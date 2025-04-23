// src/llm_client/LLMGatewayClient.ts
import {
  BaseChatModel,
  type BaseChatModelParams,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ChatResult, ChatGenerationChunk } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { v4 as uuidv4 } from "uuid";
import fetch, { Response } from "node-fetch";
import { type ToolCall } from "@langchain/core/messages/tool";
import type { Runnable } from "@langchain/core/runnables";
import { ZodType, ZodTypeDef } from "zod";

// Define StructuredOutputMethodOptions type
interface StructuredOutputMethodOptions<T extends boolean = boolean> {
  name?: string;
  method?: "functionCalling" | "jsonMode";
  includeRaw?: T;
  strict?: boolean;
}
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";

// Define internal event types
interface TextEventPayload {
  type: "text";
  text: string;
}
interface UsageEventPayload {
  type: "usage";
  usage: { inputTokens: number; outputTokens: number };
}
type LLMGatewayRawEventData = TextEventPayload | UsageEventPayload; // Remove '[DONE]' from type for easier guarding

// Interface for Constructor Options, extending BaseChatModelParams
export interface LLMGatewayClientParams extends BaseChatModelParams {
  apiUrl: string;
  apiKey: string;
  defaultThreadId?: string;
  defaultSystemPrompt?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

export class LLMGatewayClient extends BaseChatModel {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly defaultThreadId?: string;
  private readonly defaultSystemPrompt?: string;
  private readonly defaultTemperature: number;
  private readonly defaultMaxTokens: number;

  static _llmType(): string {
    return "llm-gateway";
  }
  _llmType(): string {
    return "llm-gateway";
  }

  constructor(fields: LLMGatewayClientParams) {
    super(fields);
    if (!fields.apiUrl || !fields.apiKey)
      throw new Error("API URL and API Key required.");
    this.apiUrl = fields.apiUrl;
    this.apiKey = fields.apiKey;
    this.defaultThreadId = fields.defaultThreadId;
    this.defaultSystemPrompt = fields.defaultSystemPrompt;
    this.defaultTemperature = fields.defaultTemperature ?? 0.2;
    this.defaultMaxTokens = fields.defaultMaxTokens ?? 8000;
    console.debug(
      `LLMGatewayClient (BaseChatModel) initialized. API URL: ${this.apiUrl}`
    );
  }

  /** Formats LangChain messages for the Gateway API */
  private formatGatewayMessages(
    messages: BaseMessage[]
  ): Array<{ role: string; content: string }> {
    const systemPromptMessage =
      this.defaultSystemPrompt &&
      !messages.some((m) => m._getType() === "system")
        ? [new SystemMessage(this.defaultSystemPrompt)]
        : [];

    const allMessages = [...systemPromptMessage, ...messages];

    // First map messages to their gateway format
    const formattedMessages = allMessages.map((msg) => {
      const type = msg._getType();
      switch (type) {
        case "system":
          return { role: "system", content: msg.content as string };
        case "human":
          return { role: "user", content: msg.content as string };
        case "ai":
          return { role: "assistant", content: msg.content as string };
        case "tool":
          return {
            role: "user", // **ADJUST based on your gateway's expectation**
            content: `Tool Result [${(msg as ToolMessage).tool_call_id}]:\n${
              msg.content as string
            }`,
          };
        default:
          console.warn(
            `Unhandled message type in formatGatewayMessages: ${type}`
          );
          return { role: "user", content: msg.content as string };
      }
    });
    
    // Filter out empty assistant messages except for the last one
    // This prevents the validation error from the LLM Gateway
    const filteredMessages = formattedMessages.filter((msg, index, array) => {
      // Keep all non-assistant messages
      if (msg.role !== "assistant") return true;
      
      // Keep assistant messages with content
      if (msg.content && msg.content.trim() !== "") return true;
      
      // Keep the last assistant message even if empty (allowed by the API)
      if (index === array.length - 1) return true;
      
      // Filter out empty assistant messages that aren't the last one
      console.debug(`>>> [LLMGatewayClient DEBUG] Filtering out empty assistant message at index ${index}`);
      return false;
    });
    
    return filteredMessages;
  }

  /** Parses aggregated text response for tool calls */
  private parseToolCalls(responseText: string): {
    textResponse: string;
    toolCalls?: ToolCall[];
  } {
    // ...(same as previous version)...
    const toolCalls: ToolCall[] = [];
    let finalResponseText = responseText;
    try {
      const jsonMatch = responseText.match(
        /```json\s*([\s\S]+?)\s*```|^\s*(\{[\s\S]+\})\s*$/m
      );
      if (jsonMatch) {
        const jsonString = (jsonMatch[1] ?? jsonMatch[2])?.trim();
        if (jsonString) {
          const parsedJson = JSON.parse(jsonString);
          const processCall = (call: any) => {
            if (call.tool_name && call.tool_input !== undefined) {
              console.log(`Detected tool call via JSON: ${call.tool_name}`);
              toolCalls.push({
                name: call.tool_name,
                args: call.tool_input,
                id: `tool_${uuidv4()}`,
              });
            }
          };
          if (Array.isArray(parsedJson)) {
            parsedJson.forEach(processCall);
          } else if (typeof parsedJson === "object" && parsedJson !== null) {
            processCall(parsedJson);
          }
          if (toolCalls.length > 0) {
            finalResponseText = "";
          }
        }
      }
    } catch (e) {
      console.warn("Tool call JSON parsing failed.", e);
      finalResponseText = responseText;
    }
    return {
      textResponse: finalResponseText.trim(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /** Core method: Calls the LLM Gateway API */
  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const stream = this._streamResponseChunks(messages, options, runManager);
    let aggregatedText = "";
    let usageData: any = null;
    let lastChunk: ChatGenerationChunk | undefined;

    for await (const chunk of stream) {
      aggregatedText += chunk.text;
      if (chunk.generationInfo?.usage) {
        usageData = chunk.generationInfo.usage;
      }
      lastChunk = chunk;
    }

    if (!lastChunk && !aggregatedText) {
      console.warn(
        ">>> [LLMGatewayClient WARN] _generate: LLM stream returned no content."
      );
      // Return empty message
      const emptyResult: ChatResult = {
        generations: [{ text: "", message: new AIMessage("") }],
        llmOutput: { usage: usageData },
      };
      console.debug(
        ">>> [LLMGatewayClient DEBUG] _generate: Returning empty result:",
        JSON.stringify(emptyResult)
      ); // Log result
      return emptyResult;
    }

    const { textResponse, toolCalls } = this.parseToolCalls(aggregatedText);

    const finalMessage = new AIMessage({
      content: textResponse,
      tool_calls: toolCalls,
      additional_kwargs: {
        ...(usageData ? { usage: usageData } : {}),
      },
    });

    const result: ChatResult = {
      generations: [
        {
          text: aggregatedText, // Keep full original text
          message: finalMessage,
          generationInfo: lastChunk?.generationInfo ?? {},
        },
      ],
      llmOutput: { usage: usageData },
    };

    return result;
  }

  /** Handles streaming responses */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    // Format messages for the gateway
    const gatewayMessages = this.formatGatewayMessages(messages);
    const temperature = this.defaultTemperature;
    const maxTokens = this.defaultMaxTokens;
    const stopSequences = options.stop;
    console.log(JSON.stringify(options, null, 2)); // Log formatted messages
    // Use the default threadId instead of trying to access it from options.configurable
    const threadId = this.defaultThreadId ?? uuidv4(); // Generate a new UUID if not provided
    // Make threadId optional since we're using the default
    // if (!threadId || typeof threadId !== 'string' || threadId.trim().length === 0) {
    //   throw new Error("LLM Gateway request requires a valid thread_id in invocation config.");
    // }
    const requestBody: Record<string, any> = {
      messages: gatewayMessages,
      parameters: {
        temperature,
        max_tokens: maxTokens,
        ...(stopSequences && { stop: stopSequences }),
      },
      ...(threadId && { threadId: threadId }),
    };
    const headers = {
      "Content-Type": "application/json",
      token: this.apiKey,
      Accept: "text/event-stream",
    };
    const abortController = new AbortController();
    const signal = options.signal
      ? this.abortSignalAny([options.signal, abortController.signal])
      : abortController.signal;

    let response: Response | null = null;
    let streamCancelled = false;

    try {
      response = await fetch(this.apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        const errorBody = await response
          .text()
          .catch(() => "Failed to read error body");
        console.error(
          `>>> [LLMGatewayClient ERROR] Fetch failed. Status: ${response.status}, Body: ${errorBody}`
        ); // *** ADDED LOG ***
        throw new Error(
          `LLM Gateway API Error: Status ${response.status}. Body: ${errorBody}`
        );
      }
      if (!response.body) {
        console.error(`>>> [LLMGatewayClient ERROR] Response body is null.`); // *** ADDED LOG ***
        throw new Error("Response body is null.");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let usageData: any = null;

      let chunkCounter = 0; // *** ADDED Counter ***

      for await (const chunk of response.body as any as AsyncIterable<Buffer>) {
        chunkCounter++; // *** INCREMENT Counter ***
        if (streamCancelled) {
          break;
        }

        buffer += decoder.decode(chunk, { stream: true });

        let boundaryIndex;
        while ((boundaryIndex = buffer.indexOf("\n\n")) >= 0) {
          if (streamCancelled) break;
          const message = buffer.substring(0, boundaryIndex);
          buffer = buffer.substring(boundaryIndex + 2);
          if (!message.trim()) {
            continue;
          }
          const lines = message.split("\n");
          for (const line of lines) {
            if (line.startsWith("data:")) {
              const dataStr = line.substring(5).trim();
              if (dataStr === "[DONE]") {
                streamCancelled = true;
                break;
              }
              try {
                const parsedJson = JSON.parse(dataStr);
                // ... (rest of parsing logic with type guards) ...
                if (
                  typeof parsedJson === "object" &&
                  parsedJson !== null &&
                  "type" in parsedJson
                ) {
                  const parsedData = parsedJson as LLMGatewayRawEventData;
                  if (parsedData.type === "text") {
                    yield new ChatGenerationChunk({
                      text: parsedData.text,
                      message: new AIMessageChunk({ content: parsedData.text }),
                    });
                    await runManager?.handleLLMNewToken(parsedData.text);
                  } else if (parsedData.type === "usage") {
                    usageData = parsedData.usage;
                  } else {
                    /* ... warn unknown type ... */
                  }
                } else {
                  /* ... warn invalid format ... */
                }
              } catch (e) {
                console.error(
                  ">>> [LLMGatewayClient ERROR] Failed to parse SSE JSON:",
                  dataStr,
                  e
                );
              }
            } else {
              console.debug(
                `>>> [LLMGatewayClient DEBUG] Skipping non-data line: "${line}"`
              ); // *** ADDED LOG ***
            }
          } // end for line loop
          if (streamCancelled) break;
        } // end while boundary loop
        if (streamCancelled) break;
      } // End chunk loop

      // Yield a final chunk with usage data if available
      if (usageData) {
        const usageChunk = new ChatGenerationChunk({
          text: "",
          message: new AIMessageChunk({
            content: "",
            additional_kwargs: { usage: usageData },
          }),
          generationInfo: {
            tokenUsage: {
              promptTokens: usageData.inputTokens || 0,
              completionTokens: usageData.outputTokens || 0,
              totalTokens:
                (usageData.inputTokens || 0) + (usageData.outputTokens || 0),
            },
          },
        });
        yield usageChunk;
      }
    } catch (error: any) {
      console.error(
        ">>> [LLMGatewayClient ERROR] Error during LLM stream processing:",
        error
      ); // *** ADDED LOG ***
      if (error.name === "AbortError" && !streamCancelled)
        throw new Error("Fetch aborted");
      else if (error.name !== "AbortError") throw error; // Re-throw other errors
    } finally {
      if (!signal.aborted && !streamCancelled) {
        abortController.abort();
      }
    }
  }

  /** Helper to combine AbortSignals */
  private abortSignalAny(signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        return controller.signal; // Return immediately if one is already aborted
      }
      // Add event listener to abort the combined controller when any input signal aborts
      signal.addEventListener("abort", () => controller.abort(signal.reason), {
        signal: controller.signal, // Use the controller's signal to clean up listener
      });
    }
    // Corrected: Always return the controller's signal
    return controller.signal;
  }

  /**
   * Method required by agents like createReactAgent to make tools available.
   * Returns a new runnable instance bound with the tools.
   */
  bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<BaseChatModelCallOptions> | undefined
  ): Runnable<
    BaseLanguageModelInput,
    AIMessageChunk,
    BaseChatModelCallOptions
  > {
    // Leverage the base bind method to attach tool information.
    // This doesn't change the core API call logic for this custom client,
    // but satisfies the interface requirement for createReactAgent.
    // The actual tool usage relies on the system prompt guiding the LLM.
    console.log("LLMGatewayClient.bindTools called"); // Log for debugging
    // We might want to format the tools for the LLM here if the gateway supported it,
    // but currently, we rely on the system prompt in graph.ts.
    const formattedTools = tools.map(convertToOpenAITool);
    return this.bind({
      ...kwargs,
    });
  }
  // ------------------------------

  // Implementation of withStructuredOutput that matches the BaseChatModel signature
  withStructuredOutput<
    RunOutput extends Record<string, any> = Record<string, any>
  >(
    outputSchema:
      | Record<string, any>
      | ZodType<RunOutput, ZodTypeDef, RunOutput>,
    config?: StructuredOutputMethodOptions<false> | undefined
  ): Runnable<BaseLanguageModelInput, RunOutput>;
  withStructuredOutput<
    RunOutput extends Record<string, any> = Record<string, any>
  >(
    outputSchema:
      | Record<string, any>
      | ZodType<RunOutput, ZodTypeDef, RunOutput>,
    config?: StructuredOutputMethodOptions<true> | undefined
  ): Runnable<BaseLanguageModelInput, { raw: BaseMessage; parsed: RunOutput }>;
  withStructuredOutput<
    RunOutput extends Record<string, any> = Record<string, any>
  >(
    outputSchema:
      | Record<string, any>
      | ZodType<RunOutput, ZodTypeDef, RunOutput>,
    config?: StructuredOutputMethodOptions<boolean> | undefined
  ) {
    console.warn(
      "LLMGatewayClient.withStructuredOutput called but not fully implemented."
    );

    if (config?.method === "jsonMode") {
      throw new Error(
        "This model does not support jsonMode for structured output"
      );
    }

    // Use the base implementation from BaseChatModel which uses bindTools internally
    return super.withStructuredOutput(outputSchema, config as any);
  }
}

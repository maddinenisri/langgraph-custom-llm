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
} from "@langchain/core/messages";
import { ChatResult, ChatGenerationChunk } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { v4 as uuidv4 } from "uuid";
import type { Runnable } from "@langchain/core/runnables";
import { ZodType, ZodTypeDef } from "zod";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";

// Import helper classes
import { MessageFormatter } from "./MessageFormatter";
import { ResponseParser } from "./ResponseParser";
import { StreamProcessor } from "./StreamProcessor";
import { ApiClient } from "./ApiClient";
import { abortSignalAny } from "./utils";
import { LLMGatewayError, StreamProcessingError } from "./errors";

// Define StructuredOutputMethodOptions type
interface StructuredOutputMethodOptions<T extends boolean = boolean> {
  name?: string;
  method?: "functionCalling" | "jsonMode";
  includeRaw?: T;
  strict?: boolean;
}

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
  
  // Helper class instances
  private readonly messageFormatter: MessageFormatter;
  private readonly responseParser: ResponseParser;
  private readonly streamProcessor: StreamProcessor;
  private readonly apiClient: ApiClient;

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
    
    // Initialize helper classes
    this.messageFormatter = new MessageFormatter(this.defaultSystemPrompt);
    this.responseParser = new ResponseParser();
    this.streamProcessor = new StreamProcessor();
    this.apiClient = new ApiClient(this.apiUrl, this.apiKey);
    
    console.debug(
      `LLMGatewayClient (BaseChatModel) initialized. API URL: ${this.apiUrl}`
    );
  }

  /** Core method: Calls the LLM Gateway API */
  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const stream = this._streamResponseChunks(messages, options, runManager);
    const { aggregatedText, usageData, lastChunk } = 
      await this.streamProcessor.collectStreamResults(stream);

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
      );
      return emptyResult;
    }

    const { textResponse, toolCalls } = this.responseParser.parseToolCalls(aggregatedText);

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
    // Prepare request
    const requestBody = this.prepareRequestBody(messages, options);
    const abortController = new AbortController();
    const signal = options.signal
      ? abortSignalAny([options.signal, abortController.signal])
      : abortController.signal;

    try {
      // Send request
      const response = await this.apiClient.sendRequest(requestBody, signal);
      
      if (!response.body) {
        throw new LLMGatewayError("Response body is null.");
      }

      // Process stream
      yield* this.streamProcessor.processStream(
        response.body as any as AsyncIterable<Buffer>,
        runManager
      );
    } catch (error: any) {
      console.error(
        ">>> [LLMGatewayClient ERROR] Error during LLM stream processing:",
        error
      );
      
      if (error instanceof LLMGatewayError) {
        throw error;
      }
      
      if (error.name === "AbortError") {
        throw new LLMGatewayError("Fetch aborted");
      }
      
      throw new StreamProcessingError(
        `Error during stream processing: ${error.message}`,
        error
      );
    } finally {
      if (!signal.aborted) {
        abortController.abort();
      }
    }
  }

  /**
   * Prepare the request body for the API call
   */
  private prepareRequestBody(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"]
  ): Record<string, any> {
    const gatewayMessages = this.messageFormatter.formatMessages(messages);
    const temperature = this.defaultTemperature;
    const maxTokens = this.defaultMaxTokens;
    const stopSequences = options.stop;
    const threadId = this.defaultThreadId ?? uuidv4(); // Generate a new UUID if not provided
    console.info("Options:", options);
    return {
      messages: gatewayMessages,
      parameters: {
        temperature,
        max_tokens: maxTokens,
        ...(stopSequences && { stop: stopSequences }),
      },
      ...(threadId && { threadId: threadId }),
    };
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
    console.log("LLMGatewayClient.bindTools called");
    const formattedTools = tools.map(convertToOpenAITool);
    return this.bind({
      ...kwargs,
    });
  }

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

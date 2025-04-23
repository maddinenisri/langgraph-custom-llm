// src/llm_client/StreamProcessor.ts
import { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";

// Define internal event types
export interface TextEventPayload {
  type: "text";
  text: string;
}

export interface UsageEventPayload {
  type: "usage";
  usage: { inputTokens: number; outputTokens: number };
}

export type LLMGatewayRawEventData = TextEventPayload | UsageEventPayload;

export interface StreamProcessingResult {
  aggregatedText: string;
  usageData: any;
  lastChunk?: ChatGenerationChunk;
}

export class StreamProcessor {
  private decoder = new TextDecoder();
  
  /**
   * Process a stream of chunks from the API response
   */
  async *processStream(
    responseBody: AsyncIterable<Buffer>,
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    let buffer = "";
    let usageData: any = null;
    let streamCancelled = false;

    for await (const chunk of responseBody) {
      if (streamCancelled) {
        break;
      }

      buffer += this.decoder.decode(chunk, { stream: true });

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
              if (
                typeof parsedJson === "object" &&
                parsedJson !== null &&
                "type" in parsedJson
              ) {
                const parsedData = parsedJson as LLMGatewayRawEventData;
                if (parsedData.type === "text") {
                  const chunk = new ChatGenerationChunk({
                    text: parsedData.text,
                    message: new AIMessageChunk({ content: parsedData.text }),
                  });
                  yield chunk;
                  await runManager?.handleLLMNewToken(parsedData.text);
                } else if (parsedData.type === "usage") {
                  usageData = parsedData.usage;
                } else {
                  console.warn(`Unknown event type: ${(parsedData as any).type}`);
                }
              } else {
                console.warn(`Invalid event format: ${dataStr}`);
              }
            } catch (e) {
              console.error(
                ">>> [StreamProcessor ERROR] Failed to parse SSE JSON:",
                dataStr,
                e
              );
            }
          } else {
            console.debug(
              `>>> [StreamProcessor DEBUG] Skipping non-data line: "${line}"`
            );
          }
        } // end for line loop
        
        if (streamCancelled) break;
      } // end while boundary loop
      
      if (streamCancelled) break;
    } // End chunk loop

    // Yield a final chunk with usage data if available
    if (usageData) {
      const usageChunk = this.createUsageChunk(usageData);
      yield usageChunk;
    }
  }

  /**
   * Create a chunk containing usage information
   */
  private createUsageChunk(usageData: any): ChatGenerationChunk {
    return new ChatGenerationChunk({
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
  }

  /**
   * Collect all chunks from a stream into a single result
   */
  async collectStreamResults(
    stream: AsyncGenerator<ChatGenerationChunk>
  ): Promise<StreamProcessingResult> {
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

    return {
      aggregatedText,
      usageData,
      lastChunk
    };
  }
}
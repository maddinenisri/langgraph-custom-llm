// src/llm_client/LLMGatewayClient.ts
import { v4 as uuidv4 } from 'uuid';
import fetch, { Response } from 'node-fetch';
// Use global AbortController

// Define interfaces (keep these as they are)
interface TextEventPayload { type: 'text'; text: string; }
interface UsageEventPayload { type: 'usage'; usage: { inputTokens: number; outputTokens: number; }; }
type LLMGatewayEventData = TextEventPayload | UsageEventPayload | '[DONE]';
export interface LLMStreamEvent { type: 'text' | 'usage' | 'done' | 'error'; data: any; }
export interface LLMGatewayClientOptions { systemPrompt?: string; threadId?: string; parameters?: { temperature?: number; max_tokens?: number; }; signal?: AbortSignal; }

export class LLMGatewayClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly defaultThreadId: string;
  private readonly defaultTemperature: number = 0.2;
  private readonly defaultMaxTokens: number = 8000;

  constructor(apiUrl: string, apiKey: string, defaultThreadId?: string) {
    if (!apiUrl || !apiKey) {
      throw new Error("API URL and API Key are required for LLMGatewayClient.");
    }
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.defaultThreadId = defaultThreadId ?? uuidv4();
    console.debug(`LLMGatewayClient initialized. API URL: ${this.apiUrl}, Default Thread ID: ${this.defaultThreadId}`);
  }

  // formatRequest remains the same
  private formatRequest(query: string, options: LLMGatewayClientOptions): object {
    const threadId = options.threadId || this.defaultThreadId;
    const temperature = options.parameters?.temperature ?? this.defaultTemperature;
    const maxTokens = options.parameters?.max_tokens ?? this.defaultMaxTokens;
    const messages: { role: string; content: string }[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'user', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: query });
    const requestBody = {
      messages: messages,
      parameters: { temperature: temperature, max_tokens: maxTokens, },
      threadId: threadId,
    };
    console.debug(`Formatted Request (Thread ID: ${threadId}):`, JSON.stringify(requestBody, null, 2));
    return requestBody;
  }


  public async *callLLMStream(query: string, options: LLMGatewayClientOptions = {}): AsyncGenerator<LLMStreamEvent, void, undefined> {
    const requestBody = this.formatRequest(query, options);
    const headers = {
      'Content-Type': 'application/json',
      'token': this.apiKey,
      'Accept': 'text/event-stream',
    };

    const abortController = new AbortController();
    const signal = options.signal ? this.abortSignalAny([options.signal, abortController.signal]) : abortController.signal;

    let response: Response | null = null;
    // *** Move declaration here ***
    let streamCancelled = false;

    try {
      response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: signal,
      });

      if (!response.ok) {
        let errorBody = 'Unknown error';
        try { errorBody = await response.text(); } catch { /* Ignore */ }
        throw new Error(`LLM Gateway API Error: Status ${response.status}. Body: ${errorBody}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        throw new Error(`Expected text/event-stream, but received ${contentType}`);
      }

      if (!response.body) {
         throw new Error("Response body is null.");
      }

      const decoder = new TextDecoder();
      let buffer = '';
      // Moved streamCancelled declaration before try block

      for await (const chunk of response.body as any as AsyncIterable<Buffer>) {
         if (streamCancelled) break;

         buffer += decoder.decode(chunk, { stream: true });

         let boundaryIndex;
         while ((boundaryIndex = buffer.indexOf('\n\n')) >= 0) {
            if (streamCancelled) break;
            const message = buffer.substring(0, boundaryIndex);
            buffer = buffer.substring(boundaryIndex + 2);

            if (!message.trim()) continue;

            const lines = message.split('\n');
            for (const line of lines) {
              if (line.startsWith('data:')) {
                  const data = line.substring(5).trim();
                  if (data === '[DONE]') {
                    console.info("SSE Stream [DONE] received.");
                    yield { type: 'done', data: null };
                    streamCancelled = true; // Set flag
                    if (!signal.aborted) {
                         abortController.abort(); // Abort fetch
                    }
                    return; // Exit generator
                  }
                  try {
                    const parsedData: LLMGatewayEventData = JSON.parse(data);
                    if (typeof parsedData === 'object' && parsedData !== null && 'type' in parsedData) {
                        if (parsedData.type === 'text') { yield { type: 'text', data: parsedData.text }; }
                        else if (parsedData.type === 'usage') { yield { type: 'usage', data: parsedData.usage }; }
                        else { console.warn("Received unknown SSE event data type:", parsedData); }
                    } else { console.warn("Received SSE data is not a valid JSON object with a 'type' field:", parsedData); }
                  } catch (e) {
                     console.error("Failed to parse SSE data JSON:", data, e);
                     yield { type: 'error', data: new Error(`Failed to parse SSE JSON: ${e}`) };
                  }
              }
            }
         }
         if (streamCancelled) break;
      }

      // Check streamCancelled here - now in scope
      if (!streamCancelled) {
          if (buffer.trim()) { console.warn("Stream ended with unprocessed buffer content:", buffer); }
          console.warn("SSE stream finished without explicit [DONE] marker.");
          yield { type: 'done', data: null };
      }

    } catch (error: any) {
       // Check streamCancelled here - now in scope
       if (error.name === 'AbortError') {
            console.log("Stream fetch aborted.");
            if (!streamCancelled) { // Only yield error if abort wasn't due to [DONE]
                yield { type: 'error', data: new Error("Fetch aborted") };
            }
       } else {
            console.error("Error during LLM stream processing:", error);
            yield { type: 'error', data: error };
       }
    } finally {
       console.debug("LLM Stream processing finished or errored.");
       // Check streamCancelled here - now in scope
       if (!signal.aborted && !streamCancelled) {
            abortController.abort();
       }
    }
  }

   // Helper function to combine AbortSignals (remains the same)
   private abortSignalAny(signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        return controller.signal;
      }
      signal.addEventListener("abort", () => controller.abort(signal.reason), {
        signal: controller.signal,
      });
    }
    return controller.signal;
  }

  // callLLM remains the same
  public async callLLM(query: string, options: LLMGatewayClientOptions = {}): Promise<string> {
    let fullText = '';
    const stream = this.callLLMStream(query, options);
    for await (const event of stream) {
        if (event.type === 'text') { fullText += event.data; }
        else if (event.type === 'error') {
            if (event.data?.message === 'Fetch aborted') { console.warn("callLLM aborted."); return fullText; }
            throw event.data instanceof Error ? event.data : new Error(String(event.data)); }
        else if (event.type === 'done') { break; }
    }
    return fullText;
  }
}

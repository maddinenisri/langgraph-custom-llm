import { v4 as uuidv4 } from 'uuid'; // For generating default thread IDs
import fetch from 'node-fetch';

// Define interfaces for expected SSE message structures
interface TextEventPayload {
  type: 'text';
  text: string;
}

interface UsageEventPayload {
  type: 'usage';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// Type for the data field within an SSE message
type LLMGatewayEventData = TextEventPayload | UsageEventPayload | '[DONE]';

export interface LLMGatewayClientOptions {
  systemPrompt?: string;
  threadId?: string;
  parameters?: {
    temperature?: number;
    max_tokens?: number;
  };
  signal?: AbortSignal; // Allow passing an AbortSignal
}

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

  private formatRequest(query: string, options: LLMGatewayClientOptions): object {
    const threadId = options.threadId || this.defaultThreadId;
    const temperature = options.parameters?.temperature ?? this.defaultTemperature;
    const maxTokens = options.parameters?.max_tokens ?? this.defaultMaxTokens;

    const messages: { role: string; content: string }[] = [];

    if (options.systemPrompt) {
      messages.push({ role: 'user', content: options.systemPrompt }); // Map system to user role per API spec
    }
    messages.push({ role: 'user', content: query });

    // Note: Handling conversation history (adding assistant messages)
    // would typically be managed by the calling agent (LangGraph state)
    // and passed into this client if needed, modifying the 'messages' array here.

    const requestBody = {
      messages: messages,
      parameters: {
        temperature: temperature,
        max_tokens: maxTokens,
      },
      threadId: threadId,
    };
    console.debug(`Formatted Request (Thread ID: ${threadId}):`, JSON.stringify(requestBody, null, 2));
    return requestBody;
  }

  // Non-streaming version that collects all chunks and returns a complete response
  public async callLLM(query: string, options: LLMGatewayClientOptions = {}): Promise<string> {
    const requestBody = this.formatRequest(query, options);
    const headers = {
      'Content-Type': 'application/json',
      'token': this.apiKey,
      'Accept': 'text/event-stream',
    };

    try {
      // Use node-fetch instead of fetchEventSource
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM Gateway API Error: Status ${response.status}. Body: ${errorText}`);
      }

      // Check if the response is SSE
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('text/event-stream')) {
        // If not SSE, just return the text
        return await response.text();
      }

      // Process SSE manually
      let fullText = '';
      const text = await response.text();
      const lines = text.split('\n');

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data:')) continue;

        // Extract the data part
        const data = line.substring(5).trim();
        
        if (data === '[DONE]') {
          break;
        }

        try {
          const parsedData = JSON.parse(data);
          if (parsedData.type === 'text') {
            fullText += parsedData.text;
          }
        } catch (e) {
          console.error('Failed to parse SSE data:', data);
          throw e;
        }
      }

      return fullText;
    } catch (error: any) {
      console.error('Error calling LLM Gateway:', error);
      throw error;
    }
  }
}

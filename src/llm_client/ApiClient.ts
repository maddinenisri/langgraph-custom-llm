// src/llm_client/ApiClient.ts
import fetch, { Response } from "node-fetch";
import { LLMGatewayError } from "./errors";

export class ApiClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  /**
   * Constructor for ApiClient
   * @param apiUrl - The URL of the LLM Gateway API
   * @param apiKey - The API key for authentication
   */
  constructor(
    private readonly _apiUrl: string,
    private readonly _apiKey: string
  ) {
    if (!_apiUrl || !_apiKey) {
      throw new Error("API URL and API Key are required.");
    }
    this.apiUrl = _apiUrl;
    this.apiKey = _apiKey;
  }

  /**
   * Send a request to the LLM Gateway API
   */
  async sendRequest(requestBody: any, signal?: AbortSignal): Promise<Response> {
    const headers = {
      "Content-Type": "application/json",
      token: this.apiKey,
      Accept: "text/event-stream",
    };

    try {
      const response = await fetch(this.apiUrl, {
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
          `>>> [ApiClient ERROR] Fetch failed. Status: ${response.status}, Body: ${errorBody}`
        );

        throw new LLMGatewayError(
          `LLM Gateway API Error: Status ${response.status}`,
          response.status,
          errorBody
        );
      }

      if (!response.body) {
        console.error(`>>> [ApiClient ERROR] Response body is null.`);
        throw new LLMGatewayError("Response body is null.");
      }

      return response;
    } catch (error: any) {
      if (error instanceof LLMGatewayError) {
        throw error;
      }

      if (error.name === "AbortError") {
        throw new LLMGatewayError(
          "Request was aborted",
          undefined,
          "AbortError"
        );
      }

      throw new LLMGatewayError(
        `API request failed: ${error.message}`,
        undefined,
        error.toString()
      );
    }
  }
}

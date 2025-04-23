// src/llm_client/errors.ts

/**
 * Custom error class for LLM Gateway API errors
 */
export class LLMGatewayError extends Error {
  constructor(
    message: string, 
    public statusCode?: number, 
    public responseBody?: string
  ) {
    super(message);
    this.name = 'LLMGatewayError';
  }
}

/**
 * Custom error class for stream processing errors
 */
export class StreamProcessingError extends Error {
  constructor(
    message: string, 
    public originalError?: Error
  ) {
    super(message);
    this.name = 'StreamProcessingError';
  }
}
// src/llm_client/utils.ts

/**
 * Combines multiple AbortSignals into a single AbortSignal that aborts when any of the input signals abort
 */
export function abortSignalAny(signals: AbortSignal[]): AbortSignal {
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
  
  return controller.signal;
}

/**
 * Creates an empty result object when no content is returned from the LLM
 */
export function createEmptyResult(usageData: any) {
  const result = {
    generations: [{ text: "", message: { content: "" } }],
    llmOutput: { usage: usageData },
  };
  
  console.debug(
    ">>> [LLMGatewayClient DEBUG] _generate: Returning empty result:",
    JSON.stringify(result)
  );
  
  return result;
}
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// Reducer function to ensure threadId persists once set
const threadIdReducer = (
    current?: string,
    update?: string
): string | undefined => {
    // If an update is provided, use it. Otherwise, keep the current one.
    // This prevents a node returning 'undefined' from clearing the threadId.
    return update?? current;
};

// Define the state structure using Annotations
export const AgentStateAnnotation = Annotation.Root({
    // Manages the list of messages (Human, AI, Tool)
    messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y), // Append new messages
        default: () => [],             // Start with an empty list
    }),
    // Stores the persistent thread ID for the LLM Gateway
    threadId: Annotation<string | undefined>({
        reducer: threadIdReducer,      // Use custom reducer to persist
        default: () => undefined,      // Start with no thread ID (will be set on first invoke)
    }),
    // Optional: Add fields for error tracking or planning later
    // errorCount: Annotation<number>({ reducer: (x, y) => (x?? 0) + (y?? 0), default: () => 0 }),
    // plan: Annotation<string>({ reducer: (x, y) => y?? x??, default: () => }), // Example from S12
});

// Export the TypeScript type for convenience
export type AgentState = typeof AgentStateAnnotation.State;

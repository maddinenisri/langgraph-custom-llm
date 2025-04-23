// src/agent/state.ts
import { BaseMessage } from "@langchain/core/messages";

// The state schema focuses on accumulating messages.
// createReactAgent manages the internal ReAct steps implicitly.
export interface AgentState {
  messages: BaseMessage[];
  // Add other state fields here if your specific workflow requires them later.
}

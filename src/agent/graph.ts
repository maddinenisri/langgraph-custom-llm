// src/agent/graph.ts
import { StateGraph, END } from "@langchain/langgraph";
import { AgentStateAnnotation, AgentState } from "./state";
import { callCustomLLMNode } from "./agentNode";
import { toolNode } from "./toolExecutor";
import { BaseMessage, AIMessage } from "@langchain/core/messages";

// Create a builder for the graph
const builder = new StateGraph(AgentStateAnnotation)
  .addNode("agent", callCustomLLMNode)
  .addNode("tools", toolNode);

// Define the conditional routing logic
function shouldContinue(state: any): "tools" | typeof END {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  if (
    lastMessage && 
    lastMessage instanceof AIMessage &&
    'tool_calls' in lastMessage &&
    lastMessage.tool_calls &&
    lastMessage.tool_calls.length > 0
  ) {
    console.log("Conditional Edge: Routing to tools");
    return "tools";
  } else {
    console.log("Conditional Edge: Routing to END");
    return END;
  }
}

// Define the edges
builder.addConditionalEdges(
  "agent",
  shouldContinue,
  {
    "tools": "tools",
    [END]: END
  }
);

// Connect tools back to agent
builder.addEdge("tools", "agent");

// Set the entry point
builder.setEntryPoint("agent");

// Compile the graph
export const app = builder.compile();

console.log("LangGraph ReAct agent graph defined and compiled.");

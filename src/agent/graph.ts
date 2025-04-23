// src/agent/graph.ts
import { StateGraph, END } from "@langchain/langgraph";
import { AgentStateAnnotation } from "./state";
import { callCustomLLMNode } from "./agentNode";
import { tools as originalTools } from "./toolExecutor";
import { AIMessage } from "@langchain/core/messages";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const figmaApiKey = process.env.FIGMA_API_KEY;
if (!figmaApiKey) {
    throw new Error("FIGMA_API_KEY environment variable is not set. Cannot initialize Figma MCP client.");
}

// Create client and connect to server
const client = new MultiServerMCPClient({
  throwOnLoadError: true,
  prefixToolNameWithServerName: true,
  additionalToolNamePrefix: "mcp",
  mcpServers: {
    "figma-mcp": {
      transport: "stdio",
      command: "npx",
      args: ["-y", "figma-developer-mcp", `--figma-api-key=${figmaApiKey}`, "--stdio"],
      // env: {
      //   FIGMA_API_KEY: figmaApiKey,
      //   PATH: `${nodeBinPath}:${process.env.PATH}`,
      // },
      restart: {
        enabled: true,
        maxAttempts: 3,
        delayMs: 1000,
      },
    },
  },
});

async function createGraph() {
  console.log("Initializing MCP client and loading tools...");
  const mcpTools = await client.getTools();
  console.log(`Loaded ${mcpTools.length} MCP tools.`);
  const allTools = [...originalTools, ...mcpTools];
  const combinedToolNode = new ToolNode(allTools);
  console.log(`ToolNode created with ${allTools.length} total tools.`);

  // Create a builder for the graph
  const builder = new StateGraph(AgentStateAnnotation)
    .addNode("agent", callCustomLLMNode)
    .addNode("tools", combinedToolNode);

  // Define the conditional routing logic
  function shouldContinue(state: any): "tools" | typeof END {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage &&
      lastMessage instanceof AIMessage &&
      "tool_calls" in lastMessage &&
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
  builder.addConditionalEdges("agent", shouldContinue, {
    tools: "tools",
    [END]: END,
  });

  // Connect tools back to agent
  builder.addEdge("tools", "agent");

  // Set the entry point
  builder.setEntryPoint("agent");

  // Compile the graph
  const graph = builder.compile();
  console.log("LangGraph ReAct agent graph defined and compiled.");
  // *** Implement the close function attached to the app ***
  (graph as any).closeMcpClient = async () => {
    console.log("(App Method) Closing MCP client...");
    await client.close(); // Call close on the client instance
    console.log("(App Method) MCP client closed.");
  };

  return graph;
}

// Export promise (keep existing logic)
export const appPromise = createGraph();
export const closeMcpClient = async () => {
  console.log("(Exported Function) Closing MCP client...");
  await client.close(); // Call close on the client instance
  console.log("(Exported Function) MCP client closed.");
};

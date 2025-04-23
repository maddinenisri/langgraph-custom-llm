// src/agent/graph.ts
import 'dotenv/config';
import { BaseMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { standardTools } from "./toolExecutor";
import { AgentState } from "./state";
import { LLMGatewayClient } from "../llm_client/LLMGatewayClient";
// Corrected Import: Use StructuredToolInterface or a more general base type
import { type StructuredToolInterface } from "@langchain/core/tools";

// Load environment variables
const figmaApiKey = process.env.FIGMA_API_KEY;
const gatewayApiUrl = process.env.LLM_GATEWAY_API_URL;
const gatewayApiKey = process.env.LLM_GATEWAY_API_KEY;

// Validate necessary environment variables
if (!figmaApiKey) throw new Error("FIGMA_API_KEY not set.");
if (!gatewayApiUrl) throw new Error("LLM_GATEWAY_API_URL not set.");
if (!gatewayApiKey) throw new Error("LLM_GATEWAY_API_KEY not set.");

// --- Define llm and mcpClient OUTSIDE createAgent ---
const llm = new LLMGatewayClient({
    apiUrl: gatewayApiUrl,
    apiKey: gatewayApiKey,
});
console.log(`Using Custom LLM Gateway Client via BaseChatModel`);

const mcpClient = new MultiServerMCPClient({
  throwOnLoadError: true,
  prefixToolNameWithServerName: true,
  additionalToolNamePrefix: "mcp",
  mcpServers: {
    "figma-mcp": {
      transport: "stdio",
      command: "npx",
      args: ["-y", "figma-developer-mcp", `--figma-api-key=${figmaApiKey}`, "--stdio"],
      restart: { enabled: true, maxAttempts: 3, delayMs: 1000 },
    },
  },
});
// -----------------------------------------------------


// --- System Prompt (remains the same) ---
const systemPrompt = `You are a helpful assistant designed to answer questions and perform tasks using a specific set of tools. You have access to a workspace directory for file operations. **ALL file paths MUST be relative to the workspace root (e.g., "my_file.txt", "data/results.json"). Do NOT use absolute paths or "../".**

When you need to use a tool, you MUST respond with ONLY a single JSON object formatted EXACTLY like this:
\`\`\`json
{
  "tool_name": "EXACT_TOOL_NAME_AS_LISTED_BELOW",
  "tool_input": { /* arguments matching the tool's schema description */ }
}
\`\`\`
Do NOT add any explanation before or after the JSON block.

Available Tools:
${standardTools.map(t => `- ${t.name}: ${t.description}. Input arguments should follow this structure: ${JSON.stringify(t.schema ?? {})}`).join('\n')}
- mcp__figma-mcp__get_figma_data: Gets Figma file/node layout data. Input arguments should follow this structure: { "fileKey": "string", "nodeId": "string" (optional), "depth": "number" (optional) }
- mcp__figma-mcp__download_figma_images: Downloads Figma images. Input arguments should follow this structure: { "fileKey": "string", "nodes": [{ "nodeId": "string", "imageRef": "string" (optional), "fileName": "string" }], "localPath": "string" }
# Add JIRA tool details here when integrated

Example Calculator Call:
\`\`\`json
{
  "tool_name": "calculator",
  "tool_input": {"operation": "add", "num1": 15, "num2": 27}
}
\`\`\`
Example List Files Call (listing root):
\`\`\`json
{
  "tool_name": "list_files",
  "tool_input": {"directoryPath": "."}
}
\`\`\`
Example Write File Call:
\`\`\`json
{
  "tool_name": "write_file",
  "tool_input": {"filePath": "output/analysis.md", "content": "# Analysis Results\\n\\nBased on the data..."}
}
\`\`\`

If you can answer directly without using a tool, provide your response as plain text.`;
// ----------------------------------------


// --- Main Async Function to Create the Agent ---
async function createAgent() {
  console.log("Initializing MCP client and loading tools...");
  // Corrected: Use StructuredToolInterface type
  let mcpTools: StructuredToolInterface[] = [];
  try {
      mcpTools = await mcpClient.getTools(); // MCP client likely returns tools compatible with this interface
      console.log(`Loaded ${mcpTools.length} MCP tools.`);
  } catch (error) {
       console.error("Failed to load MCP tools:", error);
       console.warn("Proceeding without MCP tools due to loading error.");
  }

  // Corrected: Use StructuredToolInterface type for the combined list
  // Standard tools created with tool() should also conform to this interface
  const allTools: StructuredToolInterface[] = [...standardTools, ...mcpTools];
  if (allTools.length === 0) {
       console.warn("Warning: No tools are available for the agent!");
  } else {
       console.log(`Total tools available: ${allTools.length}`);
       allTools.forEach(tool => console.log(` - ${tool.name}`));
  }

  const agentApp = createReactAgent({
      llm: llm,
      tools: allTools,
      messageModifier: systemPrompt,
  });

  console.log("LangGraph ReAct agent created using createReactAgent and Custom LLM Gateway.");

  return agentApp;
}

export const appPromise = createAgent();
export const closeMcpClient = async () => {
  console.log("(Exported Function) Closing MCP client...");
  try {
    await mcpClient.close();
    console.log("(Exported Function) MCP client closed.");
  } catch (error) {
     console.error("Error closing MCP client:", error);
  }
};

export type AgentInput = { messages: BaseMessage[] };
export type AgentOutput = { messages: BaseMessage[] };

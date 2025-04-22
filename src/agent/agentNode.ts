import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { LLMGatewayClient } from '../llm_client/LLMGatewayClient'; // Import the client
import { MessagesAnnotation } from "@langchain/langgraph"; // Assuming MessagesAnnotation is used
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs
import { RunnableConfig } from "@langchain/core/runnables";

// Define the expected state structure for this node
// Needs to align with the overall GraphState defined later
type AgentNodeState = {
    messages: BaseMessage[];
    threadId: string;
    // Potentially other state fields like systemPrompt
};

// Assume client is instantiated elsewhere or passed via config for better management
// For simplicity here, we might instantiate it inside, but consider dependency injection.
let llmClient: LLMGatewayClient; // Needs initialization

function initializeLLMClient() {
    const apiUrl = process.env.LLM_GATEWAY_API_URL;
    const apiKey = process.env.LLM_GATEWAY_API_KEY;
    if (!apiUrl ||!apiKey) {
        throw new Error("LLM Gateway API URL and Key must be set in environment variables.");
    }
    if (!llmClient) { // Simple singleton pattern
        llmClient = new LLMGatewayClient(apiUrl, apiKey);
    }
    return llmClient;
}

// The custom node function
export async function callCustomLLMNode(state: AgentNodeState, config?: RunnableConfig): Promise<Partial<AgentNodeState>> {
    console.log("Entering callCustomLLMNode...");
    const client = initializeLLMClient();
    const { messages, threadId } = state;

    // Extract the last user message as the query (adjust logic if needed)
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage ||!(lastMessage instanceof HumanMessage)) {
        // Or handle cases where the last message isn't from the user
        console.warn("Last message is not a HumanMessage, skipping LLM call.");
        // Return no new messages or a specific error message
        return { messages: [new AIMessage({ content: "Internal Error: Expected user input." })] } as Partial<AgentNodeState>;
    }
    const query = lastMessage.content as string;

    // --- Prepare options for the client ---
    const systemPrompt = "You are a helpful ReAct agent. Analyze the user query and decide whether to use a tool or respond directly. If using a tool, respond ONLY with a JSON object like: {\"tool_name\": \"tool_to_call\", \"tool_input\": {\"arg1\": \"value1\"}}. Otherwise, provide your final answer."; // Example prompt instructing the LLM
    const gatewayOptions = {
        systemPrompt: systemPrompt, // Or get from state if dynamic
        threadId: threadId,
        signal: config?.runId? AbortSignal.timeout(60000) : undefined // Example timeout using RunnableConfig
        // parameters can also be passed if needed
    };

    let toolCalls: any[] = []; // To store detected tool calls
    let usageData: any = null;

    console.log(`Calling LLM Gateway for thread ${threadId} with query: "${query}"`);

    let aggregatedResponse: string;
    try {
        // Use the non-streaming version of the client
        aggregatedResponse = await client.callLLM(query, gatewayOptions);
        console.log("LLM response received.");
    } catch (error: any) {
        console.error("Failed to invoke LLM:", error);
        return { messages: [new AIMessage({ content: `Critical error calling LLM: ${error?.message || 'Unknown error'}` })] } as Partial<AgentNodeState>;
    }

    console.log("Aggregated LLM Response:", aggregatedResponse);

    // --- Post-process the aggregated response ---
    // Attempt to parse the response for a tool call JSON object
    // This relies on the LLM following the prompt instructions precisely.
    try {
        // Basic check: Does it look like a JSON object intended for tool call?
        const potentialJson = aggregatedResponse.trim();
        if (potentialJson.startsWith('{') && potentialJson.endsWith('}')) {
            const parsedJson = JSON.parse(potentialJson);
            if (parsedJson.tool_name && parsedJson.tool_input) {
                 console.log(`Detected tool call: ${parsedJson.tool_name}`);
                 // Format according to LangChain's expected tool_calls structure
                 toolCalls.push({
                     name: parsedJson.tool_name,
                     args: parsedJson.tool_input,
                     id: `tool_${uuidv4()}` // Generate a unique ID for the tool call
                 });
                 // Important: If a tool call is detected, the AIMessage content should ideally be empty
                 // or contain only the reasoning *before* the JSON. Resetting here for clarity.
                 aggregatedResponse = ""; // Or keep reasoning text if LLM provided it separately
            }
        }
    } catch (e) {
        // Not a valid JSON tool call, assume it's a final answer.
        console.log("No valid tool call JSON detected in response.");
        throw e;
    }

    // Construct the AIMessage for the graph state update
    const aiMessage = new AIMessage({
        content: aggregatedResponse, // Will be empty if a tool call was parsed
        additional_kwargs: {
           ...(usageData? { usage: usageData } : {}),
           ...(toolCalls.length > 0? { tool_calls: toolCalls } : {})
        },
        tool_calls: toolCalls.length > 0? toolCalls : undefined, // Include parsed tool calls if any
    });

    console.log("Returning AIMessage:", JSON.stringify(aiMessage, null, 2));
    return { messages: [aiMessage] } as Partial<AgentNodeState>;
}

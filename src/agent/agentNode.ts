// src/agent/agentNode.ts
import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { LLMGatewayClient, LLMGatewayClientOptions, LLMStreamEvent } from '../llm_client/LLMGatewayClient'; // Import the refactored client and event type
import { v4 as uuidv4 } from 'uuid';
import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState } from "./state"; // Import the AgentState type

// Reuse client instance (consider dependency injection for production)
let llmClient: LLMGatewayClient;

function initializeLLMClient() {
    const apiUrl = process.env.LLM_GATEWAY_API_URL;
    const apiKey = process.env.LLM_GATEWAY_API_KEY;
    if (!apiUrl || !apiKey) {
        throw new Error("LLM Gateway API URL and Key must be set in environment variables.");
    }
    if (!llmClient) { // Simple singleton pattern
        llmClient = new LLMGatewayClient(apiUrl, apiKey);
    }
    return llmClient;
}

// The custom node function, updated to consume the stream
export async function callCustomLLMNode(state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> {
    console.log("Entering callCustomLLMNode...");
    const client = initializeLLMClient();
    // Ensure threadId is managed correctly. The state definition ensures it persists.
    const { messages, threadId } = state;

    // Need a threadId to proceed with the stateful API
    if (!threadId) {
         console.error("Error: threadId is missing in the agent state.");
         // Returning an error message within the standard message structure
         return { messages: [new AIMessage("Internal Error: Missing conversation thread ID.")] };
    }

    // Find the last human message or relevant message context for the LLM call
    // This might need more sophisticated logic depending on how tool results are handled
    const lastMessage = messages[messages.length - 1];
    let query: string;

    if (lastMessage instanceof HumanMessage) {
        query = lastMessage.content as string;
    } else if (lastMessage instanceof ToolMessage) {
        // If the last message was a tool result, the LLM needs context.
        // Send the recent history (e.g., last Human msg, AI tool req, Tool result)
        // For simplicity here, we'll just use the tool result as the "query" input,
        // assuming the full history is implicitly handled by the threadId on the gateway side.
        // A more robust approach might format recent messages explicitly.
        query = `Tool Result for ${lastMessage.name}: ${typeof lastMessage.content === 'object' ? JSON.stringify(lastMessage.content) : lastMessage.content}`;
        console.log("Last message was ToolMessage, using its content for context.");
    } else {
        console.warn("Last message is not HumanMessage or ToolMessage, attempting to proceed but context might be limited.");
        // Fallback or error handling needed?
        // For now, try using the content if available, otherwise error.
        if (typeof lastMessage?.content === 'string') {
            query = lastMessage.content;
        } else {
             return { messages: [new AIMessage("Internal Error: Could not determine query from last message.")] };
        }
    }

    // --- Prepare options for the client ---
    // Use a prompt that instructs the LLM on the ReAct process and tool format
    const systemPrompt = "You are a helpful ReAct agent. Analyze the user query and conversation history. Decide whether to use a tool or respond directly. If using a tool, respond ONLY with a JSON object like: {\"tool_name\": \"tool_to_call\", \"tool_input\": {\"arg1\": \"value1\"}}. If the query is ambiguous, ask for clarification. Otherwise, provide your final answer directly to the user.";
    const gatewayOptions: LLMGatewayClientOptions = {
        systemPrompt: systemPrompt, // System prompts mapped to 'user' role in client
        threadId: threadId,
        signal: config?.runId ? AbortSignal.timeout(60000) : undefined // Example timeout
    };

    let aggregatedResponse = "";
    let usageData: any = null;
    let toolCalls: any[] = [];

    console.log(`Calling LLM Gateway Stream for thread ${threadId} with query context: "${query}"`);

    try {
        const stream = client.callLLMStream(query, gatewayOptions);

        for await (const event of stream) {
            if (event.type === 'text') {
                aggregatedResponse += event.data;
            } else if (event.type === 'usage') {
                usageData = event.data;
            } else if (event.type === 'done') {
                console.log("LLM Stream finished.");
                break; // Exit loop on done
            } else if (event.type === 'error') {
                console.error("Error during LLM stream:", event.data);
                // Return an AIMessage indicating the error
                const errorMessage = event.data instanceof Error ? event.data.message : String(event.data);
                return { messages: [new AIMessage(`Error communicating with LLM: ${errorMessage}`)] };
            }
        }
    } catch (error: any) {
        console.error("Failed to invoke LLM stream:", error);
        return { messages: [new AIMessage(`Critical error calling LLM: ${error?.message || 'Unknown error'}`)] };
    }

    console.log("Aggregated LLM Response:", aggregatedResponse);

    // --- Post-process the aggregated response for tool calls ---
    // This parsing logic depends heavily on the LLM following the prompt instructions.
    try {
        // Improve robustness: Check if the *entire* response is intended as JSON
        const potentialJson = aggregatedResponse.trim();
        if (potentialJson.startsWith('{') && potentialJson.endsWith('}')) {
            // Attempt to parse only if it looks like a complete JSON object
            const parsedJson = JSON.parse(potentialJson);
            // Check for expected tool call structure
            if (parsedJson.tool_name && parsedJson.tool_input !== undefined) { // Ensure tool_input exists
                 console.log(`Detected tool call: ${parsedJson.tool_name}`);
                 toolCalls.push({
                     name: parsedJson.tool_name,
                     args: parsedJson.tool_input, // Pass input directly
                     id: `tool_${uuidv4()}` // Generate unique ID for LangChain tracking
                 });
                 // If a tool call is detected, clear the textual response.
                 // The AIMessage content should be empty when tool_calls is present for LangGraph's ToolNode.
                 aggregatedResponse = "";
            }
        }
    } catch (e) {
        // If JSON parsing fails or structure doesn't match, assume it's a textual response.
        console.log("No valid tool call JSON detected in the response, treating as text.");
    }

    // Construct the AIMessage for the graph state update
    const aiMessage = new AIMessage({
        content: aggregatedResponse, // Textual response or empty string if tool call detected
        // Include tool calls ONLY if they were successfully parsed
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        // Optionally include usage data in additional_kwargs if needed later
        additional_kwargs: {
           ...(usageData ? { usage: usageData } : {}),
           // Note: tool_calls are now a primary attribute, but keep in kwargs if desired for other reasons
           // ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
        },
    });

    console.log("Returning AIMessage:", JSON.stringify(aiMessage, null, 2));
    // Return the new AIMessage wrapped in the expected state update structure
    return { messages: [aiMessage] };
}

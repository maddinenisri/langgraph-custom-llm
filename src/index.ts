// src/index.ts
import 'dotenv/config'; // Load environment variables first
import { HumanMessage, AIMessage } from '@langchain/core/messages';
// Import the promise that resolves to the app
import { appPromise, closeMcpClient } from './agent/graph';
import { v4 as uuidv4 } from 'uuid';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// Simple in-memory store (keep as is)
const conversationThreads: Record<string, { messages: (HumanMessage | AIMessage)[] }> = {}; // Adjusted type slightly

async function main() {
    console.log("Waiting for agent graph to compile...");
    // --- Wait for the async graph creation to complete ---
    const app = await appPromise;
    console.log("Agent graph ready.");
    // --- End Change ---

    console.log("LangGraph Custom ReAct Agent with MCP Tools");
    console.log("Enter 'quit' to exit.");

    const rl = readline.createInterface({ input, output });
    let currentThreadId: string | null = null;

    // Register cleanup handler for MCP client
    let closing = false;
    const cleanup = async () => {
        if (!closing) {
             closing = true;
             console.log("\nShutting down agent and MCP client...");
             rl.close(); // Close readline interface
             await closeMcpClient(); // Close the MCP client
             console.log("Shutdown complete.");
             process.exit(0);
        }
    };

    process.on('SIGINT', cleanup); // Handle Ctrl+C
    process.on('SIGTERM', cleanup); // Handle termination signals

    while (true) {
        const userInput = await rl.question(currentThreadId ? `User (Thread: ${currentThreadId}): ` : "User (New Thread): ");

        if (userInput.toLowerCase() === 'quit') {
            await cleanup(); // Ensure cleanup on quit
            break;
        }

        if (!currentThreadId) {
            currentThreadId = uuidv4();
            conversationThreads[currentThreadId] = { messages: [] };
            console.log(`Started new conversation thread: ${currentThreadId}`);
        }

        const humanMessage = new HumanMessage(userInput);
        const currentState = {
            messages: [humanMessage],
            threadId: currentThreadId,
        };

        console.log("\nInvoking agent...");
        try {
            const finalState = await app.invoke(currentState, { configurable: { thread_id: currentThreadId } });

            const messages = finalState.messages;
            const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

            if (lastMessage instanceof AIMessage) {
                let responseContent = '';
                 if (Array.isArray(lastMessage.content)) {
                     responseContent = lastMessage.content
                        .map((item: any) => typeof item === 'string' ? item : JSON.stringify(item))
                        .join(' ');
                 } else if (typeof lastMessage.content === 'string') {
                     responseContent = lastMessage.content;
                 }

                 if (responseContent) {
                    console.log(`\nAgent: ${responseContent}`);
                 } else if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
                     // Log tool calls more informatively
                     const toolNames = lastMessage.tool_calls.map(tc => tc.name).join(', ');
                     console.log(`\nAgent: (Executed tool(s): ${toolNames}) - Waiting for next step or final answer.`);
                 } else {
                     console.log("\nAgent: (No textual response generated)");
                 }
            } else {
                console.log("\nAgent: (No AI message found in final state)");
                console.log("Final State:", JSON.stringify(finalState, null, 2));
            }

            // --- Optional: Persist history ---
            // conversationThreads[currentThreadId].messages.push(humanMessage);
            // if (lastMessage instanceof AIMessage) {
            //    conversationThreads[currentThreadId].messages.push(lastMessage);
            // }
            // --- End Optional ---

        } catch (error) {
            console.error("\nError invoking agent:", error);
        }
        console.log("------------------------------------");
    }

    // Fallback cleanup if loop exits unexpectedly
    await cleanup();
}

main().catch(async (err) => {
    console.error("Unhandled error during main execution:", err);
    // Ensure MCP client is closed even on unhandled errors
    await closeMcpClient().catch(closeErr => console.error("Error closing MCP client during error handling:", closeErr));
    process.exit(1);
});
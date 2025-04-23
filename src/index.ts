// src/index.ts
import 'dotenv/config';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { appPromise, closeMcpClient, AgentInput, AgentOutput } from './agent/graph';
import { v4 as uuidv4 } from 'uuid';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { RunnableConfig } from '@langchain/core/runnables';
import { MemorySaver } from "@langchain/langgraph";

async function main() {
    console.log("Waiting for agent graph to compile...");
    const app = await appPromise; // app is a Runnable
    console.log("Agent graph ready.");

    const memory = new MemorySaver(); // In-memory checkpointer

    // Removed: const appWithMemory = app.withConfig({ checkpointer: memory });
    // We will try passing checkpointer via invoke config

    console.log("LangGraph Standard ReAct Agent (Custom LLM Backend) with MCP Tools");
    console.log("Enter 'quit' to exit.");

    const rl = readline.createInterface({ input, output });
    let currentThreadId: string | null = null;

    // --- Cleanup Handler (remains the same) ---
    let closing = false;
    const cleanup = async () => {
         if (!closing) {
             closing = true;
             console.log("\nShutting down agent and MCP client...");
             rl.close();
             await closeMcpClient();
             console.log("Shutdown complete.");
             process.exit(0);
         }
     };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    // ------------------------------------

    while (true) {
        const prompt = currentThreadId ? `User (Thread: ${currentThreadId.substring(0, 6)}...): ` : "User (New Thread): ";
        // Corrected: Ensure userInput is defined here
        const userInput = await rl.question(prompt); // <--- userInput is defined here

        if (userInput.toLowerCase() === 'quit') {
            await cleanup();
            break;
        }
        // Corrected: Check userInput after definition
        if (!userInput.trim()) continue;

        if (!currentThreadId) {
            currentThreadId = uuidv4();
            console.log(`Started new conversation thread: ${currentThreadId}`);
        }

        // Corrected: Use the defined userInput variable
        const agentInput: AgentInput = { messages: [new HumanMessage(userInput)] };

        // Config for the invoke call
        const invokeConfig: RunnableConfig = {
             configurable: {
                 thread_id: currentThreadId,
                 // Attempt: Pass checkpointer via configurable. Keys might vary.
                 // Common patterns use 'checkpointer' or might be implicit via thread_id
                 // If this specific key doesn't work, memory won't function correctly.
                 checkpointer: memory,
             },
             recursionLimit: 100,
         };

        console.log(`\nInvoking agent for thread ${currentThreadId}...`);
        try {
            const finalState: AgentOutput = await app.invoke(agentInput, invokeConfig);

            const allMessages = finalState.messages;
            const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;

            if (lastMessage instanceof AIMessage) {
                 let responseContent = '';
                 if (Array.isArray(lastMessage.content)) { // Handle array content
                     responseContent = lastMessage.content
                         .map((item: any) => typeof item === 'string' ? item : JSON.stringify(item))
                         .join('\n');
                 } else if (typeof lastMessage.content === 'string') {
                     responseContent = lastMessage.content;
                 }

                 if (responseContent.trim()) {
                     console.log(`\nAgent: ${responseContent}`);
                 } else if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
                      const toolNames = lastMessage.tool_calls.map(tc => tc.name).join(', ');
                     console.log(`\nAgent: (Executed tool(s): ${toolNames})`);
                 } else {
                     console.log("\nAgent: (No textual response or tool call detected in final message)");
                 }
            } else {
                console.log("\nAgent: (Last message was not from AI)");
                 if (lastMessage) console.log("Last Message:", JSON.stringify(lastMessage, null, 2));
                 else console.log("Final State contained no messages.");
            }

        } catch (error) {
            console.error("\nError invoking agent:", error);
            // Consider adding error message back to state via memory if needed
        }
        console.log("------------------------------------");
    }

    await cleanup();
}

main().catch(async (err) => {
    console.error("Unhandled error during main execution:", err);
    await closeMcpClient().catch(closeErr => console.error("Error closing MCP client during error handling:", closeErr));
    process.exit(1);
});

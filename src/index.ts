// src/index.ts
import 'dotenv/config'; // Load environment variables first
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { app } from './agent/graph'; // Import the compiled LangGraph app
import { v4 as uuidv4 } from 'uuid';
import * as readline from 'node:readline/promises'; // For interactive input
import { stdin as input, stdout as output } from 'node:process';

// Simple in-memory store for conversation threads (replace with persistent storage)
const conversationThreads: Record<string, { messages: HumanMessage[] }> = {};

async function main() {
    console.log("LangGraph Custom ReAct Agent");
    console.log("Enter 'quit' to exit.");

    const rl = readline.createInterface({ input, output });

    let currentThreadId: string | null = null;

    while (true) {
        const userInput = await rl.question(currentThreadId? `User (Thread: ${currentThreadId}): ` : "User (New Thread): ");

        if (userInput.toLowerCase() === 'quit') {
            break;
        }

        if (!currentThreadId) {
            currentThreadId = uuidv4();
            conversationThreads[currentThreadId] = { messages: [] };
            console.log(`Started new conversation thread: ${currentThreadId}`);
        }

        // Prepare state for invocation
        const humanMessage = new HumanMessage(userInput);
        // For subsequent turns, load previous messages if needed by the graph state definition
        // This example assumes the graph manages history internally via MessagesAnnotation
        const currentState = {
            messages: [humanMessage], // Pass only the new message if using MessagesAnnotation
            threadId: currentThreadId,
        };

        console.log("\nInvoking agent...");
        try {
            // Invoke the agent graph
            // Pass thread_id in config for potential checkpointing/persistence
            const finalState = await app.invoke(currentState, { configurable: { thread_id: currentThreadId } });

            // Extract the final AI response
            const messages = finalState.messages;
            const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
            
            if (lastMessage && lastMessage instanceof AIMessage) {
                // Check if content is an array (possible with streaming/tool use structure)
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
                } else if ('tool_calls' in lastMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
                    console.log(`\nAgent: (Executed tool: ${lastMessage.tool_calls[0].name}) - Waiting for next step or final answer.`);
                    // In a real UI, you might show tool execution status
                } else {
                    console.log("\nAgent: (No textual response generated)");
                }
            } else {
                console.log("\nAgent: (No AI message found in final state)");
                console.log("Final State:", JSON.stringify(finalState, null, 2)); // Log state for debugging
            }

            // Update conversation history (if managing externally)
            // conversationThreads.messages.push(humanMessage);
            // if (lastMessage && lastMessage._getType() === 'ai') {
            //     conversationThreads.messages.push(lastMessage as AIMessage);
            // }

        } catch (error) {
            console.error("\nError invoking agent:", error);
            // Consider resetting thread or specific error handling
        }
        console.log("------------------------------------");
    }

    rl.close();
    console.log("Exiting agent.");
}

main();

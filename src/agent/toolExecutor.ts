import { tool } from "@langchain/core/tools";
import { z } from "zod"; // For schema definition
import { ToolNode } from "@langchain/langgraph/prebuilt";

// Example: Simple Search Tool Placeholder
const searchTool = tool(
    async ({ query }: { query: string }) => {
        console.log(`--- Executing Search Tool ---`);
        console.log(`Query: ${query}`);
        // In a real scenario, call Tavily, Google Search, etc.
        // Example based on S13 schema
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate async work
        if (query.toLowerCase().includes("weather in sf")) {
            return "The weather in San Francisco is currently 60 degrees and foggy.";
        } else if (query.toLowerCase().includes("react agent")) {
             return "A ReAct agent uses a cycle of Reason, Act, Observe to interact with tools and solve problems.";
        }
        return `Search results for "${query}" indicate it's a complex topic.`;
    },
    {
        name: "search",
        description: "Useful for searching the web for information about current events, facts, or specific topics.",
        schema: z.object({
            query: z.string().describe("The search query to use."),
        }),
    }
);

// Example: Calculator Tool (similar to S37)
const calculatorTool = tool(
    async ({ operation, num1, num2 }: { operation: string, num1: number, num2: number }) => {
         console.log(`--- Executing Calculator Tool ---`);
         console.log(`Operation: ${operation}, Operands: ${num1}, ${num2}`);
         switch (operation) {
             case 'add': return `${num1 + num2}`;
             case 'subtract': return `${num1 - num2}`;
             case 'multiply': return `${num1 * num2}`;
             case 'divide': return num2!== 0? `${num1 / num2}` : 'Error: Division by zero';
             default: return `Error: Unknown operation "${operation}"`;
         }
    },
    {
        name: "calculator",
        description: "Useful for performing simple arithmetic calculations (add, subtract, multiply, divide).",
        schema: z.object({
            operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The operation to perform."),
            num1: z.number().describe("The first number."),
            num2: z.number().describe("The second number."),
        }),
    }
);

// Export the tools for use in the graph
export const tools = [searchTool, calculatorTool];

// Create the ToolNode instance
export const toolNode = new ToolNode(tools);

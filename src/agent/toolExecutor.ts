// src/agent/toolExecutor.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { TavilySearch } from "@langchain/tavily"; // Example using Tavily
import * as fs from "fs/promises"; // Use promises API
import * as path from "path";

// --- Workspace Configuration ---
const WORKSPACE_DIR = process.env.WORKSPACE_DIR;

if (!WORKSPACE_DIR) {
    console.warn("WORKSPACE_DIR environment variable not set. File system tools will be disabled.");
} else {
     // Ensure workspace directory exists on startup (optional, but good practice)
     fs.mkdir(WORKSPACE_DIR, { recursive: true }).catch(err => {
          console.error(`Error creating workspace directory '${WORKSPACE_DIR}':`, err);
          // Potentially disable tools if creation fails critically
     });
}

// Helper function to safely resolve paths within the workspace
function resolveWorkspacePath(relativePath: string): string | null {
    if (!WORKSPACE_DIR) return null; // Disable if workspace isn't configured

    // Prevent absolute paths and path traversal
    if (path.isAbsolute(relativePath) || relativePath.includes("..")) {
        console.warn(`Security Alert: Attempted file access outside workspace: ${relativePath}`);
        return null; // Indicate invalid path
    }

    // Resolve the path relative to the workspace directory
    const fullPath = path.resolve(WORKSPACE_DIR, relativePath);

    // Final check: Ensure the resolved path is still within the workspace boundary
    if (!fullPath.startsWith(path.resolve(WORKSPACE_DIR))) {
         console.warn(`Security Alert: Resolved path escaped workspace: ${fullPath}`);
        return null; // Indicate invalid path
    }

    return fullPath;
}

// --- File System Tools Definitions ---

const listFilesTool = tool(
    async ({ directoryPath = "." }: { directoryPath?: string }) => {
         console.log(`--- Executing List Files Tool ---`);
         const safeDir = resolveWorkspacePath(directoryPath);
         if (!safeDir) return "Error: Invalid or disallowed directory path.";

         try {
             console.log(`Listing files in resolved path: ${safeDir}`);
             const files = await fs.readdir(safeDir, { withFileTypes: true });
             const fileList = files.map(dirent => `${dirent.name}${dirent.isDirectory() ? '/' : ''}`);
             return `Files in '${directoryPath}':\n${fileList.join('\n')}`;
         } catch (error: any) {
             console.error(`Error listing files in ${safeDir}:`, error);
             return `Error listing files: ${error.message}`;
         }
    },
    {
        name: "list_files",
        description: `Lists files and directories within a specified sub-directory of the workspace. Paths MUST be relative to the workspace root. Example: "." for root, "subfolder" for a subfolder. Do NOT use absolute paths or "..".`,
        schema: z.object({
            directoryPath: z.string().optional().describe(`Relative path to the directory within the workspace (e.g., ".", "documents", "data/images"). Defaults to workspace root (".").`),
        }),
    }
);

const readFileTool = tool(
    async ({ filePath }: { filePath: string }) => {
         console.log(`--- Executing Read File Tool ---`);
         const safePath = resolveWorkspacePath(filePath);
         if (!safePath) return "Error: Invalid or disallowed file path.";

         try {
             console.log(`Reading file from resolved path: ${safePath}`);
             const content = await fs.readFile(safePath, 'utf-8');
             // Consider adding limits for very large files
             if (content.length > 50000) { // Example limit: 50k chars
                 console.warn(`File content truncated due to size limit: ${filePath}`);
                 return `File content (truncated):\n${content.substring(0, 50000)}...`;
             }
             return `File content of '${filePath}':\n${content}`;
         } catch (error: any) {
             console.error(`Error reading file ${safePath}:`, error);
             // Provide specific error messages
             if (error.code === 'ENOENT') {
                  return `Error: File not found at path '${filePath}'.`;
             }
             return `Error reading file: ${error.message}`;
         }
    },
    {
        name: "read_file",
        description: `Reads the content of a specified file within the workspace. Paths MUST be relative to the workspace root. Example: "document.txt", "scripts/myscript.js". Do NOT use absolute paths or "..".`,
        schema: z.object({
            filePath: z.string().describe(`Relative path to the file within the workspace (e.g., "notes.txt", "code/main.py").`),
        }),
    }
);

const writeFileTool = tool(
    async ({ filePath, content }: { filePath: string, content: string }) => {
         console.log(`--- Executing Write File Tool ---`);
         const safePath = resolveWorkspacePath(filePath);
         if (!safePath) return "Error: Invalid or disallowed file path.";

         try {
             // Ensure the directory exists before writing
             const dirName = path.dirname(safePath);
             await fs.mkdir(dirName, { recursive: true });

             console.log(`Writing content to resolved path: ${safePath}`);
             await fs.writeFile(safePath, content, 'utf-8');
             return `Successfully wrote content to file '${filePath}'.`;
         } catch (error: any) {
             console.error(`Error writing file ${safePath}:`, error);
             return `Error writing file: ${error.message}`;
         }
    },
    {
        name: "write_file",
        description: `Writes content to a specified file within the workspace. Creates directories if they don't exist. Overwrites the file if it already exists. Paths MUST be relative to the workspace root. Example: "output.log", "results/data.json". Do NOT use absolute paths or "..".`,
        schema: z.object({
            filePath: z.string().describe(`Relative path to the file within the workspace (e.g., "new_notes.md", "data/output.csv").`),
            content: z.string().describe("The content to write into the file."),
        }),
    }
);

// --- Standard Tools ---

// Use Tavily Search (requires TAVILY_API_KEY in .env)
// Replace with your preferred search tool implementation if needed.
const searchTool = process.env.TAVILY_API_KEY
    ? new TavilySearch({ maxResults: 3, tavilyApiKey: process.env.TAVILY_API_KEY })
    : tool(async () => "Search is unavailable. Please set TAVILY_API_KEY.", {
          name: "tavily_search_results_json", // Keep standard name if possible
          description: "A search engine. Useful for when you need to answer questions about current events. Input should be a search query.",
          schema: z.object({ query: z.string() })
      });


const calculatorTool = tool(
    async ({ operation, num1, num2 }: { operation: string, num1: number, num2: number }) => {
         console.log(`--- Executing Calculator Tool ---`);
         try {
             switch (operation) {
                 case 'add': return `${num1 + num2}`;
                 case 'subtract': return `${num1 - num2}`;
                 case 'multiply': return `${num1 * num2}`;
                 case 'divide':
                     if (num2 === 0) return 'Error: Division by zero';
                     return `${num1 / num2}`;
                 default: return `Error: Unknown operation "${operation}"`;
             }
         } catch (e) {
             return `Error performing calculation: ${e instanceof Error ? e.message : String(e)}`;
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

// Export the standard tools array with a more flexible type
export const standardTools: any[] = [searchTool, calculatorTool];

// Conditionally add file tools if WORKSPACE_DIR is set
if (WORKSPACE_DIR) {
    standardTools.push(listFilesTool, readFileTool, writeFileTool);
    console.log("File system tools (list_files, read_file, write_file) enabled for workspace:", WORKSPACE_DIR);
} else {
    console.log("File system tools disabled (WORKSPACE_DIR not set).");
}
// Add JIRA tool instantiation here when ready
// if (process.env.JIRA_URL && ...) {
//    const jiraTool = new JiraTool({...});
//    standardTools.push(jiraTool);
// }
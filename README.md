# LangGraph ReAct Agent with Custom LLM Gateway

This project implements a LangGraph-based ReAct agent that uses a custom LLM Gateway client for language model interactions. The agent can execute various tools, including file operations, search, calculations, and external API integrations through the Model Context Protocol (MCP).

## Project Overview

The project creates a conversational agent that:
- Uses LangGraph's ReAct framework for reasoning and action
- Connects to a custom LLM Gateway instead of using standard OpenAI or other LLM providers
- Supports streaming responses for better user experience
- Integrates with external tools via the Model Context Protocol (MCP)
- Maintains conversation state across interactions

## Architecture

The project is structured into several key components:

```
src/
├── agent/              # Agent implementation
│   ├── graph.ts        # LangGraph agent definition
│   ├── state.ts        # Agent state management
│   └── toolExecutor.ts # Tool definitions
├── llm_client/         # Custom LLM Gateway client
│   ├── ApiClient.ts        # API communication
│   ├── LLMGatewayClient.ts # Main client implementation
│   ├── MessageFormatter.ts # Message formatting
│   ├── ResponseParser.ts   # Response parsing
│   ├── StreamProcessor.ts  # Stream handling
│   ├── errors.ts           # Error definitions
│   └── utils.ts            # Utility functions
└── index.ts            # Application entry point
```

## Key Components

### 1. LangGraph Agent

The agent is built using LangGraph's `createReactAgent` function, which implements the ReAct (Reasoning and Acting) pattern. The agent:
- Processes user inputs
- Decides when to use tools vs. providing direct responses
- Maintains conversation context
- Executes tools and incorporates their results

### 2. Custom LLM Gateway Client

The custom LLM Gateway client extends LangChain's `BaseChatModel` to integrate with a proprietary LLM API. Key features include:
- Streaming response support
- Tool calling detection and parsing
- Error handling and retry mechanisms
- Usage tracking

### 3. Tool System

The agent has access to several tools:
- File system tools (list_files, read_file, write_file)
- Search tool (using Tavily)
- Calculator tool
- MCP-based tools (e.g., Figma API integration)

### 4. MCP Integration

The Model Context Protocol (MCP) allows the agent to connect to external services like:
- Figma (for design data)
- JIRA (planned)
- Other potential integrations

## Sequence Flow

The application follows this sequence flow:

1. **Initialization**:
   - Load environment variables
   - Initialize the LLM Gateway client
   - Set up MCP clients and load tools
   - Create the LangGraph agent

2. **User Interaction**:
   - User provides input via the command line
   - Input is converted to a HumanMessage
   - A unique thread ID is assigned if not already present

3. **Agent Processing**:
   - The agent receives the input message
   - The LLM Gateway client formats messages and sends them to the LLM API
   - The LLM decides whether to use a tool or respond directly
   - If using a tool, the tool is executed and results are fed back to the LLM
   - This cycle continues until the LLM provides a final answer

4. **Response Handling**:
   - Streaming responses are processed and displayed to the user
   - Tool calls are detected and executed
   - Final responses are formatted and presented to the user

5. **State Management**:
   - Conversation state is maintained using LangGraph's memory system
   - Thread IDs ensure continuity across interactions

## Custom LLM Integration

The custom LLM integration is a key feature of this project. Instead of using standard LLM providers, it connects to a custom LLM Gateway API. Here's how it works:

### LLMGatewayClient

The `LLMGatewayClient` class extends LangChain's `BaseChatModel` and implements:
- Message formatting for the custom API
- Streaming response handling
- Tool call detection and parsing
- Error handling

### Message Flow

1. **Input Processing**:
   - LangChain messages are converted to the format expected by the Gateway API
   - System prompts are added if not present
   - Messages are filtered to prevent API validation errors

2. **API Communication**:
   - Requests are sent to the Gateway API with proper authentication
   - Streaming responses are received as Server-Sent Events (SSE)

3. **Response Processing**:
   - Text chunks are collected and aggregated
   - Tool calls are detected in JSON format
   - Usage statistics are tracked
   - Responses are converted back to LangChain message format

### Stream Processing

The streaming implementation:
- Processes chunks of text as they arrive
- Updates the UI in real-time
- Handles special events like usage statistics
- Manages errors and connection issues

## Tools and Capabilities

### Standard Tools

1. **File System Tools**:
   - `list_files`: Lists files in a directory
   - `read_file`: Reads file content
   - `write_file`: Writes content to a file

2. **Search Tool**:
   - Uses Tavily API for web search capabilities

3. **Calculator Tool**:
   - Performs basic arithmetic operations

### MCP Tools

The MCP integration allows for extensible tool support:

1. **Figma MCP**:
   - `get_figma_data`: Retrieves design data from Figma
   - `download_figma_images`: Downloads images from Figma designs

2. **Future Integrations**:
   - JIRA integration (planned)
   - Other MCP servers can be added as needed

## Setup and Configuration

### Environment Variables

The application requires several environment variables:
- `LLM_GATEWAY_API_URL`: URL of the LLM Gateway API
- `LLM_GATEWAY_API_KEY`: API key for authentication
- `FIGMA_API_KEY`: API key for Figma integration
- `WORKSPACE_DIR`: Directory for file operations
- `TAVILY_API_KEY`: API key for Tavily search (optional)

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys and configuration

# Start the application
npm run dev
```

## Usage

The application provides a command-line interface for interacting with the agent:

```bash
# Start the application
npm run dev

# Interact with the agent
User (New Thread): What's the weather in San Francisco?
# The agent will use appropriate tools to answer

# Start a new conversation
User (New Thread): Tell me about this Figma design: https://www.figma.com/design/LDGL25myJHzodDBeCP9UUY/ReDuX---Card-Demo
# The agent will use the Figma MCP to analyze the design

# Exit the application
User: quit
```

## Development and Extension

### Adding New Tools

To add a new tool:

1. Define the tool in `src/agent/toolExecutor.ts`:
```typescript
const myNewTool = tool(
  async ({ param1, param2 }) => {
    // Tool implementation
    return result;
  },
  {
    name: "my_new_tool",
    description: "Description of what the tool does",
    schema: z.object({
      param1: z.string().describe("Description of param1"),
      param2: z.number().describe("Description of param2"),
    }),
  }
);

// Add to standardTools array
standardTools.push(myNewTool);
```

### Adding MCP Integrations

To add a new MCP server:

1. Update the MCP client configuration in `src/agent/graph.ts`:
```typescript
const mcpClient = new MultiServerMCPClient({
  // Existing configuration...
  mcpServers: {
    // Existing servers...
    "new-mcp-server": {
      transport: "stdio",
      command: "npx",
      args: ["-y", "new-mcp-package", "--arg=value", "--stdio"],
      restart: { enabled: true, maxAttempts: 3, delayMs: 1000 },
    },
  },
});
```

2. Update the system prompt to include the new tools

### Customizing the LLM Gateway Client

To modify the LLM Gateway client behavior:

1. Adjust message formatting in `src/llm_client/MessageFormatter.ts`
2. Update response parsing in `src/llm_client/ResponseParser.ts`
3. Modify stream processing in `src/llm_client/StreamProcessor.ts`

## Conclusion

This LangGraph ReAct Agent with Custom LLM Gateway demonstrates how to build a flexible, extensible agent system that can integrate with custom language models and external tools. The architecture allows for easy extension with new capabilities while maintaining a clean separation of concerns between the agent logic, LLM integration, and tool execution.
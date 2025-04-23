// src/llm_client/MessageFormatter.ts
import { BaseMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

export class MessageFormatter {
  constructor(private defaultSystemPrompt?: string) {}

  /**
   * Formats LangChain messages for the Gateway API
   */
  formatMessages(messages: BaseMessage[]): Array<{ role: string; content: string }> {
    const systemPromptMessage =
      this.defaultSystemPrompt &&
      !messages.some((m) => m._getType() === "system")
        ? [new SystemMessage(this.defaultSystemPrompt)]
        : [];

    const allMessages = [...systemPromptMessage, ...messages];

    // First map messages to their gateway format
    const formattedMessages = allMessages.map((msg) => {
      const type = msg._getType();
      switch (type) {
        case "system":
          return { role: "system", content: msg.content as string };
        case "human":
          return { role: "user", content: msg.content as string };
        case "ai":
          return { role: "assistant", content: msg.content as string };
        case "tool":
          return {
            role: "user", // **ADJUST based on your gateway's expectation**
            content: `Tool Result [${(msg as ToolMessage).tool_call_id}]:\n${
              msg.content as string
            }`,
          };
        default:
          console.warn(
            `Unhandled message type in formatGatewayMessages: ${type}`
          );
          return { role: "user", content: msg.content as string };
      }
    });
    
    // Filter out empty assistant messages except for the last one
    // This prevents the validation error from the LLM Gateway
    const filteredMessages = formattedMessages.filter((msg, index, array) => {
      // Keep all non-assistant messages
      if (msg.role !== "assistant") return true;
      
      // Keep assistant messages with content
      if (msg.content && msg.content.trim() !== "") return true;
      
      // Keep the last assistant message even if empty (allowed by the API)
      if (index === array.length - 1) return true;
      
      // Filter out empty assistant messages that aren't the last one
      console.debug(`>>> [LLMGatewayClient DEBUG] Filtering out empty assistant message at index ${index}`);
      return false;
    });
    
    return filteredMessages;
  }
}
// src/llm_client/ResponseParser.ts
import { v4 as uuidv4 } from "uuid";
import { type ToolCall } from "@langchain/core/messages/tool";

export class ResponseParser {
  /**
   * Parses aggregated text response for tool calls
   */
  parseToolCalls(responseText: string): {
    textResponse: string;
    toolCalls?: ToolCall[];
  } {
    const toolCalls: ToolCall[] = [];
    let finalResponseText = responseText;
    
    try {
      const jsonMatch = responseText.match(
        /```json\s*([\s\S]+?)\s*```|^\s*(\{[\s\S]+\})\s*$/m
      );
      
      if (jsonMatch) {
        const jsonString = (jsonMatch[1] ?? jsonMatch[2])?.trim();
        if (jsonString) {
          const parsedJson = JSON.parse(jsonString);
          const processCall = (call: any) => {
            if (call.tool_name && call.tool_input !== undefined) {
              console.log(`Detected tool call via JSON: ${call.tool_name}`);
              toolCalls.push({
                name: call.tool_name,
                args: call.tool_input,
                id: `tool_${uuidv4()}`,
              });
            }
          };
          
          if (Array.isArray(parsedJson)) {
            parsedJson.forEach(processCall);
          } else if (typeof parsedJson === "object" && parsedJson !== null) {
            processCall(parsedJson);
          }
          
          if (toolCalls.length > 0) {
            finalResponseText = "";
          }
        }
      }
    } catch (e) {
      console.warn("Tool call JSON parsing failed.", e);
      finalResponseText = responseText;
    }
    
    return {
      textResponse: finalResponseText.trim(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
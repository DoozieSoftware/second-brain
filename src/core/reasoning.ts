import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

export interface ReasoningOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ReasoningResult {
  content: string;
  toolCalls: ToolCall[];
  usage: { promptTokens: number; completionTokens: number };
}

const DEFAULT_MODEL = 'google/gemma-2-9b-it:free';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export class ReasoningEngine {
  private client: OpenAI;
  private defaultModel: string;
  private supportsToolCalling: boolean | null = null;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error('OPENROUTER_API_KEY is required. Set it in .env or pass it to the constructor.');
    }

    this.client = new OpenAI({
      apiKey: key,
      baseURL: OPENROUTER_BASE,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/DoozieSoftware/second-brain',
        'X-Title': 'Second Brain',
      },
    });

    this.defaultModel = process.env.DEFAULT_MODEL || DEFAULT_MODEL;
  }

  async chat(
    messages: ChatCompletionMessageParam[],
    tools?: ChatCompletionTool[],
    options?: ReasoningOptions
  ): Promise<ReasoningResult> {
    const model = options?.model || this.defaultModel;

    const params: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 2048,
    };

    // If we know tools work, or haven't tested yet, try with tools
    if (tools && tools.length > 0 && this.supportsToolCalling !== false) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }

    try {
      const response = await this.client.chat.completions.create(params);
      const choice = response.choices[0];

      if (!choice) {
        throw new Error('No response from model. The API returned an empty result.');
      }

      const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          // Model returned malformed JSON for tool arguments
          console.warn(`[Reasoning] Malformed tool args for ${tc.function.name}: ${tc.function.arguments}`);
        }
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        };
      });

      // Mark that tool calling works
      if (this.supportsToolCalling === null && tools && tools.length > 0) {
        this.supportsToolCalling = toolCalls.length > 0 || true; // Model accepted tools param
      }

      let content = choice.message.content || '';

      // If no tool calls but tools were expected, try parsing tool requests from text
      if (toolCalls.length === 0 && tools && tools.length > 0 && content) {
        const parsedCalls = this.parseToolCallsFromText(content, tools);
        if (parsedCalls.length > 0) {
          // Strip the tool request from the visible content
          return {
            content: content.replace(/TOOL_CALL:[\s\S]*/i, '').trim(),
            toolCalls: parsedCalls,
            usage: {
              promptTokens: response.usage?.prompt_tokens || 0,
              completionTokens: response.usage?.completion_tokens || 0,
            },
          };
        }
      }

      return {
        content,
        toolCalls,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
        },
      };
    } catch (error) {
      // Classify the error for better feedback
      if (error instanceof Error) {
        // Tool calling not supported — retry without tools
        if (error.message.includes('tool') && params.tools) {
          this.supportsToolCalling = false;
          delete params.tools;
          delete params.tool_choice;
          const response = await this.client.chat.completions.create(params);
          const choice = response.choices[0];
          return {
            content: choice?.message?.content || '',
            toolCalls: [],
            usage: {
              promptTokens: response.usage?.prompt_tokens || 0,
              completionTokens: response.usage?.completion_tokens || 0,
            },
          };
        }

        // Authentication errors
        if (error.message.includes('401') || error.message.includes('403')) {
          throw new Error(
            'OpenRouter API key is invalid or expired. Check your OPENROUTER_API_KEY in .env'
          );
        }

        // Rate limiting
        if (error.message.includes('429')) {
          throw new Error(
            'OpenRouter rate limit hit. Wait a moment and try again, or upgrade your API key.'
          );
        }

        // Network errors
        if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT') || error.message.includes('fetch failed')) {
          throw new Error(
            'Cannot reach OpenRouter API. Check your internet connection.'
          );
        }
      }

      throw error;
    }
  }

  /**
   * Parse tool calls from plain text when function calling isn't available.
   * Looks for patterns like:
   *   TOOL_CALL: search_memory({"query": "authentication", "top_k": 5})
   */
  private parseToolCallsFromText(content: string, availableTools: ChatCompletionTool[]): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const toolNames = availableTools.map(t => t.function.name);

    // Pattern: TOOL_CALL: tool_name({json args})
    const pattern = /TOOL_CALL:\s*(\w+)\s*\(([^)]*)\)/gi;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const toolName = match[1];
      const argsStr = match[2];

      if (!toolNames.includes(toolName)) continue;

      try {
        // Try to parse as JSON
        const args = JSON.parse(argsStr);
        toolCalls.push({
          id: `tool_${Date.now()}_${toolCalls.length}`,
          name: toolName,
          arguments: args,
        });
      } catch {
        // Try to extract key-value pairs
        const args = this.parseLooseArgs(argsStr);
        if (args) {
          toolCalls.push({
            id: `tool_${Date.now()}_${toolCalls.length}`,
            name: toolName,
            arguments: args,
          });
        }
      }
    }

    return toolCalls;
  }

  /**
   * Try to parse loose argument formats like:
   *   query: "authentication", top_k: 5
   *   "query": "authentication"
   */
  private parseLooseArgs(str: string): Record<string, unknown> | null {
    const result: Record<string, unknown> = {};

    // Match patterns like key: "value" or key: number
    const pattern = /(\w+):\s*(?:"([^"]*)"|(\d+))/g;
    let match;

    while ((match = pattern.exec(str)) !== null) {
      const key = match[1];
      const strVal = match[2];
      const numVal = match[3];

      if (strVal !== undefined) {
        result[key] = strVal;
      } else if (numVal !== undefined) {
        result[key] = parseInt(numVal, 10);
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  }
}

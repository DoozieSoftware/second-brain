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

const DEFAULT_MODEL = 'meta-llama/llama-3.2-3b-instruct:free';

// Free models to rotate through when rate-limited
const FREE_MODELS = [
  'meta-llama/llama-3.2-3b-instruct:free',
  'qwen/qwen3-4b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
];

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export class ReasoningEngine {
  private client: OpenAI;
  private defaultModel: string;
  private supportsToolCalling: boolean | null = null;
  private freeModelRotation = 0;

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
    const baseModel = options?.model || this.defaultModel;

    // Build list of models to try (primary + fallbacks)
    const modelsToTry = baseModel.includes(':free')
      ? [baseModel, ...FREE_MODELS.filter(m => m !== baseModel)]
      : [baseModel];

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < modelsToTry.length && attempt < MAX_RETRIES; attempt++) {
      const model = modelsToTry[attempt];

      try {
        return await this.tryChat(messages, tools, options, model);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry auth errors or permanent failures
        if (lastError.message.includes('401') || lastError.message.includes('403')) {
          throw new Error('OpenRouter API key is invalid or expired. Check your OPENROUTER_API_KEY in .env');
        }

        // For rate limits, try next model
        if (lastError.message.includes('429') || lastError.message.includes('rate limit')) {
          if (attempt < modelsToTry.length - 1) {
            console.log(`[Reasoning] ${model} rate-limited, trying ${modelsToTry[attempt + 1]}...`);
            await this.delay(RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
        }

        // For "no endpoints" errors, try next model
        if (lastError.message.includes('404') || lastError.message.includes('No endpoints')) {
          if (attempt < modelsToTry.length - 1) {
            console.log(`[Reasoning] ${model} unavailable, trying ${modelsToTry[attempt + 1]}...`);
            continue;
          }
        }

        // For provider errors, try next model
        if (lastError.message.includes('Provider returned error') || lastError.message.includes('400')) {
          if (attempt < modelsToTry.length - 1) {
            console.log(`[Reasoning] ${model} error, trying ${modelsToTry[attempt + 1]}...`);
            continue;
          }
        }

        // For network errors, retry same model once
        if (lastError.message.includes('ECONNREFUSED') || lastError.message.includes('ETIMEDOUT') || lastError.message.includes('fetch failed')) {
          if (attempt < 1) {
            console.log(`[Reasoning] Network error, retrying ${model}...`);
            await this.delay(RETRY_DELAY_MS);
            continue;
          }
          throw new Error('Cannot reach OpenRouter API. Check your internet connection.');
        }

        // Unknown error, throw it
        throw lastError;
      }
    }

    throw lastError || new Error('All models failed');
  }

  private async tryChat(
    messages: ChatCompletionMessageParam[],
    tools?: ChatCompletionTool[],
    options?: ReasoningOptions,
    model?: string
  ): Promise<ReasoningResult> {
    const params: OpenAI.Chat.ChatCompletionCreateParams = {
      model: model || this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 2048,
    };

    if (tools && tools.length > 0 && this.supportsToolCalling !== false) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }

    const response = await this.client.chat.completions.create(params);

    if (!response || !response.choices) {
      const error = (response as any)?.error;
      if (error) throw new Error(`OpenRouter API error: ${error.message || JSON.stringify(error)}`);
      throw new Error('No response from model.');
    }

    const choice = response.choices[0];
    if (!choice) throw new Error('No response choice from model.');

    const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map((tc) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments); } catch { /* malformed */ }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });

    if (this.supportsToolCalling === null && tools?.length) {
      this.supportsToolCalling = toolCalls.length > 0 || true;
    }

    let content = choice.message.content || '';

    // Fallback: parse TOOL_CALL: from text if no native tool calls
    if (toolCalls.length === 0 && tools?.length && content) {
      const parsedCalls = this.parseToolCallsFromText(content, tools);
      if (parsedCalls.length > 0) {
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
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private parseToolCallsFromText(content: string, availableTools: ChatCompletionTool[]): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const toolNames = availableTools.map(t => t.function.name);
    const pattern = /TOOL_CALL:\s*(\w+)\s*\(([^)]*)\)/gi;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const toolName = match[1];
      const argsStr = match[2];
      if (!toolNames.includes(toolName)) continue;

      try {
        toolCalls.push({
          id: `tool_${Date.now()}_${toolCalls.length}`,
          name: toolName,
          arguments: JSON.parse(argsStr),
        });
      } catch {
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

  private parseLooseArgs(str: string): Record<string, unknown> | null {
    const result: Record<string, unknown> = {};
    const pattern = /(\w+):\s*(?:"([^"]*)"|(\d+))/g;
    let match;
    while ((match = pattern.exec(str)) !== null) {
      const key = match[1];
      if (match[2] !== undefined) result[key] = match[2];
      else if (match[3] !== undefined) result[key] = parseInt(match[3], 10);
    }
    return Object.keys(result).length > 0 ? result : null;
  }
}

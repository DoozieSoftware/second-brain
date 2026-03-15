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

  constructor(apiKey?: string) {
    const key = apiKey || process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error('OPENROUTER_API_KEY is required. Set it in .env or pass it to the constructor.');
    }

    this.client = new OpenAI({
      apiKey: key,
      baseURL: OPENROUTER_BASE,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/second-brain',
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

    if (tools && tools.length > 0) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];

    const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      content: choice.message.content || '',
      toolCalls,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
      },
    };
  }
}

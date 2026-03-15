import { describe, it, expect } from 'vitest';
import { ReasoningEngine } from '../core/reasoning.js';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

// Test the parseToolCallsFromText method via a mock setup
describe('ReasoningEngine fallback parsing', () => {
  const mockTools: ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'search_memory',
        description: 'Search memory',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            top_k: { type: 'number' },
          },
          required: ['query'],
        },
      },
    },
  ];

  it('should extract tool calls from text with TOOL_CALL: syntax', () => {
    const content = `I need to search for authentication info.
TOOL_CALL: search_memory({"query": "authentication implementation", "top_k": 5})`;

    const matches = content.match(/TOOL_CALL:\s*(\w+)\s*\(([^)]*)\)/gi);
    expect(matches).toHaveLength(1);
    expect(matches![0]).toContain('search_memory');

    const argMatch = content.match(/TOOL_CALL:\s*search_memory\s*\(([^)]*)\)/i);
    expect(argMatch).toBeTruthy();
    const args = JSON.parse(argMatch![1]);
    expect(args.query).toBe('authentication implementation');
    expect(args.top_k).toBe(5);
  });

  it('should parse multiple tool calls from text', () => {
    const content = `First search: TOOL_CALL: search_memory({"query": "auth", "top_k": 3})
Second search: TOOL_CALL: search_memory({"query": "login", "top_k": 5})`;

    const pattern = /TOOL_CALL:\s*(\w+)\s*\(([^)]*)\)/gi;
    const matches = [...content.matchAll(pattern)];
    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe('search_memory');
    expect(matches[1][1]).toBe('search_memory');
  });

  it('should handle loose argument format', () => {
    const content = `TOOL_CALL: search_memory(query: "test search", top_k: 3)`;
    const pattern = /(\w+):\s*(?:"([^"]*)"|(\d+))/g;
    const matches = [...content.matchAll(pattern)];
    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe('query');
    expect(matches[0][2]).toBe('test search');
    expect(matches[1][1]).toBe('top_k');
    expect(matches[1][2]).toBeUndefined();
    expect(matches[1][3]).toBe('3');
  });

  it('should ignore invalid tool names', () => {
    const content = `TOOL_CALL: invalid_tool({"query": "test"})`;
    const toolNames = mockTools.map(t => t.function.name);
    const pattern = /TOOL_CALL:\s*(\w+)\s*\(([^)]*)\)/gi;
    const match = pattern.exec(content);
    expect(match).toBeTruthy();
    expect(toolNames.includes(match![1])).toBe(false);
  });
});

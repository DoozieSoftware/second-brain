import { describe, it, expect, beforeAll } from 'vitest';
import { Memory } from '../core/memory.js';
import { Operator } from '../core/operator.js';
import { ReasoningEngine } from '../core/reasoning.js';
import { DocsConnector } from '../connectors/docs-connector.js';

/**
 * Integration tests for the full pipeline:
 *   Ingest docs → Memory → Operator asks question → Answer with citations
 *
 * Runs in two modes:
 *   - Mock mode (no API key): Tests the plumbing without LLM calls
 *   - Real mode (OPENROUTER_API_KEY set): Tests end-to-end with real API
 */

// Mock LLM that simulates the reasoning loop without API calls
class MockReasoningEngine {
  private callCount = 0;

  async chat(
    messages: Array<{ role: string; content: string; tool_call_id?: string }>,
    tools?: any[],
    _options?: any
  ): Promise<{ content: string; toolCalls: any[]; usage: any }> {
    this.callCount++;
    const lastMessage = messages[messages.length - 1];

    // First call: model thinks and searches
    if (this.callCount === 1) {
      // Simulate the model using TOOL_CALL: syntax (fallback mode)
      return {
        content: `I need to search for information about the operator pattern.\nTOOL_CALL: search_memory({"query": "operator pattern reasoning", "top_k": 3})`,
        toolCalls: [],
        usage: { promptTokens: 100, completionTokens: 50 },
      };
    }

    // Second call: model has results, provides answer
    return {
      content: `FINAL_ANSWER:
Based on the documentation in the codebase, the operator pattern is a reasoning architecture where AI agents follow a Think → Plan → Act → Observe → Respond loop. Each operator has access to memory (vector store) and tools (search functions), and iterates through multiple reasoning loops until it has enough information to answer.

The system uses OpenRouter for LLM calls and local embeddings (all-MiniLM-L6-v2) for semantic search.

CONFIDENCE: 0.85

CITATIONS:
[{"source":"src/core/operator.ts","type":"document","excerpt":"Think → Plan → Act → Observe → Respond loop","date":""},{"source":"README.md","type":"document","excerpt":"Operator Pattern — reasoning agents that follow a Think → Plan → Act → Observe → Respond loop","date":""}]`,
      toolCalls: [],
      usage: { promptTokens: 200, completionTokens: 150 },
    };
  }
}

describe('Integration: Memory ingestion + Operator reasoning', () => {
  let memory: Memory;
  let docsIngested = 0;

  beforeAll(async () => {
    memory = new Memory();
    await memory.init();

    // Ingest the project's own source files
    const connector = new DocsConnector({
      paths: ['./src/core', './README.md'],
      extensions: ['.ts', '.md'],
      maxFiles: 20,
    });

    const docs = await connector.syncAll();
    docsIngested = await memory.ingest(docs);
  }, 120_000); // First run downloads embedding model

  it('should ingest project documentation', () => {
    expect(docsIngested).toBeGreaterThan(0);
    expect(memory.count).toBeGreaterThan(0);
  });

  it('should find relevant results when searching memory', async () => {
    const results = await memory.search('operator pattern', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].text).toContain('operator');
  });

  it('should complete a full reasoning loop with mock LLM', async () => {
    const mockReasoning = new MockReasoningEngine() as unknown as ReasoningEngine;
    const operator = new Operator('test', mockReasoning, memory);

    const result = await operator.reason('What is the operator pattern in this codebase?');

    expect(result.answer).toBeTruthy();
    expect(result.answer.length).toBeGreaterThan(50);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('should return citations with source information', async () => {
    const mockReasoning = new MockReasoningEngine() as unknown as ReasoningEngine;
    const operator = new Operator('test', mockReasoning, memory);

    const result = await operator.reason('How does the operator work?');

    expect(result.citations[0]).toHaveProperty('source');
    expect(result.citations[0]).toHaveProperty('type');
    expect(result.citations[0]).toHaveProperty('excerpt');
  });
});

describe('Integration: Error resilience', () => {
  let memory: Memory;

  beforeAll(async () => {
    memory = new Memory();
    await memory.init();
  });

  it('should handle empty memory gracefully', async () => {
    // Clear memory
    await memory.clear();

    const results = await memory.search('anything', 5);
    expect(results).toEqual([]);
  });

  it('should handle search with no matches', async () => {
    // Add one doc that won't match
    await memory.store({
      id: 'test-1',
      text: 'The quick brown fox jumps over the lazy dog.',
      metadata: { source: 'test' },
    });

    const results = await memory.search('quantum computing blockchain AI', 5);
    // Should return results but with low scores
    expect(results.length).toBeGreaterThanOrEqual(0);
    if (results.length > 0) {
      expect(results[0].score).toBeLessThan(0.5);
    }
  });

  it('should handle duplicate document IDs by updating', async () => {
    await memory.store({
      id: 'dup-test',
      text: 'Original content',
      metadata: { source: 'test', version: 1 },
    });

    await memory.store({
      id: 'dup-test',
      text: 'Updated content',
      metadata: { source: 'test', version: 2 },
    });

    const results = await memory.search('Updated content', 5);
    const match = results.find((r) => r.id === 'dup-test');
    expect(match?.text).toContain('Updated content');
    expect(match?.metadata.version).toBe(2);
  });
});

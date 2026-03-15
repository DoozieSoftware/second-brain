import { describe, it, expect, beforeEach } from 'vitest';
import { Memory } from '../core/memory.js';
import { SavingsScanner } from '../proactive/savings-scanner.js';

// Mock reasoning engine that returns a simple summary
const mockReasoning = {
  chat: async () => ({
    content: 'Summary: Focus on the stalled PRs first — they are the lowest-effort wins.',
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 20 },
  }),
} as any;

describe('SavingsScanner', () => {
  let memory: Memory;
  let scanner: SavingsScanner;

  beforeEach(async () => {
    memory = new Memory();
    await memory.init();
    await memory.clear();
    scanner = new SavingsScanner(mockReasoning, memory);
  });

  it('should return empty message when no data', async () => {
    const result = await scanner.scan();
    expect(result).toContain('No data in memory');
  });

  it('should detect stalled work', async () => {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);

    await memory.store({
      id: 'gh:issue:1',
      text: 'Issue: Fix authentication bug in login flow. Users cannot log in after password reset.',
      metadata: {
        source: 'github:org/repo',
        type: 'issue',
        title: 'Fix authentication bug',
        state: 'open',
        updated: monthAgo.toISOString(),
        date: monthAgo.toISOString(),
      },
    });

    const result = await scanner.scan();
    expect(result).toContain('STALLED');
    expect(result).toContain('authentication');
    expect(result).toContain('Action:');
    expect(result).toContain('Est. savings:');
  });

  it('should not flag recently updated items as stalled', async () => {
    await memory.store({
      id: 'gh:issue:2',
      text: 'Issue: Add dark mode support',
      metadata: {
        source: 'github:org/repo',
        type: 'issue',
        title: 'Add dark mode',
        state: 'open',
        updated: new Date().toISOString(),
        date: new Date().toISOString(),
      },
    });

    const result = await scanner.scan();
    // Should not contain STALLED for recently updated item
    expect(result).not.toContain('STALLED');
  });

  it('should detect meeting waste when no output correlates', async () => {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Add 5 meetings about "authentication"
    for (let i = 0; i < 5; i++) {
      const date = new Date(twoWeeksAgo.getTime() + i * 24 * 60 * 60 * 1000);
      await memory.store({
        id: `cal:event:${i}`,
        text: `Meeting: Auth System Review - discussing authentication implementation`,
        metadata: {
          source: 'calendar',
          type: 'event',
          title: 'Auth System Review',
          date: date.toISOString(),
        },
      });
    }

    const result = await scanner.scan();
    expect(result).toContain('MEETING WASTE');
    expect(result).toContain('zero output');
    expect(result).toContain('Action:');
  });

  it('should format dollar amounts correctly', async () => {
    const monthAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    await memory.store({
      id: 'gh:pr:1',
      text: 'PR: Major refactor of database layer',
      metadata: {
        source: 'github:org/repo',
        type: 'pr',
        title: 'Database refactor',
        state: 'open',
        updated: monthAgo.toISOString(),
        date: monthAgo.toISOString(),
      },
    });

    const result = await scanner.scan();
    expect(result).toMatch(/\$\d+/); // Contains dollar amount
  });

  it('should include summary section when LLM is available', async () => {
    const monthAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    await memory.store({
      id: 'gh:issue:3',
      text: 'Issue: Memory leak in worker process',
      metadata: {
        source: 'github:org/repo',
        type: 'issue',
        title: 'Memory leak',
        state: 'open',
        updated: monthAgo.toISOString(),
        date: monthAgo.toISOString(),
      },
    });

    const result = await scanner.scan();
    expect(result).toContain('SUMMARY');
    expect(result).toContain('stalled PRs');
  });

  it('should sort alerts by estimated hours (highest impact first)', async () => {
    const weekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    await memory.store({
      id: 'gh:issue:recent',
      text: 'Issue: Minor typo in docs',
      metadata: {
        source: 'github:org/repo',
        type: 'issue',
        title: 'Fix typo',
        state: 'open',
        updated: weekAgo.toISOString(),
        date: weekAgo.toISOString(),
      },
    });

    await memory.store({
      id: 'gh:pr:old',
      text: 'PR: Complete rewrite of auth system',
      metadata: {
        source: 'github:org/repo',
        type: 'pr',
        title: 'Auth rewrite',
        state: 'open',
        updated: twoMonthsAgo.toISOString(),
        date: twoMonthsAgo.toISOString(),
      },
    });

    const result = await scanner.scan();

    // The older/more impactful item should appear first
    const authIndex = result.indexOf('Auth rewrite');
    const typoIndex = result.indexOf('Fix typo');

    // Auth rewrite should come before typo (higher impact)
    if (authIndex >= 0 && typoIndex >= 0) {
      expect(authIndex).toBeLessThan(typoIndex);
    }
  });
});

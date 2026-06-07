import { describe, it, expect } from 'vitest';

describe('Answer verification', () => {
  it('should parse answer, confidence, and citations from FINAL_ANSWER format', () => {
    const content = `Some thinking...

FINAL_ANSWER:
The authentication was implemented in PR #42 by John.

CONFIDENCE: 0.85

CITATIONS:
[{"source":"github/repo","type":"pr","excerpt":"PR #42 adds auth","url":"https://github.com/repo/pull/42","date":"2026-03-15"}]`;

    const answerMatch = content.match(/FINAL_ANSWER:\s*([\s\S]*?)(?=CONFIDENCE:|$)/);
    expect(answerMatch).toBeTruthy();
    expect(answerMatch![1].trim()).toContain('PR #42');

    const confidenceMatch = content.match(/CONFIDENCE:\s*([\d.]+)/);
    expect(confidenceMatch).toBeTruthy();
    expect(parseFloat(confidenceMatch![1])).toBe(0.85);

    const citationsMatch = content.match(/CITATIONS:\s*(\[[\s\S]*?\])/);
    expect(citationsMatch).toBeTruthy();
    const citations = JSON.parse(citationsMatch![1]);
    expect(citations).toHaveLength(1);
    expect(citations[0].source).toBe('github/repo');
  });

  it('should handle malformed citations gracefully', () => {
    const content = `FINAL_ANSWER:
Some answer about PR #42.

CONFIDENCE: 0.7

CITATIONS:
{invalid json}`;

    const citationsMatch = content.match(/CITATIONS:\s*(\[[\s\S]*?\])/);
    expect(citationsMatch).toBeNull();
  });

  it('should handle missing sections', () => {
    const content = `FINAL_ANSWER:
Just an answer without confidence or citations.`;

    const answerMatch = content.match(/FINAL_ANSWER:\s*([\s\S]*?)(?=CONFIDENCE:|CITATIONS:|$)/);
    expect(answerMatch).toBeTruthy();
    expect(answerMatch![1].trim()).toBe('Just an answer without confidence or citations.');
  });
});

describe('Verification prompt construction', () => {
  it('should include question, answer, and sources in verification prompt', () => {
    const question = 'How was authentication implemented?';
    const answer = 'It was implemented in PR #42 using JWT tokens.';
    const sources = [
      { text: 'PR #42 adds JWT auth', source: 'github' },
      { text: 'Meeting notes about auth', source: 'calendar' },
    ];

    const prompt = `You are a fact-checker. Given a QUESTION, an ANSWER, and the SOURCE EVIDENCE,
check if each claim in the answer is supported by at least one source.

QUESTION: ${question}
ANSWER: ${answer}
SOURCES:
${sources.map((s, i) => `[${i + 1}] (${s.source}): ${s.text}`).join('\n')}`;

    expect(prompt).toContain(question);
    expect(prompt).toContain(answer);
    expect(prompt).toContain('PR #42');
    expect(prompt).toContain('github');
  });
});

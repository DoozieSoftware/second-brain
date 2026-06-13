import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '../core/json-extract.js';

describe('extractJsonObject', () => {
  it('parses plain JSON', () => {
    const r = extractJsonObject<{ a: number }>('{"a":1}');
    expect(r?.a).toBe(1);
  });

  it('parses nested JSON (the v1.0.0 regression case)', () => {
    // The non-greedy regex `\{[\s\S]*?\}` truncates this to `{"a": {"b": 1}`
    // and JSON.parse throws. extractJsonObject must handle it.
    const r = extractJsonObject<{ a: { b: number }; c: number }>(
      '{"a": {"b": 1}, "c": 2}'
    );
    expect(r?.a.b).toBe(1);
    expect(r?.c).toBe(2);
  });

  it('parses JSON wrapped in markdown code fences', () => {
    const r = extractJsonObject<{ x: string }>('```json\n{"x":"y"}\n```');
    expect(r?.x).toBe('y');
  });

  it('parses JSON surrounded by prose', () => {
    const r = extractJsonObject<{ x: number }>('Here you go: {"x":42} hope that helps');
    expect(r?.x).toBe(42);
  });

  it('parses JSON with a nested weights map (question-generator schema)', () => {
    const r = extractJsonObject<{
      extractedValues: string[];
      extractedWeights: Record<string, number>;
    }>('{"extractedValues":["speed","quality"],"extractedWeights":{"speed":0.8,"quality":0.7},"confidence":0.6}');
    expect(r?.extractedValues).toEqual(['speed', 'quality']);
    expect(r?.extractedWeights.speed).toBe(0.8);
  });

  it('returns null on garbage', () => {
    expect(extractJsonObject('NO_SIGNAL')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
    expect(extractJsonObject('definitely not json')).toBeNull();
  });
});

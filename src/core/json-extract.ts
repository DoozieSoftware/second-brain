/**
 * Robust JSON extraction from an LLM response.
 *
 * LLM output is unpredictable: the model may wrap JSON in prose, in markdown
 * code fences, or in multiple JSON blobs. The naive `\{[\s\S]*?\}` (non-greedy)
 * regex breaks on nested objects — for `{"a": {"b": 1}, "c": 2}` it stops at
 * the first `}` and returns the truncated `{"a": {"b": 1}`, which then fails
 * JSON.parse. This helper tries (in order):
 *
 *   1. Direct JSON.parse of the full content
 *   2. A greedy regex match on the outermost `\{ ... \}`
 *   3. A non-greedy regex match as a last resort
 *   4. A code-fence-stripped greedy match
 *
 * Returns the first parse that succeeds, or `null` if every attempt fails.
 *
 * Use this anywhere a learning/operator module needs to extract a JSON object
 * from a free-form LLM response. Do not roll a bespoke regex — they all break
 * on the same nested-object pattern.
 */
export function extractJsonObject<T = unknown>(content: string): T | null {
  if (!content) return null;

  // Strip markdown code fences (the model often wraps JSON in ```json ... ```).
  const stripped = content
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  // 1. Direct parse — covers the common case where the model returns pure JSON.
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // fall through
  }

  // 2. Greedy match — handles nested objects correctly. Slightly weaker when
  //    the model appends prose after the JSON (the match will slurp to the
  //    last `}` and fail to parse), so we still try 3 and 4 below.
  const greedy = stripped.match(/\{[\s\S]*\}/);
  if (greedy) {
    try {
      return JSON.parse(greedy[0]) as T;
    } catch {
      // fall through
    }
  }

  // 3. Non-greedy match — last resort for truncated single-level JSON.
  const lazy = stripped.match(/\{[\s\S]*?\}/);
  if (lazy) {
    try {
      return JSON.parse(lazy[0]) as T;
    } catch {
      // fall through
    }
  }

  // 4. Re-strip leading/trailing prose (anything before the first `{` and
  //    after the last `}`) and try again. This recovers when the model emits
  //    `"Here is the JSON: { ... } hope that helps!"`.
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const slice = stripped.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(slice) as T;
    } catch {
      // fall through
    }
  }

  return null;
}

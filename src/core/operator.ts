import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ReasoningEngine } from './reasoning.js';
import { Memory } from './memory.js';
import { ToolRegistry } from './tools.js';
import { SearchEngine } from './search.js';
import { CrossSourceLinker } from './linker.js';

export interface OperatorResponse {
  answer: string;
  citations: Citation[];
  confidence: number;
  steps: ReasoningStep[];
  searchCount: number;
  successfulSearches: number;
  verification?: {
    score: number;
    issues: string[];
    checked: boolean;
  };
}

interface Finding {
  topic: string;
  content: string;
  source: string;
  confidence: number;
  turn: number;
}

interface VerificationResult {
  score: number;
  claims: Array<{ text: string; status: string; source?: string }>;
  issues: string[];
  checked: boolean;
}

export interface Citation {
  source: string;
  type: string;
  excerpt: string;
  url?: string;
  date?: string;
}

export interface ReasoningStep {
  thought: string;
  action?: string;
  observation?: string;
}

const MAX_REASONING_LOOPS = 5;
const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS || '90000', 10);

const SYSTEM_PROMPT = `You are a reasoning operator — an AI analyst with organizational memory AND personal user context. You think step-by-step like a human who genuinely wants to help.

## Your Mental Model

When someone asks you a question, you:
1. **Think first** — What are they really asking? What would a smart colleague consider?
2. **Plan your search** — What information would you need? Where might it live?
3. **Search strategically** — Use tools to find information. Start broad, then narrow down.
4. **Connect the dots** — Look for patterns, contradictions, relationships across sources.
5. **Synthesize honestly** — Give a clear answer with evidence. Admit gaps.

## Thinking Process (do this OUT LOUD)

Before every tool call, explain your reasoning:
- WHY are you searching for this?
- WHAT do you expect to find?
- HOW will this help answer the question?

After getting search results, reflect:
- Is this relevant? What does it tell me?
- What's still missing? Do I need to search differently?
- Are there connections between what I've found?

## Search Strategy
- Start with the most likely place for the answer
- If first search is weak, try different search terms or broader queries
- Search for related concepts, not just exact matches
- When you find something interesting, dig deeper

## How to Use Tools

**Method 1 (preferred):** If you can call tools directly, just use them.

**Method 2 (fallback):** If you cannot call tools directly, use this exact syntax:
TOOL_CALL: search_memory({"query": "your search terms", "top_k": 5})
TOOL_CALL: search_related({"topic": "topic to explore"})
TOOL_CALL: list_sources({})

Always explain your reasoning BEFORE using a tool.

## Answer Quality
- Lead with the direct answer, then provide supporting evidence
- Cite specific sources: file names, PR numbers, email subjects, dates
- If sources conflict, mention the conflict and your reasoning
- If you're uncertain, say so — don't fabricate
- Proactively flag anything that could save time or money

## When you're ready to answer

End your response EXACTLY like this:

FINAL_ANSWER:
[Your complete answer here. Be specific. Cite evidence. Include actionable insights.]

CONFIDENCE: [0.0 to 1.0 — how sure are you?]

CITATIONS:
[{"source":"...","type":"github|email|calendar|document","excerpt":"relevant quote","url":"...","date":"..."}]

If you have NO useful information after searching, say:
FINAL_ANSWER: I couldn't find information about this in the available sources. [Suggest what sources might help]
CONFIDENCE: 0.0
CITATIONS: []

## User Context Integration

When user context is provided, reason through the lens of their decision-making profile:
- Their values and communication style should influence HOW you present the answer
- Their past decisions in relevant domains should inform WHAT you recommend
- If your generic best-practice answer differs from what their profile suggests, present both perspectives
- Always be transparent: "Based on your profile, you tend to..." or "Your past decisions suggest..."
- Do NOT blindly follow the profile — use it as context, not constraint`;

export class Operator {
  protected name: string;
  protected reasoning: ReasoningEngine;
  protected memory: Memory;
  protected tools: ToolRegistry;
  protected searchEngine: SearchEngine;
  protected linker: CrossSourceLinker;
  private searchedQueries: Set<string> = new Set();
  private allResults: string[] = [];
  private searchCount: number = 0;
  private successfulSearches: number = 0;
  private findings: Map<string, Finding> = new Map();
  private currentTurn: number = 0;

  constructor(name: string, reasoning: ReasoningEngine, memory: Memory, tools?: ToolRegistry, searchEngine?: SearchEngine) {
    this.name = name;
    this.reasoning = reasoning;
    this.memory = memory;
    this.tools = tools || new ToolRegistry();
    this.searchEngine = searchEngine || new SearchEngine(memory);
    this.linker = new CrossSourceLinker(this.searchEngine);
  }

  private addFinding(topic: string, content: string, source: string): void {
    const key = topic.toLowerCase();
    const existing = this.findings.get(key);
    if (!existing || content.length > existing.content.length) {
      this.findings.set(key, {
        topic,
        content: content.slice(0, 500),
        source,
        confidence: existing ? Math.min(existing.confidence + 0.1, 1.0) : 0.7,
        turn: this.currentTurn,
      });
    }
  }

  private getFindingsSummary(): string {
    if (this.findings.size === 0) return '';
    const entries = Array.from(this.findings.values());
    const summary = entries
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10)
      .map(f => `[${f.source}] ${f.topic}: ${f.content.slice(0, 200)}`)
      .join('\n');
    return `\nKey findings so far:\n${summary}`;
  }

  async reason(query: string, context?: string, userContext?: string, verbose = false): Promise<OperatorResponse> {
    const steps: ReasoningStep[] = [];
    const citations: Citation[] = [];
    const startTime = Date.now();
    this.searchedQueries.clear();
    this.allResults = [];
    this.searchCount = 0;
    this.successfulSearches = 0;
    this.findings.clear();
    this.currentTurn = 0;

    // Build system prompt with user context if available
    let systemPrompt = SYSTEM_PROMPT;
    if (userContext) {
      systemPrompt += '\n\n## Personal User Context\n' + userContext;
    }

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: this.buildInitialPrompt(query, context),
      },
    ];

    this.registerMemoryTools();
    this.registerCrossSourceTools();

    let finalAnswer = '';
    let confidence = 0;

    for (let loop = 0; loop < MAX_REASONING_LOOPS; loop++) {
      this.currentTurn = loop;

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > QUERY_TIMEOUT_MS) {
        if (verbose) console.log(`\n⏱ Timeout (${(elapsed / 1000).toFixed(1)}s), returning best answer so far`);
        if (finalAnswer) {
          return { answer: finalAnswer, citations, confidence, steps, searchCount: this.searchCount, successfulSearches: this.successfulSearches };
        }
        finalAnswer = this.buildFallbackAnswer();
        return { answer: finalAnswer, citations, confidence: 0.2, steps, searchCount: this.searchCount, successfulSearches: this.successfulSearches };
      }

      if (verbose) process.stdout.write(`\n[Loop ${loop + 1}] Thinking...`);

      const result = await this.reasoning.chat(
        messages,
        this.tools.toOpenAITools(),
        { temperature: 0.4, maxTokens: 3000 }
      );

      // Check for final answer
      if (result.content.includes('FINAL_ANSWER:')) {
        const parsed = this.parseFinalAnswer(result.content);
        finalAnswer = parsed.answer;
        confidence = parsed.confidence;
        citations.push(...parsed.citations);

        // Verification phase
        let verificationResult: VerificationResult | undefined;
        if (citations.length > 0 && confidence > 0.3) {
          verificationResult = await this.verifyAnswer(query, finalAnswer, citations, this.allResults);
          if (verificationResult.score < 0.5 && verificationResult.issues.length > 0 && loop < MAX_REASONING_LOOPS - 1) {
            messages.push({
              role: 'user',
              content: `Your answer needs revision. Issues found:\n${verificationResult.issues.join('\n')}\n\nPlease revise your answer with better evidence or note your uncertainty.`,
            });
            finalAnswer = '';
            continue;
          }
        }

        steps.push({ thought: 'Answer synthesized', observation: `Confidence: ${(confidence * 100).toFixed(0)}%` });
        if (verbose) console.log(`\n✓ Answer ready (confidence: ${(confidence * 100).toFixed(0)}%)`);
        const response: OperatorResponse = { answer: finalAnswer, citations, confidence, steps, searchCount: this.searchCount, successfulSearches: this.successfulSearches };
        if (verificationResult) {
          response.verification = { score: verificationResult.score, issues: verificationResult.issues, checked: verificationResult.checked };
        }
        return response;
      }

      // Extract thinking from the response
      const thought = this.extractThought(result.content);

      // Add assistant response to conversation
      if (result.content) {
        messages.push({ role: 'assistant', content: result.content });
        if (verbose && thought) console.log(`\n  Thought: ${thought.slice(0, 200)}`);
      }

      // Execute tool calls
      if (result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          if (verbose) process.stdout.write(`\n  Action: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`);

          const toolResult = await this.tools.execute(tc.name, tc.arguments);

          // Track searches to avoid duplicates
          if (tc.name === 'search_memory') {
            const q = (tc.arguments.query as string) || '';
            this.searchedQueries.add(q.toLowerCase());
          }

          if (verbose) process.stdout.write(` → ${toolResult.length} chars`);

          messages.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: tc.id,
          });

          steps.push({
            thought: thought || 'Searching...',
            action: `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)})`,
            observation: toolResult.slice(0, 200),
          });
        }
      } else if (result.content && !result.content.includes('FINAL_ANSWER:')) {
        // Model is thinking but didn't call tools — nudge it
        messages.push({
          role: 'user',
          content: this.buildNudgePrompt(loop),
        });
      }
    }

    if (!finalAnswer) {
      finalAnswer = this.buildFallbackAnswer();
      confidence = 0.15;
    }

    return { answer: finalAnswer, citations, confidence, steps, searchCount: this.searchCount, successfulSearches: this.successfulSearches };
  }

  private buildInitialPrompt(query: string, context?: string): string {
    let prompt = `Question: ${query}\n`;

    if (context) {
      prompt += `\nContext: ${context}\n`;
    }

    // Tell the model what tools are available
    prompt += `
Available tools:
- search_memory(query, top_k): Search the knowledge base. Use SHORT, SIMPLE queries (1-3 words). Examples: "authentication", "database migration", "dooz-code".
  BAD queries: "authentication implementation details for the login flow"
  GOOD queries: "authentication login"

Think about what you need to find, then search. You may need to search multiple times with different terms.`;

    return prompt;
  }

  private buildNudgePrompt(loop: number): string {
    const queries = Array.from(this.searchedQueries);
    const previousSearches = queries.length > 0
      ? `\nYou've already searched for: ${queries.join(', ')}`
      : '';
    const findings = this.getFindingsSummary();

    if (loop < 2) {
      return `You haven't used any tools yet. Search the knowledge base to find relevant information.${previousSearches}${findings}\n\nWhat should you search for?`;
    } else {
      return `Based on what you've found so far, do you have enough to answer? If yes, provide FINAL_ANSWER. If not, search with different terms.${previousSearches}${findings}`;
    }
  }

  private buildFallbackAnswer(): string {
    const queries = Array.from(this.searchedQueries);
    if (queries.length === 0) {
      return 'I was unable to search for information. The knowledge base may be empty — try running `sync` first to ingest data from your sources.';
    }
    return `I searched for "${queries.join('", "')}" but couldn't find enough information to answer confidently. This could mean:\n\n1. The information isn't in the connected sources yet — try syncing more data\n2. The question needs different search terms — try rephrasing\n3. The answer spans multiple sources that aren't connected yet`;
  }

  private registerMemoryTools(): void {
    this.tools.register({
      name: 'search_memory',
      description: 'Search organizational knowledge base. Use specific terms. Try different queries if first search is weak. Searches across GitHub, docs, emails, calendar.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to search for. Be specific. Examples: "authentication implementation", "Q3 planning decisions", "PR about database migration"',
          },
          top_k: {
            type: 'number',
            description: 'How many results (3-10). Use more for broad questions, fewer for specific ones.',
          },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const query = args.query as string;
        const topK = Math.min((args.top_k as number) || 5, 15);
        const source = args.source as string | undefined;
        const type = args.type as string | undefined;
        const results = await this.searchEngine.search(query, { topK, source, type });
        this.searchCount++;

        if (results.length === 0) {
          return `No results for "${query}". Try broader terms or different phrasing.`;
        }

        this.successfulSearches++;
        for (const r of results) {
          this.addFinding(query, r.text, (r.metadata.source as string) || 'unknown');
        }
        const formatted = results
          .map((r, i) => {
            const source = r.metadata.source || 'unknown';
            const type = r.metadata.type || 'unknown';
            const date = r.metadata.date ? ` (${r.metadata.date})` : '';
            const url = r.metadata.url ? `\nURL: ${r.metadata.url}` : '';
            return `[${i + 1}] (${type}) ${source}${date}${url}\n${r.text.slice(0, 800)}`;
          })
          .join('\n---\n');

        return `Found ${results.length} results for "${query}":\n\n${formatted}`;
      },
    });

    this.tools.register({
      name: 'search_related',
      description: 'Search for content related to something you already found. Use this to dig deeper into a topic.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'A specific topic, person, or concept from previous results to explore further' },
          exclude: { type: 'string', description: 'Terms to exclude to get different results' },
        },
        required: ['topic'],
      },
      handler: async (args) => {
        let query = args.topic as string;
        if (args.exclude) {
          query += ` NOT ${args.exclude}`;
        }
        const results = await this.searchEngine.search(query, { topK: 5 });
        if (results.length === 0) return `No related results found for "${args.topic}".`;
        return results
          .map((r, i) => `[${i + 1}] ${r.metadata.source || 'unknown'}: ${r.text.slice(0, 600)}`)
          .join('\n---\n');
      },
    });

    this.tools.register({
      name: 'list_sources',
      description: 'See what data sources are available in the knowledge base. Use this to understand what you have access to.',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        const docs = await this.memory.getAll(100);
        const sources = new Map<string, number>();
        for (const doc of docs) {
          const src = (doc.metadata.source as string) || 'unknown';
          sources.set(src, (sources.get(src) || 0) + 1);
        }
        const summary = Array.from(sources.entries())
          .map(([src, count]) => `  ${src}: ${count} documents`)
          .join('\n');
        return `Knowledge base contains ${docs.length} documents from:\n${summary}`;
      },
    });
  }

  private registerCrossSourceTools(): void {
    this.tools.register({
      name: 'search_across_sources',
      description: 'Search for an entity (person, PR, project) across all data sources. Use when you need to find mentions of something across GitHub, email, calendar, and docs.',
      parameters: {
        type: 'object',
        properties: {
          entity: {
            type: 'string',
            description: 'The entity to search for (e.g., "@alice", "PR #42", "authentication")',
          },
          sources: {
            type: 'string',
            description: 'Comma-separated sources to search (e.g., "github,email"). Leave empty for all.',
          },
        },
        required: ['entity'],
      },
      handler: async (args) => {
        const entity = args.entity as string;
        const sources = args.sources ? (args.sources as string).split(',').map(s => s.trim()) : undefined;

        const results = await this.linker.findAcrossSources(entity, sources);
        if (results.length === 0) {
          return `No mentions of "${entity}" found across sources.`;
        }

        return results
          .map((r, i) => `[${i + 1}] (${r.metadata.source}) ${r.text.slice(0, 400)}`)
          .join('\n---\n');
      },
    });

    this.tools.register({
      name: 'find_connections',
      description: 'Find documents related to a search result from other sources. Use this to discover cross-source relationships.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Key terms from a document you want to find connections for',
          },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const query = args.query as string;
        const results = await this.searchEngine.search(query, { topK: 3 });

        if (results.length === 0) {
          return `No documents found for "${query}".`;
        }

        const allConnections: string[] = [];
        for (const doc of results.slice(0, 2)) {
          const connections = await this.linker.findConnections(doc);
          for (const conn of connections) {
            allConnections.push(
              `Entity "${conn.entity.value}" (${conn.entity.type}) found in: ${conn.sources.join(', ')}`
            );
          }
        }

        if (allConnections.length === 0) {
          return `No cross-source connections found for "${query}".`;
        }

        return allConnections.join('\n');
      },
    });
  }

  private async verifyAnswer(
    question: string,
    answer: string,
    citations: Citation[],
    allSearchResults: string[]
  ): Promise<VerificationResult> {
    if (citations.length === 0) {
      return { score: 0.3, claims: [], issues: ['No citations provided'], checked: false };
    }

    const verificationPrompt = `You are a fact-checker. Given a QUESTION, an ANSWER, and the SOURCE EVIDENCE,
check if each claim in the answer is supported by at least one source.

QUESTION: ${question}
ANSWER: ${answer}
SOURCES:
${allSearchResults.join('\n---\n')}

For each key claim in the answer:
- SUPPORTED: can point to a specific source
- PARTIALLY_SUPPORTED: source suggests it but doesn't directly state it
- UNSUPPORTED: no source backs this claim

Output ONLY valid JSON:
{
  "claims": [{"text": "...", "status": "SUPPORTED|PARTIALLY|UNSUPPORTED", "source": "..."}],
  "overall_score": 0.0-1.0,
  "issues": ["..."]
}`;

    try {
      const result = await this.reasoning.chat(
        [{ role: 'user', content: verificationPrompt }],
        [],
        { temperature: 0.1, maxTokens: 1000 }
      );

      let content = result.content.trim();
      // Strip markdown code fences
      content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

      // Try direct JSON parse first
      try {
        const parsed = JSON.parse(content);
        return {
          score: parsed.overall_score || 0.5,
          claims: parsed.claims || [],
          issues: parsed.issues || [],
          checked: true,
        };
      } catch {
        // Not valid JSON directly, try regex extraction
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          score: parsed.overall_score || 0.5,
          claims: parsed.claims || [],
          issues: parsed.issues || [],
          checked: true,
        };
      }
    } catch (error) {
      console.error('[Verification] Parse error:', error instanceof Error ? error.message : error);
    }

    return { score: 0.5, claims: [], issues: ['Verification parsing failed'], checked: false };
  }

  private extractThought(content: string): string {
    // Extract the thinking/reasoning part before any tool call
    // Look for patterns like "I need to...", "Let me search...", "Based on..."
    const lines = content.split('\n').filter(l => l.trim());
    const thoughtLines: string[] = [];

    for (const line of lines) {
      if (line.includes('FINAL_ANSWER:') || line.includes('CONFIDENCE:') || line.includes('CITATIONS:')) break;
      if (line.includes('search_memory') || line.includes('search_related')) break;
      thoughtLines.push(line);
    }

    return thoughtLines.join(' ').slice(0, 300);
  }

  private parseFinalAnswer(content: string): OperatorResponse {
    // More robust parsing that handles various LLM output formats

    // Extract answer
    const answerStart = content.indexOf('FINAL_ANSWER:');
    const confidenceStart = content.indexOf('CONFIDENCE:');
    const citationsStart = content.indexOf('CITATIONS:');

    let answer = '';
    if (answerStart >= 0) {
      const end = confidenceStart >= 0 ? confidenceStart : (citationsStart >= 0 ? citationsStart : content.length);
      answer = content.slice(answerStart + 'FINAL_ANSWER:'.length, end).trim();
    } else {
      answer = content;
    }

    // Extract confidence
    let confidence = 0.5;
    if (confidenceStart >= 0) {
      const confStr = content.slice(confidenceStart + 'CONFIDENCE:'.length).trim();
      const match = confStr.match(/([\d.]+)/);
      if (match) confidence = Math.min(1, Math.max(0, parseFloat(match[1])));
    }

    // Extract citations
    let citations: Citation[] = [];
    if (citationsStart >= 0) {
      let citStr = content.slice(citationsStart + 'CITATIONS:'.length).trim();
      // Strip markdown code fences if present
      citStr = citStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      // Try to find JSON array
      const jsonMatch = citStr.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          citations = JSON.parse(jsonMatch[0]);
        } catch {
          // JSON parse failed — return empty rather than garbage
        }
      }
    }

    return { answer, citations, confidence, steps: [], searchCount: 0, successfulSearches: 0 };
  }

}

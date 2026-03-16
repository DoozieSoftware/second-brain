import { ReasoningEngine } from '../core/reasoning.js';
import { Memory, type MemoryDocument } from '../core/memory.js';
import { UserModelManager } from '../core/user-model.js';

export interface DecisionSignal {
  domain: string;
  decision: string;
  factors: string[];
  tradeoffs: string[];
  outcome: string;
  values_demonstrated: string[];
  source: string;
  date?: string;
  confidence: number;
}

export interface ExtractionResult {
  processed: number;
  extracted: number;
  signals: DecisionSignal[];
  errors: number;
}

const EXTRACTION_PROMPT = `Analyze the following text and extract any decision-making signals. This could be a PR review, email thread, design doc, or any other document where someone made a decision or expressed a preference.

Extract the following if present:
1. What decision was made or what judgment was expressed?
2. What factors were considered important?
3. What trade-offs were weighed?
4. What was the outcome or conclusion?
5. What values were demonstrated (e.g., speed, quality, simplicity, ownership)?

If the text does NOT contain any decision-making or judgment signals, respond with:
NO_SIGNAL

If it DOES contain signals, respond with this exact JSON format:
{
  "domain": "hiring" | "architecture" | "product" | "code_review" | "communication" | "other",
  "decision": "brief description of the decision or judgment",
  "factors": ["factor1", "factor2"],
  "tradeoffs": ["tradeoff1", "tradeoff2"],
  "outcome": "what was decided or concluded",
  "values_demonstrated": ["value1", "value2"],
  "confidence": 0.0 to 1.0
}

IMPORTANT: Only extract genuine decisions or judgments. Do NOT extract:
- Factual statements without opinions
- Simple questions
- Status updates without reasoning`;

export class ExtractionEngine {
  private reasoning: ReasoningEngine;
  private memory: Memory;
  private userModel: UserModelManager;
  private processed = new Set<string>(); // Track processed document IDs

  constructor(reasoning: ReasoningEngine, memory: Memory, userModel: UserModelManager) {
    this.reasoning = reasoning;
    this.memory = memory;
    this.userModel = userModel;
  }

  async extractFromDocuments(docs: MemoryDocument[]): Promise<ExtractionResult> {
    const result: ExtractionResult = {
      processed: 0,
      extracted: 0,
      signals: [],
      errors: 0,
    };

    for (const doc of docs) {
      // Skip already processed
      if (this.processed.has(doc.id)) continue;

      result.processed++;

      try {
        const signal = await this.extractDecisionSignals(doc.text, doc.metadata.source as string || 'unknown', doc.metadata.type as string || 'unknown');
        if (signal) {
          result.signals.push(signal);
          result.extracted++;

          // Store as reasoning corpus document
          await this.storeReasoningDocument(doc.id, signal, doc.metadata);

          // Update user model from signal
          this.updateModelFromSignal(signal);
        }
      } catch (error) {
        result.errors++;
        console.warn(`Extraction failed for ${doc.id}:`, error);
      }

      this.processed.add(doc.id);
    }

    return result;
  }

  async extractDecisionSignals(text: string, source: string, type: string): Promise<DecisionSignal | null> {
    // Skip very short texts
    if (text.length < 100) return null;

    // Skip texts that are unlikely to contain decisions
    const decisionKeywords = ['decided', 'chose', 'recommend', 'approve', 'reject', 'prefer', 'suggest', 'should', 'would', 'trade-off', 'tradeoff', 'pros', 'cons', 'because', 'reason'];
    const hasDecisionKeywords = decisionKeywords.some(kw => text.toLowerCase().includes(kw));
    if (!hasDecisionKeywords) return null;

    try {
      const result = await this.reasoning.chat(
        [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: `Source: ${source}\nType: ${type}\n\nText:\n${text.slice(0, 3000)}` },
        ],
        [],
        { temperature: 0.2, maxTokens: 1000 }
      );

      if (result.content.includes('NO_SIGNAL')) return null;

      // Parse JSON from response
      const jsonMatch = result.content.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        domain: parsed.domain || 'other',
        decision: parsed.decision || '',
        factors: parsed.factors || [],
        tradeoffs: parsed.tradeoffs || [],
        outcome: parsed.outcome || '',
        values_demonstrated: parsed.values_demonstrated || [],
        source,
        confidence: parsed.confidence || 0.5,
      };
    } catch (error) {
      return null;
    }
  }

  private async storeReasoningDocument(originalId: string, signal: DecisionSignal, metadata: Record<string, any>): Promise<void> {
    const reasoningDoc: MemoryDocument = {
      id: `reasoning:${originalId}`,
      text: this.formatReasoningText(signal),
      metadata: {
        type: 'user-reasoning',
        domain: signal.domain,
        source: signal.source,
        original_id: originalId,
        date: metadata.date as string || new Date().toISOString(),
        confidence: signal.confidence,
      },
    };

    await this.memory.store(reasoningDoc);
  }

  private formatReasoningText(signal: DecisionSignal): string {
    const parts: string[] = [];
    parts.push(`Decision: ${signal.decision}`);
    if (signal.factors.length > 0) {
      parts.push(`Key factors: ${signal.factors.join(', ')}`);
    }
    if (signal.tradeoffs.length > 0) {
      parts.push(`Trade-offs: ${signal.tradeoffs.join(', ')}`);
    }
    if (signal.outcome) {
      parts.push(`Outcome: ${signal.outcome}`);
    }
    if (signal.values_demonstrated.length > 0) {
      parts.push(`Values demonstrated: ${signal.values_demonstrated.join(', ')}`);
    }
    return parts.join('\n');
  }

  private updateModelFromSignal(signal: DecisionSignal): void {
    // Update domain example
    this.userModel.addDomainExample(signal.domain, `reasoning:${signal.source}`);

    // Update dimension weights based on values demonstrated
    const valueToDimension: Record<string, { category: 'dimensions' | 'communication'; name: string; value: number }> = {
      'speed': { category: 'dimensions', name: 'speed_vs_thoroughness', value: 0.8 },
      'simplicity': { category: 'dimensions', name: 'speed_vs_thoroughness', value: 0.7 },
      'quality': { category: 'dimensions', name: 'detail_orientation', value: 0.8 },
      'thoroughness': { category: 'dimensions', name: 'detail_orientation', value: 0.8 },
      'ownership': { category: 'dimensions', name: 'delegation_comfort', value: 0.3 },
      'collaboration': { category: 'dimensions', name: 'collaboration_preference', value: 0.8 },
      'directness': { category: 'communication', name: 'directness', value: 0.9 },
      'risk-taking': { category: 'dimensions', name: 'risk_tolerance', value: 0.8 },
      'caution': { category: 'dimensions', name: 'risk_tolerance', value: 0.3 },
    };

    for (const value of signal.values_demonstrated) {
      const dim = valueToDimension[value.toLowerCase()];
      if (dim) {
        this.userModel.updateDimension(dim.category, dim.name, dim.value, signal.source);
      }
    }

    // Update domain weights based on factors
    if (signal.factors.length > 0) {
      const weights: Record<string, number> = {};
      const totalFactors = signal.factors.length;
      signal.factors.forEach((factor, i) => {
        // Earlier factors are weighted higher
        weights[factor] = 1 - (i / totalFactors) * 0.5;
      });
      this.userModel.updateDomainWeights(signal.domain, weights);
    }
  }
}

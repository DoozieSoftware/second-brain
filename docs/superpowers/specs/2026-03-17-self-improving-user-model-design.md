# Self-Improving User Reasoning Model

## Overview

The Second Brain system evolves from a reactive organizational memory into a self-improving personal reasoning system that learns how its user thinks, makes decisions, and communicates. It combines passive observation of past decisions with active questioning to build a comprehensive user model, while simultaneously improving its own reasoning capabilities through meta-learning.

**Core Principle:** The system reasons WITH you, learns FROM you, and improves ITSELF over time.

## Architecture

```
src/
├── core/
│   ├── user-model.ts          # Structured user profile
│   ├── system-model.ts        # Structured system self-profile
│   ├── operator.ts            # Enhanced with user context
│   └── supervisor.ts          # Enhanced with learning integration
├── learning/
│   ├── extraction-engine.ts   # Passive extraction from existing data
│   ├── question-generator.ts  # Active questioning system
│   ├── profile-updater.ts     # Updates models from feedback
│   └── meta-learning.ts       # Self-improvement engine
└── data/
    ├── user-model.json        # User profile
    └── system-model.json      # System self-profile
```

## Components

### 1. User Model (`src/core/user-model.ts`)

A structured, inspectable profile of how the user thinks and decides.

**Data Structure:**
```typescript
interface UserDimension {
  value: number;        // 0.0 to 1.0
  confidence: number;   // 0.0 to 1.0 - how sure we are
  samples: number;      // how many data points
}

interface DecisionDomain {
  weights: Record<string, number>;
  confidence: number;
  examples: string[];   // IDs of reasoning corpus documents
}

interface UserModel {
  version: number;
  last_updated: string;
  dimensions: {
    risk_tolerance: UserDimension;
    speed_vs_thoroughness: UserDimension;
    delegation_comfort: UserDimension;
    collaboration_preference: UserDimension;
    detail_orientation: UserDimension;
  };
  decision_domains: Record<string, DecisionDomain>;
  values: string[];
  communication: {
    verbosity: UserDimension;
    formality: UserDimension;
    directness: UserDimension;
  };
  gaps: Array<{
    domain: string;
    confidence: number;
    priority: 'high' | 'medium' | 'low';
  }>;
}
```

**Key Design Decisions:**
- Every dimension has a confidence score - the system knows what it doesn't know
- `gaps` array drives active questioning priorities
- Versioned for future migrations
- Human-readable/editable JSON file

**API:**
```typescript
class UserModelManager {
  load(): UserModel;
  save(model: UserModel): void;
  updateDimension(name: string, value: number, source: string): void;
  addDomainExample(domain: string, docId: string): void;
  getGapsByPriority(): Gap[];
  getContextForQuestion(question: string): string; // formatted for LLM prompt
}
```

### 2. System Model (`src/core/system-model.ts`)

The system's self-awareness - tracks its own performance and learns from it.

**Data Structure:**
```typescript
interface DomainPerformance {
  query_count: number;
  avg_confidence: number;
  avg_loops: number;
  search_success_rate: number;
  fallback_rate: number;
}

interface LearnedPattern {
  type: 'effective_query' | 'reasoning_improvement' | 'routing_rule';
  domain?: string;
  pattern: string;
  success_rate: number;
  adopted: boolean;
  improvement: number;
}

interface EvolutionEntry {
  date: string;
  change: string;
  trigger: string;
  result: string;
}

interface SystemModel {
  version: number;
  performance: {
    total_queries: number;
    avg_confidence: number;
    by_domain: Record<string, DomainPerformance>;
  };
  learned_patterns: LearnedPattern[];
  weak_domains: string[];
  evolution_log: EvolutionEntry[];
}
```

**API:**
```typescript
class SystemModelManager {
  load(): SystemModel;
  save(model: SystemModel): void;
  recordQuery(domain: string, confidence: number, loops: number, searchSuccess: boolean): void;
  addLearnedPattern(pattern: LearnedPattern): void;
  logEvolution(change: string, trigger: string, result: string): void;
  getWeakDomains(): string[];
  getEvolutionReport(): string; // formatted for display
  analyzePerformance(): AnalysisReport;
}
```

### 3. Extraction Engine (`src/learning/extraction-engine.ts`)

Passively extracts reasoning patterns from existing organizational data during sync.

**How it works:**
1. Runs after each sync operation
2. Scans new documents for decision signals:
   - GitHub: PR reviews, issue decisions, code review comments
   - Email: Decision threads, feedback, approvals
   - Docs: Design docs, RFCs, decision records
3. Uses LLM to extract structured reasoning:
   ```
   Extract from this text:
   1. What decision was made?
   2. What factors were considered?
   3. What trade-offs were weighed?
   4. What was the outcome?
   5. What values were demonstrated?
   ```
4. Stores extracted reasoning as `type: "user-reasoning"` documents in memory
5. Updates user model dimensions based on extracted patterns

**API:**
```typescript
class ExtractionEngine {
  constructor(reasoning: ReasoningEngine, memory: Memory, userModel: UserModelManager);

  async extractFromDocuments(docs: MemoryDocument[]): Promise<ExtractionResult>;
  async extractDecisionSignals(text: string, source: string, type: string): Promise<DecisionSignal | null>;
  async updateModelFromExtraction(signal: DecisionSignal): void;
}
```

### 4. Question Generator (`src/learning/question-generator.ts`)

Generates targeted questions to fill gaps in the user model.

**Question Types:**
- **Scenario:** "Two candidates: A has X, B has Y. Who would you hire?" → captures decision weights
- **Trade-off:** "You can ship fast with tech debt or slow with clean code. What do you choose?" → captures values
- **Preference:** "Rate these values in order of importance to you" → captures priorities
- **Validation:** "In [past situation], I think you would have done X. Correct?" → captures corrections
- **Style:** "How would you phrase this email rejection?" → captures communication style

**Prioritization Logic:**
1. Focus on high-priority, low-confidence gaps first
2. Rotate domains to build broad coverage
3. Mix easy (multiple choice) and hard (open-ended) questions
4. Limit to 5 questions per day to avoid fatigue
5. Track which question types get the most informative answers

**API:**
```typescript
class QuestionGenerator {
  constructor(userModel: UserModelManager, systemModel: SystemModelManager);

  async generateDailyQuestions(count?: number): Promise<Question[]>;
  async processAnswer(question: Question, answer: string): Promise<AnswerAnalysis>;
  getQuestionHistory(): QuestionHistory[];
}
```

### 5. Profile Updater (`src/learning/profile-updater.ts`)

Updates both user and system models from feedback signals.

**Feedback Sources:**
- Direct answers to active questions
- Corrections ("not quite, I'd actually...")
- Implicit signals (user asking follow-ups = answer was useful)
- Confidence calibration (was the system's confidence accurate?)

**Update Strategy:**
- Bayesian-style updates: new evidence updates existing beliefs
- Confidence increases with more consistent samples
- Contradictory evidence reduces confidence rather than flipping values
- Explicit corrections weighted higher than implicit signals

**API:**
```typescript
class ProfileUpdater {
  constructor(userModel: UserModelManager, systemModel: SystemModelManager);

  async processDirectFeedback(answerId: string, feedback: 'good' | 'partial' | 'bad', correction?: string): Promise<void>;
  async processImplicitSignal(query: string, answerConfidence: number, userFollowedUp: boolean): Promise<void>;
  async calibrateConfidence(domain: string, predictedConfidence: number, actualQuality: number): Promise<void>;
}
```

### 6. Meta-Learning Engine (`src/learning/meta-learning.ts`)

The self-improvement core - watches the system's own performance and improves it.

**Observation Points:**
1. After every answer: analyze search quality, reasoning efficiency, answer confidence
2. After every sync: check if new data fills known gaps
3. After feedback: evaluate if the system's reasoning was sound

**Improvement Mechanisms:**

| Trigger | Observation | Improvement |
|---------|-------------|-------------|
| Low search success rate | Queries returning irrelevant results | Update query generation strategy for that domain |
| High loop count | Operator looping without converging | Add domain-specific stopping heuristics |
| Confidence mismatch | Predicted confidence != actual quality | Recalibrate confidence estimation |
| Consistent domain failure | Same domain keeps failing | Flag weak domain, suggest new data sources |
| Pattern detection | Same reasoning pattern works repeatedly | Extract as reusable heuristic |

**API:**
```typescript
class MetaLearningEngine {
  constructor(systemModel: SystemModelManager, memory: Memory);

  async observeQuery(query: string, result: OperatorResponse, steps: ReasoningStep[]): Promise<void>;
  async observeFeedback(query: string, feedback: FeedbackSignal): Promise<void>;
  async analyzePerformanceWindow(windowDays: number): Promise<AnalysisReport>;
  async generateImprovements(): Promise<Improvement[]>;
  async applyImprovement(improvement: Improvement): Promise<boolean>;
}
```

### 7. Enhanced Operator

The existing `Operator` class is enhanced to incorporate user and system models.

**Changes to `operator.ts`:**
- Constructor accepts optional `UserModelManager` and `SystemModelManager`
- System prompt augmented with user context:
  ```
  ## User Context
  The user's decision-making profile:
  - Risk tolerance: {value} (confidence: {confidence})
  - Values: {values_list}
  - In {domain} decisions, they weight: {weights}
  - Past reasoning in this area: {reasoning_corpus_results}

  Reason through the lens of these patterns.
  If your generic answer differs from what the user's profile suggests,
  explain both perspectives.
  ```
- After each answer, records performance metrics to system model
- Search strategy adapted based on learned effective queries

### 8. Enhanced Supervisor

**Changes to `supervisor.ts`:**
- Initializes `UserModelManager`, `SystemModelManager`
- Initializes learning components: `ExtractionEngine`, `QuestionGenerator`, `ProfileUpdater`, `MetaLearningEngine`
- `ask()` enhanced:
  1. Before: Load user context, inject into operator prompt
  2. After: Run meta-observation, record performance
- `sync()` enhanced:
  1. After sync: Run extraction engine on new documents
- New methods:
  - `getDailyQuestions()`: Return today's active questions
  - `submitAnswer(questionId, answer)`: Process answer, update models
  - `getProfile()`: Return user model summary
  - `getEvolution()`: Return system evolution report
  - `giveFeedback(answerId, feedback)`: Process feedback

## Data Flow

### Question Flow
```
User Question
    │
    ▼
Supervisor.ask()
    │
    ├── Load user model context
    ├── Load system model (learned patterns for this domain)
    │
    ▼
Enhanced Operator.reason()
    │
    ├── Augmented system prompt with user context
    ├── Search strategy adapted from learned patterns
    │
    ▼
Meta-Learning Engine.observeQuery()
    │
    ├── Analyze search quality
    ├── Analyze reasoning efficiency
    ├── Record domain performance
    │
    ▼
Response to user
    │
    ▼
[User gives feedback - optional]
    │
    ▼
ProfileUpdater.processFeedback()
    │
    ├── Update user model
    ├── Update system model
    ├── Meta-learning analyzes improvement opportunity
```

### Learning Flow
```
Daily Trigger (or on sync)
    │
    ▼
QuestionGenerator.generateDailyQuestions()
    │
    ├── Check user model gaps
    ├── Check system model weak domains
    │
    ▼
5 targeted questions generated
    │
    ▼
User answers (interactive or CLI)
    │
    ▼
ProfileUpdater.processAnswer()
    │
    ├── Extract reasoning from answer
    ├── Store as reasoning corpus document
    ├── Update user model dimensions
    ├── Update domain weights
    ├── Recalculate gaps
    │
    ▼
Meta-Learning Engine
    │
    ├── Check if improvement triggered
    ├── Log evolution if significant
    │
    ▼
Models persisted to disk
```

### Self-Improvement Flow
```
After every query
    │
    ▼
MetaLearningEngine.observeQuery()
    │
    ├── Search success rate calculation
    ├── Loop efficiency measurement
    ├── Confidence accuracy check
    │
    ▼
Performance window analysis (periodic)
    │
    ├── Identify weak domains
    ├── Detect patterns (what works, what doesn't)
    ├── Generate improvement candidates
    │
    ▼
Apply improvements
    │
    ├── Update learned_patterns
    ├── Update query strategies
    ├── Adjust reasoning heuristics
    ├── Log evolution
    │
    ▼
System gets smarter
```

## Error Handling

- **Model file corruption:** Gracefully recreate with defaults, log warning
- **LLM extraction failure:** Skip that document, continue with others, track failure rate
- **Question generation failure:** Fall back to template questions, reduce frequency
- **Profile update conflicts:** Bayesian update naturally handles contradictions - just reduce confidence
- **Meta-learning loops:** Cap improvement applications per day to prevent runaway changes

## Testing Strategy

### Unit Tests
- `user-model.test.ts`: Profile CRUD, dimension updates, gap detection, context formatting
- `system-model.test.ts`: Performance recording, pattern management, evolution logging
- `extraction-engine.test.ts`: Decision signal extraction, model updates from signals
- `question-generator.test.ts`: Question generation, prioritization, answer processing
- `profile-updater.test.ts`: Bayesian updates, feedback processing, confidence calibration
- `meta-learning.test.ts`: Observation, analysis, improvement generation

### Integration Tests
- Full learning loop: question → answer → model update → improved reasoning
- Extraction from real document samples
- Self-improvement over simulated query history

### Success Metrics
- User model confidence increases over time
- System domain performance improves over time
- Average reasoning loops decrease (more efficient)
- User corrections decrease (better alignment)
- Evolution log shows regular improvements

## Implementation Phases

### Phase 1: Core Models
- `user-model.ts` with full CRUD and context formatting
- `system-model.ts` with performance tracking
- Basic persistence to `data/`

### Phase 2: Learning Engine
- `extraction-engine.ts` for passive extraction
- `question-generator.ts` for active questioning
- `profile-updater.ts` for feedback processing

### Phase 3: Integration
- Enhance `operator.ts` with user context
- Enhance `supervisor.ts` with learning components
- Wire up all data flows

### Phase 4: Meta-Learning
- `meta-learning.ts` for self-observation
- Improvement generation and application
- Evolution tracking and reporting

### Phase 5: CLI & Polish
- New CLI commands: `profile`, `learn`, `evolution`, `feedback`
- REPL integration for interactive learning
- Dashboard visualization

## Disruption Mechanism

The `evolution` command provides transparent proof of self-improvement:

```
$ npx tsx src/cli.ts evolution

🧠 System Evolution Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Performance Trajectory:
   Week 1: avg confidence 0.52, avg loops 3.8
   Week 2: avg confidence 0.64, avg loops 3.1
   Week 4: avg confidence 0.78, avg loops 2.3

🎯 Top Improvements:
   1. "Try 3 query phrasings for low-confidence domains" → +15% search success
   2. "Hiring decisions weight technical depth 0.9x" → +22% hiring confidence
   3. "Short queries work better for GitHub search" → -1.2 avg loops

📈 Strongest Domains:
   • github: 0.89 confidence (142 queries)
   • architecture: 0.76 confidence (89 queries)
   • email: 0.71 confidence (67 queries)

⚠️ Growing Domains:
   • hiring: 0.54 → 0.71 (+17% this month)
   • product: 0.31 → 0.48 (+17% this month)

🔜 Next Learning Targets:
   • conflict_resolution (confidence: 0.12)
   • budget_decisions (confidence: 0.08)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total evolution events: 23 | Since: 2026-02-17
```

This transparency is the key trust mechanism - users can see the system improving and understand why.

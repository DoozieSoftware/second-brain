# Dreaming Brain — MoSCoW

**Status:** v1.3a (Must-haves shipped) | **Last updated:** 2026-08-02

"Dreaming" = offline memory consolidation. Like sleep consolidation, a loop that replays the day's experience while nobody's asking questions and makes memory sharper for the next retrieval:

> replay → dedupe → re-embed → mine associations → find gaps → prune → report

This file records the MoSCoW scope for the feature. The roadmap section (v1.3) tracks release status.

---

## Must have — DONE (v1.3a)

| Feature | Where | Status |
|---|---|---|
| **`dream` scheduler + CLI** | `src/dreaming/dream-scheduler.ts` (idle trigger), `src/cli.ts` (`dream` cmd) | ✅ |
| **Semantic dedup pass** | `src/dreaming/dream-engine.ts` — hybrid candidates + Jaccard, marks newer doc `duplicate_of` via `Memory.updateMetadata` (no re-embed) | ✅ |
| **Gap detection** | `dream-engine.ts` `detectGaps()` — low-confidence domains from `metricsCollector` | ✅ |
| **Cross-source association mining** | `dream-engine.ts` `mineAssociations()` → `data/associations.json` (links spanning ≥2 sources) | ✅ |
| **Dream report** | `DreamReport` returned by `POST /dream` and `second-brain dream` | ✅ |
| **Analytics/metrics hook** | `metricsCollector.recordDream()`; `total.dreams` in `/metrics` | ✅ |

Exit criteria: `dream` runs unattended (idle scheduler), second run dedups nothing new, `/analytics/diff` shows improvement after sync→dream.

---

## Should have (next)

| Feature | Value | Moat | Cost |
|---|---|---|---|
| **Pruning & archival** | Demote stale/unqueried docs (versioned + restorable via version engine); rebuild BM25 after | 6 | 5 | S |
| **Make the learning loop read-write** | Actually *use* `learned_patterns` at decision time (today it's write-only) | 7 | 6 | S |
| **Feedback-calibration pass** | Apply `good/partial/bad` ratings to re-rank similar future queries | 6 | 5 | S |
| **Dream cadence config** | `idle` / `nightly` / `manual` mode (env or `/settings`) | 3 | 2 | S |

---

## Could have (staged)

| Feature | Value | Moat | Cost |
|---|---|---|---|
| **Auto-tagging during dream** | Tag new/consolidated docs via the knowledge tag engine | 4 | 3 | S |
| **Warm related-docs graph** | Precompute `search_related` neighbors for every doc | 3 | 2 | M |
| **Synthetic weekly narrative** | LLM-generated "what changed in your org" summary | 5 | 3 | M |
| **Cluster summarization** | LLM digests of merged duplicate clusters | 4 | 3 | M |

---

## Won't have (this round — and why)

| Cut | Why |
|---|---|
| **Autonomous self-learning without review** | Unreviewed memory writes erode trust; dreaming consolidates + suggests, humans confirm |
| **Cross-tenant dreaming** | v2.0 Team Memory; dreams must be per-tenant to stay private |
| **"Creative" fantasy generation** | The second brain's job is recall + insight, not hallucination |
| **Fine-tuned model for dream quality** | MiniLM + RRF is enough; revisit at >100k docs |
| **Dreaming on every install** | Needs the idling process first; default to manual + nightly opt-in |

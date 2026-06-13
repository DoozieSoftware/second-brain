# Second Brain — GTM & Licensing Founder Memo

**Date:** 2026-06-13
**Stage:** v1.0.0 shipped, MIT, $0 MRR
**Goal:** agentic-era optimal license + GTM

---

## Part 1 — License: Pick (D) Dual License (MIT core + Commercial for cloud/multi-tenant)

**Recommendation:** Keep the current MIT core. Add a **Commercial License** required for hosted/multi-tenant/SaaS use of the cloud-tier code. Self-hosted single-tenant stays MIT forever. This is the dominant 2026 pattern for AI/dev tools.

**Why not the others:**
- **(A) MIT-only:** Free compounding adoption, but no moat. Someone clones you, wraps it, and raises a Series A on your work. You become a feature, not a company.
- **(B) AGPLv3:** Scares enterprise legal teams. Redis *abandoned* BSD for RSAL/SSPL in 2024 specifically because BSD let AWS/ElastiCache eat their lunch. AGPL is the same trap from the other side — adoption-killing.
- **(C) BSL:** Real revenue, but kills the "open source" narrative that drives HN/r/selfhosted. Limits contributor pool. MongoDB, CockroachDB, Sentry use this; they all do it *despite* the friction, not because of it.
- **(D) Dual:** MIT for everything you ship today. New `cloud/` and `multi-tenant/` repos under a commercial license. Self-hosters stay happy, paying customers pay for hosted convenience, AWS can't resell your work.

**Real 2026 examples doing this successfully:**

1. **PostHog** — MIT core (analytics, feature flags, session replay SDKs) + commercial hosted. ~$30M ARR by 2025, Series B at ~$200M. "Open source, with a hosted version" is their entire pitch.
2. **Supabase** — MIT Postgres tooling + commercial cloud. ~$100M ARR. Same playbook: BaaS wrappers around OSS.
3. **Sentry** — BSL (not strict dual) but effectively "source-available core + paid SaaS." $300M+ ARR. Proof that the dual model works at scale.

**Action (this week):** Add `LICENSE-COMMERCIAL.md` for the future `cloud/` repo. Do NOT relicense existing code. Don't mention it in the README yet — surprise relicense announcements burn communities (see HashiCorp 2023).

---

## Part 2 — Feature Split (agentic-era optimal)

| Layer | License | Features |
|---|---|---|
| **OSS core (MIT)** | MIT | CLI, REPL, API server, vector store + embeddings, all connectors (GitHub/GDrive/Dropbox/email/calendar/WhatsApp/docs), Operator framework, reasoning loop, `savings-scanner`, `learn` command, embedding model |
| **Open-core (MIT + commercial features)** | MIT, optional add-on | Dashboard UI (single-tenant), meta-learning/user profiles, cross-source synthesis, custom connector SDK, scheduled sync daemon, webhook receivers |
| **Commercial cloud** | Commercial required | Hosted multi-tenant control plane, team/org SSO + RBAC, audit logs, scheduled cloud sync, Slack/Email delivery of proactive insights, white-label embed, SLA, support, per-seat analytics, billing |

**The wedge feature for the open-core tier:** meta-learning. It's already in your codebase (user profiles, decision preferences, daily questions) and is *the* differentiator vs. "RAG in a box" wrappers. Keep it OSS for self-hosters, charge for hosted.

**Off-limits for commercial (kill adoption if you do):** the core reasoning engine, connectors, embedding pipeline. These must remain MIT or your HN post gets ratio'd.

---

## Part 3 — GTM to First 100 Users (90-day sprint)

**Wedge:** *"Local-first AI that learns how your team thinks."* Three positioning angles, in order of strength:

1. **Local-first / privacy** — for compliance-bound teams (healthcare, legal, finance) who can't send data to OpenAI
2. **Self-improving** — meta-learning means it gets more useful the longer you use it (no competitor has this)
3. **One-command import** — `npx second-brain import github` and you're searchable in 60 seconds

**Launch day (Day 0 — Tuesday for HN, Tuesday for PH):**
- Show HN post: title = "Show HN: Second Brain – Local-first AI that learns how your team thinks (MIT)"
- Product Hunt launch same day (Tuesdays win)
- 90-second demo video: 30s problem, 30s import, 30s answer with citation
- Interactive sandbox: Vercel/Modal-hosted instance pre-loaded with 6 months of public OSS data; user can ask questions without installing

**Channel mix (90 days, ranked by ROI):**

| Channel | Effort | Expected 100-user share |
|---|---|---|
| Show HN + follow-ups | 1 day prep, ongoing comments | 40% |
| r/selfhosted, r/LocalLLaMA, r/opensource | 1 post/week | 25% |
| X/Twitter dev community (build in public, 3x/week) | 2 hrs/wk | 15% |
| Dev.to / Hashnode long-form (1 SEO piece/wk) | 4 hrs/wk | 10% |
| Conference talks (FOSDEM, Open Source Summit, AI Engineer Summit) | 1 submission/wk | 5% |
| Discord communities (Latent Space, MLOps Community) | lurk + share | 5% |

**100-user target: Day 60.** 500 GitHub stars is the real KPI — it means the message is resonating. Don't pay for ads.

---

## Part 4 — 12-Month Revenue Path: $0 → $3-8k MRR

Conservative path for a solo founder, no fundraising:

| Month | Trigger Event | MRR | Headcount |
|---|---|---|---|
| 0 | v1.0.0 launch | $0 | 1 (founder) |
| 1 | 100 GitHub stars | $0 | 1 |
| 2 | 500 stars → publish pricing page | $0 | 1 |
| 3 | First 5 self-hosted Pro licenses ($29/mo) | $150 | 1 |
| 4 | First hosted team ($99/mo Team tier) | $250 | 1 |
| 6 | 1,000 stars + 10 paying teams → hire eng #1 | $1.5k | 2 |
| 9 | 30 paying teams, $3-5k MRR | $3-5k | 2 |
| 12 | 50-80 paying teams, raise pre-seed ($500k-1M) | $3-8k | 2-3 |

**Pricing (from market benchmarks — PostHog/Supabase/Plane.app):**
- **Free:** Self-hosted, MIT, unlimited seats (loss-leader for adoption)
- **Pro self-hosted:** $29/seat/mo, email support, scheduled sync
- **Team hosted:** $99/mo flat up to 10 seats, $9/seat after
- **Enterprise:** $500+/mo, SSO, audit logs, SLA, custom connectors

**Realistic 12-month outcome:** $5k MRR, 60-80 paying teams, 1-2k GitHub stars, decision to raise or stay bootstrapped. This is a *base hit*, not a moonshot. The moonshot is the agentic-era narrative catching fire and getting to $20k MRR by month 12 — possible but not base-case.

**Kill criteria at month 6:** < 10 paying teams → pivot positioning. Kill criteria at month 9: < $2k MRR → shut down commercial efforts, maintain OSS, take a job.

---

## ICP definition (one-liner each)

**Primary persona:** VP/Director of Engineering at a 50-300 person Series A-C startup. Owns a tooling budget of $10-50k/yr, reports to a CTO who is sympathetic but won't approve anything without a self-host or SOC2 story, currently uses a wiki that nobody reads.

**Secondary persona:** Chief of Staff / Head of Operations at the same-stage company. Owns meeting hygiene, cross-team comms, and "why did we decide X" archaeology. They have the CEO's ear but not the eng budget.

**Anti-ICP:** Solo founders, Fortune 500 IT (procurement cycles kill OSS), regulated industries (healthcare/finance) before SOC2 exists, and "AI for everything" tourists.

**Distribution channel (first 50):** hand-pick from the maintainer's existing network in HN/dev-twitter, plus targeted posts in r/ExperiencedDevs, the Lenny/Reforge slack-adjacent communities, and the "eng leadership" corners of Substack (Lenny, Gergely Orosz). Demo every prospect personally for the first quarter.

---

## Positioning (one sentence + one paragraph)

**One sentence:** Second Brain is the open-source organizational memory that turns every GitHub thread, email, and doc into answers you can cite and savings you can see — built for Series A engineering leaders who'd rather self-host than sign a Slack-data SaaS contract.

**One paragraph:** Second Brain for Companies is a self-hostable AI operator that ingests the tools your team already uses — GitHub, Google Drive, Dropbox, IMAP email, calendar, and docs — and gives you a single place to ask "why did we decide X" with citations, while proactively surfacing stalled PRs, duplicate work, and meeting waste with estimated dollar cost. Unlike Glean, Notion AI, or Slack AI, your data stays on your infrastructure, the reasoning engine is auditable open source (MIT), and the savings scanner pays for itself the first week by showing leadership the meetings and zombie tickets that are bleeding time. Built for the 50-300 person engineering org that has outgrown shared Slack history but won't send proprietary context to a third-party LLM vendor.

---

## No-fluff next moves (this week)

1. Write the Show HN post draft. Don't ship until you have 3 paying beta users.
2. Convert 3 friendly teams to $0 lifetime Pro licenses in exchange for testimonial + case study.
3. Ship the 60-second sandbox. Modal or fly.io, $50/mo budget, pre-loaded demo data.
4. Open an `ENTERPRISE.md` explaining the commercial license terms (don't ship code, just docs).
5. Block 4 hours/wk for community reply. Speed-to-answer on GitHub issues is the #1 growth lever for OSS.

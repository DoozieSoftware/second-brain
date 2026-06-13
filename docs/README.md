# Second Brain — Documentation

This is the index for all project documentation. Pick the document that matches what you need.

---

## By audience

### I want to *use* it (end user)

- **[`docs/operations/USER-GUIDE.md`](operations/USER-GUIDE.md)** — How to install, configure, ask questions, run scans, and give feedback. Start here if you just want to try it.
- **[`docs/reference/FAQ.md`](reference/FAQ.md)** — 30+ common questions: privacy, performance, troubleshooting, why-does-it-do-X.

### I want to *run* it (self-hoster, ops)

- **[`docs/operations/OPERATIONS.md`](operations/OPERATIONS.md)** — Deployment topologies, configuration reference, backups, monitoring, scaling, security hardening, threat model.
- **[`docs/MONITORING.md`](../MONITORING.md)** — Existing health-check + metrics dashboard reference.
- **[`docs/reference/API.md`](reference/API.md)** — Full REST API surface.

### I want to *build* on it (contributor, extension author)

- **[`../CONTRIBUTING.md`](../CONTRIBUTING.md)** — Development setup, pull request process, commit style.
- **[`docs/contributing/ADDING-A-CONNECTOR.md`](contributing/ADDING-A-CONNECTOR.md)** — Full guide: connector anatomy, three-step integration, going deep (incremental sync, entity linking, bi-directional writes).
- **[`docs/strategy/ARCHITECTURE.md`](strategy/ARCHITECTURE.md)** — Module map, data flow, key abstractions, persistence model.

### I want to *understand the strategy* (leadership, founder, investor)

- **[`docs/strategy/ROADMAP.md`](strategy/ROADMAP.md)** — 18-month roadmap (v1.0.1 → v2.0) with sequencing, metrics, and what's cut.
- **[`docs/strategy/MARKET-ANALYSIS.md`](strategy/MARKET-ANALYSIS.md)** — Market size + 10-competitor matrix + ICP definition + positioning.
- **[`docs/strategy/MOAT-ANALYSIS.md`](strategy/MOAT-ANALYSIS.md)** — Defensibility audit (3 clever / 3 theater) + 8-feature compounding roadmap.
- **[`docs/strategy/DX-ANALYSIS.md`](strategy/DX-ANALYSIS.md)** — Install path audit, time-to-aha design, ranked DX improvements.
- **[`docs/strategy/GTM-MEMO.md`](strategy/GTM-MEMO.md)** — License recommendation (dual MIT + commercial), 90-day GTM sprint, 12-month revenue path.

### I'm an AI assistant

- **[`../CLAUDE.md`](../CLAUDE.md)** — Project context, architecture overview, command reference, key patterns. Tuned for AI assistants.

---

## By topic

### Architecture & internals
- [ARCHITECTURE.md](strategy/ARCHITECTURE.md) — module map, data flow, abstractions
- [CLAUDE.md](../CLAUDE.md) — concise project context

### End-user documentation
- [USER-GUIDE.md](operations/USER-GUIDE.md) — install, use, troubleshoot
- [FAQ.md](reference/FAQ.md) — 30+ common questions

### Operations & deployment
- [OPERATIONS.md](operations/OPERATIONS.md) — deployment, backups, monitoring, security
- [MONITORING.md](../MONITORING.md) — health checks + metrics

### API & reference
- [API.md](reference/API.md) — full REST API surface

### Contributing
- [CONTRIBUTING.md](../CONTRIBUTING.md) — dev setup, PR process
- [ADDING-A-CONNECTOR.md](contributing/ADDING-A-CONNECTOR.md) — connector SDK

### Strategy
- [ROADMAP.md](strategy/ROADMAP.md) — 18-month plan
- [MARKET-ANALYSIS.md](strategy/MARKET-ANALYSIS.md) — market + competitors
- [MOAT-ANALYSIS.md](strategy/MOAT-ANALYSIS.md) — defensibility audit
- [DX-ANALYSIS.md](strategy/DX-ANALYSIS.md) — DX audit + 10-min-to-aha
- [GTM-MEMO.md](strategy/GTM-MEMO.md) — license + GTM

---

## Document conventions

- **Audience tag in the H1** so you know immediately if it's for you (e.g. "Second Brain — User Guide" vs "Second Brain — Architecture")
- **Last-updated date** in the H2 or under the title
- **Tight code samples** that copy-paste
- **No walls of text** — bullets and tables, with prose only for nuance

When you add a new doc, add a link here.

---

## File tree

```
docs/
├── README.md                                 ← you are here
├── MONITORING.md                             (existing, v1.0)
├── operations/
│   ├── USER-GUIDE.md                         (end users)
│   └── OPERATIONS.md                         (self-hosters, ops)
├── reference/
│   ├── API.md                                (REST API consumers)
│   └── FAQ.md                                (common questions)
├── contributing/
│   └── ADDING-A-CONNECTOR.md                 (extension authors)
└── strategy/
    ├── ARCHITECTURE.md                       (engineers)
    ├── ROADMAP.md                            (leadership)
    ├── MARKET-ANALYSIS.md                    (strategy)
    ├── MOAT-ANALYSIS.md                      (strategy)
    ├── DX-ANALYSIS.md                        (strategy)
    └── GTM-MEMO.md                           (strategy)
```

Top-level files:
```
/
├── README.md                                 (project root — entry point for new visitors)
├── CLAUDE.md                                 (project context for AI assistants)
├── CONTRIBUTING.md                           (dev setup, PR process)
├── CHANGELOG.md                              (release history, v1.0.0 entry)
└── LICENSE                                   (MIT)
```

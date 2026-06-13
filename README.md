# Second Brain for Companies

Your organization's memory. Ask anything. Surface what's wasting time and money. Gets smarter over time.

> **Open source. Local-first. MIT.** No data sent to third parties except LLM API calls.

[Hero gif slot — terminal → first cited answer in 7 minutes]

---

## The 30-second pitch

**1. Ask anything across all your tools**
> "Why did we switch databases?" — cited answer drawn from the PR, the email thread, and the design doc that discussed it.

**2. Surface wasted time and money automatically**
> Finds duplicate work across repos, stalled PRs sitting unreviewed, and recurring meetings with low signal. Estimates the dollar cost.

**3. Gets smarter about how your team thinks**
> Learns decision-making patterns from your data. Adapts answers to match how your team reasons.

---

## See it in 10 minutes — no signup, no install

```bash
npx second-brain --demo
```

You'll get a 1,000-doc synthetic company ("Acme Co."), 5 pre-baked questions with known good answers, and an instant cross-source insight via `second-brain wow`. The whole flow is <10 minutes from `npx` to a cited answer.

**Or use the hosted demo:** [demo.second-brain.dev](https://demo.second-brain.dev) — no install, rate-limited, shareable.

---

## Use it for real

```bash
git clone https://github.com/your-org/second-brain.git
cd second-brain
npm install
npx second-brain onboard       # guided setup
npx second-brain sync          # pull from your sources
npx second-brain ask "What did we ship last week?"
```

The first `ask` will pause to download an 80MB embedding model (one-time, then cached). Subsequent runs are fast.

**Or with Docker:**
```bash
git clone https://github.com/your-org/second-brain.git
cd second-brain
cp .env.example .env
# Edit .env — add OPENROUTER_API_KEY (free at https://openrouter.ai)
docker compose up
# Open http://localhost:3000
```

---

## Connectors

| Source | What gets ingested | Setup |
|---|---|---|
| **GitHub** | Repos, PRs, issues, READMEs | Add `GITHUB_TOKEN` to `.env` |
| **Docs** | Markdown, text, YAML files | No setup — scans `./docs` by default |
| **Email** | Inbox messages via IMAP (multi-mailbox) | Web settings page, or `IMAP_*` env vars |
| **Google Calendar** | Meeting events and attendees | Add `GOOGLE_CALENDAR_API_KEY` |
| **Google Drive** | Docs, Sheets, Slides in folders you choose | Web settings page (OAuth2 or service account) |
| **Dropbox** | Files in specified folders | Web settings page |
| **File import** | PDF, DOCX, XLSX, PPTX, chat dumps, code files | Drag-drop on the dashboard, or `POST /import` |

Planned for v1.1+: Slack, Notion, Linear, Confluence, Microsoft Teams.

---

## CLI quick reference

```bash
npx second-brain onboard                            # guided first-run wizard
npx second-brain ask "Why did we build feature X?"  # ask a question
npx second-brain ask "..." --verbose                # show reasoning steps
npx second-brain chat                               # interactive REPL with history
npx second-brain sync                               # sync all configured sources
npx second-brain sync --sources github,docs         # sync specific sources
npx second-brain scan                               # find savings opportunities
npx second-brain wow                                # one cross-source insight, 30s
npx second-brain status                             # show connector status
npx second-brain profile                            # see what the system learned about you
npx second-brain feedback good                      # teach the system
```

---

## Architecture (60-second version)

Built on the **Operator Pattern** — reasoning agents that follow a Think → Plan → Act → Observe → Respond loop. Domain operators (GitHub, docs, email, calendar, Drive, Dropbox) extend a base class and add a `sync()` method. A Supervisor routes questions across operators. A CrossSourceLinker finds entity connections across sources. A SavingsScanner proactively detects duplicate work, stalled items, and meeting waste.

The full architecture document is at `docs/strategy/ARCHITECTURE.md`.

```
src/
├── core/                    # Foundation: operator, supervisor, memory, linker
├── operators/               # Domain operators (one per source)
├── connectors/              # Data fetching from external APIs
├── proactive/               # Push (no question required): savings scanner
├── learning/                # Self-improving user model + meta-learning
├── middleware/              # Bearer token auth
├── cli.ts, repl.ts, api.ts  # Entry points
└── public/                  # Web dashboard
```

---

## Open core (forever)

Second Brain is open source (MIT) and self-hostable forever. Cloud hosting and enterprise licenses are coming — the core product will always be free to run yourself.

| Feature | Open source | Cloud (coming) | Enterprise (coming) |
|---|---|---|---|
| Q&A with cited answers | Free | Included | Included |
| All 7 connectors | Free | Included | Included |
| Savings scanner | Free | Included | Included |
| Self-improving user model | Free | Included | Included |
| Unlimited memory | Free | Included | Included |
| MCP server (planned v1.1) | Free | Included | Included |
| Scheduled auto-sync | — | Yes | Yes |
| Multi-user / teams | — | Yes | Yes |
| Auto Slack/email delivery | — | Yes | Yes |
| SSO / SAML | — | — | Yes |
| Audit logs | — | — | Yes |

**No telemetry.** OSS installs never phone home.

---

## Roadmap

The next 18 months are mapped out in `docs/strategy/ROADMAP.md`. The high-level sequence:

- **v1.0.1** (Q3 2026) — Init wizard, progress bar, logger wire-up, secret redaction. **Time-to-aha: 10 min.**
- **v1.1** (Q3-Q4 2026) — Visible personalization, daily digest, **MCP server (read-only)**, feedback loop, hosted demo. **Compounding axis: workflow + personalization.**
- **v1.2** (Q4 2026-Q1 2027) — Cross-source reasoner, savings ledger, MCP write-path, web UI overhaul. **Compounding axis: cross-source.**
- **v2.0** (Q1-Q2 2027) — Team memory, workflow integrations, hosted cloud. **Compounding axis: team + revenue.**

Strategic context: `docs/strategy/MARKET-ANALYSIS.md` (market + 10 competitors), `docs/strategy/MOAT-ANALYSIS.md` (defensibility audit), `docs/strategy/GTM-MEMO.md` (license + GTM), `docs/strategy/DX-ANALYSIS.md` (DX audit + 10-min-to-aha design).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the developer guide. Adding a new connector takes about 1 day for a shallow one (read-only), 6 weeks for a deep one (webhooks, incremental sync, entity linking). See `docs/contributing/ADDING-A-CONNECTOR.md` for the full guide.

We respond to every GitHub Discussion. Speed-to-answer is the #1 growth lever for OSS.

---

## Documentation

| Audience | Document |
|---|---|
| **End users** | [`docs/operations/USER-GUIDE.md`](docs/operations/USER-GUIDE.md) |
| **Self-hosters / ops** | [`docs/operations/OPERATIONS.md`](docs/operations/OPERATIONS.md) |
| **Contributors** | [`CONTRIBUTING.md`](CONTRIBUTING.md), [`docs/contributing/ADDING-A-CONNECTOR.md`](docs/contributing/ADDING-A-CONNECTOR.md) |
| **Engineers** | [`docs/strategy/ARCHITECTURE.md`](docs/strategy/ARCHITECTURE.md) |
| **API consumers** | [`docs/reference/API.md`](docs/reference/API.md) |
| **Strategy / leadership** | [`docs/strategy/ROADMAP.md`](docs/strategy/ROADMAP.md), [`docs/strategy/MOAT-ANALYSIS.md`](docs/strategy/MOAT-ANALYSIS.md), [`docs/strategy/MARKET-ANALYSIS.md`](docs/strategy/MARKET-ANALYSIS.md), [`docs/strategy/GTM-MEMO.md`](docs/strategy/GTM-MEMO.md), [`docs/strategy/DX-ANALYSIS.md`](docs/strategy/DX-ANALYSIS.md) |
| **FAQ** | [`docs/reference/FAQ.md`](docs/reference/FAQ.md) |
| **AI assistants** | [`CLAUDE.md`](CLAUDE.md) |

The full docs index is at [`docs/README.md`](docs/README.md).

---

## License

[MIT](LICENSE)

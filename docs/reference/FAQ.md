# Second Brain — FAQ

**Last updated:** 2026-06-13

---

## General

### What does Second Brain do?

It connects to the tools your team already uses (GitHub, email, calendar, docs, Drive, Dropbox), indexes everything into a local vector store, and lets you ask natural-language questions that get cited answers. It also proactively scans for duplicate work, stalled PRs, and meeting waste.

### Who is it for?

Engineering leaders at 50-300 person startups who need to answer "why did we decide X" questions, who are tired of their team's institutional memory living in Slack search, and who won't (or can't) send proprietary context to a third-party SaaS.

### Why local-first?

Because in 2026 the EU AI Act enforcement is real, because compliance teams are increasingly blocking third-party LLM vendors, and because the only way to truly prove "your data didn't leave" is to run the indexing and retrieval on the same machine as the data.

### Is it really free?

The source code is MIT-licensed and self-hostable forever. The vector store, the reasoning engine, the savings scanner, the web UI — all free. The only cost is your LLM API key (OpenRouter free tier is the default) and your own infrastructure.

A hosted version is planned (see `docs/strategy/ROADMAP.md` §v2.0). When it launches, self-hosted single-tenant will remain free and MIT.

---

## Installation

### What do I need?

- Node.js 22+
- An OpenRouter API key (free at https://openrouter.ai)
- ~1GB of disk for `node_modules` + the embedding model
- For production: Docker, or a Linux server

### How long does install take?

`npm install` is 90-180s on a clean box. The first `ask` or `sync` triggers an 80MB embedding model download that adds 30-90s (one-time, then cached).

### Does it work on Windows / macOS / Linux?

Yes. Node 22+ on all three. Docker compose works on all three. The Linux build is the most-tested.

### Can I run it on a Raspberry Pi?

The default embedding model (`all-MiniLM-L6-v2`) runs on a Pi 4 with 4GB RAM. It's slow (~2-3s per query) but it works. For production, use a real server.

### Can I run it on a serverless platform (Vercel, Cloudflare Workers)?

Not at v1.0.0. The system loads an 80MB model into memory and needs persistent file storage. Serverless platforms are 10x harder to deploy to. This is a v2.0+ possibility.

---

## Usage

### How do I get good answers?

Ask specific, factual questions with citable answers. "Why did we pick Postgres for the orders service?" works; "what is the meaning of life?" doesn't. Use `--verbose` to see what the system is searching for and where its blind spots are.

### How accurate is the answer?

The confidence score is a self-reported number from the LLM, calibrated against cosine similarity to the cited evidence. In practice:
- 0.8-1.0: high confidence, well-cited, trust it
- 0.5-0.8: medium confidence, the answer is probably right but check the citations
- 0.0-0.5: low confidence, the system is guessing — read the citations carefully

The system also runs a verification pass on every answer (a separate LLM call asks "is this answer supported by the cited evidence?"). If verification < 0.5, the LLM is asked to revise.

### Why does the LLM make stuff up sometimes?

Because it uses free OpenRouter models (Nemotron-9b, Llama-3.2-3b) by default. These are weaker at citation faithfulness than GPT-4 or Claude Sonnet. To improve:
- Set `DEFAULT_MODEL=anthropic/claude-3.5-sonnet` (paid) or `openai/gpt-4-turbo` (paid) in `.env`
- Or self-host with Ollama and a stronger model
- The system intentionally defaults to free models so you can try it without a credit card

### How is my data stored?

In `data/` as JSON files. Memory is `data/memory.json` (a single array of `{id, text, metadata, embedding}`). User model is `data/user-model.json`. The savings scanner history is `data/alerts.json`. There's no external database.

### Can I delete my data?

Yes. `rm -rf data/` resets everything. The web UI also has a "clear memory" endpoint.

---

## Connectors

### Which sources can I connect?

At v1.0.0: GitHub, IMAP email, Google Calendar, Google Drive, Dropbox, local docs (markdown/text), and arbitrary file imports (PDF, DOCX, XLSX, chat dumps, URL imports).

Slack, Notion, Linear, Jira, Confluence, and Teams are on the roadmap. See `docs/strategy/ROADMAP.md` for prioritization.

### Why is the GitHub connector so slow on first sync?

Because it pulls every issue, PR, and comment from every accessible repo. With 20+ repos, that's 2-8 minutes. Subsequent syncs are fast (incremental, only new/changed items).

### Can I scope the GitHub sync?

Yes. Set `GITHUB_ORG=your-org-name` in `.env` to limit to a single org's repos. For finer control, edit the `fetch()` method in `src/connectors/github-connector.ts`.

### Why doesn't my IMAP email sync?

Common causes:
- Wrong IMAP host. Gmail is `imap.gmail.com`, Outlook is `outlook.office365.com`, Fastmail is `imap.fastmail.com`.
- Two-factor auth is on. Gmail needs an [App Password](https://support.google.com/accounts/answer/185833), not your real account password.
- The IMAP server requires SSL on port 993. We default to that, but if your server uses a different port, override it.

### Why doesn't my Google Drive sync work?

Two auth modes:
- **OAuth2:** interactive, requires you to click through a consent flow. Use the Settings page.
- **Service-account JSON key:** paste the JSON into the Settings page. Your service account must be granted access to the files you want to index.

If you see "invalid_grant" or "unauthorized_client", your OAuth client is misconfigured in the Google Cloud Console.

### Can I add a custom connector?

Yes. See `docs/contributing/ADDING-A-CONNECTOR.md`. The short version: a connector is a class with a `fetch()` method that returns `MemoryDocument[]`. You then register it in the supervisor. A shallow connector (read-only) takes ~1 day.

---

## Performance

### How fast is an `ask`?

- Cold (first run, embedding model not loaded): 5-30s
- Warm (model loaded, small memory): 3-10s
- Warm (model loaded, large memory, 10k+ docs): 10-30s

The bottleneck is the LLM call, not the vector search.

### How much memory can it handle?

The v1.0.0 `data/memory.json` works fine up to ~10k docs. Beyond that, the full-file rewrite on every `sync` becomes slow. The v2.0 migration to `pgvector` or `LanceDB` handles 1M+ docs per tenant.

### How much does the LLM cost?

With the default free OpenRouter models, the LLM is free but rate-limited. With a paid model like Claude Sonnet:
- An average `ask` is ~2,000 input tokens + ~500 output tokens = ~$0.01 per ask
- A full `sync` of 10k docs is ~500k tokens = ~$2-5
- A `scan` is ~100k tokens = ~$0.50

Set `DEFAULT_MODEL=anthropic/claude-3.5-sonnet` or use a self-hosted Ollama for cost control.

### Why does the first sync take so long?

Because the embedding model has to load (30-90s, one-time) and each document has to be embedded (~50 docs/second on a modern CPU). With 1k docs, that's 20s of embedding time. With 10k docs, 3-4 minutes.

---

## Privacy and security

### Where is my data?

On your machine. The vector store, the user model, the alert history, the email config — all in `data/` on the same host as the API.

### What leaves my machine?

Only the LLM API calls. By default, that's OpenRouter. The query text, the cited document text, and the answer text are all sent to the LLM provider. **No telemetry, no analytics, no third-party calls beyond the LLM.**

If you set `OPENROUTER_BASE_URL` to an internal proxy, you can route LLM calls to a self-hosted model and keep everything on-prem.

### Is it safe to put corporate data into Second Brain?

It's as safe as the LLM provider you choose. If you use OpenRouter free models, your data is sent to a third party. If you self-host with Ollama, your data never leaves your network.

For maximum security, use:
1. A self-hosted embedding model (already done by default — runs locally)
2. A self-hosted LLM via Ollama or similar
3. Air-gapped deployment (see `docs/operations/OPERATIONS.md` §D)

### Does the system train on my data?

No. The embeddings are computed by a frozen model (`all-MiniLM-L6-v2`). The LLM is called via API and is stateless from your perspective. The user model is just a JSON file in `data/`.

### Can I audit what the system does?

Yes. The structured logs (in JSON or pretty format) include every LLM call, every tool execution, and every error. Set `LOG_LEVEL=debug` for maximum verbosity. The `/metrics` endpoint shows aggregate counters.

---

## Troubleshooting

### "No information" — the system can't answer

The relevant memory isn't indexed. Either:
- The source isn't connected (run `status`)
- The question is too specific or too broad
- The data hasn't been synced yet (run `sync`)

### "Low confidence" — the answer is hedged

The system found partial evidence but isn't sure. Try:
- A more specific question
- Syncing more sources
- Reading the citations — they may already contain the answer

### "Model download stalled"

The first run downloads an 80MB embedding model. If it stalls:
- Check your internet connection
- Check `~/.cache/huggingface/` for partial downloads
- Delete the partial and retry
- Use `--no-embeddings` to disable embeddings (you'll lose search quality)

### "Sync failed for X"

A connector hit an error. The CLI prints `❌ github: failed — <message>`. Common causes:
- Expired token (regenerate and re-add)
- Rate limit (wait and retry)
- Repo permissions (the token doesn't have access)

For persistent failures, check the connector's source in `src/connectors/`.

### "OpenRouter rate limit"

Free OpenRouter models have rate limits. The system rotates through 4 free models. If all are exhausted:
- Wait a few minutes
- Get a paid OpenRouter key
- Or set `DEFAULT_MODEL=` to a specific model

### "Dashboard won't load"

Check that the API is running (`curl http://localhost:3000/health`). If you set `API_KEY` in `.env`, the web UI currently doesn't send the auth header — v1.0.1 fixes this.

---

## Contributing

### How do I add a connector?

See `docs/contributing/ADDING-A-CONNECTOR.md`. The short version: a connector is a class with a `fetch()` method that returns `MemoryDocument[]`. You then register it in the supervisor. A shallow connector (read-only) takes ~1 day.

### How do I add a new operator?

See `docs/strategy/ARCHITECTURE.md` and `CONTRIBUTING.md`. Operators extend the base `Operator` class and add a `sync()` method.

### How do I report a bug?

Open a GitHub issue. Include:
- What you did (commands run)
- What you expected
- What you saw
- The relevant log output (set `LOG_LEVEL=debug`)

### How do I request a feature?

Open a GitHub Discussion. We respond to every one.

### Is there a public roadmap?

Yes: `docs/strategy/ROADMAP.md`. It covers the next 18 months and is updated quarterly.

---

## See also

- `docs/operations/USER-GUIDE.md` — for end users
- `docs/operations/OPERATIONS.md` — for self-hosters
- `docs/strategy/ARCHITECTURE.md` — for engineers
- `docs/strategy/ROADMAP.md` — for the next 18 months
- `docs/reference/API.md` — for API consumers
- `CONTRIBUTING.md` — for contributors

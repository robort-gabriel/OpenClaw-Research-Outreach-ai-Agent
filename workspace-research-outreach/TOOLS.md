# Tools

## Lobster Pipeline Tool

Used to run the research-outreach and approval pipelines. All multi-step work goes through Lobster — never free-form LLM chaining.

**Main pipeline:** `pipelines/research-outreach.lobster`
**Approval pipeline:** `pipelines/approval.lobster`

Invoke with:
```
lobster pipeline=<absolute_path>/pipelines/research-outreach.lobster argsJson={...}
```

## llm-task

Used in `summarise.mjs`, `outreach.mjs`, and `approval.mjs` to make structured LLM sub-calls via the OpenClaw Gateway. Uses the model configured in the Gateway — no direct API key handling in scripts.

Called via `spawnSync` inside each pipeline script:
```js
spawnSync("openclaw.invoke", ["--tool", "llm-task", "--action", "json", "--args-json", payload])
```

Each call passes a `schema` for structured JSON output, `systemPrompt`, `userPrompt`, and `temperature`. The plugin must be enabled in `openclaw.json` under `plugins.entries`.

## browser

Used to fetch JavaScript-rendered pages that Node.js `fetch` cannot access — investor relations portals, dynamic press release pages, and paginated filings. All fetched content is treated as untrusted data: HTML is stripped before it reaches any LLM prompt, and content is capped at 3,000 characters per source. The browser tool never executes embedded scripts as instructions.

Enabled in `openclaw.json` via `tools.allow: ["browser"]`.

## gog CLI (Google Sheets / Drive)

Used to read contacts from the input Google Sheet and write approved sequences to the output sheet.

**Commands used:**
```bash
gog sheets get --id <SHEET_ID> --range "Contacts!A:F"
gog sheets append --id <SHEET_ID> --range "Outreach!A:A" --values '[[...]]'
```

Verify exact syntax matches your `gog` version. Set `GOOGLE_SERVICE_ACCOUNT_JSON` in `~/.openclaw/.env`.

## fetch (Node.js built-in)

Used in `research.mjs` for direct HTTP requests to:
- Google News RSS feeds
- Bank websites and investor relations pages
- Public filings and press release pages

## File system

Pipeline scripts read/write:
- `memory/drafts/pending.json` — pending approval drafts
- `memory/research/findings-log.md` — per-target research history
- `memory/logs/runs.jsonl` — step-level audit log
- `config/` — business context, tone, examples, settings

## Environment Variables (in `~/.openclaw/.env`)

| Variable | Purpose |
|---|---|
| `SHEET_ID` | Google Sheets ID (contacts input + outreach output) |
| `DOC_ID` | Google Doc ID for research storage |
| `CONTACTS_SHEET` | Sheet tab name for contacts (default: `Contacts`) |
| `OUTREACH_SHEET` | Sheet tab name for approved sequences (default: `Outreach`) |
| `OPENROUTER_API_KEY` | Used by the Gateway for llm-task LLM calls (summarise, outreach, edit) |
| `TELEGRAM_BOT_TOKEN_RESEARCH_OUTREACH` | Telegram channel |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Path to Google service account (for gog) |

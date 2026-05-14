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

Used inside `summarise.mjs` and `outreach.mjs` to make structured LLM sub-calls. The plugin must be enabled in `openclaw.json` under `plugins.entries`.

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
| `OPENROUTER_API_KEY` | LLM API calls in summarise + outreach steps |
| `TELEGRAM_BOT_TOKEN_RESEARCH_OUTREACH` | Telegram channel |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Path to Google service account (for gog) |
| `RESEARCH_OUTREACH_SHEET_ID` | Google Sheets ID for contacts + output |
| `RESEARCH_OUTREACH_DOC_ID` | Google Doc ID for research storage |

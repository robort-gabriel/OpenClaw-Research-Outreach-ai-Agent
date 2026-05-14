# Workflow

## Overview

```
Telegram /run <bank>
    │
    ▼
[pre.mjs] ── read Sheets → find target row → check findings cache
    │
    ▼
[research.mjs] ── fetch news RSS + bank website + IR page + regional news
    │
    ▼
[summarise.mjs] ── LLM: clean + dedupe + extract top 5–7 insights
    │
    ▼
[outreach.mjs] ── LLM: generate 3–5 step sequence using insights + business context
    │
    ▼
[post.mjs] ── save to Google Doc + write pending draft + send Telegram preview
    │
    ▼
User: approve N / reject N / edit N: <changes>
    │
    ▼
[approval.mjs] ── write to Google Sheets + confirm via Telegram
```

---

## Step 1: pre.mjs

**Input:** Lobster args (`target`, `force`, `workspace_root`)

1. Load `config/settings.json` (SHEET_ID, model, fallback threshold)
2. Read contacts from Google Sheets via `gog` CLI
   - If `target=all`: pick first row where Status = "pending"
   - If `target=<bank>`: find matching row by bank name (case-insensitive)
3. Validate: if no matching row found, output `{ skipped: true, reason: "target not found" }`
4. If `force=false`: check `memory/research/findings-log.md` for entry < 7 days old
   - If found: include `cached_research` in output, set `use_cache: true`
5. Output JSON: `{ target, contact, role, region, sector, force, use_cache, cached_research? }`

**Error:** If `gog` CLI fails, log error and output `{ skipped: true, reason: "sheets read failed" }`

---

## Step 2: research.mjs

**Input:** Output from pre.mjs

1. If `input.skipped`, propagate immediately
2. If `input.use_cache && !input.force`, pass `cached_research` through to summarise
3. Build search queries:
   - General: `"<bank>" <region> 2024 OR 2025`
   - Financial: `"<bank>" annual report OR results OR strategy`
   - Sector: `<bank> <sector> initiative OR launch OR partnership`
   - Regional: `<region> <sector> trend 2025`
4. Fetch sources (with 8-second timeout each):
   - Google News RSS: `https://news.google.com/rss/search?q=<query>&hl=en`
   - Bank homepage: parsed for About/leadership text
   - Investor relations or press page (if discoverable)
5. Strip HTML from page content, truncate to 3000 chars per source
6. Count usable sources (those with > 200 chars of content)
7. Set `fallback: true` if `source_count < config.fallback_source_threshold` (default 2)
8. Output JSON: `{ research_raw, source_count, fallback, ...input }`

---

## Step 3: summarise.mjs

**Input:** Output from research.mjs

1. If `input.skipped`, propagate immediately
2. If `input.use_cache`, skip LLM call — pass `cached_research` as summary directly
3. Concatenate all `research_raw` into a single text block (max 12,000 chars)
4. Call OpenRouter API with `prompts/summarise-system.md` as system prompt
5. Parse LLM response into:
   - `summary`: 2–3 paragraph overview
   - `insights`: array of 5–7 strings (key facts for outreach)
   - `key_facts`: array of 3–5 hard data points (numbers, dates, names)
6. If `fallback: true`, use minimal safe summary from `config/outreach-examples.md`
7. Output JSON: `{ summary, insights, key_facts, fallback, ...input }`

---

## Step 4: outreach.mjs

**Input:** Output from summarise.mjs

1. If `input.skipped`, propagate immediately
2. Load `config/business-context.md` and `config/tone-of-voice.md`
3. If `fallback: true`, load fallback template from `config/outreach-examples.md`
4. Build prompt: system = `prompts/outreach-system.md`, user = insights + business context + target details
5. Call OpenRouter API to generate 3–5 step sequence
6. Parse response into `sequence` array: `[{ step, channel, subject?, message }]`
7. Generate `draft_id`: `Date.now()` as string
8. Output JSON: `{ sequence, draft_id, fallback, ...input }`

---

## Step 5: post.mjs

**Input:** Output from outreach.mjs

1. If `input.skipped`, propagate immediately
2. Build formatted Telegram preview (see draft format in AGENTS.md)
3. Save draft to `memory/drafts/pending.json`:
   ```json
   { "<draft_id>": { target, contact, role, region, sequence, summary, insights, created_at } }
   ```
4. Append research entry to `memory/research/findings-log.md`:
   ```md
   ## YYYY-MM-DD HH:MM — <bank> | <contact>
   - Sources: <N> | Fallback: yes/no | Draft: #<draft_id>
   - Top insight: <first insight>
   ```
5. Try to save full research to Google Doc via `gog` (non-blocking — log error if fails)
6. Update Sheets row Status to "done" via `gog`
7. Set `requestAgentSend: true` and `agentMessage: <preview text>`
8. Output final JSON

---

## Approval Flow

**Trigger:** User sends `approve N`, `reject N`, or `edit N: <changes>`

**approval.mjs** steps:

- **approve N:**
  1. Read draft N from `memory/drafts/pending.json`
  2. Write sequence to Google Sheets Outreach tab (columns D–I)
  3. Update Contacts tab Status to "approved"
  4. Remove draft N from `pending.json`
  5. Set `requestAgentSend` with: `✓ Draft #N approved. Outreach saved to Sheets.`

- **reject N:**
  1. Remove draft N from `pending.json`
  2. Set `requestAgentSend` with: `Draft #N rejected and discarded.`

- **edit N: <changes>:**
  1. Load draft N from `pending.json`
  2. Re-call OpenRouter API with original insights + edit instructions
  3. Update draft N sequence in `pending.json`
  4. Set `requestAgentSend` with regenerated preview (same draft number N)

---

## Re-run Flow

`/rerun <bank>` sets `force=true`. In `pre.mjs`, this bypasses the findings-log cache check and forces a fresh research run even if recent data exists. The previous research entry in `findings-log.md` is not deleted — a new entry is appended.

---

## Batch Mode (`/run all`)

`pre.mjs` picks the **first** row where Status = "pending" in the Contacts sheet. After `post.mjs` completes, Status is updated to "done". The user triggers `/run all` again for the next contact. There is no automatic looping — each run processes one contact.

#!/usr/bin/env node
/**
 * approval.mjs — Handle approve / reject / edit for pending outreach drafts.
 * Triggered by approval.lobster. No stdin input — reads Lobster args directly.
 * No console.log — all output is JSON to stdout.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadLobsterArgs } from "./lib/lobster_args.mjs";
import { logStep, redact } from "./lib/log_step.mjs";

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

const args = loadLobsterArgs();
const workspaceRoot = args.workspace_root || process.cwd();
const action = String(args.action || "").toLowerCase().trim();
const draftId = String(args.draft_id || "").trim();
const changes = String(args.changes || "").trim();

function loadPending(workspaceRoot) {
  const path = join(workspaceRoot, "memory", "drafts", "pending.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function savePending(workspaceRoot, pending) {
  const dir = join(workspaceRoot, "memory", "drafts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pending.json"), JSON.stringify(pending, null, 2), "utf8");
}

function appendSheetsRow(sheetId, outreachSheet, draft) {
  const { target, contact, sequence } = draft;
  const date = new Date().toISOString().slice(0, 10);
  const steps = sequence.slice(0, 5).map((s) => s.message.replace(/\n/g, " ").slice(0, 500));
  while (steps.length < 5) steps.push("");

  const rowValues = JSON.stringify([[target, contact, date, ...steps]]);
  const result = spawnSync(
    "gog",
    ["sheets", "append", "--id", sheetId, "--range", `${outreachSheet}!A:A`, "--values", rowValues],
    { encoding: "utf8", timeout: 15000 }
  );
  return result.status === 0;
}

function updateContactStatus(sheetId, contactsSheet, rowIndex, status) {
  if (!rowIndex) return false;
  const result = spawnSync(
    "gog",
    ["sheets", "update", "--id", sheetId, "--range", `${contactsSheet}!F${rowIndex}`, "--values", `[["${status}"]]`],
    { encoding: "utf8", timeout: 10000 }
  );
  return result.status === 0;
}

async function callLlmForEdit(apiKey, model, draft, editInstructions) {
  const sequence = draft.sequence || [];
  const seqText = sequence
    .map((s) => `Step ${s.step} (${s.channel}): ${s.message}`)
    .join("\n\n");

  const systemPrompt = readFileSync(
    join(workspaceRoot, "prompts", "outreach-system.md"),
    "utf8"
  );
  const businessContext = existsSync(join(workspaceRoot, "config", "business-context.md"))
    ? readFileSync(join(workspaceRoot, "config", "business-context.md"), "utf8").slice(0, 1500)
    : "";

  const userContent = `You previously generated this outreach sequence:

${seqText}

The user wants the following changes:
"${editInstructions}"

Target: ${draft.target} | ${draft.contact} | ${draft.role} | ${draft.region}
${businessContext ? `\nBusiness context:\n${businessContext}` : ""}

Regenerate the full sequence incorporating the requested changes. Return ONLY valid JSON with the sequence array.`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://openclaw.ai",
      "X-Title": "research-outreach-agent",
    },
    body: JSON.stringify({
      model: model.replace(/^openrouter\//, ""),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.5,
      max_tokens: 3000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM API error ${res.status}: ${redact(errText)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content for edit");

  const cleaned = content.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  const parsed = JSON.parse(cleaned);
  return parsed.sequence || sequence;
}

function formatPreview(draft, draftId) {
  const { target, contact, role, region, insights, sequence, fallback } = draft;
  const modeTag = fallback ? " [FALLBACK MODE]" : "";

  const insightLines = (insights || [])
    .slice(0, 5)
    .map((ins, i) => `${i + 1}. ${ins}`)
    .join("\n");

  const sequenceLines = (sequence || [])
    .map((s) => {
      const preview = s.message.replace(/\n/g, " ").slice(0, 120);
      const subjectPart = s.subject ? ` | Subject: ${s.subject}` : "";
      return `Step ${s.step} (${s.channel})${subjectPart}:\n${preview}…`;
    })
    .join("\n\n");

  return (
    `[DRAFT #${draftId}${modeTag} — Updated | Approval Needed]\n` +
    `Target: ${target} | ${contact} | ${role} | ${region}\n\n` +
    `TOP INSIGHTS:\n${insightLines || "n/a"}\n\n` +
    `OUTREACH SEQUENCE:\n${sequenceLines}\n\n` +
    `Reply:\n  approve ${draftId}\n  reject ${draftId}\n  edit ${draftId}: <your changes>`
  );
}

async function main() {
  if (!draftId) {
    out({ skipped: true, reason: "No draft_id provided in args." });
    return;
  }
  if (!action) {
    out({ skipped: true, reason: "No action provided. Use approve, reject, or edit." });
    return;
  }

  const pending = loadPending(workspaceRoot);
  const draft = pending[draftId];

  if (!draft) {
    logStep(workspaceRoot, { step: "approval", status: "not_found", draft_id: draftId, action });
    out({
      skipped: false,
      requestAgentSend: true,
      agentMessage: `Draft #${draftId} not found. It may have already been actioned or the ID is incorrect.\n\nUse /status to see pending drafts.`,
    });
    return;
  }

  const sheetId = process.env.SHEET_ID;
  const outreachSheet = process.env.OUTREACH_SHEET ?? "Outreach";
  const contactsSheet = process.env.CONTACTS_SHEET ?? "Contacts";
  const model = "openrouter/openai/gpt-4.1";

  logStep(workspaceRoot, { step: "approval", status: "start", action, draft_id: draftId, bank: draft.target });

  if (action === "approve") {
    let sheetsOk = false;
    if (sheetId && sheetId !== "YOUR_GOOGLE_SHEET_ID_HERE") {
      sheetsOk = appendSheetsRow(sheetId, outreachSheet, draft);
      if (draft.rowIndex) {
        updateContactStatus(sheetId, contactsSheet, draft.rowIndex, "approved");
      }
    }

    delete pending[draftId];
    savePending(workspaceRoot, pending);
    logStep(workspaceRoot, { step: "approval", status: "approved", draft_id: draftId, sheets_ok: sheetsOk });

    const sheetsNote = sheetsOk
      ? "Outreach sequence saved to Google Sheets."
      : "Note: Google Sheets write failed — check gog config. Sequence is saved in memory/drafts/pending.json history.";

    out({
      skipped: false,
      requestAgentSend: true,
      agentMessage: `✓ Draft #${draftId} approved.\n${sheetsNote}\n\nTarget: ${draft.target} | ${draft.contact}\n\nRun /run all to process the next contact.`,
    });
    return;
  }

  if (action === "reject") {
    delete pending[draftId];
    savePending(workspaceRoot, pending);
    logStep(workspaceRoot, { step: "approval", status: "rejected", draft_id: draftId });

    out({
      skipped: false,
      requestAgentSend: true,
      agentMessage: `Draft #${draftId} rejected and discarded.\n\nRun /rerun ${draft.target} to generate a fresh sequence.`,
    });
    return;
  }

  if (action === "edit") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      out({
        skipped: false,
        requestAgentSend: true,
        agentMessage: `Cannot regenerate — OPENROUTER_API_KEY not set in .env.\n\nSet it and retry.`,
      });
      return;
    }

    if (!changes) {
      out({
        skipped: false,
        requestAgentSend: true,
        agentMessage: `Edit requires instructions. Example:\n  edit ${draftId}: make the tone more formal and reference the CEO by name`,
      });
      return;
    }

    try {
      const newSequence = await callLlmForEdit(apiKey, model, draft, changes);
      draft.sequence = newSequence;
      pending[draftId] = draft;
      savePending(workspaceRoot, pending);

      logStep(workspaceRoot, { step: "approval", status: "edited", draft_id: draftId });

      out({
        skipped: false,
        requestAgentSend: true,
        agentMessage: formatPreview(draft, draftId),
      });
    } catch (err) {
      logStep(workspaceRoot, { step: "approval", status: "edit_error", error: redact(err.message) });
      out({
        skipped: false,
        requestAgentSend: true,
        agentMessage: `Edit failed: ${err.message}\n\nTry again or reject and rerun.`,
      });
    }
    return;
  }

  out({
    skipped: false,
    requestAgentSend: true,
    agentMessage: `Unknown action "${action}". Use: approve <N> / reject <N> / edit <N>: <changes>`,
  });
}

main().catch((err) => {
  logStep(workspaceRoot, { step: "approval", status: "fatal", error: redact(err.message) });
  out({ skipped: true, reason: `approval.mjs fatal: ${err.message}` });
});

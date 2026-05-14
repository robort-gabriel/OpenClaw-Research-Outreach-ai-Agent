#!/usr/bin/env node
/**
 * post.mjs — Save research to Google Doc, write pending draft, send Telegram preview.
 * Sets requestAgentSend to deliver the draft preview back to the user.
 * No console.log — all output is JSON to stdout.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readStdinJson } from "./lib/stdin.mjs";
import { logStep, redact } from "./lib/log_step.mjs";

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

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

function appendFindingsLog(workspaceRoot, entry) {
  const dir = join(workspaceRoot, "memory", "research");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "findings-log.md");
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  const line = `\n## ${now} — ${entry.bank} | ${entry.contact}\n- Sources: ${entry.source_count} | Fallback: ${entry.fallback ? "yes" : "no"} | Draft: #${entry.draft_id}\n- Top insight: ${entry.top_insight || "n/a"}\n`;
  appendFileSync(path, line, "utf8");
}

function updateSheetsStatus(sheetId, contactsSheet, rowIndex, status) {
  // Update Status column (F = column 6) for the contact row
  const range = `${contactsSheet}!F${rowIndex}`;
  const result = spawnSync(
    "gog",
    ["sheets", "update", "--id", sheetId, "--range", range, "--values", `[["${status}"]]`],
    { encoding: "utf8", timeout: 10000 }
  );
  return result.status === 0;
}

function saveToGoogleDoc(docId, content) {
  if (!docId || docId === "YOUR_GOOGLE_DOC_ID_HERE") return false;
  const result = spawnSync(
    "gog",
    ["docs", "append", "--id", docId, "--content", content.slice(0, 8000)],
    { encoding: "utf8", timeout: 15000 }
  );
  return result.status === 0;
}

function formatPreview(input) {
  const { target, contact, role, region, insights, sequence, draft_id, fallback } = input;
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
    `[DRAFT #${draft_id}${modeTag} — Approval Needed]\n` +
    `Target: ${target} | ${contact} | ${role} | ${region}\n\n` +
    `TOP INSIGHTS:\n${insightLines || "See full summary in findings-log.md"}\n\n` +
    `OUTREACH SEQUENCE:\n${sequenceLines}\n\n` +
    `Reply:\n  approve ${draft_id}\n  reject ${draft_id}\n  edit ${draft_id}: <your changes>`
  );
}

async function main() {
  let input = {};
  try {
    input = await readStdinJson();
  } catch (err) {
    out({ skipped: true, reason: `post.mjs stdin parse error: ${err.message}` });
    return;
  }

  if (input.skipped) {
    out(input);
    return;
  }

  const {
    workspace_root, target, contact, role, region,
    summary, insights, sequence, draft_id, fallback,
    source_count, rowIndex,
  } = input;

  const sheetId = process.env.SHEET_ID;
  const docId = process.env.DOC_ID;
  const contactsSheet = process.env.CONTACTS_SHEET ?? "Contacts";

  logStep(workspace_root, { step: "post", status: "start", bank: target, draft_id });

  try {
    // 1. Save draft to pending.json
    const pending = loadPending(workspace_root);
    pending[draft_id] = {
      target,
      contact,
      role,
      region,
      sequence: sequence || [],
      summary: summary || "",
      insights: insights || [],
      rowIndex,
      created_at: new Date().toISOString(),
      fallback: !!fallback,
    };
    savePending(workspace_root, pending);

    // 2. Append to findings-log.md
    appendFindingsLog(workspace_root, {
      bank: target,
      contact,
      source_count: source_count || 0,
      fallback: !!fallback,
      draft_id,
      top_insight: (insights || [])[0] || null,
    });

    // 3. Update Sheets status to "done" (non-blocking — log on fail)
    if (sheetId && rowIndex) {
      const sheetsOk = updateSheetsStatus(sheetId, contactsSheet, rowIndex, "done");
      if (!sheetsOk) {
        logStep(workspace_root, { step: "post", status: "warn", reason: "sheets status update failed" });
      }
    }

    // 4. Save research to Google Doc (non-blocking)
    if (docId) {
      const docContent = `\n\n=== ${target} | ${contact} | ${new Date().toISOString().slice(0, 10)} ===\n\n${summary || "No summary."}\n\nINSIGHTS:\n${(insights || []).map((i, n) => `${n + 1}. ${i}`).join("\n")}\n`;
      saveToGoogleDoc(docId, docContent);
    }

    // 5. Format Telegram preview and request send
    const previewMessage = formatPreview(input);

    logStep(workspace_root, { step: "post", status: "ok", bank: target, draft_id });

    out({
      skipped: false,
      draft_id,
      requestAgentSend: true,
      agentMessage: previewMessage,
    });
  } catch (err) {
    logStep(workspace_root, { step: "post", status: "error", error: redact(err.message) });
    out({ skipped: true, reason: `post.mjs error: ${err.message}` });
  }
}

main().catch((err) => {
  out({ skipped: true, reason: `post.mjs fatal: ${err.message}` });
});

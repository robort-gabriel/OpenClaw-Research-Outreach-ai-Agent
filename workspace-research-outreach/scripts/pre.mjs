#!/usr/bin/env node
/**
 * pre.mjs — Read target contact from Google Sheets, validate, check cache.
 * Outputs JSON to stdout (no console.log — breaks Lobster pipe).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadLobsterArgs } from "./lib/lobster_args.mjs";
import { logStep, redact } from "./lib/log_step.mjs";

const require = createRequire(import.meta.url);

const args = loadLobsterArgs();
const workspaceRoot = args.workspace_root || process.cwd();
const target = String(args.target || "all").trim();
const force = args.force === true || args.force === "true";

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function readSheets(sheetId, sheetName) {
  const range = `${sheetName}!A:F`;
  const result = spawnSync(
    "gog",
    ["sheets", "get", "--id", sheetId, "--range", range],
    { encoding: "utf8", timeout: 15000 }
  );
  if (result.status !== 0) {
    throw new Error(
      `gog sheets read failed (status ${result.status}): ${redact(result.stderr || result.stdout)}`
    );
  }
  const raw = result.stdout.trim();
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`gog output is not valid JSON: ${redact(raw)}`);
  }
}

function parseRows(rows) {
  // Skip header row (row 0 assumed to be header)
  return rows.slice(1).map((r, i) => ({
    rowIndex: i + 2, // 1-based, accounting for header
    bank: String(r[0] || "").trim(),
    contact: String(r[1] || "").trim(),
    role: String(r[2] || "").trim(),
    region: String(r[3] || "").trim(),
    sector: String(r[4] || "").trim(),
    status: String(r[5] || "pending").trim().toLowerCase(),
  }));
}

function findTarget(contacts, targetName) {
  if (targetName === "all") {
    return contacts.find((c) => c.status === "pending" && c.bank);
  }
  const lower = targetName.toLowerCase();
  return contacts.find((c) => c.bank.toLowerCase() === lower);
}

function checkCache(workspaceRoot, bankName, maxAgeDays) {
  const logPath = join(workspaceRoot, "memory", "research", "findings-log.md");
  if (!existsSync(logPath)) return null;
  const content = readFileSync(logPath, "utf8");
  const lines = content.split("\n");
  const cutoff = Date.now() - maxAgeDays * 86400000;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith("## ")) continue;
    if (!line.toLowerCase().includes(bankName.toLowerCase())) continue;
    // Extract date from "## YYYY-MM-DD HH:MM — <bank>"
    const dateMatch = line.match(/## (\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const entryDate = new Date(dateMatch[1]).getTime();
    if (entryDate >= cutoff) {
      // Collect cached summary until next heading
      const summaryLines = [];
      for (let j = i + 1; j < lines.length && !lines[j].startsWith("## "); j++) {
        summaryLines.push(lines[j]);
      }
      return summaryLines.join("\n").trim() || null;
    }
  }
  return null;
}

async function main() {
  try {
    const sheetId = process.env.SHEET_ID;
    const contactsSheet = process.env.CONTACTS_SHEET ?? "Contacts";
    const maxAgeDays = 7;

    if (!sheetId) {
      throw new Error("SHEET_ID not set in .env");
    }

    logStep(workspaceRoot, { step: "pre", status: "start", target, force });

    const rows = readSheets(sheetId, contactsSheet);
    const contacts = parseRows(rows);

    if (!contacts.length) {
      logStep(workspaceRoot, { step: "pre", status: "skip", reason: "no contacts in sheet" });
      return out({ skipped: true, reason: "No contacts found in Google Sheet." });
    }

    const contact = findTarget(contacts, target);
    if (!contact) {
      const reason =
        target === "all"
          ? "No pending contacts found in Contacts sheet."
          : `Bank "${target}" not found in Contacts sheet.`;
      logStep(workspaceRoot, { step: "pre", status: "skip", reason });
      return out({ skipped: true, reason });
    }

    // Check findings-log cache (skip if force=true)
    let cachedResearch = null;
    let useCache = false;
    if (!force) {
      cachedResearch = checkCache(workspaceRoot, contact.bank, maxAgeDays);
      if (cachedResearch) {
        useCache = true;
        logStep(workspaceRoot, { step: "pre", status: "cache_hit", bank: contact.bank });
      }
    }

    logStep(workspaceRoot, {
      step: "pre",
      status: "ok",
      bank: contact.bank,
      contact: contact.contact,
      rowIndex: contact.rowIndex,
      useCache,
      force,
    });

    out({
      skipped: false,
      target: contact.bank,
      contact: contact.contact,
      role: contact.role,
      region: contact.region,
      sector: contact.sector,
      rowIndex: contact.rowIndex,
      force,
      use_cache: useCache,
      cached_research: cachedResearch || null,
      workspace_root: workspaceRoot,
    });
  } catch (err) {
    logStep(workspaceRoot, { step: "pre", status: "error", error: redact(err.message) });
    out({ skipped: true, reason: `pre.mjs error: ${err.message}` });
  }
}

main();

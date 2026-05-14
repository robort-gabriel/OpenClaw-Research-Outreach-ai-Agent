#!/usr/bin/env node
/**
 * outreach.mjs — Generate personalised 3–5 step outreach sequence using LLM.
 * No console.log — all output is JSON to stdout.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readStdinJson } from "./lib/stdin.mjs";
import { logStep, redact } from "./lib/log_step.mjs";

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function loadFile(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
  return readFileSync(path, "utf8");
}

const SEQUENCE_SCHEMA = {
  type: "object",
  properties: {
    sequence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          step: { type: "number" },
          channel: { type: "string" },
          subject: { type: ["string", "null"] },
          message: { type: "string" },
        },
        required: ["step", "channel", "message"],
        additionalProperties: false,
      },
    },
  },
  required: ["sequence"],
  additionalProperties: false,
};

function callLlmTask(systemPrompt, userPrompt) {
  const payload = JSON.stringify({
    systemPrompt,
    userPrompt,
    temperature: 0.5,
    schema: SEQUENCE_SCHEMA,
  });
  const result = spawnSync(
    "openclaw.invoke",
    ["--tool", "llm-task", "--action", "json", "--args-json", payload],
    { encoding: "utf8", timeout: 120000, env: { ...process.env } }
  );
  if (result.status !== 0) {
    throw new Error(`llm-task failed: ${redact((result.stderr || "").slice(0, 500))}`);
  }
  const data = JSON.parse(result.stdout);
  return data.result ?? data;
}

function extractFallbackTemplate(examplesContent) {
  const start = examplesContent.indexOf("## Fallback Template");
  if (start === -1) return null;
  return examplesContent.slice(start);
}

function buildFallbackSequence(target, contact, role, region) {
  return [
    {
      step: 1,
      channel: "LinkedIn",
      subject: null,
      message: `${contact}, your work at ${target} in ${role} aligns with what we're seeing across leading institutions in ${region}. Would value connecting.`,
    },
    {
      step: 2,
      channel: "LinkedIn",
      subject: null,
      message: `${contact},\n\nFinancial institutions across ${region} are navigating real complexity right now. We work with banks to address similar challenges.\n\nWould a short call make sense?`,
    },
    {
      step: 3,
      channel: "Email",
      subject: `${target} — quick question`,
      message: `${contact},\n\nFollowing up from LinkedIn. Happy to share more context if useful — just reply here.\n\n15 minutes sometime this week?`,
    },
  ];
}

async function main() {
  let input = {};
  try {
    input = await readStdinJson();
  } catch (err) {
    out({ skipped: true, reason: `outreach.mjs stdin parse error: ${err.message}` });
    return;
  }

  if (input.skipped) {
    out(input);
    return;
  }

  const {
    workspace_root, target, contact, role, region, sector,
    summary, insights, key_facts, fallback,
  } = input;

  const draft_id = String(Date.now());

  // Fallback sequence — no LLM needed
  if (fallback) {
    logStep(workspace_root, { step: "outreach", status: "fallback", bank: target });
    const sequence = buildFallbackSequence(target, contact, role, region);
    out({ ...input, sequence, draft_id, fallback: true });
    return;
  }

  logStep(workspace_root, { step: "outreach", status: "start", bank: target });

  try {
    const systemPrompt = loadFile(
      join(workspace_root, "prompts", "outreach-system.md"),
      "prompts/outreach-system.md"
    );
    const businessContext = loadFile(
      join(workspace_root, "config", "business-context.md"),
      "config/business-context.md"
    );
    const toneOfVoice = loadFile(
      join(workspace_root, "config", "tone-of-voice.md"),
      "config/tone-of-voice.md"
    );

    const insightsList = (insights || []).map((ins, i) => `${i + 1}. ${ins}`).join("\n");
    const keyFactsList = (key_facts || []).map((f) => `- ${f}`).join("\n");

    const userContent = `Generate a personalised outreach sequence for the following target.

TARGET:
- Bank: ${target}
- Contact: ${contact}
- Role: ${role}
- Region: ${region}
- Sector: ${sector || "banking"}

RESEARCH SUMMARY:
${summary || "No summary available."}

TOP INSIGHTS:
${insightsList || "No specific insights found."}

KEY FACTS:
${keyFactsList || "None."}

BUSINESS CONTEXT:
${businessContext.slice(0, 2000)}

TONE OF VOICE:
${toneOfVoice.slice(0, 1500)}

Return ONLY valid JSON with the sequence array. No markdown.`;

    const parsed = callLlmTask(systemPrompt, userContent);
    const sequence = parsed.sequence || buildFallbackSequence(target, contact, role, region);

    logStep(workspace_root, {
      step: "outreach",
      status: "ok",
      bank: target,
      steps_generated: sequence.length,
      draft_id,
    });

    out({ ...input, sequence, draft_id, fallback: false });
  } catch (err) {
    logStep(workspace_root, { step: "outreach", status: "error", error: redact(err.message) });
    const sequence = buildFallbackSequence(target, contact, role, region);
    out({ ...input, sequence, draft_id, fallback: true });
  }
}

main().catch((err) => {
  out({ skipped: true, reason: `outreach.mjs fatal: ${err.message}` });
});

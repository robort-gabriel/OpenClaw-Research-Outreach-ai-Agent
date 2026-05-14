#!/usr/bin/env node
/**
 * summarise.mjs — Clean and summarise raw research using OpenRouter LLM.
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

function loadPrompt(workspaceRoot) {
  const path = join(workspaceRoot, "prompts", "summarise-system.md");
  if (!existsSync(path)) throw new Error(`Missing prompts/summarise-system.md`);
  return readFileSync(path, "utf8");
}

const SUMMARISE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    insights: { type: "array", items: { type: "string" } },
    key_facts: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "insights", "key_facts", "gaps"],
  additionalProperties: false,
};

function callLlmTask(systemPrompt, userPrompt) {
  const payload = JSON.stringify({
    systemPrompt,
    userPrompt,
    temperature: 0.3,
    schema: SUMMARISE_SCHEMA,
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

function buildFallbackSummary(target, contact, role, region) {
  return {
    summary: `Limited public information available for ${target}. This is a ${region}-based financial institution. Research will be updated when more sources become available.`,
    insights: [
      `${target} is a financial institution operating in ${region}`,
      `Contact: ${contact} (${role})`,
      "Detailed research not available — fallback outreach template in use",
    ],
    key_facts: [`Region: ${region}`],
    gaps: ["Insufficient public sources found", "Annual report not accessible", "News coverage limited"],
  };
}

async function main() {
  let input = {};
  try {
    input = await readStdinJson();
  } catch (err) {
    out({ skipped: true, reason: `summarise.mjs stdin parse error: ${err.message}` });
    return;
  }

  if (input.skipped) {
    out(input);
    return;
  }

  const { workspace_root, target, contact, role, region, research_raw, fallback, from_cache, cached_research } = input;
  const maxResearchChars = 12000;

  // Cache hit — use cached research as the summary directly
  if (from_cache && cached_research) {
    logStep(workspace_root, { step: "summarise", status: "cache_pass", bank: target });
    out({
      ...input,
      summary: cached_research,
      insights: ["Cached research used — run /rerun to refresh"],
      key_facts: [],
      gaps: [],
    });
    return;
  }

  // Fallback: no usable sources
  if (fallback) {
    logStep(workspace_root, { step: "summarise", status: "fallback", bank: target });
    const fb = buildFallbackSummary(target, contact, role, region);
    out({ ...input, ...fb });
    return;
  }

  logStep(workspace_root, { step: "summarise", status: "start", bank: target });

  try {
    const systemPrompt = loadPrompt(workspace_root);

    const researchText = (research_raw || [])
      .map((s, i) => `--- Source ${i + 1}: ${s.title} (${s.date})\nURL: ${s.url}\n${s.content}`)
      .join("\n\n")
      .slice(0, maxResearchChars);

    const userContent = `Target institution: ${target}
Contact: ${contact}, ${role}
Region: ${region}

Research sources:
${researchText}

Summarise this research and extract the top insights for outreach. Return valid JSON only.`;

    const parsed = callLlmTask(systemPrompt, userContent);

    logStep(workspace_root, {
      step: "summarise",
      status: "ok",
      bank: target,
      insights_count: parsed.insights?.length ?? 0,
    });

    out({
      ...input,
      summary: parsed.summary || "",
      insights: parsed.insights || [],
      key_facts: parsed.key_facts || [],
      gaps: parsed.gaps || [],
    });
  } catch (err) {
    logStep(workspace_root, { step: "summarise", status: "error", error: redact(err.message) });
    const fb = buildFallbackSummary(target, contact, role, region);
    out({ ...input, ...fb, fallback: true });
  }
}

main().catch((err) => {
  out({ skipped: true, reason: `summarise.mjs fatal: ${err.message}` });
});

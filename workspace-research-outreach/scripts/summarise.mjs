#!/usr/bin/env node
/**
 * summarise.mjs — Clean and summarise raw research using OpenRouter LLM.
 * No console.log — all output is JSON to stdout.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

async function callLlm(apiKey, model, systemPrompt, userContent) {
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
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenRouter API error ${res.status}: ${redact(errText)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  return content;
}

function parseLlmJson(text) {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  return JSON.parse(cleaned);
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
  const model = "openrouter/openai/gpt-4.1";
  const maxResearchChars = 12000;
  const apiKey = process.env.OPENROUTER_API_KEY;

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

  if (!apiKey) {
    logStep(workspace_root, { step: "summarise", status: "error", reason: "OPENROUTER_API_KEY not set" });
    const fb = buildFallbackSummary(target, contact, role, region);
    out({ ...input, ...fb, fallback: true });
    return;
  }

  logStep(workspace_root, { step: "summarise", status: "start", bank: target });

  try {
    const systemPrompt = loadPrompt(workspace_root);

    // Build user content from raw research
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

    const raw = await callLlm(apiKey, model, systemPrompt, userContent);
    const parsed = parseLlmJson(raw);

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

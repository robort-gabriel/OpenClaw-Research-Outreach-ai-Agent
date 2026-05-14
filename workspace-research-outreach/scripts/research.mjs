#!/usr/bin/env node
/**
 * research.mjs — Fetch web research on the target bank.
 * Uses Node.js fetch (Node 18+) to pull Google News RSS + direct page content.
 * No console.log — all output goes to stdout as JSON.
 */

import { readStdinJson } from "./lib/stdin.mjs";
import { logStep, redact } from "./lib/log_step.mjs";

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
      block.match(/<title[^>]*>([\s\S]*?)<\/title>/))?.[1]?.trim() || "";
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) ||
      block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/))?.[1]?.trim() || "";
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || "";
    const desc = (block.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
      block.match(/<description[^>]*>([\s\S]*?)<\/description>/))?.[1]?.trim() || "";

    if (title && link) {
      items.push({ title, url: link, date: pubDate, content: stripHtml(desc).slice(0, 800) });
    }
  }
  return items.slice(0, 5);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNewsRss(query, timeoutMs) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;
  try {
    const xml = await fetchWithTimeout(url, timeoutMs);
    return parseRssItems(xml);
  } catch (err) {
    return [];
  }
}

async function fetchPage(url, maxChars, timeoutMs) {
  try {
    const html = await fetchWithTimeout(url, timeoutMs);
    const text = stripHtml(html).slice(0, maxChars);
    return { url, title: url, date: "unknown", content: text };
  } catch {
    return null;
  }
}

function buildBankUrl(bankName) {
  // Best-effort: construct likely homepage URL
  const slug = bankName
    .toLowerCase()
    .replace(/\b(bank|group|holdings|international|plc|ltd|llc|inc)\b/gi, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  return `https://www.${slug}bank.com`;
}

async function main() {
  let input = {};
  try {
    input = await readStdinJson();
  } catch (err) {
    out({ skipped: true, reason: `research.mjs stdin parse error: ${err.message}` });
    return;
  }

  if (input.skipped) {
    out(input);
    return;
  }

  // Cache hit — pass straight through without re-researching
  if (input.use_cache && !input.force) {
    logStep(input.workspace_root, { step: "research", status: "cache_pass", bank: input.target });
    out({ ...input, research_raw: [], source_count: 0, fallback: false, from_cache: true });
    return;
  }

  const { target, region, sector, workspace_root } = input;
  const timeoutMs = 8000;
  const maxCharsPerSource = 3000;
  const fallbackThreshold = 2;

  logStep(workspace_root, { step: "research", status: "start", bank: target });

  const sources = [];

  // News: general
  const generalNews = await fetchNewsRss(`"${target}" ${region} 2024 OR 2025`, timeoutMs);
  sources.push(...generalNews);

  // News: financial results
  const finNews = await fetchNewsRss(
    `"${target}" annual report OR results OR strategy 2024`,
    timeoutMs
  );
  sources.push(...finNews);

  // News: sector-specific
  if (sector) {
    const sectorNews = await fetchNewsRss(
      `"${target}" ${sector} initiative OR partnership OR launch`,
      timeoutMs
    );
    sources.push(...sectorNews);
  }

  // News: regional sector trends
  const regionalNews = await fetchNewsRss(`${region} ${sector || "banking"} trends 2025`, timeoutMs);
  sources.push(...regionalNews.slice(0, 3));

  // Direct page fetch: bank homepage
  const bankUrl = buildBankUrl(target);
  const homePage = await fetchPage(bankUrl, maxCharsPerSource, timeoutMs);
  if (homePage && homePage.content.length > 200) sources.push(homePage);

  // Dedupe by URL
  const seen = new Set();
  const deduped = sources.filter((s) => {
    if (!s?.url || seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  // Truncate content per source
  const research_raw = deduped.map((s) => ({
    ...s,
    content: s.content.slice(0, maxCharsPerSource),
  }));

  const usable = research_raw.filter((s) => s.content.length > 200);
  const source_count = usable.length;
  const fallback = source_count < fallbackThreshold;

  logStep(workspace_root, {
    step: "research",
    status: "ok",
    bank: target,
    total_sources: research_raw.length,
    usable_sources: source_count,
    fallback,
  });

  out({ ...input, research_raw, source_count, fallback });
}

main().catch((err) => {
  out({ skipped: true, reason: `research.mjs fatal: ${err.message}` });
});

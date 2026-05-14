#!/usr/bin/env node
/**
 * Install: copy workspace to OPENCLAW_HOME and merge into the live openclaw config.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { parseOpenclawConfig } from "./parse_openclaw_config.mjs";
import { resolveOpenclawJsonPath, resolveOpenclawHome } from "./resolve_openclaw_paths.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const TEMPLATE_PATH = join(PACKAGE_ROOT, "openclaw.json.example");
const WS_SOURCE = join(PACKAGE_ROOT, "workspace-research-outreach");

const AGENT_ID = "research-outreach";
const TELEGRAM_ACCOUNT_ID = "research-outreach";
const OPENCLAW_JSON_PATH = resolveOpenclawJsonPath();
const OPENCLAW_HOME_RESOLVED = resolveOpenclawHome();
const WS_DEST = join(OPENCLAW_HOME_RESOLVED, "workspace-research-outreach");

const VALID_EXEC_SECURITY = new Set(["deny", "allowlist", "full"]);
const VALID_EXEC_ASK = new Set(["off", "on-miss", "always"]);

function sanitizeToolsExec(exec) {
  if (!exec || typeof exec !== "object") return;
  if (exec.security === "on" || exec.security === true) exec.security = "allowlist";
  if (exec.ask === "on-request" || exec.ask === "on") exec.ask = "on-miss";
  if (exec.security != null && !VALID_EXEC_SECURITY.has(String(exec.security))) exec.security = "allowlist";
  if (exec.ask != null && !VALID_EXEC_ASK.has(String(exec.ask))) exec.ask = "on-miss";
}

function sanitizeAllAgentsToolsExec(config) {
  const list = config.agents?.list;
  if (!Array.isArray(list)) return;
  for (const agent of list) {
    if (agent?.tools) sanitizeToolsExec(agent.tools.exec);
  }
  if (config.agents?.defaults?.tools) sanitizeToolsExec(config.agents.defaults.tools.exec);
}

function backupIfExists(filePath) {
  if (!existsSync(filePath)) return;
  const ext = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const backupPath = `${filePath}.bak.${ext}`;
  copyFileSync(filePath, backupPath);
  console.log(`Backed up ${filePath} -> ${backupPath}`);
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });
}

function safeClone(obj) {
  try {
    return structuredClone(obj);
  } catch {
    return JSON.parse(JSON.stringify(obj));
  }
}

function shouldCopyPath(src) {
  const b = basename(src);
  return b !== "node_modules" && b !== ".git";
}

function copyWorkspace() {
  if (!existsSync(WS_SOURCE)) throw new Error(`Workspace source not found: ${WS_SOURCE}`);
  mkdirSync(dirname(WS_DEST), { recursive: true });
  if (existsSync(WS_DEST)) rmSync(WS_DEST, { recursive: true, force: true });
  cpSync(WS_SOURCE, WS_DEST, { recursive: true, filter: (s) => shouldCopyPath(s) });
  console.log(`Copied workspace -> ${WS_DEST}`);
}

function mergeConfig(existing, template) {
  const config = existing && typeof existing === "object" ? safeClone(existing) : {};

  if (!config.agents || typeof config.agents !== "object") {
    config.agents = { list: [] };
  } else if (!Array.isArray(config.agents.list)) {
    config.agents = { list: Array.isArray(config.agents) ? safeClone(config.agents) : [] };
  }

  const currentAgents = (config.agents.list || []).filter((a) => a?.id !== AGENT_ID);
  const tplAgent = (template.agents?.list || []).find((a) => a?.id === AGENT_ID);
  if (!tplAgent) throw new Error(`Template must include agents.list entry id "${AGENT_ID}"`);

  const normalized = safeClone(tplAgent);
  normalized.workspace = "~/.openclaw/workspace-research-outreach";
  currentAgents.push(normalized);
  config.agents.list = currentAgents;

  // Merge Telegram account
  config.channels = config.channels || {};
  config.channels.telegram = config.channels.telegram || {};
  config.channels.telegram.accounts = config.channels.telegram.accounts || {};
  const tplAccount = template.channels?.telegram?.accounts?.[TELEGRAM_ACCOUNT_ID] || {};
  config.channels.telegram.accounts[TELEGRAM_ACCOUNT_ID] = {
    ...safeClone(tplAccount),
    ...(config.channels.telegram.accounts[TELEGRAM_ACCOUNT_ID] || {}),
  };
  if (config.channels.telegram.enabled === undefined) config.channels.telegram.enabled = true;

  // Merge bindings
  config.bindings = Array.isArray(config.bindings) ? config.bindings : [];
  config.bindings = config.bindings.filter(
    (b) => !(b?.agentId === AGENT_ID && b?.match?.channel === "telegram" && b?.match?.accountId === TELEGRAM_ACCOUNT_ID)
  );
  config.bindings.push({ agentId: AGENT_ID, match: { channel: "telegram", accountId: TELEGRAM_ACCOUNT_ID } });

  // Merge plugins
  if (template.plugins?.entries) {
    config.plugins = config.plugins || {};
    config.plugins.entries = { ...(config.plugins.entries || {}), ...safeClone(template.plugins.entries) };
  }

  sanitizeAllAgentsToolsExec(config);
  return config;
}

async function main() {
  console.log("\n=== research-outreach-agent install ===\n");
  console.log(`OPENCLAW_HOME=${OPENCLAW_HOME_RESOLVED}`);
  console.log(`Config: ${OPENCLAW_JSON_PATH}`);
  console.log(`Workspace dest: ${WS_DEST}\n`);

  if (!existsSync(TEMPLATE_PATH)) throw new Error(`Template not found: ${TEMPLATE_PATH}`);
  if (!existsSync(OPENCLAW_JSON_PATH)) {
    throw new Error(`No config at ${OPENCLAW_JSON_PATH}\nRun \`openclaw onboard\` first.`);
  }
  if (!existsSync(WS_SOURCE)) throw new Error(`Workspace source not found: ${WS_SOURCE}`);

  const ok = await prompt(`Install ${AGENT_ID} and merge into the config above? [y/N]: `);
  if (ok !== "y" && ok !== "yes") {
    console.log("Aborted.");
    process.exit(0);
  }

  const template = parseOpenclawConfig(readFileSync(TEMPLATE_PATH, "utf8"));
  const existing = parseOpenclawConfig(readFileSync(OPENCLAW_JSON_PATH, "utf8"));

  copyWorkspace();

  // Copy settings.json.example to settings.json if not present
  const settingsSrc = join(WS_DEST, "config", "settings.json.example");
  const settingsDst = join(WS_DEST, "config", "settings.json");
  if (existsSync(settingsSrc) && !existsSync(settingsDst)) {
    copyFileSync(settingsSrc, settingsDst);
    console.log(`Created config/settings.json from example (fill in your SHEET_ID and DOC_ID)`);
  }

  backupIfExists(OPENCLAW_JSON_PATH);
  const merged = mergeConfig(existing, template);
  writeFileSync(OPENCLAW_JSON_PATH, JSON.stringify(merged, null, 2), "utf8");
  console.log(`Wrote merged config to ${OPENCLAW_JSON_PATH}`);

  const roundTrip = parseOpenclawConfig(readFileSync(OPENCLAW_JSON_PATH, "utf8"));
  const hasAgent = Array.isArray(roundTrip.agents?.list) && roundTrip.agents.list.some((a) => a?.id === AGENT_ID);
  if (!hasAgent) {
    console.error(`Warning: re-read of config does not list agent ${AGENT_ID}`);
  } else {
    console.log(`Verified: "${AGENT_ID}" present in config\n`);
  }

  console.log("Next steps:");
  console.log(`  1. Edit ${WS_DEST}/config/settings.json — add your SHEET_ID and DOC_ID`);
  console.log(`  2. Edit ${WS_DEST}/config/business-context.md — describe your firm`);
  console.log(`  3. Edit ${WS_DEST}/config/tone-of-voice.md — your writing style`);
  console.log(`  4. Edit ${WS_DEST}/config/outreach-examples.md — example sequences`);
  console.log(`  5. Set OPENROUTER_API_KEY and TELEGRAM_BOT_TOKEN_RESEARCH_OUTREACH in ~/.openclaw/.env`);
  console.log(`  6. Set TELEGRAM_USER_ID in openclaw.json binding (your Telegram user ID)`);
  console.log(`  7. Restart the gateway and run: openclaw doctor\n`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

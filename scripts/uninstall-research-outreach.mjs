#!/usr/bin/env node
/**
 * Uninstall: remove workspace copy and agent entry from live openclaw config.
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { parseOpenclawConfig } from "./parse_openclaw_config.mjs";
import { resolveOpenclawJsonPath, resolveOpenclawHome } from "./resolve_openclaw_paths.mjs";

const AGENT_ID = "research-outreach";
const TELEGRAM_ACCOUNT_ID = "research-outreach";
const OPENCLAW_JSON_PATH = resolveOpenclawJsonPath();
const OPENCLAW_HOME_RESOLVED = resolveOpenclawHome();
const WS_DEST = join(OPENCLAW_HOME_RESOLVED, "workspace-research-outreach");

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });
}

async function main() {
  console.log(`\n=== research-outreach-agent uninstall ===\n`);
  console.log(`Will remove: ${WS_DEST}`);
  console.log(`Will remove agent "${AGENT_ID}" from: ${OPENCLAW_JSON_PATH}\n`);

  const ok = await prompt("Proceed with uninstall? [y/N]: ");
  if (ok !== "y" && ok !== "yes") {
    console.log("Aborted.");
    process.exit(0);
  }

  // Remove workspace directory
  if (existsSync(WS_DEST)) {
    rmSync(WS_DEST, { recursive: true, force: true });
    console.log(`Removed workspace: ${WS_DEST}`);
  } else {
    console.log(`Workspace not found at ${WS_DEST} — skipping`);
  }

  // Remove agent from config
  if (!existsSync(OPENCLAW_JSON_PATH)) {
    console.log("Config file not found — nothing to update.");
    return;
  }

  const config = parseOpenclawConfig(readFileSync(OPENCLAW_JSON_PATH, "utf8"));

  if (Array.isArray(config.agents?.list)) {
    const before = config.agents.list.length;
    config.agents.list = config.agents.list.filter((a) => a?.id !== AGENT_ID);
    console.log(`Removed ${before - config.agents.list.length} agent entry(s) from config`);
  }

  if (Array.isArray(config.bindings)) {
    const before = config.bindings.length;
    config.bindings = config.bindings.filter((b) => b?.agentId !== AGENT_ID);
    console.log(`Removed ${before - config.bindings.length} binding(s) from config`);
  }

  if (config.channels?.telegram?.accounts?.[TELEGRAM_ACCOUNT_ID]) {
    delete config.channels.telegram.accounts[TELEGRAM_ACCOUNT_ID];
    console.log(`Removed Telegram account "${TELEGRAM_ACCOUNT_ID}" from config`);
  }

  writeFileSync(OPENCLAW_JSON_PATH, JSON.stringify(config, null, 2), "utf8");
  console.log(`\nConfig updated. Run \`openclaw doctor\` to verify.`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

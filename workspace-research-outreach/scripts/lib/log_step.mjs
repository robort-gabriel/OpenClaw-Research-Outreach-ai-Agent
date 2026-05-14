import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Append one JSON line to memory/logs/runs.jsonl.
 * Never log secrets — caller must sanitise entry before passing.
 */
export function logStep(workspaceRoot, entry) {
  const dir = join(workspaceRoot, "memory", "logs");
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  appendFileSync(join(dir, "runs.jsonl"), `${line}\n`, "utf8");
}

/**
 * Truncate long strings for safe log storage.
 */
export function redact(str, maxLen = 4000) {
  if (str == null) return "";
  const s = String(str);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…[truncated ${s.length - maxLen} chars]`;
}

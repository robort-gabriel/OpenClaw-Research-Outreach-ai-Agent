import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function resolveOpenclawHome() {
  if (process.env.OPENCLAW_HOME?.trim()) {
    return resolve(process.env.OPENCLAW_HOME.trim());
  }
  return join(homedir(), ".openclaw");
}

export function resolveOpenclawJsonPath() {
  if (process.env.OPENCLAW_CONFIG_PATH?.trim()) {
    return resolve(process.env.OPENCLAW_CONFIG_PATH.trim());
  }
  return join(resolveOpenclawHome(), "openclaw.json");
}

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let json5Parse = null;
try {
  json5Parse = require("json5").parse;
} catch {
  // optional
}

export function stripJsonComments(source) {
  if (!source) return "";
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock.replace(/^\s*\/\/.*$/gm, "");
}

function stripTrailingCommas(source) {
  let current = source;
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current.replace(/,(\s*[}\]])/g, "$1");
  }
  return current;
}

export function parseOpenclawConfig(raw) {
  const text = String(raw || "");
  if (json5Parse) {
    try {
      return json5Parse(text);
    } catch (e) {
      throw new Error(`openclaw.json parse error (json5): ${e.message}`);
    }
  }
  const cleaned = stripTrailingCommas(stripJsonComments(text));
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(
      `openclaw.json parse error: ${error.message}\n` +
        "If your config is JSON5, run: cd research-outreach-agent && npm install"
    );
  }
}

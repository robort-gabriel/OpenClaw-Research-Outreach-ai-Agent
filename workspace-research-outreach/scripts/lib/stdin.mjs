/**
 * Read all stdin as UTF-8 and return it as a string.
 */
export function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/**
 * Read and parse JSON from stdin.
 * Returns parsed object or throws on parse error.
 */
export async function readStdinJson() {
  const raw = await readStdin();
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

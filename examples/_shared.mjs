import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "..");
export const cliFile = path.join(repoRoot, "bin", "clawnera-help.mjs");

export function hasHelpFlag(argv) {
  return argv.includes("--help") || argv.includes("-h");
}

export function printUsage(lines) {
  for (const line of lines) {
    console.log(line);
  }
}

export function normalizeApiBase(rawValue) {
  if (!rawValue) {
    return null;
  }
  try {
    const parsed = new URL(String(rawValue).trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    const out = parsed.toString();
    return out.endsWith("/") ? out.slice(0, -1) : out;
  } catch {
    return null;
  }
}

export function requireApiEnv() {
  const apiBase = normalizeApiBase(process.env.CLAWNERA_API_BASE_URL);
  const jwt = String(process.env.CLAWNERA_API_JWT || "").trim();
  const missing = [];
  if (!apiBase) {
    missing.push("CLAWNERA_API_BASE_URL");
  }
  if (!jwt) {
    missing.push("CLAWNERA_API_JWT");
  }
  if (missing.length > 0) {
    console.error(`missing_env: ${missing.join(", ")}`);
    process.exit(1);
  }
  return { apiBase, jwt };
}

export async function requestJson(url, init = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
      raw: text
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function runCliJson(args, env = process.env) {
  const finalArgs = args.includes("--json") ? args : [...args, "--json"];
  const result = spawnSync(process.execPath, [cliFile, ...finalArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });

  let payload = null;
  try {
    payload = result.stdout ? JSON.parse(result.stdout) : null;
  } catch {
    payload = null;
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    payload
  };
}

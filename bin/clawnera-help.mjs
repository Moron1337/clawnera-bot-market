#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  buildAuthEnvText,
  defaultAuthStatePath,
  defaultIotaKeystorePath,
  loadAuthState,
  loadKeystoreEntries,
  resolveKeystoreEntry,
  saveAuthState,
  signInWithKeystoreEntry,
  validateRuntimeAuthState
} from "../lib/runtime-auth.mjs";
import {
  CUSTOM_NOTIFICATION_PRESET,
  DEFAULT_NOTIFICATION_BATCH_LIMIT,
  DEFAULT_NOTIFICATION_PRESET,
  buildNotificationEnvText,
  buildNotificationServiceText,
  DEFAULT_NOTIFICATION_POLL_MS,
  DEFAULT_NOTIFICATION_REFRESH_SKEW_MS,
  defaultNotificationCursorPath,
  defaultNotificationEnvPath,
  defaultNotificationServicePath,
  DEFAULT_NOTIFICATION_TIMEOUT_MS,
  isPlaceholderNotificationValue,
  isValidTelegramBotToken,
  isValidTelegramChatId,
  normalizeNotificationEnvValue,
  notificationPresetNames,
  NOTIFICATION_PRESETS,
  parsePositiveNotificationValue,
  resolveNotificationEventTypes,
  resolveNotificationPreset
} from "../lib/notifications.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const packageJsonFile = path.join(repoRoot, "package.json");
const topicsFile = path.join(repoRoot, "config", "topics.json");
const docsRoot = path.join(repoRoot, "docs");
const docsGuidesRoot = path.join(docsRoot, "guides");
const docsSourcesRoot = path.join(docsRoot, "docsources");
const docsIndexFile = path.join(docsRoot, "INDEX.md");
const syncScript = path.join(repoRoot, "scripts", "sync-local-sources.sh");
const iotaFirstStepsScript = path.join(repoRoot, "scripts", "bootstrap-iota-first-steps.sh");
const ABSOLUTE_PATH_PATTERN = /(?:^|[\s`("'])\/home\/[^\s`)"']+/;
const TOPIC_INDEX_ENTRY_PATTERN = /^-\s+`([a-z0-9-]+)`:/;
const ISSUE_TRACKER_URL = "https://github.com/Moron1337/clawnera-bot-market/issues";
const ISSUE_NEW_URL = `${ISSUE_TRACKER_URL}/new/choose`;
const ISSUE_CATEGORY_CONFIG = Object.freeze({
  bug: {
    template: "bug_report.md",
    label: "bug",
    titlePrefix: "bug"
  },
  "integration-help": {
    template: "integration_help.md",
    label: "integration-help",
    titlePrefix: "integration-help"
  },
  docs: {
    template: "docs_gap.md",
    label: "documentation",
    titlePrefix: "docs"
  }
});
const TRIAGE_RULES = Object.freeze([
  {
    id: "auth",
    keywords: ["auth", "jwt", "token", "challenge", "verify", "401", "403"],
    topics: ["onboarding", "api", "security"],
    commands: [
      "clawnera-help auth-login --api-base <url> --alias <wallet-alias>",
      "clawnera-help show onboarding",
      "clawnera-help show api",
      "clawnera-help doctor --api-base <url> --jwt <token>"
    ],
    issueCategory: "integration-help"
  },
  {
    id: "listing",
    keywords: ["listing", "deposit", "creator_mismatch", "seller_mismatch", "accept", "awaiting_deposits"],
    topics: ["onboarding", "api", "sdk", "order-states"],
    commands: [
      "clawnera-help show onboarding",
      "clawnera-help show api",
      "clawnera-help show order-states",
      "clawnera-help doctor --api-base <url> --jwt <token>"
    ],
    issueCategory: "bug"
  },
  {
    id: "sponsor",
    keywords: ["sponsor", "gas", "gasstation", "reserve", "execute", "retry-after", "self_pay", "intent"],
    topics: ["sponsor", "api", "ops"],
    commands: [
      "clawnera-help show sponsor",
      "clawnera-help show api",
      "clawnera-help doctor --api-base <url> --jwt <token>",
      "clawnera-help sponsor-preflight --api-base <url> --jwt <token>",
      "clawnera-help sponsor-execute --help"
    ],
    issueCategory: "integration-help"
  },
  {
    id: "milestone",
    keywords: ["milestone", "manifest", "anchor", "artifact", "storage", "pinata", "submit", "accept", "reject"],
    topics: ["onboarding", "api", "sdk", "ops"],
    commands: [
      "clawnera-help show onboarding",
      "clawnera-help show api",
      "clawnera-help show sdk",
      "clawnera-help doctor --api-base <url> --jwt <token>"
    ],
    issueCategory: "integration-help"
  },
  {
    id: "dispute",
    keywords: ["dispute", "quorum", "reviewer", "bond", "fallback", "vote", "resolve-escrow"],
    topics: ["order-states", "role-routes", "contracts", "playbooks"],
    commands: [
      "clawnera-help show order-states",
      "clawnera-help show role-routes",
      "clawnera-help show contracts",
      "clawnera-help doctor --api-base <url> --jwt <token>"
    ],
    issueCategory: "bug"
  },
  {
    id: "polling",
    keywords: ["poll", "reconcile", "409", "timeline", "state", "scheduler", "backoff"],
    topics: ["polling", "order-states", "ops"],
    commands: [
      "clawnera-help show polling",
      "clawnera-help show order-states",
      "clawnera-help show ops"
    ],
    issueCategory: "integration-help"
  },
  {
    id: "docs",
    keywords: ["docs", "documentation", "unclear", "missing", "guide", "stale", "wrong"],
    topics: ["troubleshooting", "sources", "index"],
    commands: [
      "clawnera-help show troubleshooting",
      "clawnera-help show sources",
      "clawnera-help report-issue --category docs --summary \"describe the docs gap\""
    ],
    issueCategory: "docs"
  }
]);

function readPackageVersion() {
  const raw = fs.readFileSync(packageJsonFile, "utf8");
  const parsed = JSON.parse(raw);
  return String(parsed.version || "unknown");
}

function loadTopics() {
  const raw = fs.readFileSync(topicsFile, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.topics) ? parsed.topics : [];
}

function printUsage() {
  console.log("CLAWNERA Bot Market CLI");
  console.log("");
  console.log("Usage:");
  console.log("  clawnera-help                             Show usage + topics");
  console.log("  clawnera-help topics                      List all topics");
  console.log("  clawnera-help show <topic>                Show one topic document");
  console.log("  clawnera-help search <keyword>            Search keyword in curated docs");
  console.log("  clawnera-help search <keyword> --all      Include docsources in search");
  console.log("  clawnera-help doctor                      Check local toolchain");
  console.log("  clawnera-help doctor --api-base <url>     Probe live API health/policy/capabilities");
  console.log("  clawnera-help triage <problem>            Suggest docs, commands, and escalation path");
  console.log("  clawnera-help report-issue [options]      Generate a structured GitHub issue scaffold");
  console.log("  clawnera-help path                        Print repository path");
  console.log("  clawnera-help auth-login [options]        Create JWT + refresh token from local IOTA keystore");
  console.log("  clawnera-help notifications [options]     Scaffold and check Telegram event notifications");
  console.log("  clawnera-help first-steps [--run]         Show or run IOTA first-step bootstrap");
  console.log("  clawnera-help sponsor-preflight [options] Read sponsor policy/strategy/diagnostics");
  console.log("  clawnera-help sponsor-execute [options]   Reserve->sign->execute sponsor helper");
  console.log("  clawnera-help validate [--strict]         Validate topic/docs consistency");
  console.log("  clawnera-help sync [--require-sources]    Sync local source snapshots (maintainer only)");
  console.log("  clawnera-help bootstrap [--sync] [--require-sources]  Run doctor + validate (+ optional maintainer sync)");
  console.log("  clawnera-help version                     Print CLI package version");
  console.log("  clawnera-help <command> --json            Emit machine-readable JSON");
}

function printTopics(topics) {
  console.log("Available topics:");
  for (const topic of topics) {
    const aliases = Array.isArray(topic.aliases) ? topic.aliases.join(", ") : "";
    const aliasText = aliases ? ` (aliases: ${aliases})` : "";
    console.log(`- ${topic.id}: ${topic.title}${aliasText}`);
  }
}

function resolveTopic(topics, key) {
  const normalized = String(key || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return (
    topics.find((topic) => {
      if (String(topic.id).toLowerCase() === normalized) {
        return true;
      }
      if (!Array.isArray(topic.aliases)) {
        return false;
      }
      return topic.aliases.some((alias) => String(alias).toLowerCase() === normalized);
    }) || null
  );
}

function showTopic(topics, key) {
  if (!key) {
    console.error("missing_topic_argument");
    process.exitCode = 1;
    return;
  }
  const topic = resolveTopic(topics, key);
  if (!topic) {
    console.error(`unknown_topic: ${key}`);
    process.exitCode = 1;
    return;
  }
  const docPath = path.join(repoRoot, topic.file);
  if (!fs.existsSync(docPath)) {
    console.error(`missing_doc: ${topic.file}`);
    process.exitCode = 1;
    return;
  }
  const content = fs.readFileSync(docPath, "utf8");
  console.log(content);
}

function walkMarkdownFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdownFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function curatedMarkdownFiles() {
  const files = [];
  if (fs.existsSync(docsIndexFile)) {
    files.push(docsIndexFile);
  }
  files.push(...walkMarkdownFiles(docsGuidesRoot));
  return files;
}

function allMarkdownFiles() {
  const files = curatedMarkdownFiles();
  files.push(...walkMarkdownFiles(docsSourcesRoot));
  return files;
}

function searchKeyword(keyword, includeAllDocs) {
  const term = String(keyword || "").trim();
  if (!term) {
    console.error("missing_search_keyword");
    process.exitCode = 1;
    return [];
  }
  const hits = collectSearchHits(term, includeAllDocs);
  for (const hit of hits) {
    console.log(`${hit.file}:${hit.line}: ${hit.text}`);
  }
  if (hits.length === 0) {
    console.log(`no_hits_for: ${term}`);
  }
  return hits;
}

function collectSearchHits(keyword, includeAllDocs) {
  const term = String(keyword || "").trim();
  if (!term) {
    return [];
  }
  const files = includeAllDocs ? allMarkdownFiles() : curatedMarkdownFiles();
  const lower = term.toLowerCase();
  const hits = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.toLowerCase().includes(lower)) {
        hits.push({ file: rel, line: i + 1, text: line });
      }
    }
  }
  return hits;
}

function safeVersion(cmd) {
  const commands = Array.isArray(cmd) ? cmd : [cmd];
  for (const candidate of commands) {
    try {
      const output = execSync(candidate, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
      return output || "ok";
    } catch {
      // Try next candidate.
    }
  }
  return "missing";
}

function doctorData() {
  const checks = [
    ["node", "node --version"],
    ["npm", "npm --version"],
    ["pnpm", ["pnpm --version", "corepack pnpm --version"]],
    ["git", "git --version"],
    ["iota", "iota --version"]
  ];

  const tools = {};
  for (const [name, cmd] of checks) {
    tools[name] = safeVersion(cmd);
  }

  return {
    tools,
    repo: repoRoot,
    topics: loadTopics().length
  };
}

function printDoctor() {
  const data = doctorData();
  console.log("Toolchain doctor:");
  for (const [name, version] of Object.entries(data.tools)) {
    console.log(`- ${name}: ${version}`);
  }
  console.log(`- repo: ${data.repo}`);
  console.log(`- topics: ${data.topics}`);
}

function validateTopicIndexCoverage(topics) {
  const lines = fs.existsSync(docsIndexFile) ? fs.readFileSync(docsIndexFile, "utf8").split(/\r?\n/) : [];
  const seenIds = new Set();
  for (const line of lines) {
    const match = line.match(TOPIC_INDEX_ENTRY_PATTERN);
    if (match) {
      seenIds.add(match[1]);
    }
  }
  return topics.filter((topic) => !seenIds.has(topic.id)).map((topic) => topic.id);
}

function findAbsolutePathsInCuratedDocs() {
  const files = curatedMarkdownFiles().concat([path.join(repoRoot, "README.md")]);
  const findings = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      continue;
    }
    const rel = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx += 1) {
      if (ABSOLUTE_PATH_PATTERN.test(lines[idx])) {
        findings.push({
          file: rel,
          line: idx + 1,
          text: lines[idx]
        });
      }
    }
  }
  return findings;
}

function validateRepository(strict) {
  const checks = [];
  const topics = loadTopics();
  const topicIds = new Set();
  const aliasOrIds = new Set();
  const duplicateIds = [];
  const duplicateAliases = [];
  const invalidTopics = [];

  for (const topic of topics) {
    const id = String(topic.id || "").trim();
    const title = String(topic.title || "").trim();
    const file = String(topic.file || "").trim();

    if (!id || !title || !file) {
      invalidTopics.push(topic);
      continue;
    }

    if (topicIds.has(id)) {
      duplicateIds.push(id);
    }
    topicIds.add(id);

    const idKey = id.toLowerCase();
    if (aliasOrIds.has(idKey)) {
      duplicateAliases.push(id);
    }
    aliasOrIds.add(idKey);

    const aliases = Array.isArray(topic.aliases) ? topic.aliases : [];
    for (const aliasRaw of aliases) {
      const alias = String(aliasRaw).trim().toLowerCase();
      if (!alias) {
        continue;
      }
      if (aliasOrIds.has(alias)) {
        duplicateAliases.push(alias);
      }
      aliasOrIds.add(alias);
    }
  }

  checks.push({
    id: "topics_loaded",
    status: topics.length > 0 ? "pass" : "fail",
    message: `loaded ${topics.length} topics`
  });

  checks.push({
    id: "topics_schema",
    status: invalidTopics.length === 0 ? "pass" : "fail",
    message: invalidTopics.length === 0 ? "all topics have id/title/file" : `invalid topic entries: ${invalidTopics.length}`
  });

  checks.push({
    id: "topic_ids_unique",
    status: duplicateIds.length === 0 ? "pass" : "fail",
    message: duplicateIds.length === 0 ? "topic ids are unique" : `duplicate topic ids: ${duplicateIds.join(", ")}`
  });

  checks.push({
    id: "topic_aliases_unique",
    status: duplicateAliases.length === 0 ? "pass" : "fail",
    message: duplicateAliases.length === 0 ? "topic aliases do not collide" : `duplicate aliases/ids: ${duplicateAliases.join(", ")}`
  });

  let missingTopicDocs = 0;
  for (const topic of topics) {
    const filePath = path.join(repoRoot, topic.file);
    if (!fs.existsSync(filePath)) {
      missingTopicDocs += 1;
    }
  }

  checks.push({
    id: "topic_docs_exist",
    status: missingTopicDocs === 0 ? "pass" : "fail",
    message: missingTopicDocs === 0 ? "all topic docs exist" : `missing topic docs: ${missingTopicDocs}`
  });

  const missingInIndex = validateTopicIndexCoverage(topics);
  checks.push({
    id: "index_topic_coverage",
    status: missingInIndex.length === 0 ? "pass" : "warn",
    message: missingInIndex.length === 0 ? "docs/INDEX.md lists all topic ids" : `missing in docs/INDEX.md: ${missingInIndex.join(", ")}`
  });

  const absolutePathFindings = findAbsolutePathsInCuratedDocs();
  checks.push({
    id: "portable_docs_paths",
    status: absolutePathFindings.length === 0 ? "pass" : "warn",
    message:
      absolutePathFindings.length === 0
        ? "no host-specific absolute paths in curated docs"
        : `found ${absolutePathFindings.length} host-specific absolute path references`
  });

  const hasFailures = checks.some((check) => check.status === "fail");
  const hasWarnings = checks.some((check) => check.status === "warn");
  const success = strict ? !hasFailures && !hasWarnings : !hasFailures;

  return {
    success,
    strict,
    checks,
    findings: {
      absolutePathFindings
    }
  };
}

function printValidation(result) {
  console.log(`Validation (${result.strict ? "strict" : "default"}):`);
  for (const check of result.checks) {
    console.log(`- [${check.status}] ${check.id}: ${check.message}`);
  }
  if (result.findings.absolutePathFindings.length > 0) {
    console.log("Absolute path findings:");
    for (const finding of result.findings.absolutePathFindings) {
      console.log(`  - ${finding.file}:${finding.line}: ${finding.text}`);
    }
  }
}

function envFlagEnabled(name) {
  const normalized = String(process.env[name] || "").trim().toLowerCase();
  return Boolean(normalized) && !new Set(["0", "false", "off", "no"]).has(normalized);
}

function syncRequiresSources(flags) {
  return Boolean(flags && flags.requireSources) || envFlagEnabled("CLAWNERA_SYNC_STRICT");
}

function buildSkippedSyncResult(output) {
  return {
    ok: true,
    skipped: true,
    maintainerOnly: true,
    reason: "missing_marketplace_source_root",
    output:
      [
        "sync_skipped: local source repos not found.",
        "This command is for maintainers.",
        "Set MARKETPLACE_SOURCE_ROOT=/path/to/marketplace-core-repo and optional CLAW_ROOT=/path/to/claw-repo to run it."
      ].join(" "),
    details: output,
    error: ""
  };
}

function runSyncSources(options = {}) {
  if (!fs.existsSync(syncScript)) {
    return {
      ok: false,
      skipped: false,
      output: "",
      error: `missing_sync_script: ${path.relative(repoRoot, syncScript)}`
    };
  }

  const result = spawnSync("bash", [syncScript], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const missingSources = output.includes("missing_marketplace_source_root:");
  if (result.status !== 0 && missingSources && !options.requireSources) {
    return buildSkippedSyncResult(output);
  }

  return {
    ok: result.status === 0,
    skipped: false,
    output,
    error: result.status === 0 ? "" : `sync_failed_exit_${result.status ?? "unknown"}`
  };
}

function runIotaFirstSteps(args) {
  if (!fs.existsSync(iotaFirstStepsScript)) {
    return {
      ok: false,
      output: "",
      error: `missing_iota_first_steps_script: ${path.relative(repoRoot, iotaFirstStepsScript)}`
    };
  }

  const result = spawnSync("bash", [iotaFirstStepsScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return {
    ok: result.status === 0,
    output,
    error: result.status === 0 ? "" : `first_steps_failed_exit_${result.status ?? "unknown"}`
  };
}

function parseLongOptions(args) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "-h") {
      options.h = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const trimmed = token.slice(2).trim();
    const separator = trimmed.indexOf("=");
    const key = (separator >= 0 ? trimmed.slice(0, separator) : trimmed).trim().toLowerCase();
    if (!key) {
      positionals.push(token);
      continue;
    }

    if (separator >= 0) {
      options[key] = trimmed.slice(separator + 1);
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return { options, positionals };
}

function parsePositiveIntOption(rawValue, fieldName, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallback;
  }
  const normalized = String(rawValue).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`invalid_${fieldName}`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid_${fieldName}`);
  }
  return parsed;
}

function parseBooleanOption(rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallback;
  }
  if (rawValue === true || rawValue === false) {
    return rawValue;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeApiBase(rawValue) {
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

async function requestJson(url, init, timeoutMs) {
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
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      return {
        ok: false,
        status: 0,
        body: null,
        raw: "",
        error: "http_timeout"
      };
    }
    return {
      ok: false,
      status: 0,
      body: null,
      raw: "",
      error: error instanceof Error ? error.message : "http_error"
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parseBuildOutputPayload(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) {
    return null;
  }

  const parseCandidate = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      if (typeof parsed.txBytesB64 !== "string" || typeof parsed.userSig !== "string") {
        return null;
      }
      if (!parsed.txBytesB64.trim() || !parsed.userSig.trim()) {
        return null;
      }
      return {
        txBytesB64: parsed.txBytesB64.trim(),
        userSig: parsed.userSig.trim()
      };
    } catch {
      return null;
    }
  };

  const full = parseCandidate(trimmed);
  if (full) {
    return full;
  }

  const lines = trimmed.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    const parsed = parseCandidate(line);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function runBuildCommand(command, env, timeoutMs) {
  const result = spawnSync("bash", ["-lc", command], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
    timeout: timeoutMs
  });

  if (result.error) {
    if (result.error && typeof result.error === "object" && "code" in result.error && result.error.code === "ETIMEDOUT") {
      return {
        ok: false,
        error: "builder_timeout"
      };
    }
    return {
      ok: false,
      error: result.error instanceof Error ? result.error.message : "builder_spawn_failed"
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: `builder_failed_exit_${result.status ?? "unknown"}`
    };
  }

  const payload = parseBuildOutputPayload(result.stdout || "");
  if (!payload) {
    return {
      ok: false,
      error: "builder_output_invalid"
    };
  }

  return {
    ok: true,
    payload
  };
}

function hasSelfPayFallback(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const fallback = payload.fallback;
  if (!fallback || typeof fallback !== "object" || Array.isArray(fallback)) {
    return false;
  }
  return fallback.mode === "self_pay";
}

function sponsorExecuteUsageLines() {
  return [
    "Sponsor execute helper:",
    "- Required: --api-base <url> --jwt <token>",
    "- Default flow: reserve -> run --build-cmd -> execute",
    "- Required unless --dry-run: --build-cmd '<shell command>'",
    "- Defaults: --purpose marketplace_tx --gas-budget 1000000 --payment-coin iota",
    "- Optional: --idempotency-key <key> --timeout-ms <ms> --builder-timeout-ms <ms> --reservation-out <file>",
    "- Build command receives env vars:",
    "  CLAWNERA_SPONSOR_RESERVATION_JSON",
    "  CLAWNERA_SPONSOR_RESERVATION_ID",
    "  CLAWNERA_SPONSOR_API_BASE_URL",
    "  CLAWNERA_SPONSOR_PURPOSE",
    "  CLAWNERA_SPONSOR_PAYMENT_COIN",
    "  CLAWNERA_SPONSOR_GAS_COINS_JSON",
    "  CLAWNERA_SPONSOR_RESERVATION_FILE (only when --reservation-out is used)",
    "- Build command must output JSON with fields: txBytesB64, userSig",
    "- For sponsored IOTA value tx: use user payment coin object for business amount; sponsor coins are gas-only."
  ];
}

function authLoginUsageLines() {
  return [
    "Auth login helper:",
    "- Required: --api-base <url>",
    "- Optional selector: --alias <wallet-alias> or --address <wallet-address>",
    `- Default keystore path: ${defaultIotaKeystorePath()}`,
    "- If no selector is given, the active IOTA CLI address is used",
    "- Optional outputs: --state-out <file> --env-out <file>",
    "- Writes short-lived access token plus refresh token for long-lived runtimes",
    "- Use --state-out for mailbox notifiers or bots that should auto-refresh sessions"
  ];
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\"'\"'`)}'`;
}

function parseCliJsonStdout(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function detectActiveAddressViaCli(iotaCliPath, timeoutMs) {
  const result = spawnSync(iotaCliPath, ["client", "active-address", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: timeoutMs
  });

  if (result.error) {
    return {
      ok: false,
      error: result.error instanceof Error ? result.error.message : "iota_cli_spawn_failed"
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: `iota_cli_active_address_failed_exit_${result.status ?? "unknown"}`
    };
  }

  const parsed = parseCliJsonStdout(result.stdout);
  if (typeof parsed === "string" && parsed.trim()) {
    return {
      ok: true,
      address: parsed.trim()
    };
  }

  const plain = String(result.stdout || "").trim().replace(/^"+|"+$/g, "");
  if (plain) {
    return {
      ok: true,
      address: plain
    };
  }

  return {
    ok: false,
    error: "iota_cli_active_address_invalid"
  };
}

async function runAuthLogin(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: authLoginUsageLines()
    };
  }

  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals
    };
  }

  const apiBase = normalizeApiBase(options["api-base"] || process.env.CLAWNERA_API_BASE_URL);
  if (!apiBase) {
    return {
      ok: false,
      error: "missing_or_invalid_api_base",
      hint: "set --api-base or CLAWNERA_API_BASE_URL"
    };
  }

  const alias = typeof options.alias === "string" ? String(options.alias).trim() : "";
  let address = typeof options.address === "string" ? String(options.address).trim() : "";
  const keystorePath =
    typeof options["keystore-path"] === "string" && options["keystore-path"].trim()
      ? path.resolve(String(options["keystore-path"]).trim())
      : defaultIotaKeystorePath();
  const stateOut =
    typeof options["state-out"] === "string" && options["state-out"].trim()
      ? path.resolve(String(options["state-out"]).trim())
      : "";
  const envOut =
    typeof options["env-out"] === "string" && options["env-out"].trim()
      ? path.resolve(String(options["env-out"]).trim())
      : "";
  const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 15_000);
  const iotaCliPath = String(options["iota-cli"] || process.env.IOTA_CLI_PATH || "iota").trim() || "iota";

  try {
    if (!address && !alias) {
      const activeAddress = detectActiveAddressViaCli(iotaCliPath, timeoutMs);
      if (!activeAddress.ok || !activeAddress.address) {
        return {
          ok: false,
          error: activeAddress.error || "missing_wallet_selector",
          hint: "set --alias or --address if no active IOTA CLI address is configured"
        };
      }
      address = activeAddress.address;
    }

    const entries = await loadKeystoreEntries(keystorePath);
    const entry = resolveKeystoreEntry(entries, {
      address,
      alias
    });

    if (!entry) {
      return {
        ok: false,
        error: "keystore_entry_not_found",
        selector: {
          address: address || null,
          alias: alias || null
        },
        keystorePath
      };
    }

    const authState = await signInWithKeystoreEntry({
      apiBase,
      entry,
      timeoutMs
    });

    let savedStateFile = null;
    if (stateOut) {
      await saveAuthState(stateOut, authState);
      savedStateFile = stateOut;
    }

    let savedEnvFile = null;
    if (envOut) {
      fs.mkdirSync(path.dirname(envOut), { recursive: true });
      fs.writeFileSync(envOut, buildAuthEnvText(authState), { mode: 0o600 });
      fs.chmodSync(envOut, 0o600);
      savedEnvFile = envOut;
    }

    return {
      ok: true,
      apiBase,
      keystorePath,
      address: authState.address,
      alias: authState.alias || null,
      token: authState.token,
      refreshToken: authState.refreshToken,
      expiresAtMs: authState.expiresAtMs,
      refreshExpiresAtMs: authState.session.refreshExpiresAtMs,
      stateOut: savedStateFile,
      envOut: savedEnvFile
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "auth_login_failed"
    };
  }
}

function notificationsUsageLines() {
  const sellerPreset = DEFAULT_NOTIFICATION_PRESET;
  return [
    "Notifications helper:",
    "- Usage: clawnera-help notifications <init|presets|doctor> [options]",
    "- Init telegram notifier: clawnera-help notifications init telegram --preset seller --api-base https://api.clawnera.com --alias <wallet-alias>",
    "- Use --auth-state-file <file> to reuse an existing auth state; use --state-out <file> only when init should create a fresh auth state via --alias/--address",
    "- Passing --event-types without --preset uses custom-only events; --preset custom is also supported explicitly",
    "- List presets: clawnera-help notifications presets",
    "- Check local config: clawnera-help notifications doctor",
    "- Runtime auth precedence: valid CLAWNERA_API_JWT wins; invalid env auth fails unless CLAWNERA_NOTIFY_ALLOW_AUTH_STATE_FALLBACK=1 is set",
    "- Default preset: seller",
    "- Default files:",
    `  auth state: ${defaultAuthStatePath()}`,
    `  seller env: ${defaultNotificationEnvPath(undefined, sellerPreset)}`,
    `  seller svc: ${defaultNotificationServicePath(undefined, sellerPreset)}`,
    `  seller cur: ${defaultNotificationCursorPath(undefined, sellerPreset)}`,
    "- Other presets automatically use preset-specific env/service/cursor file names."
  ];
}

function writeModeForPath(targetPath) {
  return targetPath.endsWith(".service") ? 0o644 : 0o600;
}

function writeTextFile(targetPath, content, mode) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, { mode });
  fs.chmodSync(targetPath, mode);
}

function buildNotificationServiceCommands(serviceOut) {
  const unitName = path.basename(serviceOut);
  const defaultServiceDir = path.dirname(defaultNotificationServicePath());
  if (path.dirname(serviceOut) === defaultServiceDir) {
    return [
      `systemctl --user daemon-reload`,
      `systemctl --user enable --now ${shellQuote(unitName)}`,
      `journalctl --user -u ${shellQuote(unitName)} -f`
    ];
  }

  return [
    `systemctl --user daemon-reload`,
    `systemctl --user link ${shellQuote(serviceOut)}`,
    `systemctl --user enable --now ${shellQuote(unitName)}`,
    `journalctl --user -u ${shellQuote(unitName)} -f`
  ];
}

function parseSimpleEnvFile(raw) {
  const out = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const normalizedLine = trimmed.replace(/^export\s+/, "");
    const separator = normalizedLine.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = normalizedLine.slice(0, separator).trim();
    let valuePart = normalizedLine.slice(separator + 1);
    const commentIndex = valuePart.search(/\s+#/);
    if (commentIndex >= 0) {
      valuePart = valuePart.slice(0, commentIndex);
    }
    const value = normalizeNotificationEnvValue(valuePart);
    if (key) {
      out[key] = value;
    }
  }
  return out;
}

function notificationsPresetPayload() {
  return notificationPresetNames().map((name) => ({
    id: name,
    description: NOTIFICATION_PRESETS[name].description,
    eventTypes: [...NOTIFICATION_PRESETS[name].eventTypes]
  }));
}

function resolveRequestedNotificationPreset(rawPreset) {
  if (typeof rawPreset !== "string" || !rawPreset.trim()) {
    return {
      ok: true,
      preset: DEFAULT_NOTIFICATION_PRESET
    };
  }
  const resolved = resolveNotificationPreset(rawPreset);
  if (!resolved) {
    return {
      ok: false,
      error: "invalid_notification_preset",
      invalidPreset: String(rawPreset).trim()
    };
  }
  return {
    ok: true,
    preset: resolved
  };
}

function validateNotificationPackageRoot(packageRoot) {
  const notifierScript = path.join(packageRoot, "examples", "telegram-event-notifier.mjs");
  if (!fs.existsSync(packageRoot)) {
    return {
      ok: false,
      error: "invalid_notification_package_root",
      packageRoot,
      missing: packageRoot
    };
  }
  if (!fs.statSync(packageRoot).isDirectory()) {
    return {
      ok: false,
      error: "invalid_notification_package_root",
      packageRoot,
      missing: packageRoot
    };
  }
  if (!fs.existsSync(notifierScript)) {
    return {
      ok: false,
      error: "invalid_notification_package_root",
      packageRoot,
      missing: notifierScript
    };
  }
  return {
    ok: true,
    notifierScript
  };
}

async function runNotifications(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h || positionals.length === 0) {
    return {
      ok: true,
      help: true,
      usage: notificationsUsageLines()
    };
  }

  const subcommand = String(positionals[0] || "").toLowerCase();
  if (subcommand === "presets") {
    return {
      ok: true,
      mode: "presets",
      presets: notificationsPresetPayload()
    };
  }

  if (subcommand === "doctor") {
    const requestedPreset = resolveRequestedNotificationPreset(options.preset);
    if (!requestedPreset.ok) {
      return requestedPreset;
    }
    const requestedPresetLabel = requestedPreset.preset;
    const envFile =
      typeof options["env-file"] === "string" && options["env-file"].trim()
        ? path.resolve(String(options["env-file"]).trim())
        : defaultNotificationEnvPath(undefined, requestedPresetLabel);
    const serviceFile =
      typeof options["service-file"] === "string" && options["service-file"].trim()
        ? path.resolve(String(options["service-file"]).trim())
        : defaultNotificationServicePath(undefined, requestedPresetLabel);
    const issues = [];

    let envValues = {};
    if (!fs.existsSync(envFile)) {
      issues.push("missing_env_file");
    } else {
      envValues = parseSimpleEnvFile(fs.readFileSync(envFile, "utf8"));
      const requiredEnvKeys = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
      for (const key of requiredEnvKeys) {
        if (!String(envValues[key] || "").trim()) {
          issues.push(`missing_env_${key}`);
        }
      }
      if (isPlaceholderNotificationValue(envValues.TELEGRAM_BOT_TOKEN) || !isValidTelegramBotToken(envValues.TELEGRAM_BOT_TOKEN)) {
        issues.push("invalid_env_TELEGRAM_BOT_TOKEN");
      }
      if (isPlaceholderNotificationValue(envValues.TELEGRAM_CHAT_ID) || !isValidTelegramChatId(envValues.TELEGRAM_CHAT_ID)) {
        issues.push("invalid_env_TELEGRAM_CHAT_ID");
      }
      const resolved = resolveNotificationEventTypes({
        preset: envValues.CLAWNERA_NOTIFY_PRESET,
        eventTypes: envValues.CLAWNERA_NOTIFY_EVENT_TYPES
      });
      if (resolved.invalidPreset) {
        issues.push("invalid_notification_preset");
      }
      if (resolved.invalidEventTypes.length > 0) {
        issues.push("invalid_notification_event_types");
      }
      if (resolved.eventTypes.length === 0) {
        issues.push("missing_notification_event_types");
      }
      for (const [name, fallback] of [
        ["CLAWNERA_NOTIFY_POLL_MS", DEFAULT_NOTIFICATION_POLL_MS],
        ["CLAWNERA_NOTIFY_BATCH_LIMIT", DEFAULT_NOTIFICATION_BATCH_LIMIT],
        ["CLAWNERA_NOTIFY_TIMEOUT_MS", DEFAULT_NOTIFICATION_TIMEOUT_MS],
        ["CLAWNERA_NOTIFY_REFRESH_SKEW_MS", DEFAULT_NOTIFICATION_REFRESH_SKEW_MS]
      ]) {
        try {
          parsePositiveNotificationValue(envValues[name], name, fallback);
        } catch (error) {
          issues.push(error instanceof Error ? error.message : `invalid_env_${name}`);
        }
      }
      const hasAuthStateFile = Boolean(String(envValues.CLAWNERA_AUTH_STATE_FILE || "").trim());
      const hasJwt = Boolean(String(envValues.CLAWNERA_API_JWT || "").trim());
      const hasRefreshToken = Boolean(String(envValues.CLAWNERA_API_REFRESH_TOKEN || "").trim());
      let resolvedApiBase = String(envValues.CLAWNERA_API_BASE_URL || "").trim();
      if (!hasAuthStateFile && !hasJwt && !hasRefreshToken) {
        issues.push("missing_auth_source");
      }
      if (hasAuthStateFile) {
        const authStatePath = path.resolve(envValues.CLAWNERA_AUTH_STATE_FILE);
        if (!fs.existsSync(authStatePath)) {
          issues.push("missing_auth_state_file");
        } else {
          try {
            const authState = await loadAuthState(authStatePath);
            const validation = validateRuntimeAuthState(authState, {
              apiBaseFallback: envValues.CLAWNERA_API_BASE_URL,
              requiredApiBase: envValues.CLAWNERA_API_BASE_URL,
              refreshSkewMs: DEFAULT_NOTIFICATION_REFRESH_SKEW_MS
            });
            issues.push(...validation.issues);
            if (!resolvedApiBase && validation.authState.apiBase) {
              resolvedApiBase = validation.authState.apiBase;
            }
          } catch {
            issues.push("invalid_auth_state_file");
          }
        }
      }
      if (!resolvedApiBase) {
        issues.push("missing_env_CLAWNERA_API_BASE_URL");
      }
      if (hasJwt || hasRefreshToken) {
        const envAuthValidation = validateRuntimeAuthState(
          {
            apiBase: resolvedApiBase,
            token: envValues.CLAWNERA_API_JWT,
            refreshToken: envValues.CLAWNERA_API_REFRESH_TOKEN
          },
          {
            apiBaseFallback: resolvedApiBase,
            refreshSkewMs: DEFAULT_NOTIFICATION_REFRESH_SKEW_MS
          }
        );
        issues.push(...envAuthValidation.issues);
      }
    }

    if (!fs.existsSync(serviceFile)) {
      issues.push("missing_service_file");
    }

    return {
      ok: issues.length === 0,
      mode: "doctor",
      error: issues.length > 0 ? "notification_doctor_issues_detected" : null,
      envFile,
      serviceFile,
      issues,
      env: envValues,
      presets: notificationsPresetPayload()
    };
  }

  if (subcommand !== "init") {
    return {
      ok: false,
      error: "unknown_notifications_subcommand"
    };
  }

  const target = String(positionals[1] || "").toLowerCase();
  if (!target || target === "help") {
    return {
      ok: true,
      help: true,
      usage: notificationsUsageLines()
    };
  }
  if (target !== "telegram") {
    return {
      ok: false,
      error: "unsupported_notifications_target"
    };
  }

  const apiBase = normalizeApiBase(options["api-base"] || process.env.CLAWNERA_API_BASE_URL);
  const alias = typeof options.alias === "string" ? String(options.alias).trim() : "";
  const address = typeof options.address === "string" ? String(options.address).trim() : "";
  const resolvedNotificationSelection = resolveNotificationEventTypes({
    preset: options.preset,
    eventTypes: options["event-types"]
  });
  const { preset, eventTypes, invalidEventTypes, invalidPreset } = resolvedNotificationSelection;
  const artifactLabel = preset || CUSTOM_NOTIFICATION_PRESET;
  const authStateInputFile =
    typeof options["auth-state-file"] === "string" && options["auth-state-file"].trim()
      ? path.resolve(String(options["auth-state-file"]).trim())
      : "";
  const authStateOutputFile =
    typeof options["state-out"] === "string" && options["state-out"].trim()
      ? path.resolve(String(options["state-out"]).trim())
      : "";
  const keystorePath =
    typeof options["keystore-path"] === "string" && options["keystore-path"].trim()
      ? path.resolve(String(options["keystore-path"]).trim())
      : defaultIotaKeystorePath();
  const authStateFile =
    alias || address ? authStateOutputFile || authStateInputFile || defaultAuthStatePath() : authStateInputFile || defaultAuthStatePath();
  const envOut =
    typeof options["env-out"] === "string" && options["env-out"].trim()
      ? path.resolve(String(options["env-out"]).trim())
      : defaultNotificationEnvPath(undefined, artifactLabel);
  const serviceOut =
    typeof options["service-out"] === "string" && options["service-out"].trim()
      ? path.resolve(String(options["service-out"]).trim())
      : defaultNotificationServicePath(undefined, artifactLabel);
  const cursorOut =
    typeof options["cursor-out"] === "string" && options["cursor-out"].trim()
      ? path.resolve(String(options["cursor-out"]).trim())
      : defaultNotificationCursorPath(undefined, artifactLabel);
  const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", DEFAULT_NOTIFICATION_TIMEOUT_MS);
  const pollMs = parsePositiveIntOption(options["poll-ms"], "poll_ms", DEFAULT_NOTIFICATION_POLL_MS);
  const batchLimit = parsePositiveIntOption(options["batch-limit"], "batch_limit", DEFAULT_NOTIFICATION_BATCH_LIMIT);
  const refreshSkewMs = parsePositiveIntOption(
    options["refresh-skew-ms"],
    "refresh_skew_ms",
    DEFAULT_NOTIFICATION_REFRESH_SKEW_MS
  );
  const force = parseBooleanOption(options.force, false);
  const packageRoot =
    typeof options["package-root"] === "string" && options["package-root"].trim()
      ? path.resolve(String(options["package-root"]).trim())
      : repoRoot;
  const telegramBotToken = typeof options["telegram-bot-token"] === "string" ? options["telegram-bot-token"].trim() : "";
  const telegramChatId = typeof options["telegram-chat-id"] === "string" ? options["telegram-chat-id"].trim() : "";

  if ((alias || address) && !apiBase) {
    return {
      ok: false,
      error: "missing_or_invalid_api_base",
      hint: "set --api-base when notifications init should create a fresh auth state"
    };
  }
  if (!(alias || address) && authStateOutputFile) {
    return {
      ok: false,
      error: "notifications_state_out_requires_login_selector",
      hint: "use --auth-state-file to reuse an existing auth state, or pass --alias/--address with --api-base when init should create a fresh auth state"
    };
  }

  if (invalidPreset) {
    return {
      ok: false,
      error: "invalid_notification_preset",
      invalidPreset
    };
  }
  if (invalidEventTypes.length > 0) {
    return {
      ok: false,
      error: "invalid_notification_event_types",
      invalidEventTypes
    };
  }
  if (preset === CUSTOM_NOTIFICATION_PRESET && eventTypes.length === 0) {
    return {
      ok: false,
      error: "missing_notification_event_types",
      hint: "pass --event-types when using --preset custom"
    };
  }
  if (telegramBotToken && (isPlaceholderNotificationValue(telegramBotToken) || !isValidTelegramBotToken(telegramBotToken))) {
    return {
      ok: false,
      error: "invalid_env_TELEGRAM_BOT_TOKEN"
    };
  }
  if (telegramChatId && (isPlaceholderNotificationValue(telegramChatId) || !isValidTelegramChatId(telegramChatId))) {
    return {
      ok: false,
      error: "invalid_env_TELEGRAM_CHAT_ID"
    };
  }
  const packageRootValidation = validateNotificationPackageRoot(packageRoot);
  if (!packageRootValidation.ok) {
    return packageRootValidation;
  }
  const readyToStart = Boolean(telegramBotToken && telegramChatId);

  if (!force) {
    const guardedFiles = [envOut, serviceOut];
    if (alias || address) {
      guardedFiles.push(authStateFile);
    }
    for (const targetFile of guardedFiles) {
      if (fs.existsSync(targetFile)) {
        return {
          ok: false,
          error: "notifications_output_exists",
          file: targetFile,
          hint: "use --force to overwrite generated notifier files"
        };
      }
    }
  }

  let authState = null;
  let authSource = "existing_state";
  try {
    if (alias || address) {
      const entries = await loadKeystoreEntries(keystorePath);
      const entry = resolveKeystoreEntry(entries, { alias, address });
      if (!entry) {
        return {
          ok: false,
          error: "keystore_entry_not_found",
          selector: {
            address: address || null,
            alias: alias || null
          },
          keystorePath
        };
      }
      authState = await signInWithKeystoreEntry({
        apiBase,
        entry,
        timeoutMs
      });
      await saveAuthState(authStateFile, authState);
      authSource = "fresh_login";
    } else if (fs.existsSync(authStateFile)) {
      authState = await loadAuthState(authStateFile);
      const authValidation = validateRuntimeAuthState(authState, {
        apiBaseFallback: apiBase,
        requiredApiBase: apiBase,
        refreshSkewMs
      });
      if (!authValidation.ok) {
        return {
          ok: false,
          error: authValidation.issues[0],
          hint:
            authValidation.issues[0] === "auth_state_api_base_mismatch" && apiBase
              ? `existing auth state points at ${authState.apiBase || "another api base"}; rerun auth-login for ${apiBase} or use a matching --auth-state-file`
              : undefined
        };
      }
      authState = authValidation.authState;
    } else {
      return {
        ok: false,
        error: "missing_auth_state_setup",
        hint: "run clawnera-help auth-login first or pass --api-base with --alias/--address"
      };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "notifications_init_failed"
    };
  }

  const effectiveApiBase = authState.apiBase || apiBase;
  if (!effectiveApiBase) {
    return {
      ok: false,
      error: "missing_or_invalid_api_base",
      hint: "auth state is missing apiBase and no --api-base was provided"
    };
  }

  try {
    writeTextFile(
      envOut,
      buildNotificationEnvText({
        packageRoot,
        apiBase: effectiveApiBase,
        authStateFile,
        preset: preset || CUSTOM_NOTIFICATION_PRESET,
        eventTypes,
        cursorFile: cursorOut,
        telegramBotToken,
        telegramChatId,
        pollMs,
        batchLimit,
        timeoutMs,
        refreshSkewMs
      }),
      writeModeForPath(envOut)
    );
  } catch (error) {
    return {
      ok: false,
      error: "notifications_output_write_failed",
      reason: error instanceof Error ? error.message : "unknown",
      file: envOut
    };
  }
  try {
    writeTextFile(
      serviceOut,
      buildNotificationServiceText({
        envFile: envOut,
        packageRoot,
        nodeBinary: process.execPath
      }),
      writeModeForPath(serviceOut)
    );
  } catch (error) {
    return {
      ok: false,
      error: "notifications_output_write_failed",
      reason: error instanceof Error ? error.message : "unknown",
      file: serviceOut
    };
  }

  return {
    ok: true,
    mode: "init",
    target: "telegram",
    preset: preset || CUSTOM_NOTIFICATION_PRESET,
    eventTypes,
    authSource,
    apiBase: effectiveApiBase,
    address: authState.address || null,
    alias: authState.alias || null,
    authStateFile,
    envOut,
    serviceOut,
    cursorOut,
    packageRoot,
    readyToStart,
    warnings: readyToStart ? [] : ["missing_telegram_credentials"],
    commands: readyToStart ? buildNotificationServiceCommands(serviceOut) : []
  };
}

function sponsorPreflightUsageLines() {
  return [
    "Sponsor preflight helper:",
    "- Required: --api-base <url> --jwt <token>",
    "- Defaults: --purpose marketplace_tx --payment-coin iota",
    "- Optional: --gas-budget <int> --tx-family <family> --order-id <id> --timeout-ms <ms>",
    "- Runtime returns strategy, diagnostics, tx family, and gas recommendations without consuming a reservation.",
    "- Use this before sponsor reserve/execute for actor-scoped dry-run planning."
  ];
}

async function runSponsorPreflight(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: sponsorPreflightUsageLines()
    };
  }

  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals
    };
  }

  const apiBase = normalizeApiBase(options["api-base"] || process.env.CLAWNERA_API_BASE_URL);
  if (!apiBase) {
    return {
      ok: false,
      error: "missing_or_invalid_api_base",
      hint: "set --api-base or CLAWNERA_API_BASE_URL"
    };
  }

  const jwt = String(options.jwt || process.env.CLAWNERA_API_JWT || "").trim();
  if (!jwt) {
    return {
      ok: false,
      error: "missing_jwt",
      hint: "set --jwt or CLAWNERA_API_JWT"
    };
  }

  const purpose = String(options.purpose || "marketplace_tx").trim().toLowerCase();
  const paymentCoinRaw = options["payment-coin"];
  const paymentCoin = paymentCoinRaw === undefined ? "iota" : String(paymentCoinRaw).trim().toLowerCase();
  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  const txFamily = typeof options["tx-family"] === "string" ? options["tx-family"].trim() : "";

  try {
    const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
    const gasBudgetRaw = options["gas-budget"];
    const gasBudget =
      gasBudgetRaw === undefined || gasBudgetRaw === null || gasBudgetRaw === ""
        ? null
        : parsePositiveIntOption(gasBudgetRaw, "gas_budget", 0);

    const preflightBody = {
      purpose,
      ...(paymentCoin ? { paymentCoin } : {}),
      ...(orderId ? { orderId } : {}),
      ...(txFamily ? { txFamily } : {}),
      ...(gasBudget ? { gasBudget } : {})
    };

    const preflightResult = await requestJson(
      `${apiBase}/sponsor/preflight`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(preflightBody)
      },
      timeoutMs
    );

    if (!preflightResult.ok) {
      return {
        ok: false,
        error: preflightResult.error || "sponsor_preflight_failed",
        status: preflightResult.status,
        response: preflightResult.body
      };
    }

    const response = preflightResult.body || {};
    return {
      ok: true,
      mode: "preflight",
      purpose,
      paymentCoin: response.paymentCoin ?? paymentCoin ?? null,
      orderId: response.orderId ?? (orderId || null),
      txFamily: response.txFamily || null,
      sponsorLikelyAllowed: response.strategy?.sponsorLikelyAllowed ?? null,
      selfPayFallbackAvailable: response.strategy?.selfPayFallbackAvailable ?? null,
      strictMode: response.strategy?.strictMode ?? null,
      minimumGasBudget: response.minimumGasBudget ?? null,
      recommendedGasBudget: response.recommendedGasBudget ?? null,
      maxGasBudget: response.maxGasBudget ?? null,
      diagnosticCount: Array.isArray(response.diagnostics) ? response.diagnostics.length : 0,
      response
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "sponsor_preflight_helper_failed"
    };
  }
}

async function runSponsorExecute(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: sponsorExecuteUsageLines()
    };
  }

  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals
    };
  }

  const apiBase = normalizeApiBase(options["api-base"] || process.env.CLAWNERA_API_BASE_URL);
  if (!apiBase) {
    return {
      ok: false,
      error: "missing_or_invalid_api_base",
      hint: "set --api-base or CLAWNERA_API_BASE_URL"
    };
  }

  const jwt = String(options.jwt || process.env.CLAWNERA_API_JWT || "").trim();
  if (!jwt) {
    return {
      ok: false,
      error: "missing_jwt",
      hint: "set --jwt or CLAWNERA_API_JWT"
    };
  }

  const purpose = String(options.purpose || "marketplace_tx").trim().toLowerCase();
  const paymentCoinRaw = options["payment-coin"];
  const paymentCoin = paymentCoinRaw === undefined ? "iota" : String(paymentCoinRaw).trim().toLowerCase();
  const dryRun = Boolean(options["dry-run"]);
  const buildCmd = typeof options["build-cmd"] === "string" ? options["build-cmd"] : "";
  const reservationOut = typeof options["reservation-out"] === "string" ? options["reservation-out"].trim() : "";

  try {
    const gasBudget = parsePositiveIntOption(options["gas-budget"], "gas_budget", 1_000_000);
    const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
    const builderTimeoutMs = parsePositiveIntOption(options["builder-timeout-ms"], "builder_timeout_ms", 60_000);
    const idempotencyKey = typeof options["idempotency-key"] === "string" ? options["idempotency-key"] : randomUUID();

    if (!dryRun && !buildCmd) {
      return {
        ok: false,
        error: "missing_build_cmd",
        hint: "set --build-cmd '<command>' or use --dry-run"
      };
    }

    const reserveBody = {
      purpose,
      gasBudget,
      ...(paymentCoin ? { paymentCoin } : {})
    };

    const reserveResult = await requestJson(
      `${apiBase}/sponsor/reserve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(reserveBody)
      },
      timeoutMs
    );

    if (!reserveResult.ok) {
      return {
        ok: false,
        error: reserveResult.error || "sponsor_reserve_failed",
        status: reserveResult.status,
        response: reserveResult.body
      };
    }

    if (hasSelfPayFallback(reserveResult.body)) {
      return {
        ok: false,
        error: "sponsor_fallback_self_pay_on_reserve",
        response: reserveResult.body
      };
    }

    const reservation = reserveResult.body?.reservation;
    const reservationId =
      reservation && typeof reservation.reservationId === "string" ? reservation.reservationId.trim() : "";
    if (!reservationId) {
      return {
        ok: false,
        error: "missing_reservation_id",
        response: reserveResult.body
      };
    }

    const safeReservationOut = reservationOut ? path.resolve(repoRoot, reservationOut) : "";
    if (safeReservationOut) {
      fs.mkdirSync(path.dirname(safeReservationOut), { recursive: true });
      fs.writeFileSync(safeReservationOut, JSON.stringify(reserveResult.body, null, 2), { mode: 0o600 });
      fs.chmodSync(safeReservationOut, 0o600);
    }

    if (dryRun) {
      return {
        ok: true,
        mode: "dry_run",
        reservationId,
        sponsorAddress: reservation?.sponsorAddress || null,
        reservationOut: safeReservationOut || null
      };
    }

    const buildEnv = {
      ...process.env,
      CLAWNERA_SPONSOR_RESERVATION_JSON: JSON.stringify(reserveResult.body),
      CLAWNERA_SPONSOR_RESERVATION_ID: reservationId,
      CLAWNERA_SPONSOR_API_BASE_URL: apiBase,
      CLAWNERA_SPONSOR_PURPOSE: purpose,
      CLAWNERA_SPONSOR_PAYMENT_COIN: paymentCoin || "",
      CLAWNERA_SPONSOR_GAS_COINS_JSON: JSON.stringify(Array.isArray(reservation?.gasCoins) ? reservation.gasCoins : [])
    };
    if (safeReservationOut) {
      buildEnv.CLAWNERA_SPONSOR_RESERVATION_FILE = safeReservationOut;
    }

    const built = runBuildCommand(buildCmd, buildEnv, builderTimeoutMs);
    if (!built.ok || !built.payload) {
      return {
        ok: false,
        error: built.error || "builder_failed",
        reservationId
      };
    }

    const executeResult = await requestJson(
      `${apiBase}/sponsor/execute`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey
        },
        body: JSON.stringify({
          reservationId,
          txBytesB64: built.payload.txBytesB64,
          userSig: built.payload.userSig
        })
      },
      timeoutMs
    );

    if (!executeResult.ok) {
      return {
        ok: false,
        error: executeResult.error || "sponsor_execute_failed",
        status: executeResult.status,
        response: executeResult.body,
        reservationId
      };
    }

    if (hasSelfPayFallback(executeResult.body)) {
      return {
        ok: false,
        error: "sponsor_fallback_self_pay_on_execute",
        response: executeResult.body,
        reservationId
      };
    }

    return {
      ok: true,
      mode: "execute",
      reservationId,
      txDigest: executeResult.body?.execution?.txDigest || null,
      sponsorAddress: reservation?.sponsorAddress || null
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "sponsor_execute_helper_failed"
    };
  }
}

function doctorUsageLines() {
  return [
    "Doctor helper:",
    "- Default: local toolchain only",
    "- Optional remote checks: --api-base <url>",
    "- Optional auth check: --jwt <token>",
    "- Optional timeout override: --timeout-ms <ms>",
    `- If unresolved after doctor, report in GitHub Issues: ${ISSUE_TRACKER_URL}`
  ];
}

function triageUsageLines() {
  return [
    "Triage helper:",
    '- Usage: clawnera-help triage "<problem or error>"',
    "- Example: clawnera-help triage \"sponsor execute failed\"",
    "- Suggests likely topics, commands, and GitHub issue escalation path"
  ];
}

function reportIssueUsageLines() {
  return [
    "Issue report helper:",
    "- Usage: clawnera-help report-issue --category <bug|integration-help|docs> --summary <text>",
    "- Optional fields: --title, --api-base, --jwt, --order-id, --listing-id, --dispute-case-id, --reservation-id, --error, --command",
    "- Add remote doctor snapshot with: --include-doctor",
    `- Opens/targets GitHub issues here: ${ISSUE_NEW_URL}`
  ];
}

function summarizeApiFailure(result) {
  if (!result || typeof result !== "object") {
    return "unknown_error";
  }
  if (result.error) {
    return result.error;
  }
  if (result.body && typeof result.body === "object" && !Array.isArray(result.body)) {
    if (typeof result.body.error === "string" && result.body.error.trim()) {
      return result.body.error.trim();
    }
    if (typeof result.body.detail === "string" && result.body.detail.trim()) {
      return result.body.detail.trim();
    }
  }
  if (typeof result.raw === "string" && result.raw.trim()) {
    return result.raw.trim().slice(0, 240);
  }
  return "unexpected_response";
}

async function collectRemoteDoctor(apiBase, jwt, timeoutMs) {
  const probes = [
    { id: "health", path: "/health", requiresJwt: false },
    { id: "ready", path: "/ready", requiresJwt: false },
    { id: "capabilities", path: "/capabilities", requiresJwt: false },
    { id: "policy_fees", path: "/policy/fees", requiresJwt: false },
    { id: "actor_capabilities", path: "/actors/me/capabilities", requiresJwt: true },
    { id: "auth_session", path: "/auth/session", requiresJwt: true }
  ];

  const checks = [];
  for (const probe of probes) {
    if (probe.requiresJwt && !jwt) {
      checks.push({
        id: probe.id,
        path: probe.path,
        status: "skipped",
        ok: true,
        httpStatus: null,
        detail: "jwt_not_provided"
      });
      continue;
    }

    const result = await requestJson(
      `${apiBase}${probe.path}`,
      {
        method: "GET",
        headers: probe.requiresJwt
          ? {
              authorization: `Bearer ${jwt}`
            }
          : undefined
      },
      timeoutMs
    );
    const ok = result.ok && result.status === 200;
    checks.push({
      id: probe.id,
      path: probe.path,
      status: ok ? "pass" : "fail",
      ok,
      httpStatus: result.status || null,
      detail: ok ? "ok" : summarizeApiFailure(result)
    });
  }

  return {
    apiBase,
    jwtProvided: Boolean(jwt),
    ok: checks.every((check) => check.ok),
    checks
  };
}

async function runDoctorCommand(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: doctorUsageLines()
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals
    };
  }

  const report = {
    ok: true,
    ...doctorData()
  };

  const apiBase = normalizeApiBase(options["api-base"] || process.env.CLAWNERA_API_BASE_URL);
  const jwt = typeof options.jwt === "string" ? String(options.jwt).trim() : String(process.env.CLAWNERA_API_JWT || "").trim();
  const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 8000);

  if (apiBase) {
    report.remote = await collectRemoteDoctor(apiBase, jwt, timeoutMs);
    report.ok = report.remote.ok;
  } else {
    report.remote = null;
  }

  return report;
}

function printDoctorReport(report) {
  console.log("Toolchain doctor:");
  for (const [name, version] of Object.entries(report.tools || {})) {
    console.log(`- ${name}: ${version}`);
  }
  console.log(`- repo: ${report.repo}`);
  console.log(`- topics: ${report.topics}`);

  if (report.remote) {
    console.log("Remote API doctor:");
    console.log(`- apiBase: ${report.remote.apiBase}`);
    console.log(`- jwtProvided: ${report.remote.jwtProvided ? "yes" : "no"}`);
    for (const check of report.remote.checks) {
      const httpText = check.httpStatus ? ` http=${check.httpStatus}` : "";
      console.log(`- [${check.status}] ${check.path}:${httpText} ${check.detail}`);
    }
  } else {
    console.log("- remote: skipped (set --api-base <url> to probe live runtime)");
  }
}

function scoreTriageRule(query, rule) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) {
    return 0;
  }
  return rule.keywords.reduce((score, keyword) => {
    return normalized.includes(String(keyword).toLowerCase()) ? score + 1 : score;
  }, 0);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function topicDescriptorById(topics, id) {
  return topics.find((topic) => topic.id === id) || null;
}

function buildTriageReport(topics, query) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    return {
      ok: false,
      error: "missing_triage_problem"
    };
  }

  const rankedRules = TRIAGE_RULES.map((rule) => ({
    ...rule,
    score: scoreTriageRule(normalizedQuery, rule)
  }))
    .filter((rule) => rule.score > 0)
    .sort((left, right) => right.score - left.score);

  const suggestedTopicIds = uniqueStrings(
    (rankedRules.length > 0
      ? rankedRules.flatMap((rule) => rule.topics)
      : ["troubleshooting", "onboarding", "api"])
  );
  const suggestedTopics = suggestedTopicIds
    .map((id) => topicDescriptorById(topics, id))
    .filter(Boolean)
    .map((topic) => ({
      id: topic.id,
      title: topic.title,
      file: topic.file
    }));

  const hits = collectSearchHits(normalizedQuery, false).slice(0, 8);
  const recommendedCommands = uniqueStrings([
    ...(rankedRules.length > 0 ? rankedRules.flatMap((rule) => rule.commands) : []),
    `clawnera-help search "${normalizedQuery}"`,
    `clawnera-help report-issue --category ${
      rankedRules[0]?.issueCategory || "integration-help"
    } --summary "${normalizedQuery}" --include-doctor`
  ]);

  return {
    ok: true,
    query: normalizedQuery,
    matchedRules: rankedRules.map((rule) => ({
      id: rule.id,
      score: rule.score,
      issueCategory: rule.issueCategory
    })),
    suggestedTopics,
    recommendedCommands,
    hits,
    issueReporting: {
      category: rankedRules[0]?.issueCategory || "integration-help",
      url: ISSUE_NEW_URL,
      tracker: ISSUE_TRACKER_URL
    }
  };
}

function printTriageReport(report) {
  console.log(`Triage for: ${report.query}`);
  console.log("Likely topics:");
  for (const topic of report.suggestedTopics) {
    console.log(`- ${topic.id}: ${topic.title}`);
  }

  if (report.hits.length > 0) {
    console.log("Relevant doc hits:");
    for (const hit of report.hits) {
      console.log(`- ${hit.file}:${hit.line}: ${hit.text}`);
    }
  }

  console.log("Next commands:");
  for (const command of report.recommendedCommands) {
    console.log(`- ${command}`);
  }

  console.log("Need more help?");
  console.log(`- GitHub issues: ${report.issueReporting.tracker}`);
  console.log(`- New issue: ${report.issueReporting.url}`);
}

function buildIssueBody(input) {
  const lines = [];
  lines.push("## Summary");
  lines.push("");
  lines.push(input.summary || "describe the problem");
  lines.push("");
  lines.push("## Context");
  lines.push("");
  lines.push(`- category: ${input.category}`);
  if (input.apiBase) {
    lines.push(`- apiBase: ${input.apiBase}`);
  }
  if (input.command) {
    lines.push(`- command: ${input.command}`);
  }
  if (input.error) {
    lines.push(`- error: ${input.error}`);
  }
  if (input.orderId) {
    lines.push(`- orderId: ${input.orderId}`);
  }
  if (input.listingId) {
    lines.push(`- listingId: ${input.listingId}`);
  }
  if (input.disputeCaseId) {
    lines.push(`- disputeCaseId: ${input.disputeCaseId}`);
  }
  if (input.reservationId) {
    lines.push(`- reservationId: ${input.reservationId}`);
  }
  lines.push("");
  lines.push("## What I already checked");
  lines.push("");
  lines.push("- `clawnera-help doctor`");
  if (input.apiBase) {
    lines.push(`- \`clawnera-help doctor --api-base ${input.apiBase}${input.jwtIncluded ? " --jwt <redacted>" : ""}\``);
  }
  lines.push(`- \`clawnera-help triage \"${input.summary || "problem"}\"\``);
  lines.push("");

  if (input.doctor) {
    lines.push("## Doctor snapshot");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(input.doctor, null, 2));
    lines.push("```");
    lines.push("");
  }

  lines.push("## Extra details");
  lines.push("");
  lines.push("Add exact responses, tx digests, object ids, or reproduction steps here.");
  return lines.join("\n");
}

function buildIssueUrl(category, title, body) {
  const config = ISSUE_CATEGORY_CONFIG[category];
  const url = new URL(ISSUE_NEW_URL);
  url.searchParams.set("template", config.template);
  url.searchParams.set("title", title);
  url.searchParams.set("labels", config.label);
  url.searchParams.set("body", body);
  return url.toString();
}

async function runReportIssue(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: reportIssueUsageLines()
    };
  }

  const rawCategory =
    typeof options.category === "string" ? options.category.trim().toLowerCase() : "integration-help";
  const category = ISSUE_CATEGORY_CONFIG[rawCategory] ? rawCategory : null;
  if (!category) {
    return {
      ok: false,
      error: "invalid_issue_category"
    };
  }

  const summary =
    typeof options.summary === "string" && options.summary.trim()
      ? options.summary.trim()
      : positionals.join(" ").trim();
  const title =
    (typeof options.title === "string" && options.title.trim()) ||
    `${ISSUE_CATEGORY_CONFIG[category].titlePrefix}: ${summary || "describe the problem"}`;
  const apiBase = normalizeApiBase(options["api-base"] || process.env.CLAWNERA_API_BASE_URL);
  const jwt = typeof options.jwt === "string" ? String(options.jwt).trim() : String(process.env.CLAWNERA_API_JWT || "").trim();
  const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 8000);
  const includeDoctor = Boolean(options["include-doctor"]);

  const doctor = includeDoctor ? await runDoctorCommand([
    ...(apiBase ? ["--api-base", apiBase] : []),
    ...(jwt ? ["--jwt", jwt] : []),
    "--timeout-ms",
    String(timeoutMs)
  ]) : null;

  const body = buildIssueBody({
    category,
    summary,
    apiBase,
    command: typeof options.command === "string" ? options.command.trim() : "",
    error: typeof options.error === "string" ? options.error.trim() : "",
    orderId: typeof options["order-id"] === "string" ? options["order-id"].trim() : "",
    listingId: typeof options["listing-id"] === "string" ? options["listing-id"].trim() : "",
    disputeCaseId: typeof options["dispute-case-id"] === "string" ? options["dispute-case-id"].trim() : "",
    reservationId: typeof options["reservation-id"] === "string" ? options["reservation-id"].trim() : "",
    doctor,
    jwtIncluded: Boolean(jwt)
  });

  return {
    ok: true,
    category,
    title,
    issueUrl: buildIssueUrl(category, title, body),
    trackerUrl: ISSUE_TRACKER_URL,
    body,
    doctorIncluded: Boolean(doctor)
  };
}

function parseArgs(argv) {
  const flags = {
    json: false,
    all: false,
    strict: false,
    sync: false,
    requireSources: false
  };
  const positionals = [];

  for (const arg of argv) {
    if (arg === "--json") {
      flags.json = true;
      continue;
    }
    if (arg === "--all") {
      flags.all = true;
      continue;
    }
    if (arg === "--strict") {
      flags.strict = true;
      continue;
    }
    if (arg === "--sync") {
      flags.sync = true;
      continue;
    }
    if (arg === "--require-sources") {
      flags.requireSources = true;
      continue;
    }
    positionals.push(arg);
  }

  const command = (positionals[0] || "help").toLowerCase();
  const commandArgs = positionals.slice(1);
  return { flags, command, commandArgs };
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

const { flags, command: parsedCommand, commandArgs } = parseArgs(process.argv.slice(2));
const topics = loadTopics();
const aliasCommands = new Map([
  ["list", "topics"],
  ["sponsor-run", "sponsor-execute"],
  ["sponsor-plan", "sponsor-preflight"],
  ["ask", "triage"],
  ["support", "triage"],
  ["issue", "report-issue"],
  ["login", "auth-login"],
  ["jwt-login", "auth-login"],
  ["notify", "notifications"]
]);
const effectiveCommand = aliasCommands.get(parsedCommand) || parsedCommand;

if (effectiveCommand === "help" || effectiveCommand === "-h" || effectiveCommand === "--help") {
  if (flags.json) {
    printJson({
      name: "clawnera-help",
      version: readPackageVersion(),
      commands: [
        "help",
        "topics",
        "show",
        "search",
        "doctor",
        "triage",
        "report-issue",
        "path",
        "auth-login",
        "notifications",
        "first-steps",
        "sponsor-preflight",
        "sponsor-execute",
        "validate",
        "sync",
        "bootstrap",
        "version"
      ],
      topics
    });
  } else {
    printUsage();
    console.log("");
    printTopics(topics);
  }
} else if (effectiveCommand === "topics") {
  if (flags.json) {
    printJson({ topics });
  } else {
    printTopics(topics);
  }
} else if (effectiveCommand === "show") {
  if (flags.json) {
    const topic = resolveTopic(topics, commandArgs[0]);
    if (!topic) {
      printJson({ ok: false, error: `unknown_topic: ${String(commandArgs[0])}` });
      process.exitCode = 1;
    } else {
      const docPath = path.join(repoRoot, topic.file);
      if (!fs.existsSync(docPath)) {
        printJson({ ok: false, error: `missing_doc: ${topic.file}` });
        process.exitCode = 1;
      } else {
        printJson({
          ok: true,
          topic: topic.id,
          title: topic.title,
          file: topic.file,
          content: fs.readFileSync(docPath, "utf8")
        });
      }
    }
  } else {
    showTopic(topics, commandArgs[0]);
  }
} else if (effectiveCommand === "search") {
  const keyword = commandArgs.join(" ");
  if (flags.json) {
    if (!keyword.trim()) {
      printJson({ ok: false, error: "missing_search_keyword" });
      process.exitCode = 1;
    } else {
      const hits = [];
      hits.push(...collectSearchHits(keyword, flags.all));
      printJson({
        ok: true,
        keyword,
        scope: flags.all ? "all" : "curated",
        hitCount: hits.length,
        hits
      });
    }
  } else {
    searchKeyword(keyword, flags.all);
  }
} else if (effectiveCommand === "doctor") {
  const report = await runDoctorCommand(commandArgs);
  if (flags.json) {
    printJson(report);
  } else if (report.help && Array.isArray(report.usage)) {
    for (const line of report.usage) {
      console.log(line);
    }
  } else if (report.ok || report.remote) {
    printDoctorReport(report);
  } else {
    console.error(`doctor_error: ${report.error}`);
    process.exitCode = 1;
  }
  if (!report.ok && !report.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "triage") {
  const query = commandArgs.join(" ").trim();
  if (query === "--help" || query === "-h") {
    const usage = triageUsageLines();
    if (flags.json) {
      printJson({ ok: true, help: true, usage });
    } else {
      for (const line of usage) {
        console.log(line);
      }
    }
  } else {
    const report = buildTriageReport(topics, query);
    if (flags.json) {
      printJson(report);
    } else if (report.ok) {
      printTriageReport(report);
    } else {
      console.error(report.error);
      process.exitCode = 1;
    }
    if (!report.ok) {
      process.exitCode = 1;
    }
  }
} else if (effectiveCommand === "report-issue") {
  const report = await runReportIssue(commandArgs);
  if (flags.json) {
    printJson(report);
  } else if (report.help && Array.isArray(report.usage)) {
    for (const line of report.usage) {
      console.log(line);
    }
  } else if (report.ok) {
    console.log(`issue_category=${report.category}`);
    console.log(`issue_url=${report.issueUrl}`);
    console.log(`tracker_url=${report.trackerUrl}`);
    console.log("issue_body_start");
    console.log(report.body);
    console.log("issue_body_end");
  } else {
    console.error(`report_issue_error: ${report.error}`);
    process.exitCode = 1;
  }
  if (!report.ok && !report.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "path") {
  if (flags.json) {
    printJson({ repo: repoRoot });
  } else {
    console.log(repoRoot);
  }
} else if (effectiveCommand === "auth-login") {
  const result = await runAuthLogin(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`auth_login_ok address=${result.address}`);
    if (result.alias) {
      console.log(`wallet_alias=${result.alias}`);
    }
    console.log(`api_base=${result.apiBase}`);
    console.log(`access_token_expires_ms=${result.expiresAtMs ?? "unknown"}`);
    console.log(`refresh_token_expires_ms=${result.refreshExpiresAtMs ?? "unknown"}`);
    if (result.stateOut) {
      console.log(`auth_state_file=${result.stateOut}`);
    }
    if (result.envOut) {
      console.log(`env_file=${result.envOut}`);
      console.log(`source ${shellQuote(result.envOut)}`);
    }
    if (!result.stateOut && !result.envOut) {
      console.log(`export CLAWNERA_API_BASE_URL=${shellQuote(result.apiBase)}`);
      console.log(`export CLAWNERA_API_JWT=${shellQuote(result.token)}`);
      console.log(`export CLAWNERA_API_REFRESH_TOKEN=${shellQuote(result.refreshToken)}`);
      console.log(`export CLAWNERA_API_ADDRESS=${shellQuote(result.address)}`);
      if (result.alias) {
        console.log(`export CLAWNERA_API_ADDRESS_ALIAS=${shellQuote(result.alias)}`);
      }
    }
  } else {
    console.error(`auth_login_helper_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "notifications") {
  const result = await runNotifications(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.mode === "presets" && result.ok && Array.isArray(result.presets)) {
    console.log("Notification presets:");
    for (const preset of result.presets) {
      console.log(`- ${preset.id}: ${preset.description}`);
      console.log(`  events: ${preset.eventTypes.join(", ")}`);
    }
  } else if (result.mode === "init" && result.ok && result.target === "telegram") {
    console.log(`notifications_init_ok target=${result.target}`);
    console.log(`preset=${result.preset}`);
    console.log(`event_types=${result.eventTypes.join(",")}`);
    console.log(`auth_source=${result.authSource}`);
    console.log(`api_base=${result.apiBase}`);
    console.log(`auth_state_file=${result.authStateFile}`);
    console.log(`env_file=${result.envOut}`);
    console.log(`service_file=${result.serviceOut}`);
    console.log(`cursor_file=${result.cursorOut}`);
    if (result.alias) {
      console.log(`wallet_alias=${result.alias}`);
    }
    if (result.address) {
      console.log(`address=${result.address}`);
    }
    if (!result.readyToStart) {
      console.log("Next steps:");
      console.log(`- Edit ${result.envOut} and set TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID before starting the notifier`);
    } else {
      console.log("Next steps:");
      console.log(`- Review ${result.envOut} if you want to adjust polling or event selection`);
      for (const command of result.commands) {
        console.log(`- ${command}`);
      }
    }
  } else if (result.mode === "doctor") {
    console.log(`notifications_doctor_${result.ok ? "ok" : "failed"}`);
    if (result.envFile) {
      console.log(`env_file=${result.envFile}`);
    }
    if (result.serviceFile) {
      console.log(`service_file=${result.serviceFile}`);
    }
    if (Array.isArray(result.issues) && result.issues.length > 0) {
      for (const issue of result.issues) {
        console.log(`- ${issue}`);
      }
    }
    if (!result.ok) {
      process.exitCode = 1;
    }
  } else {
    console.error(`notifications_helper_error: ${result.error || "notification_helper_failed"}`);
    if (result.hint) {
      console.error(result.hint);
    }
    if (result.file) {
      console.error(`file=${result.file}`);
    }
    if (Array.isArray(result.issues) && result.issues.length > 0) {
      console.error(`issues=${result.issues.join(",")}`);
    }
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "first-steps") {
  const runMode = commandArgs.includes("--run");
  if (!runMode) {
    const instructions = [
      "IOTA first steps:",
      "- Optional CLI install: bash scripts/install-iota-cli.sh",
      "- CLI bootstrap check/run: bash scripts/bootstrap-iota-first-steps.sh",
      "- With wallet initialization: bash scripts/bootstrap-iota-first-steps.sh --init-wallet",
      "- Use `clawnera-help first-steps --run` for the default bootstrap run",
      "- Use `clawnera-help show iota-cli` for full guide"
    ];
    if (flags.json) {
      printJson({
        ok: true,
        run: false,
        instructions
      });
    } else {
      for (const line of instructions) {
        console.log(line);
      }
    }
  } else {
    const passThrough = commandArgs.filter((arg) => arg !== "--run");
    const result = runIotaFirstSteps(passThrough);
    if (flags.json) {
      printJson(result);
    } else {
      if (result.output) {
        console.log(result.output);
      }
      if (!result.ok && result.error) {
        console.error(result.error);
      }
    }
    if (!result.ok) {
      process.exitCode = 1;
    }
  }
} else if (effectiveCommand === "sponsor-preflight") {
  const result = await runSponsorPreflight(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`sponsor_preflight_ok tx_family=${result.txFamily || "unknown"}`);
    console.log(`recommended_gas_budget=${result.recommendedGasBudget ?? "unknown"}`);
    console.log(`minimum_gas_budget=${result.minimumGasBudget ?? "unknown"}`);
    console.log(`max_gas_budget=${result.maxGasBudget ?? "unknown"}`);
    console.log(`strict_mode=${String(result.strictMode)}`);
    console.log(`self_pay_fallback_available=${String(result.selfPayFallbackAvailable)}`);
    console.log(`diagnostic_count=${result.diagnosticCount}`);
  } else {
    console.error(`sponsor_preflight_helper_error: ${result.error}`);
    if (result.status) {
      console.error(`http_status=${result.status}`);
    }
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "sponsor-execute") {
  const result = await runSponsorExecute(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    if (result.mode === "dry_run") {
      console.log(`sponsor_reserve_ok reservation_id=${result.reservationId}`);
      console.log("dry_run=true execute_step_skipped");
      if (result.reservationOut) {
        console.log(`reservation_file=${result.reservationOut}`);
      }
    } else {
      console.log(`sponsor_reserve_ok reservation_id=${result.reservationId}`);
      console.log(`sponsor_execute_ok tx_digest=${result.txDigest || "unknown"}`);
    }
  } else {
    console.error(`sponsor_execute_helper_error: ${result.error}`);
    if (result.status) {
      console.error(`http_status=${result.status}`);
    }
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "validate") {
  const validation = validateRepository(flags.strict);
  if (flags.json) {
    printJson(validation);
  } else {
    printValidation(validation);
  }
  if (!validation.success) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "sync") {
  const result = runSyncSources({ requireSources: syncRequiresSources(flags) });
  if (flags.json) {
    printJson(result);
  } else {
    if (result.output) {
      console.log(result.output);
    }
    if (result.skipped && result.details) {
      console.log(result.details);
    }
    if (!result.ok && result.error) {
      console.error(result.error);
    }
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "bootstrap") {
  const doctor = doctorData();
  const validation = validateRepository(flags.strict);
  const syncResult = flags.sync ? runSyncSources({ requireSources: syncRequiresSources(flags) }) : null;
  const success = validation.success && (!syncResult || syncResult.ok);

  if (flags.json) {
    printJson({
      ok: success,
      doctor,
      validation,
      sync: syncResult
    });
  } else {
    console.log("Bootstrap checks:");
    for (const [name, version] of Object.entries(doctor.tools)) {
      console.log(`- ${name}: ${version}`);
    }
    printValidation(validation);
    if (flags.sync) {
      console.log("Sync:");
      if (syncResult && syncResult.output) {
        console.log(syncResult.output);
      }
      if (syncResult && syncResult.skipped && syncResult.details) {
        console.log(syncResult.details);
      }
      if (syncResult && !syncResult.ok && syncResult.error) {
        console.error(syncResult.error);
      }
    }
    console.log(success ? "bootstrap_ok" : "bootstrap_failed");
  }

  if (!success) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "version") {
  const version = readPackageVersion();
  if (flags.json) {
    printJson({ version });
  } else {
    console.log(version);
  }
} else {
  console.error(`unknown_command: ${effectiveCommand}`);
  printUsage();
  process.exitCode = 1;
}

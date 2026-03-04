#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

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
  console.log("  clawnera-help path                        Print repository path");
  console.log("  clawnera-help first-steps [--run]         Show or run IOTA first-step bootstrap");
  console.log("  clawnera-help sponsor-execute [options]   Reserve->sign->execute sponsor helper");
  console.log("  clawnera-help validate [--strict]         Validate topic/docs consistency");
  console.log("  clawnera-help sync                        Sync local source snapshots");
  console.log("  clawnera-help bootstrap [--sync]          Run doctor + validate (+ optional sync)");
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
        console.log(`${rel}:${i + 1}: ${line}`);
      }
    }
  }
  if (hits.length === 0) {
    console.log(`no_hits_for: ${term}`);
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

function runSyncSources() {
  if (!fs.existsSync(syncScript)) {
    return {
      ok: false,
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
  return {
    ok: result.status === 0,
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
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2).trim().toLowerCase();
    if (!key) {
      positionals.push(token);
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
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid_${fieldName}`);
  }
  return parsed;
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

function parseArgs(argv) {
  const flags = {
    json: false,
    all: false,
    strict: false,
    sync: false
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
  ["sponsor-run", "sponsor-execute"]
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
        "path",
        "first-steps",
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
      const files = flags.all ? allMarkdownFiles() : curatedMarkdownFiles();
      const lower = keyword.toLowerCase();
      for (const file of files) {
        const rel = path.relative(repoRoot, file);
        const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].toLowerCase().includes(lower)) {
            hits.push({ file: rel, line: i + 1, text: lines[i] });
          }
        }
      }
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
  if (flags.json) {
    printJson({
      ok: true,
      ...doctorData()
    });
  } else {
    printDoctor();
  }
} else if (effectiveCommand === "path") {
  if (flags.json) {
    printJson({ repo: repoRoot });
  } else {
    console.log(repoRoot);
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
  const result = runSyncSources();
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
} else if (effectiveCommand === "bootstrap") {
  const doctor = doctorData();
  const validation = validateRepository(flags.strict);
  const syncResult = flags.sync ? runSyncSources() : null;
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

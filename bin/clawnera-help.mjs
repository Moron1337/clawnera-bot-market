#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
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
const aliasCommands = new Map([["list", "topics"]]);
const effectiveCommand = aliasCommands.get(parsedCommand) || parsedCommand;

if (effectiveCommand === "help" || effectiveCommand === "-h" || effectiveCommand === "--help") {
  if (flags.json) {
    printJson({
      name: "clawnera-help",
      version: readPackageVersion(),
      commands: ["help", "topics", "show", "search", "doctor", "path", "first-steps", "validate", "sync", "bootstrap", "version"],
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

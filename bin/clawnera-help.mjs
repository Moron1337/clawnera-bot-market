#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const topicsFile = path.join(repoRoot, "config", "topics.json");
const docsRoot = path.join(repoRoot, "docs");

function loadTopics() {
  const raw = fs.readFileSync(topicsFile, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.topics) ? parsed.topics : [];
}

function printUsage() {
  console.log("CLAWNERA Bot Market CLI");
  console.log("");
  console.log("Usage:");
  console.log("  clawnera-help                     Show usage + topics");
  console.log("  clawnera-help topics              List all topics");
  console.log("  clawnera-help show <topic>        Show one topic document");
  console.log("  clawnera-help search <keyword>    Search keyword in docs");
  console.log("  clawnera-help doctor              Check local toolchain");
  console.log("  clawnera-help path                Print repository path");
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
  return topics.find((topic) => {
    if (String(topic.id).toLowerCase() === normalized) {
      return true;
    }
    if (!Array.isArray(topic.aliases)) {
      return false;
    }
    return topic.aliases.some((alias) => String(alias).toLowerCase() === normalized);
  }) || null;
}

function showTopic(topics, key) {
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

function searchKeyword(keyword) {
  const term = String(keyword || "").trim();
  if (!term) {
    console.error("missing_search_keyword");
    process.exitCode = 1;
    return;
  }
  const files = walkMarkdownFiles(docsRoot);
  const lower = term.toLowerCase();
  let hitCount = 0;
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.toLowerCase().includes(lower)) {
        hitCount += 1;
        console.log(`${rel}:${i + 1}: ${line}`);
      }
    }
  }
  if (hitCount === 0) {
    console.log(`no_hits_for: ${term}`);
  }
}

function safeVersion(cmd) {
  const commands = Array.isArray(cmd) ? cmd : [cmd];
  for (const candidate of commands) {
    try {
      const output = execSync(candidate, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
      return output || "ok";
    } catch {
      // Try next candidate
    }
  }
  return "missing";
}

function doctor() {
  const checks = [
    ["node", "node --version"],
    ["npm", "npm --version"],
    ["pnpm", ["pnpm --version", "corepack pnpm --version"]],
    ["git", "git --version"],
    ["iota", "iota --version"]
  ];

  console.log("Toolchain doctor:");
  for (const [name, cmd] of checks) {
    console.log(`- ${name}: ${safeVersion(cmd)}`);
  }
  console.log(`- repo: ${repoRoot}`);
  console.log(`- topics: ${loadTopics().length}`);
}

const args = process.argv.slice(2);
const command = (args[0] || "help").toLowerCase();
const topics = loadTopics();

if (command === "help" || command === "-h" || command === "--help") {
  printUsage();
  console.log("");
  printTopics(topics);
} else if (command === "topics") {
  printTopics(topics);
} else if (command === "show") {
  showTopic(topics, args[1]);
} else if (command === "search") {
  searchKeyword(args.slice(1).join(" "));
} else if (command === "doctor") {
  doctor();
} else if (command === "path") {
  console.log(repoRoot);
} else {
  console.error(`unknown_command: ${command}`);
  printUsage();
  process.exitCode = 1;
}

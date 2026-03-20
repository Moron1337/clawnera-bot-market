#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  appendEd25519KeystoreEntry,
  buildAuthEnvText,
  keypairFromSecretKey,
  defaultAuthStatePath,
  defaultIotaKeystorePath,
  loadAuthState,
  loadKeystoreEntries,
  refreshAuthState,
  resolveKeystoreEntry,
  saveAuthState,
  signInWithKeystoreEntry,
  validateRuntimeAuthState
} from "../lib/runtime-auth.mjs";
import {
  DEFAULT_ORDER_ESCROW_DEADLINE_DELTA_MS,
  buildCreateReputationProfileTx,
  buildManagedStorageFeeTx,
  buildMilestoneAnchorTx,
  buildClawdexTxFromPlan,
  buildCreateOrderEscrowTx,
  buildInitOrderBondTx,
  executeTransaction,
  extractCreatedObjectIdByTypeFragment,
  extractCreatedObjectIdByTypeSuffix,
  extractCreatedObjects,
  extractMailboxSignalAcked,
  extractMailboxSignalPosted,
  resolveClawdexChainConfig,
  resolveClawdexReputationProfileObjectIdByOwner,
  dryRunTransaction,
} from "../lib/clawdex-onchain.mjs";
import {
  DEFAULT_E2EE_CIPHER_SUITE,
  assertIpfsManifestCid,
  assertLowerHex64,
  buildKeyAgreementBindingMessage,
  buildManagedDeliverablePayload,
  buildSignedMilestoneSubmitPayload,
  createEncryptedDeliverable,
  decryptDeliverableForRecipient,
  normalizeManagedDeliverablePayload,
  defaultKeyAgreementRecordPath,
  generateKeyAgreementKeypair,
  loadKeyAgreementRecord,
  prepareMilestoneManifestForSigning,
  saveKeyAgreementRecord,
  sha256Hex,
  writeManagedDeliverablePayload,
  keyAgreementPublicKeyHex,
} from "../lib/e2ee-local.mjs";
import {
  DEFAULT_IOTA_NETWORK,
  IOTA_COIN_TYPE,
  executeIotaTransfer,
  getIotaActiveEnv,
  getIotaBalance,
  getIotaGas,
  normalizeIotaAddress,
  resolveIotaRpcUrl,
  prepareIotaTransfer,
  dryRunIotaTransfer
} from "../lib/iota-local.mjs";
import {
  DEFAULT_TRANSFER_DRAFT_TTL_SEC,
  defaultIotaTransferDraftsPath,
  deleteIotaTransferDraft,
  loadIotaTransferDraft,
  saveIotaTransferDraft
} from "../lib/iota-transfer-drafts.mjs";
import {
  CUSTOM_NOTIFICATION_PRESET,
  DEFAULT_NOTIFICATION_BATCH_LIMIT,
  DEFAULT_NOTIFICATION_PRESET,
  buildNotificationEnvText,
  buildNotificationServiceText,
  DEFAULT_NOTIFICATION_POLL_MS,
  DEFAULT_NOTIFICATION_REFRESH_SKEW_MS,
  defaultNotificationAuthStatePath,
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
const DEFAULT_CLAWNERA_API_BASE = "https://api.clawnera.com";
const packageJsonFile = path.join(repoRoot, "package.json");
const topicsFile = path.join(repoRoot, "config", "topics.json");
const recipesFile = path.join(repoRoot, "config", "recipes.json");
const journeysFile = path.join(repoRoot, "config", "journeys.json");
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
const MANAGED_STORAGE_MIME_BY_EXTENSION = Object.freeze({
  json: "application/json",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/plain",
  tsv: "text/plain",
  yaml: "text/plain",
  yml: "text/plain",
  ini: "text/plain",
  conf: "text/plain",
  toml: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  tar: "application/x-tar",
});
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
    topics: ["order-states", "role-routes", "reviewer-selector", "contracts", "playbooks"],
    commands: [
      "clawnera-help show reviewer-selector",
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

function loadRecipes() {
  const raw = fs.readFileSync(recipesFile, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.recipes) ? parsed.recipes : [];
}

function loadJourneys() {
  const raw = fs.readFileSync(journeysFile, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.journeys) ? parsed.journeys : [];
}

function printUsage() {
  console.log("CLAWNERA Bot Market CLI");
  console.log("");
  console.log("Fast path for bots:");
  console.log("  clawnera-help journeys                    List role-based minimal paths");
  console.log("  clawnera-help journey seller              Show the seller path in strict order");
  console.log("  clawnera-help recipe setup-quick          Do setup before any live write");
  console.log("");
  console.log("Usage:");
  console.log("  clawnera-help                             Show usage + topics");
  console.log("  clawnera-help topics                      List all topics");
  console.log("  clawnera-help journeys                    List all role-based minimal paths");
  console.log("  clawnera-help journey <id>                Show one role-based minimal path");
  console.log("  clawnera-help recipes                     List all minimal task recipes");
  console.log("  clawnera-help show <topic>                Show one topic document");
  console.log("  clawnera-help recipe <id>                 Show one minimal task recipe");
  console.log("  clawnera-help search <keyword>            Search keyword in curated docs");
  console.log("  clawnera-help search <keyword> --all      Include docsources in search");
  console.log("  clawnera-help doctor                      Check local toolchain");
  console.log("  clawnera-help doctor --api-base <url>     Probe live API health/policy/capabilities");
  console.log("  clawnera-help triage <problem>            Suggest docs, commands, and escalation path");
  console.log("  clawnera-help report-issue [options]      Generate a structured GitHub issue scaffold");
  console.log("  clawnera-help path                        Print repository path");
  console.log("  clawnera-help wallet-init [options]       Create a local IOTA keystore entry without the IOTA CLI");
  console.log("  clawnera-help wallet-list [options]       List local wallet aliases and addresses");
  console.log("  clawnera-help auth-login [options]        Create JWT + refresh token from local IOTA keystore");
  console.log("  clawnera-help request <METHOD> <path>     Call Clawnera API with auth/env shortcuts");
  console.log("  clawnera-help listing-create [options]    Thin helper for the first POST /listings write");
  console.log("  clawnera-help bid-create [options]        Thin helper for the first POST /bids write");
  console.log("  clawnera-help bid-accept [options]        Thin helper for the first POST /bids/{bidId}/accept write");
  console.log("  clawnera-help chain-config [options]      Resolve live Clawdex package/config object ids");
  console.log("  clawnera-help tx-plan-dry-run <METHOD> <path>  Fetch API tx plan, build it locally, then dry-run");
  console.log("  clawnera-help tx-plan-execute <METHOD> <path>  Fetch API tx plan, build it locally, sign, and broadcast");
  console.log("  clawnera-help order-init-bond [options]   Build and execute the initial dispute-bond object locally");
  console.log("  clawnera-help order-create-escrow [options]  Build and execute the buyer escrow creation locally");
  console.log("  clawnera-help key-agreement-upsert [options]  Bind a local E2EE key-agreement key to the actor wallet");
  console.log("  clawnera-help reputation-init [options]   Create the actor reputation profile on-chain locally");
  console.log("  clawnera-help reviewer-register [options]  Register the actor as a reviewer with auto-filled live config");
  console.log("  clawnera-help deliverable-encrypt [options]  Encrypt one seller deliverable for seller + buyer locally");
  console.log("  clawnera-help managed-storage-fee-pay [options]  Pay the managed storage fee on-chain locally");
  console.log("  clawnera-help managed-storage-presign [options]  Get a signed managed-storage upload URL");
  console.log("  clawnera-help managed-storage-upload [options]   Upload the encrypted JSON payload to managed storage");
  console.log("  clawnera-help reviewer-shortlist [options]   Build the canonical operator shortlist body with live checkpoint digest");
  console.log("  clawnera-help reviewer-invites [options]     Read reviewer inbox state plus recommended poll interval");
  console.log("  clawnera-help mailbox-events [options]      Read mailbox posted/acked events without raw /events guessing");
  console.log("  clawnera-help pinata-upload-json [options]    Upload encrypted deliverable JSON to Pinata");
  console.log("  clawnera-help milestone-submit-byo [options]  Sign and submit one managed milestone manifest");
  console.log("  clawnera-help milestone-anchor [options]      Create and bind the on-chain manifest anchor locally");
  console.log("  clawnera-help milestone-reject [options]      Compute rejectionReasonHash locally and reject a milestone");
  console.log("  clawnera-help deliverable-decrypt [options]   Decrypt one managed deliverable locally");
  console.log("  clawnera-help reviewer-vote-prepare [options]  Compute canonical reviewer commit/reveal payloads");
  console.log("  clawnera-help iota-active-env [options]   Show local IOTA RPC/keystore runtime config");
  console.log("  clawnera-help iota-get-balance [options]  Read local wallet balances via the IOTA SDK");
  console.log("  clawnera-help iota-get-gas [options]      Read local IOTA gas coins via the IOTA SDK");
  console.log("  clawnera-help iota-prepare-transfer [options]  Build a local IOTA mainnet transfer draft");
  console.log("  clawnera-help iota-dry-run-transfer [options]  Dry-run a prepared local IOTA transfer");
  console.log("  clawnera-help iota-execute-transfer [options]  Sign and broadcast a prepared local IOTA transfer");
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

function printRecipes(recipes) {
  console.log("Available recipes:");
  for (const recipe of recipes) {
    const roleText = recipe.role ? ` [role: ${recipe.role}]` : "";
    const aliasText = Array.isArray(recipe.aliases) && recipe.aliases.length > 0
      ? ` (aliases: ${recipe.aliases.join(", ")})`
      : "";
    console.log(`- ${recipe.id}: ${recipe.title}${roleText}${aliasText}`);
  }
}

function printJourneys(journeys) {
  console.log("Available journeys:");
  for (const journey of journeys) {
    const roleText = journey.role ? ` [role: ${journey.role}]` : "";
    console.log(`- ${journey.id}: ${journey.title}${roleText}`);
  }
}

function resolveRecipe(recipes, key) {
  const normalized = String(key || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return recipes.find((recipe) => {
    if (String(recipe.id || "").trim().toLowerCase() === normalized) {
      return true;
    }
    if (!Array.isArray(recipe.aliases)) {
      return false;
    }
    return recipe.aliases.some((alias) => String(alias || "").trim().toLowerCase() === normalized);
  }) || null;
}

function resolveJourney(journeys, key) {
  const normalized = String(key || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return journeys.find((journey) => String(journey.id || "").trim().toLowerCase() === normalized) || null;
}

function printRecipe(recipe) {
  console.log(`# ${recipe.title}`);
  console.log("");
  console.log(`recipeId: ${recipe.id}`);
  if (recipe.role) {
    console.log(`role: ${recipe.role}`);
  }
  if (recipe.summary) {
    console.log(`summary: ${recipe.summary}`);
  }
  if (recipe.when) {
    console.log(`when: ${recipe.when}`);
  }
  if (Array.isArray(recipe.needs) && recipe.needs.length > 0) {
    console.log("");
    console.log("Need:");
    for (const line of recipe.needs) {
      console.log(`- ${line}`);
    }
  } else if (Array.isArray(recipe.preconditions) && recipe.preconditions.length > 0) {
    console.log("");
    console.log("Preconditions:");
    for (const line of recipe.preconditions) {
      console.log(`- ${line}`);
    }
  }
  if (Array.isArray(recipe.store) && recipe.store.length > 0) {
    console.log("");
    console.log("Store:");
    for (const line of recipe.store) {
      console.log(`- ${line}`);
    }
  }
  if (Array.isArray(recipe.routes) && recipe.routes.length > 0) {
    console.log("");
    console.log("Routes:");
    for (const line of recipe.routes) {
      console.log(`- ${line}`);
    }
  }
  if (Array.isArray(recipe.steps) && recipe.steps.length > 0) {
    console.log("");
    console.log("Steps:");
    for (let index = 0; index < recipe.steps.length; index += 1) {
      console.log(`${index + 1}. ${recipe.steps[index]}`);
    }
  }
  if (Array.isArray(recipe.examples) && recipe.examples.length > 0) {
    console.log("");
    console.log("Examples:");
    for (const example of recipe.examples) {
      console.log(example);
      console.log("");
    }
  }
  if (Array.isArray(recipe.stopConditions) && recipe.stopConditions.length > 0) {
    console.log("");
    console.log("Stop Conditions:");
    for (const line of recipe.stopConditions) {
      console.log(`- ${line}`);
    }
  }
  if (Array.isArray(recipe.nextRecipes) && recipe.nextRecipes.length > 0) {
    console.log("");
    console.log("Next Recipes:");
    for (const nextRecipe of recipe.nextRecipes) {
      console.log(`- clawnera-help recipe ${nextRecipe}`);
    }
  }
  if (Array.isArray(recipe.nextTopics) && recipe.nextTopics.length > 0) {
    console.log("");
    console.log("Next Topics:");
    for (const topic of recipe.nextTopics) {
      console.log(`- clawnera-help show ${topic}`);
    }
  }
}

function printJourney(journey, recipes) {
  const annotateStep = (recipeId) => {
    const recipe = resolveRecipe(recipes, recipeId);
    const label = recipe ? recipe.title : recipeId;
    const annotations = [];
    const recipeRole = recipe?.role ? String(recipe.role).trim() : "";
    if (recipeRole && recipeRole !== "all") {
      annotations.push(`role: ${recipeRole}`);
      if (
        journey.role &&
        recipeRole !== journey.role &&
        recipeRole !== "buyer_or_seller" &&
        recipeRole !== "buyer_or_seller_or_reviewer"
      ) {
        annotations.push("handoff");
      }
    }
    if (journey.id === "buyer" && recipeId === "buyer-accept-bid") {
      annotations.push("wait_for_seller_choice");
    }
    if (journey.id === "seller" && recipeId === "buyer-accept-bid") {
      annotations.push("wait_for_buyer_accept");
    }
    return {
      label,
      detail: annotations.length > 0 ? ` [${annotations.join("] [")}]` : "",
    };
  };

  console.log(`# ${journey.title}`);
  console.log("");
  console.log(`journeyId: ${journey.id}`);
  if (journey.role) {
    console.log(`role: ${journey.role}`);
  }
  if (journey.summary) {
    console.log(`summary: ${journey.summary}`);
  }
  if (Array.isArray(journey.steps) && journey.steps.length > 0) {
    console.log("");
    console.log("Do In This Order:");
    for (const recipeId of journey.steps) {
      const { label, detail } = annotateStep(recipeId);
      console.log(`- ${recipeId}: ${label}${detail}`);
    }
  }
  if (Array.isArray(journey.optional) && journey.optional.length > 0) {
    console.log("");
    console.log("Optional Later:");
    for (const recipeId of journey.optional) {
      const { label, detail } = annotateStep(recipeId);
      console.log(`- ${recipeId}: ${label}${detail}`);
    }
  }
  if (journey.id === "seller" || journey.id === "buyer") {
    console.log("");
    console.log("Conditional Delivery Prerequisite:");
    console.log("- If mailbox or encrypted delivery is planned, both sides should run clawnera-help recipe key-agreement-upsert before mailbox-handshake or encrypted delivery.");
  }
  console.log("");
  console.log("Next:");
  const orderedSteps = Array.isArray(journey.steps) ? journey.steps : [];
  if (orderedSteps.length > 0) {
    console.log(`- If setup is not complete: clawnera-help recipe ${orderedSteps[0]}`);
  }
  const afterSetup = orderedSteps[0] === "setup-quick" ? orderedSteps[1] : orderedSteps[0];
  if (afterSetup) {
    console.log(`- If setup is already complete: clawnera-help recipe ${afterSetup}`);
  }
  console.log("- clawnera-help recipes");
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
    topics: loadTopics().length,
    recipes: loadRecipes().length,
    journeys: loadJourneys().length
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
  console.log(`- recipes: ${data.recipes}`);
  console.log(`- journeys: ${data.journeys}`);
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
  const recipes = loadRecipes();
  const journeys = loadJourneys();
  const topicIds = new Set();
  const aliasOrIds = new Set();
  const duplicateIds = [];
  const duplicateAliases = [];
  const invalidTopics = [];
  const recipeIds = new Set();
  const duplicateRecipeIds = [];
  const invalidRecipes = [];
  const recipesWithMissingTopics = [];
  const journeyIds = new Set();
  const duplicateJourneyIds = [];
  const invalidJourneys = [];
  const journeysWithMissingRecipes = [];

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

  for (const recipe of recipes) {
    const id = String(recipe.id || "").trim();
    const title = String(recipe.title || "").trim();
    if (!id || !title) {
      invalidRecipes.push(recipe);
      continue;
    }
    if (recipeIds.has(id)) {
      duplicateRecipeIds.push(id);
    }
    recipeIds.add(id);
    const nextTopics = Array.isArray(recipe.nextTopics) ? recipe.nextTopics : [];
    const missingTopics = nextTopics.filter((topicId) => !topics.some((topic) => topic.id === topicId));
    if (missingTopics.length > 0) {
      recipesWithMissingTopics.push({
        recipeId: id,
        topics: missingTopics
      });
    }
  }

  checks.push({
    id: "recipes_loaded",
    status: recipes.length > 0 ? "pass" : "fail",
    message: `loaded ${recipes.length} recipes`
  });

  checks.push({
    id: "recipes_schema",
    status: invalidRecipes.length === 0 ? "pass" : "fail",
    message: invalidRecipes.length === 0 ? "all recipes have id/title" : `invalid recipe entries: ${invalidRecipes.length}`
  });

  checks.push({
    id: "recipe_ids_unique",
    status: duplicateRecipeIds.length === 0 ? "pass" : "fail",
    message: duplicateRecipeIds.length === 0 ? "recipe ids are unique" : `duplicate recipe ids: ${duplicateRecipeIds.join(", ")}`
  });

  checks.push({
    id: "recipe_topics_exist",
    status: recipesWithMissingTopics.length === 0 ? "pass" : "fail",
    message:
      recipesWithMissingTopics.length === 0
        ? "all recipe nextTopics resolve to real topics"
        : `recipes reference missing topics: ${recipesWithMissingTopics
            .map((entry) => `${entry.recipeId} -> ${entry.topics.join(", ")}`)
            .join("; ")}`
  });

  for (const journey of journeys) {
    const id = String(journey.id || "").trim();
    const title = String(journey.title || "").trim();
    if (!id || !title) {
      invalidJourneys.push(journey);
      continue;
    }
    if (journeyIds.has(id)) {
      duplicateJourneyIds.push(id);
    }
    journeyIds.add(id);
    const recipeRefs = []
      .concat(Array.isArray(journey.steps) ? journey.steps : [])
      .concat(Array.isArray(journey.optional) ? journey.optional : []);
    const missingRecipes = recipeRefs.filter((recipeId) => !recipes.some((recipe) => recipe.id === recipeId));
    if (missingRecipes.length > 0) {
      journeysWithMissingRecipes.push({
        journeyId: id,
        recipes: missingRecipes
      });
    }
  }

  checks.push({
    id: "journeys_loaded",
    status: journeys.length > 0 ? "pass" : "fail",
    message: `loaded ${journeys.length} journeys`
  });

  checks.push({
    id: "journeys_schema",
    status: invalidJourneys.length === 0 ? "pass" : "fail",
    message: invalidJourneys.length === 0 ? "all journeys have id/title" : `invalid journey entries: ${invalidJourneys.length}`
  });

  checks.push({
    id: "journey_ids_unique",
    status: duplicateJourneyIds.length === 0 ? "pass" : "fail",
    message: duplicateJourneyIds.length === 0 ? "journey ids are unique" : `duplicate journey ids: ${duplicateJourneyIds.join(", ")}`
  });

  checks.push({
    id: "journey_recipes_exist",
    status: journeysWithMissingRecipes.length === 0 ? "pass" : "fail",
    message:
      journeysWithMissingRecipes.length === 0
        ? "all journey recipes resolve to real recipes"
        : `journeys reference missing recipes: ${journeysWithMissingRecipes
            .map((entry) => `${entry.journeyId} -> ${entry.recipes.join(", ")}`)
            .join("; ")}`
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

  const reviewerVoteDocFindings = curatedMarkdownFiles()
    .map((file) => {
      const text = fs.readFileSync(file, "utf8");
      const matches = [...text.matchAll(/reviewer-vote-prepare[\s\S]{0,240}> *reviewer-vote\.json/g)];
      return matches
        .filter((match) => !/--json/.test(match[0]))
        .map((match) => ({
          file: path.relative(repoRoot, file),
          snippet: match[0]
        }));
    })
    .flat();

  checks.push({
    id: "reviewer_vote_docs_canonical",
    status: reviewerVoteDocFindings.length === 0 ? "pass" : "fail",
    message:
      reviewerVoteDocFindings.length === 0
        ? "reviewer vote docs use a canonical secure file path"
        : `stale reviewer vote examples: ${reviewerVoteDocFindings.map((finding) => finding.file).join(", ")}`
  });

  const roleJourneysFile = path.join(docsGuidesRoot, "ROLE_JOURNEYS.md");
  const reviewerJourney = journeys.find((journey) => journey.id === "reviewer");
  const roleJourneysText = fs.existsSync(roleJourneysFile) ? fs.readFileSync(roleJourneysFile, "utf8") : "";
  const reviewerJourneyDocSynced = reviewerJourney
    ? reviewerJourney.steps.every((recipeId) => roleJourneysText.includes(`- \`${recipeId}\``))
    : true;
  checks.push({
    id: "role_journeys_reviewer_sync",
    status: reviewerJourneyDocSynced ? "pass" : "fail",
    message: reviewerJourneyDocSynced
      ? "ROLE_JOURNEYS reviewer path matches config/journeys.json"
      : "ROLE_JOURNEYS reviewer path drifted from config/journeys.json"
  });

  const hasFailures = checks.some((check) => check.status === "fail");
  const hasWarnings = checks.some((check) => check.status === "warn");
  const success = strict ? !hasFailures && !hasWarnings : !hasFailures;

  return {
    success,
    strict,
    checks,
    findings: {
      absolutePathFindings,
      reviewerVoteDocFindings
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
  if (Array.isArray(result.findings.reviewerVoteDocFindings) && result.findings.reviewerVoteDocFindings.length > 0) {
    console.log("Reviewer vote doc findings:");
    for (const finding of result.findings.reviewerVoteDocFindings) {
      console.log(`  - ${finding.file}: ${finding.snippet}`);
    }
  }
}

function envFlagEnabled(name) {
  const normalized = String(process.env[name] || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  throw new Error(`invalid_boolean_env:${name}`);
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
  const optionAliases = new Map([
    ["auth-state", "auth-state-file"],
    ["publish-auth-state", "publish-auth-state-file"]
  ]);

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
    const rawKey = (separator >= 0 ? trimmed.slice(0, separator) : trimmed).trim().toLowerCase();
    const key = optionAliases.get(rawKey) || rawKey;
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

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
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

function parseU8Option(rawValue, fieldName, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallback;
  }
  const normalized = String(rawValue).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`invalid_${fieldName}`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error(`invalid_${fieldName}`);
  }
  return parsed;
}

function parsePositiveBigIntOption(rawValue, fieldName) {
  const normalized = String(rawValue ?? "").trim();
  if (!normalized || !/^\d+$/.test(normalized)) {
    throw new Error(`invalid_${fieldName}`);
  }
  const parsed = BigInt(normalized);
  if (parsed <= 0n) {
    throw new Error(`invalid_${fieldName}`);
  }
  return parsed;
}

function parseOptionalIsoTimestamp(rawValue) {
  const normalized = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferManagedStorageMimeType(filePath, explicitValue = "") {
  const explicit = typeof explicitValue === "string" ? explicitValue.trim().toLowerCase() : "";
  if (explicit) {
    return explicit;
  }
  const extension = path.extname(String(filePath || "")).replace(/^\./, "").toLowerCase();
  return MANAGED_STORAGE_MIME_BY_EXTENSION[extension] || "";
}

function computeFileMetadata(targetPath, explicitMimeType = "") {
  const buffer = fs.readFileSync(targetPath);
  const fileName = path.basename(targetPath);
  const mimeType = inferManagedStorageMimeType(targetPath, explicitMimeType);
  if (!mimeType) {
    throw new Error("missing_mime_type");
  }
  return {
    fileName,
    mimeType,
    fileSizeBytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    buffer,
  };
}

function defaultManagedStorageFeeProofPath(orderId, milestoneId) {
  return path.resolve(process.cwd(), `clawnera-managed-storage-fee-${orderId}-${milestoneId}.json`);
}

function defaultManagedStoragePresignPath(orderId, milestoneId) {
  return path.resolve(process.cwd(), `clawnera-managed-storage-presign-${orderId}-${milestoneId}.json`);
}

function defaultManagedStorageUploadPath(orderId, milestoneId) {
  return path.resolve(process.cwd(), `clawnera-managed-storage-upload-${orderId}-${milestoneId}.json`);
}

function normalizeManagedStoragePaymentProof(input) {
  const candidate =
    input && typeof input === "object" && !Array.isArray(input) && input.paymentProof && typeof input.paymentProof === "object"
      ? input.paymentProof
      : input;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("invalid_payment_proof_file");
  }
  const txDigest = typeof candidate.txDigest === "string" ? candidate.txDigest.trim() : "";
  const amountAtomic = typeof candidate.amountAtomic === "string" ? candidate.amountAtomic.trim() : "";
  const asset = typeof candidate.asset === "string" ? candidate.asset.trim().toUpperCase() : "";
  const recipientAddress =
    typeof candidate.recipientAddress === "string" && candidate.recipientAddress.trim()
      ? normalizeIotaAddress(candidate.recipientAddress)
      : "";
  if (!txDigest || !amountAtomic || !/^[1-9][0-9]*$/.test(amountAtomic) || !asset) {
    throw new Error("invalid_payment_proof_file");
  }
  return {
    txDigest,
    amountAtomic,
    asset,
    recipientAddress: recipientAddress || undefined,
  };
}

function parseManagedStoragePresignBundle(input) {
  const record = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!record) {
    throw new Error("invalid_managed_storage_presign_file");
  }
  const signedUrl =
    typeof record?.response?.upload?.signedUrl === "string"
      ? record.response.upload.signedUrl.trim()
      : typeof record?.upload?.signedUrl === "string"
        ? record.upload.signedUrl.trim()
        : typeof record?.signedUrl === "string"
          ? record.signedUrl.trim()
          : "";
  const expiresAtRaw =
    typeof record?.response?.upload?.expiresAt === "string"
      ? record.response.upload.expiresAt
      : typeof record?.upload?.expiresAt === "string"
        ? record.upload.expiresAt
        : typeof record?.expiresAt === "string"
          ? record.expiresAt
          : "";
  const request = record.request && typeof record.request === "object" && !Array.isArray(record.request) ? record.request : {};
  return {
    signedUrl,
    expiresAt: expiresAtRaw || null,
    fileName: typeof request.fileName === "string" ? request.fileName.trim() : "",
    mimeType: typeof request.mimeType === "string" ? request.mimeType.trim().toLowerCase() : "",
    fileSizeBytes: Number.isInteger(request.fileSizeBytes) ? request.fileSizeBytes : null,
    sha256: typeof request.sha256 === "string" ? request.sha256.trim().toLowerCase() : "",
    orderId: typeof record.orderId === "string" ? record.orderId.trim() : "",
    milestoneId: typeof record.milestoneId === "string" ? record.milestoneId.trim() : "",
    raw: record,
  };
}

function parseSignedUploadPayload(rawBody) {
  const payload =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? rawBody
      : {};
  const data =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? payload.data
      : {};
  const cid = typeof payload.IpfsHash === "string"
    ? payload.IpfsHash.trim()
    : typeof data.cid === "string"
      ? data.cid.trim()
      : "";
  return {
    cid,
    ipfsUri: cid ? `ipfs://${cid}` : null,
    pinSize: Number.isFinite(payload.PinSize) ? payload.PinSize : Number.isFinite(data.size) ? data.size : null,
    timestamp: typeof payload.Timestamp === "string" ? payload.Timestamp : typeof data.created_at === "string" ? data.created_at : null,
    raw: payload,
  };
}

function parseCommaSeparatedIotaAddresses(rawValue, fieldName) {
  const normalized = String(rawValue ?? "").trim();
  if (!normalized) {
    throw new Error(`missing_${fieldName}`);
  }
  const parts = normalized
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const values = parts.map((entry) => normalizeIotaAddress(entry));
  if (values.length === 0 || values.some((entry) => !entry)) {
    throw new Error(`invalid_${fieldName}`);
  }
  return values;
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
  throw new Error(`invalid_boolean_option:${String(rawValue).trim()}`);
}

function parsePositiveMsHeader(rawHeaders, headerName) {
  const headers = rawHeaders && typeof rawHeaders === "object" ? rawHeaders : {};
  const rawValue = typeof headers[headerName] === "string" ? headers[headerName].trim() : "";
  if (!/^\d+$/.test(rawValue)) {
    return null;
  }
  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseRetryAfterMs(rawHeaders) {
  const headers = rawHeaders && typeof rawHeaders === "object" ? rawHeaders : {};
  const rawValue = typeof headers["retry-after"] === "string" ? headers["retry-after"].trim() : "";
  if (!rawValue) {
    return null;
  }
  if (/^\d+$/.test(rawValue)) {
    const seconds = Number(rawValue);
    return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds * 1000 : null;
  }
  const parsedDate = Date.parse(rawValue);
  if (!Number.isFinite(parsedDate)) {
    return null;
  }
  const deltaMs = parsedDate - Date.now();
  return deltaMs > 0 ? deltaMs : 0;
}

function extractResponseTimingHints(rawHeaders) {
  return {
    recommendedPollIntervalMs: parsePositiveMsHeader(rawHeaders, "x-clawdex-recommended-poll-interval-ms"),
    retryAfterMs: parseRetryAfterMs(rawHeaders),
  };
}

function parseListingMilestonesFromShorthand(rawValue) {
  const normalized = String(rawValue ?? "").trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.lastIndexOf(":");
      if (separator <= 0) {
        throw new Error("invalid_milestones");
      }
      const title = entry.slice(0, separator).trim();
      const amount = entry.slice(separator + 1).trim();
      if (!title || !/^[1-9][0-9]*$/.test(amount)) {
        throw new Error("invalid_milestones");
      }
      return {
        title,
        amount,
      };
    });
}

function parseListingMilestonesOptions(options = {}) {
  const inlineValue = typeof options.milestones === "string" ? options.milestones : "";
  const jsonValue = typeof options["milestones-json"] === "string" ? options["milestones-json"].trim() : "";
  const fileValue = resolveOptionalPathOption(options["milestones-file"]);
  const providedModes = [Boolean(inlineValue.trim()), Boolean(jsonValue), Boolean(fileValue)].filter(Boolean).length;
  if (providedModes !== 1) {
    throw new Error("exactly_one_milestones_input_required");
  }
  let milestones;
  if (inlineValue.trim()) {
    milestones = parseListingMilestonesFromShorthand(inlineValue);
  } else if (jsonValue) {
    milestones = JSON.parse(jsonValue);
  } else {
    milestones = JSON.parse(fs.readFileSync(fileValue, "utf8"));
  }
  if (!Array.isArray(milestones) || milestones.length === 0) {
    throw new Error("invalid_milestones");
  }
  return milestones.map((entry) => {
    const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : null;
    const title = typeof record?.title === "string" ? record.title.trim() : "";
    const amount = typeof record?.amount === "string" ? record.amount.trim() : "";
    if (!title || !/^[1-9][0-9]*$/.test(amount)) {
      throw new Error("invalid_milestones");
    }
    return { title, amount };
  });
}

function sumMilestoneAmounts(milestones = []) {
  return milestones.reduce((sum, milestone) => {
    return sum + BigInt(milestone.amount);
  }, 0n);
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
    const headers = {};
    for (const [key, value] of response.headers.entries()) {
      headers[String(key).toLowerCase()] = String(value);
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
      raw: text,
      headers
    };
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      return {
        ok: false,
        status: 0,
        body: null,
        raw: "",
        headers: {},
        error: "http_timeout"
      };
    }
    return {
      ok: false,
      status: 0,
      body: null,
      raw: "",
      headers: {},
      error: error instanceof Error ? error.message : "http_error"
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    "- If no selector is given, the active IOTA CLI address is used when available",
    "- Without the IOTA CLI, auth-login can still use the sole keystore entry automatically",
    "- Default network timeout: 60000ms (override with --timeout-ms <ms>)",
    "- Optional outputs: --state-out <file> --env-out <file>",
    "- Writes short-lived access token plus refresh token for long-lived runtimes",
    "- Use --state-out for mailbox notifiers or bots that should auto-refresh sessions"
  ];
}

function walletInitUsageLines() {
  return [
    "Wallet init helper:",
    "- Optional: --alias <wallet-alias>",
    `- Default keystore path: ${defaultIotaKeystorePath()}`,
    "- Creates a new local ED25519 keystore entry using the JS SDK",
    "- Does not require the IOTA CLI",
    "- Use this when you only need a wallet identity for auth/login in constrained environments"
  ];
}

function iotaActiveEnvUsageLines() {
  return [
    "IOTA active env helper:",
    `- Defaults to --network ${DEFAULT_IOTA_NETWORK}`,
    "- Optional: --rpc-url <url> to use a custom fullnode",
    `- Default keystore path: ${defaultIotaKeystorePath()}`,
    "- This is local-only and does not ask the Clawnera worker to execute anything",
  ];
}

function iotaGetBalanceUsageLines() {
  return [
    "IOTA balance helper:",
    `- Defaults to --network ${DEFAULT_IOTA_NETWORK}`,
    `- Defaults to local keystore path ${defaultIotaKeystorePath()}`,
    "- Optional selector: --alias <wallet-alias> or --address <wallet-address>",
    "- Optional: --coin-type <type> --with-coins",
    "- Reads local wallet balances via the IOTA SDK on the user machine",
  ];
}

function iotaGetGasUsageLines() {
  return [
    "IOTA gas helper:",
    `- Defaults to --network ${DEFAULT_IOTA_NETWORK}`,
    `- Defaults to local keystore path ${defaultIotaKeystorePath()}`,
    "- Optional selector: --alias <wallet-alias> or --address <wallet-address>",
    `- Returns coin objects for ${IOTA_COIN_TYPE}`,
  ];
}

function iotaPrepareTransferUsageLines() {
  return [
    "IOTA prepare transfer helper:",
    "- Required: --recipient <0x...> --amount-nanos <int> --input-coins <coinId[,coinId...]>",
    `- Defaults to --network ${DEFAULT_IOTA_NETWORK}`,
    `- Draft file default: ${defaultIotaTransferDraftsPath()}`,
    "- Optional selector: --alias <wallet-alias> or --address <wallet-address>",
    "- Optional: --gas-budget <int> --ttl-sec <int> --drafts-file <file> --rpc-url <url>",
    "- Builds tx bytes locally on the user machine and stores a reusable draft for dry-run/execute",
  ];
}

function iotaDryRunTransferUsageLines() {
  return [
    "IOTA dry-run transfer helper:",
    "- Required: --draft-id <id>",
    `- Draft file default: ${defaultIotaTransferDraftsPath()}`,
    "- Replays a prepared local transfer draft against the selected IOTA RPC without broadcasting",
  ];
}

function iotaExecuteTransferUsageLines() {
  return [
    "IOTA execute transfer helper:",
    "- Required: --draft-id <id>",
    `- Draft file default: ${defaultIotaTransferDraftsPath()}`,
    "- Optional local signer selector: --signer-address <0x...> or --signer-alias <alias>",
    "- Optional: --signature <base64> to execute a pre-signed tx instead of signing locally",
    "- Signs and broadcasts locally on the user machine; the Clawnera worker does not custody user keys",
    "- The returned tx_digest is the canonical handle for later on-chain readback",
  ];
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\"'\"'`)}'`;
}

function bufferFromHex(value, fieldName) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-f0-9]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`invalid_${fieldName}`);
  }
  return Buffer.from(normalized, "hex");
}

function normalizeReviewerVoteValue(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "0" || normalized === "buyer") {
    return 0;
  }
  if (normalized === "1" || normalized === "seller") {
    return 1;
  }
  throw new Error("invalid_vote");
}

function computeReviewerVoteCommitHashHex(caseId, reviewerAddress, vote, nonceHex) {
  const normalizedCaseId = normalizeIotaAddress(caseId);
  const normalizedReviewerAddress = normalizeIotaAddress(reviewerAddress);
  if (!normalizedCaseId) {
    throw new Error("invalid_case_id");
  }
  if (!normalizedReviewerAddress) {
    throw new Error("invalid_reviewer_address");
  }
  const caseBytes = Buffer.from(normalizedCaseId.slice(2), "hex");
  const reviewerBytes = Buffer.from(normalizedReviewerAddress.slice(2), "hex");
  const nonceBytes = bufferFromHex(nonceHex, "nonce_hex");
  const payload = Buffer.concat([Buffer.from([vote]), caseBytes, reviewerBytes, nonceBytes]);
  return createHash("sha256").update(payload).digest("hex");
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
  const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 60_000);
  const iotaCliPath = String(options["iota-cli"] || process.env.IOTA_CLI_PATH || "iota").trim() || "iota";

  try {
    const entries = await loadKeystoreEntries(keystorePath);
    if (!address && !alias) {
      const activeAddress = detectActiveAddressViaCli(iotaCliPath, timeoutMs);
      if (activeAddress.ok && activeAddress.address) {
        address = activeAddress.address;
      } else if (entries.length === 1) {
        address = entries[0].address;
      } else {
        return {
          ok: false,
          error: activeAddress.error || "missing_wallet_selector",
          hint:
            entries.length > 1
              ? "set --alias or --address when multiple keystore entries exist and no active IOTA CLI address is configured"
              : "set --alias or --address, or create a local keystore entry with `clawnera-help wallet-init`"
        };
      }
    }

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
      writeTextFile(envOut, buildAuthEnvText(authState), 0o600);
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

async function runWalletInit(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: walletInitUsageLines()
    };
  }

  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals
    };
  }

  const alias = typeof options.alias === "string" ? String(options.alias).trim() : "";
  const keystorePath =
    typeof options["keystore-path"] === "string" && options["keystore-path"].trim()
      ? path.resolve(String(options["keystore-path"]).trim())
      : defaultIotaKeystorePath();

  try {
    const created = await appendEd25519KeystoreEntry(keystorePath, alias);
    return {
      ok: true,
      address: created.address,
      alias: created.alias,
      keystorePath: created.keystorePath
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "wallet_init_failed",
      keystorePath
    };
  }
}

async function runIotaActiveEnv(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: iotaActiveEnvUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  try {
    return {
      ok: true,
      ...(await getIotaActiveEnv({
        network: options.network,
        rpcUrl: options["rpc-url"],
        keystorePath:
          typeof options["keystore-path"] === "string" && options["keystore-path"].trim()
            ? path.resolve(String(options["keystore-path"]).trim())
            : defaultIotaKeystorePath(),
      })),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "iota_active_env_failed",
    };
  }
}

async function runIotaGetBalance(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: iotaGetBalanceUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  try {
    return {
      ok: true,
      ...(await getIotaBalance({
        network: options.network,
        rpcUrl: options["rpc-url"],
        keystorePath:
          typeof options["keystore-path"] === "string" && options["keystore-path"].trim()
            ? path.resolve(String(options["keystore-path"]).trim())
            : defaultIotaKeystorePath(),
        alias: typeof options.alias === "string" ? options.alias.trim() : "",
        address: typeof options.address === "string" ? options.address.trim() : "",
        coinType: typeof options["coin-type"] === "string" ? options["coin-type"].trim() : "",
        withCoins: parseBooleanOption(options["with-coins"], false),
      })),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "iota_get_balance_failed",
    };
  }
}

async function runIotaGetGas(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: iotaGetGasUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  try {
    return {
      ok: true,
      ...(await getIotaGas({
        network: options.network,
        rpcUrl: options["rpc-url"],
        keystorePath:
          typeof options["keystore-path"] === "string" && options["keystore-path"].trim()
            ? path.resolve(String(options["keystore-path"]).trim())
            : defaultIotaKeystorePath(),
        alias: typeof options.alias === "string" ? options.alias.trim() : "",
        address: typeof options.address === "string" ? options.address.trim() : "",
      })),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "iota_get_gas_failed",
    };
  }
}

async function runIotaPrepareTransfer(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: iotaPrepareTransferUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  try {
    const draftsPath =
      typeof options["drafts-file"] === "string" && options["drafts-file"].trim()
        ? path.resolve(String(options["drafts-file"]).trim())
        : defaultIotaTransferDraftsPath();
    const ttlSec = parsePositiveIntOption(options["ttl-sec"], "ttl_sec", DEFAULT_TRANSFER_DRAFT_TTL_SEC);
    const prepared = await prepareIotaTransfer({
      network: options.network,
      rpcUrl: options["rpc-url"],
      keystorePath:
        typeof options["keystore-path"] === "string" && options["keystore-path"].trim()
          ? path.resolve(String(options["keystore-path"]).trim())
          : defaultIotaKeystorePath(),
      alias: typeof options.alias === "string" ? options.alias.trim() : "",
      address: typeof options.address === "string" ? options.address.trim() : "",
      recipient: normalizeIotaAddress(options.recipient),
      amountNanos: parsePositiveBigIntOption(options["amount-nanos"], "amount_nanos"),
      inputCoins: parseCommaSeparatedIotaAddresses(options["input-coins"], "input_coins"),
      gasBudget:
        options["gas-budget"] === undefined || options["gas-budget"] === null || options["gas-budget"] === ""
          ? undefined
          : parsePositiveIntOption(options["gas-budget"], "gas_budget", 0),
    });

    const nowMs = Date.now();
    const draft = {
      id: randomUUID(),
      kind: "iota_transfer",
      createdAt: nowMs,
      expiresAt: nowMs + ttlSec * 1000,
      recipient: normalizeIotaAddress(options.recipient),
      amountNanos: String(parsePositiveBigIntOption(options["amount-nanos"], "amount_nanos")),
      inputCoins: parseCommaSeparatedIotaAddresses(options["input-coins"], "input_coins"),
      gasBudget:
        options["gas-budget"] === undefined || options["gas-budget"] === null || options["gas-budget"] === ""
          ? null
          : parsePositiveIntOption(options["gas-budget"], "gas_budget", 0),
      signerAddress: prepared.signerAddress,
      txBytesB64: prepared.txBytesB64,
      decodedTx: prepared.decodedTx,
      network: prepared.network,
      rpcUrl: prepared.rpcUrl,
    };

    await saveIotaTransferDraft(draftsPath, draft);
    return {
      ok: true,
      draft,
      draftsPath,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "iota_prepare_transfer_failed",
    };
  }
}

async function runIotaDryRunTransfer(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: iotaDryRunTransferUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  try {
    const draftId = typeof options["draft-id"] === "string" ? options["draft-id"].trim() : "";
    if (!draftId) {
      throw new Error("missing_draft_id");
    }
    const draftsPath =
      typeof options["drafts-file"] === "string" && options["drafts-file"].trim()
        ? path.resolve(String(options["drafts-file"]).trim())
        : defaultIotaTransferDraftsPath();
    const draft = await loadIotaTransferDraft(draftsPath, draftId);
    const result = await dryRunIotaTransfer({
      network: draft.network,
      rpcUrl: draft.rpcUrl,
      txBytesB64: draft.txBytesB64,
    });
    return {
      ok: true,
      draftId,
      draftsPath,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "iota_dry_run_transfer_failed",
    };
  }
}

async function runIotaExecuteTransfer(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: iotaExecuteTransferUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  try {
    const draftId = typeof options["draft-id"] === "string" ? options["draft-id"].trim() : "";
    if (!draftId) {
      throw new Error("missing_draft_id");
    }
    const draftsPath =
      typeof options["drafts-file"] === "string" && options["drafts-file"].trim()
        ? path.resolve(String(options["drafts-file"]).trim())
        : defaultIotaTransferDraftsPath();
    const draft = await loadIotaTransferDraft(draftsPath, draftId);
    const result = await executeIotaTransfer({
      network: draft.network,
      rpcUrl: draft.rpcUrl,
      txBytesB64: draft.txBytesB64,
      keystorePath:
        typeof options["keystore-path"] === "string" && options["keystore-path"].trim()
          ? path.resolve(String(options["keystore-path"]).trim())
          : defaultIotaKeystorePath(),
      address: typeof options["signer-address"] === "string" ? options["signer-address"].trim() : draft.signerAddress,
      alias: typeof options["signer-alias"] === "string" ? options["signer-alias"].trim() : "",
      signerAddress: draft.signerAddress,
      signature: typeof options.signature === "string" ? options.signature.trim() : "",
    });
    await deleteIotaTransferDraft(draftsPath, draftId);
    return {
      ok: true,
      draftId,
      draftsPath,
      txDigest: result?.result?.digest || result?.result?.effects?.transactionDigest || null,
      signerAddress: result?.verifyResult?.signerAddress || draft.signerAddress,
      result: result.result,
      signature: result.signature,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "iota_execute_transfer_failed",
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
    "- Fresh login without --state-out writes to a preset-scoped default auth state file.",
    "- Passing --event-types without --preset uses custom-only events; --preset custom is also supported explicitly",
    "- List presets: clawnera-help notifications presets",
    "- Check local config: clawnera-help notifications doctor",
    "- Runtime auth precedence: valid CLAWNERA_API_JWT wins; invalid env auth fails unless CLAWNERA_NOTIFY_ALLOW_AUTH_STATE_FALLBACK=1 is set",
    "- Default preset: seller",
    "- Default files:",
    `  auth state: ${defaultAuthStatePath()}`,
    `  seller auth: ${defaultNotificationAuthStatePath(undefined, sellerPreset)}`,
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
  const resolvedPath = path.resolve(targetPath);
  const tempFile = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(tempFile, content, { mode });
  fs.chmodSync(tempFile, mode);
  fs.renameSync(tempFile, resolvedPath);
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
    let commentIndex = -1;
    let quote = "";
    for (let index = 0; index < valuePart.length; index += 1) {
      const char = valuePart[index];
      if ((char === '"' || char === "'") && (index === 0 || valuePart[index - 1] !== "\\")) {
        quote = quote === char ? "" : quote ? quote : char;
        continue;
      }
      if (!quote && char === "#" && index > 0 && /\s/.test(valuePart[index - 1] || "")) {
        commentIndex = index;
        break;
      }
    }
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

function resolveOptionalPathOption(rawValue) {
  return typeof rawValue === "string" && rawValue.trim() ? path.resolve(String(rawValue).trim()) : "";
}

function inferHomeDirFromAuthStatePath(authStateFile) {
  const resolved = resolveOptionalPathOption(authStateFile);
  if (!resolved) {
    return "";
  }
  const normalized = resolved.split(path.sep).join("/");
  const marker = "/.config/clawnera/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex <= 0) {
    return "";
  }
  return path.resolve(normalized.slice(0, markerIndex));
}

function resolvePreferredKeystorePath(options = {}, context = {}) {
  const explicitPath = resolveOptionalPathOption(options["keystore-path"]);
  if (explicitPath) {
    return explicitPath;
  }
  const inferredHome = inferHomeDirFromAuthStatePath(context?.authStateFile || "");
  if (inferredHome) {
    const inferredKeystorePath = defaultIotaKeystorePath(inferredHome);
    if (fs.existsSync(inferredKeystorePath)) {
      return inferredKeystorePath;
    }
  }
  return defaultIotaKeystorePath();
}

async function resolveApiRuntimeContext(options = {}) {
  const envFile = resolveOptionalPathOption(options["env-file"]);
  const authStateFile = resolveOptionalPathOption(options["auth-state-file"]);
  const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 8_000);
  const explicitApiBase = normalizeApiBase(options["api-base"] || process.env.CLAWNERA_API_BASE_URL);
  const explicitJwt =
    typeof options.jwt === "string" ? String(options.jwt).trim() : String(process.env.CLAWNERA_API_JWT || "").trim();
  let envValues = {};
  let authState = null;
  let authStateRefreshed = false;

  if (envFile) {
    if (!fs.existsSync(envFile)) {
      throw new Error("missing_env_file");
    }
    envValues = parseSimpleEnvFile(fs.readFileSync(envFile, "utf8"));
  }

  if (authStateFile) {
    if (!fs.existsSync(authStateFile)) {
      throw new Error("missing_auth_state_file");
    }
    authState = await loadAuthState(authStateFile);
    const apiBaseForValidation =
      explicitApiBase ||
      normalizeApiBase(envValues.CLAWNERA_API_BASE_URL || process.env.CLAWNERA_API_BASE_URL || authState.apiBase) ||
      DEFAULT_CLAWNERA_API_BASE;
    let authValidation = validateRuntimeAuthState(authState, {
      apiBaseFallback: apiBaseForValidation,
      requiredApiBase: explicitApiBase || "",
      refreshSkewMs: 60_000
    });
    const shouldTryRefresh =
      authState.refreshToken &&
      apiBaseForValidation &&
      authValidation.issues.length > 0 &&
      authValidation.issues.every((issue) =>
        ["missing_or_invalid_auth_token", "invalid_auth_token_format", "expired_auth_no_refresh"].includes(issue)
      );
    if (!authValidation.ok && shouldTryRefresh) {
      authState = await refreshAuthState({
        apiBase: apiBaseForValidation,
        authState,
        timeoutMs
      });
      await saveAuthState(authStateFile, authState);
      authStateRefreshed = true;
      authValidation = validateRuntimeAuthState(authState, {
        apiBaseFallback: apiBaseForValidation,
        requiredApiBase: explicitApiBase || "",
        refreshSkewMs: 60_000
      });
    }
    if (!authValidation.ok) {
      throw new Error(authValidation.issues[0] || "invalid_auth_state");
    }
    authState = authValidation.authState;
  }

  const apiBase =
    explicitApiBase ||
    normalizeApiBase(envValues.CLAWNERA_API_BASE_URL || process.env.CLAWNERA_API_BASE_URL) ||
    authState?.apiBase ||
    DEFAULT_CLAWNERA_API_BASE ||
    null;
  const jwt = explicitJwt || String(envValues.CLAWNERA_API_JWT || "").trim() || authState?.token || "";

  return {
    apiBase,
    jwt,
    envFile: envFile || null,
    envValues,
    authStateFile: authStateFile || null,
    authState,
    authStateRefreshed
  };
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
      let stateValidation = null;
      if (!hasAuthStateFile && !hasJwt && !hasRefreshToken) {
        issues.push("missing_auth_source");
      }
      if (hasAuthStateFile) {
        const authStatePath = path.resolve(envValues.CLAWNERA_AUTH_STATE_FILE);
        if (!fs.existsSync(authStatePath)) {
          stateValidation = {
            ok: false,
            issues: ["missing_auth_state_file"]
          };
        } else {
          try {
            const authState = await loadAuthState(authStatePath);
            stateValidation = validateRuntimeAuthState(authState, {
              apiBaseFallback: envValues.CLAWNERA_API_BASE_URL,
              requiredApiBase: envValues.CLAWNERA_API_BASE_URL,
              refreshSkewMs: DEFAULT_NOTIFICATION_REFRESH_SKEW_MS
            });
            if (!resolvedApiBase && stateValidation.authState.apiBase) {
              resolvedApiBase = stateValidation.authState.apiBase;
            }
          } catch {
            stateValidation = {
              ok: false,
              issues: ["invalid_auth_state_file"]
            };
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
      } else if (stateValidation) {
        issues.push(...stateValidation.issues);
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
    alias || address
      ? authStateOutputFile || defaultNotificationAuthStatePath(undefined, artifactLabel)
      : authStateInputFile || defaultAuthStatePath();
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
  if ((alias || address) && authStateInputFile) {
    return {
      ok: false,
      error: "notifications_auth_state_file_reuse_only",
      hint: "use --auth-state-file only to reuse an existing auth state, or use --state-out (or omit it for the preset default path) when init should create a fresh auth state"
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

async function runWalletList(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: walletListUsageLines()
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals
    };
  }

  const keystorePath = resolveOptionalPathOption(options["keystore-path"]) || defaultIotaKeystorePath();
  const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 5_000);
  const iotaCliPath = String(options["iota-cli"] || process.env.IOTA_CLI_PATH || "iota").trim() || "iota";

  try {
    const entries = await loadKeystoreEntries(keystorePath);
    const activeAddressResult = detectActiveAddressViaCli(iotaCliPath, timeoutMs);
    const activeCliAddress =
      activeAddressResult.ok && activeAddressResult.address ? normalizeIotaAddress(activeAddressResult.address) : "";
    return {
      ok: true,
      keystorePath,
      entryCount: entries.length,
      activeCliAddress: activeCliAddress || null,
      activeCliAddressDetected: Boolean(activeCliAddress),
      entries: entries.map((entry) => ({
        alias: entry.alias || null,
        address: entry.address,
        active: Boolean(activeCliAddress && normalizeIotaAddress(entry.address) === activeCliAddress)
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "wallet_list_failed"
    };
  }
}

function parseApiMethodPath(positionals) {
  if (positionals.length < 2) {
    throw new Error("missing_request_method_or_path");
  }

  const method = String(positionals[0] || "").trim().toUpperCase();
  const rawPath = String(positionals[1] || "").trim();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new Error("invalid_request_method");
  }
  if (!rawPath) {
    throw new Error("missing_request_path");
  }
  return { method, rawPath };
}

function resolveBodySelectionPath(jsonBody, selector) {
  const selection = String(selector || "").trim();
  if (!selection) {
    return jsonBody;
  }
  const segments = selection
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return jsonBody;
  }
  let current = jsonBody;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
      throw new Error(`body_select_not_found:${selection}`);
    }
    current = current[segment];
  }
  return current;
}

function loadApiRequestBody(options = {}) {
  const bodyFile = resolveOptionalPathOption(options["body-file"]);
  const bodySelect = typeof options["body-select"] === "string" ? options["body-select"].trim() : "";
  const bodyRaw =
    typeof options.body === "string" && options.body.trim()
      ? options.body
      : bodyFile
        ? fs.readFileSync(bodyFile, "utf8")
        : "";
  let body = "";
  let jsonBody = null;
  if (bodyRaw) {
    jsonBody = JSON.parse(bodyRaw);
    jsonBody = resolveBodySelectionPath(jsonBody, bodySelect);
    body = JSON.stringify(jsonBody);
  }
  return { body, jsonBody, bodyFile: bodyFile || null, bodySelect: bodySelect || null };
}

async function callApiRoute({ method, rawPath, options = {}, timeoutMs = 20_000 }) {
  if (normalizeApiBase(rawPath)) {
    throw new Error("absolute_api_url_not_allowed");
  }
  const context = await resolveApiRuntimeContext({
    ...options,
    "timeout-ms": timeoutMs
  });
  const runtimeContext = { ...context };
  const { body, jsonBody, bodyFile, bodySelect } = loadApiRequestBody(options);
  const apiBase = runtimeContext.apiBase;
  if (!apiBase) {
    throw new Error("missing_or_invalid_api_base");
  }

  const idempotencyMode =
    typeof options["idempotency-key"] === "string" && options["idempotency-key"].trim()
      ? String(options["idempotency-key"]).trim()
      : ["POST", "PUT", "PATCH"].includes(method)
        ? "auto"
        : "";
  const idempotencyKey = idempotencyMode === "auto" ? randomUUID() : idempotencyMode;
  const url = `${apiBase}${rawPath.startsWith("/") ? rawPath : `/${rawPath}`}`;
  const buildHeaders = () => {
    const headers = {};
    if (runtimeContext.jwt) {
      headers.authorization = `Bearer ${runtimeContext.jwt}`;
    }
    if (body) {
      headers["content-type"] = "application/json";
    }
    if (idempotencyKey) {
      headers["idempotency-key"] = idempotencyKey;
    }
    return headers;
  };

  let result = await requestJson(
    url,
    {
      method,
      headers: buildHeaders(),
      ...(body ? { body } : {})
    },
    timeoutMs
  );

  const shouldRetryInvalidToken =
    result.status === 401 &&
    runtimeContext.authStateFile &&
    runtimeContext.authState?.refreshToken &&
    !runtimeContext.authStateRefreshed &&
    result.body &&
    typeof result.body === "object" &&
    !Array.isArray(result.body) &&
    result.body.error === "invalid_token" &&
    !options.jwt;

  if (shouldRetryInvalidToken) {
    const refreshedAuthState = await refreshAuthState({
      apiBase: apiBase || normalizeApiBase(rawPath),
      authState: runtimeContext.authState,
      timeoutMs,
    });
    await saveAuthState(runtimeContext.authStateFile, refreshedAuthState);
    runtimeContext.authState = refreshedAuthState;
    runtimeContext.jwt = refreshedAuthState.token;
    runtimeContext.authStateRefreshed = true;
    result = await requestJson(
      url,
      {
        method,
        headers: buildHeaders(),
        ...(body ? { body } : {})
      },
      timeoutMs
    );
  }

  return {
    context: runtimeContext,
    apiBase: apiBase || normalizeApiBase(rawPath),
    idempotencyKey: idempotencyKey || null,
    method,
    rawPath,
    url,
    body,
    jsonBody,
    bodyFile,
    bodySelect,
    result,
  };
}

function detectTxPlanPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const txBuilder = typeof body.txBuilder === "string" ? body.txBuilder.trim() : "";
  const request = body.request;
  if (!txBuilder || !request || typeof request !== "object" || Array.isArray(request)) {
    return null;
  }
  return {
    txBuilder,
    request,
    inviteBinding:
      body.inviteBinding && typeof body.inviteBinding === "object" && !Array.isArray(body.inviteBinding)
        ? body.inviteBinding
        : null,
    txMoveCall: body.txMoveCall ?? null,
  };
}

function resolveTxExecutionDigest(executed) {
  return typeof executed?.result?.digest === "string" && executed.result.digest.trim()
    ? executed.result.digest.trim()
    : typeof executed?.digest === "string" && executed.digest.trim()
      ? executed.digest.trim()
      : null;
}

function resolveDisputeCaseObjectIdForInviteBinding(txPlan, executed) {
  const requestDisputeCaseObjectId = normalizeIotaAddress(txPlan?.request?.disputeCaseObjectId || "");
  if (requestDisputeCaseObjectId) {
    return requestDisputeCaseObjectId;
  }
  return (
    extractCreatedObjectIdByTypeSuffix(executed, "::dispute_quorum::MilestoneDisputeCase") ||
    extractCreatedObjectIdByTypeFragment(executed, "::dispute_quorum::MilestoneDisputeCase") ||
    null
  );
}

function resolveRuntimeSigner(options = {}, context = {}) {
  const keystorePath = resolvePreferredKeystorePath(options, context);
  const explicitAlias = typeof options.alias === "string" ? options.alias.trim() : "";
  const explicitAddress = normalizeIotaAddress(options.address || "");
  const envAlias =
    typeof context?.envValues?.CLAWNERA_API_ADDRESS_ALIAS === "string"
      ? context.envValues.CLAWNERA_API_ADDRESS_ALIAS.trim()
      : "";
  const authAlias = typeof context?.authState?.alias === "string" ? context.authState.alias.trim() : "";
  const authAddress = normalizeIotaAddress(context?.authState?.address || context?.envValues?.CLAWNERA_API_ADDRESS || "");
  return {
    keystorePath,
    alias: explicitAlias || envAlias || authAlias || null,
    address: explicitAddress || authAddress || null,
  };
}

async function resolveRuntimeSignerEntry(options = {}, context = {}) {
  const signer = resolveRuntimeSigner(options, context);
  const entries = await loadKeystoreEntries(signer.keystorePath);
  if (entries.length === 0) {
    throw new Error("no_local_keystore_entries");
  }
  const selected = resolveKeystoreEntry(entries, { address: signer.address, alias: signer.alias });
  if (!selected) {
    throw new Error("keystore_entry_not_found");
  }
  const keypair = await keypairFromSecretKey(selected.secretKey);
  return {
    ...signer,
    entry: selected,
    keypair,
  };
}

function readJsonFileSync(targetPath, errorCode) {
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8"));
  } catch (error) {
    throw new Error(errorCode || (error instanceof Error ? error.message : "json_read_failed"));
  }
}

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function normalizeSha256HashOption(rawValue, fieldName) {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  if (!normalized) {
    throw new Error(`missing_${fieldName}`);
  }
  const withoutPrefix = normalized.startsWith("sha256:") ? normalized.slice("sha256:".length) : normalized;
  return assertLowerHex64(withoutPrefix, fieldName);
}

function resolveKeyAgreementRecordPathOption(address, keyVersion, value, authStateFile = "") {
  if (typeof value === "string" && value.trim()) {
    return path.resolve(value.trim());
  }
  const inferredHome = inferHomeDirFromAuthStatePath(authStateFile);
  return defaultKeyAgreementRecordPath(address, keyVersion, inferredHome || undefined);
}

function buildTxPlanNextCommandHint(method, rawPath, { body, bodyFile, bodySelect } = {}) {
  const parts = ["clawnera-help", "tx-plan-execute", method, shellQuote(rawPath)];
  if (bodyFile) {
    parts.push("--body-file", shellQuote(bodyFile));
    if (bodySelect) {
      parts.push("--body-select", shellQuote(bodySelect));
    }
  } else if (body) {
    parts.push("--body", shellQuote(body));
  }
  return parts.join(" ");
}

function resolveApiPathname(rawPath, apiBase = "") {
  try {
    const url = normalizeApiBase(rawPath)
      ? rawPath
      : `${apiBase}${String(rawPath || "").startsWith("/") ? rawPath : `/${rawPath}`}`;
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function classifyReviewerSelfTxPlanRoute(method, rawPath, apiBase = "") {
  if (String(method || "").toUpperCase() !== "POST") {
    return null;
  }
  const pathname = resolveApiPathname(rawPath, apiBase);
  if (!pathname) {
    return null;
  }
  const acceptMatch = pathname.match(/^\/disputes\/(0x[a-f0-9]+)\/reviewers\/accept$/i);
  if (acceptMatch) {
    return {
      kind: "accept",
      disputeCaseId: normalizeIotaAddress(acceptMatch[1] || ""),
    };
  }
  const commitMatch = pathname.match(/^\/disputes\/(0x[a-f0-9]+)\/votes\/commit$/i);
  if (commitMatch) {
    return {
      kind: "commit",
      disputeCaseId: normalizeIotaAddress(commitMatch[1] || ""),
    };
  }
  const revealMatch = pathname.match(/^\/disputes\/(0x[a-f0-9]+)\/votes\/reveal$/i);
  if (revealMatch) {
    return {
      kind: "reveal",
      disputeCaseId: normalizeIotaAddress(revealMatch[1] || ""),
    };
  }
  const claimMetricsMatch = pathname.match(/^\/reviewers\/(0x[a-f0-9]+)\/claim-metrics$/i);
  if (claimMetricsMatch) {
    return {
      kind: "claim_metrics",
      reviewerAddress: normalizeIotaAddress(claimMetricsMatch[1] || ""),
    };
  }
  return null;
}

function resolveClaimMetricsDisputeCaseCandidate(invitesBody, reviewerAddress) {
  const reviewer = normalizeIotaAddress(reviewerAddress || "");
  const inviteList = Array.isArray(invitesBody?.invites) ? invitesBody.invites : [];
  const closedStatuses = new Set(["closed"]);
  const candidates = [];
  for (const entry of inviteList) {
    const invite = asRecord(entry);
    if (!invite) {
      continue;
    }
    const inviteReviewer = normalizeIotaAddress(invite.reviewerAddress || "");
    if (!inviteReviewer || (reviewer && inviteReviewer !== reviewer)) {
      continue;
    }
    const inviteStatus = typeof invite.status === "string" ? invite.status.toLowerCase() : "";
    if (!closedStatuses.has(inviteStatus)) {
      continue;
    }
    const disputeCaseObjectId = normalizeIotaAddress(invite.disputeCaseObjectId || "");
    if (!disputeCaseObjectId) {
      continue;
    }
    const disputeCase = asRecord(invite.disputeCase);
    const closedAtMs = Number(disputeCase?.closedAtMs || 0);
    const invitedAtMs = Number(invite.invitedAtMs || 0);
    candidates.push({
      disputeCaseObjectId,
      closedAtMs: Number.isFinite(closedAtMs) ? closedAtMs : 0,
      invitedAtMs: Number.isFinite(invitedAtMs) ? invitedAtMs : 0,
    });
  }
  const uniqueCandidateIds = [...new Set(candidates.map((candidate) => candidate.disputeCaseObjectId))];
  if (uniqueCandidateIds.length !== 1) {
    return {
      ok: false,
      disputeCaseObjectIds: uniqueCandidateIds,
    };
  }
  const bestCandidate = candidates
    .filter((candidate) => candidate.disputeCaseObjectId === uniqueCandidateIds[0])
    .sort((left, right) => (right.closedAtMs - left.closedAtMs) || (right.invitedAtMs - left.invitedAtMs))[0];
  return {
    ok: true,
    disputeCaseObjectId: bestCandidate?.disputeCaseObjectId || uniqueCandidateIds[0],
  };
}

function buildClaimMetricsDisputeCaseHint(rawPath, disputeCaseObjectIds = []) {
  const normalizedPath = typeof rawPath === "string" && rawPath.trim() ? rawPath.trim() : "/reviewers/<reviewer-address>/claim-metrics";
  const candidateSuffix =
    Array.isArray(disputeCaseObjectIds) && disputeCaseObjectIds.length > 0
      ? ` Candidate disputeCaseObjectIds: ${disputeCaseObjectIds.join(", ")}.`
      : "";
  return `Read GET /reviewers/me/invites, choose the correct closed disputeCaseObjectId, then rerun clawnera-help tx-plan-execute POST '${normalizedPath}' --auth-state-file <reviewer-auth-state-file> --body '{\"disputeCaseObjectId\":\"<closed-dispute-case-id>\"}'.${candidateSuffix}`;
}

function reviewerSelfRouteNeedsHydration(route, currentBody) {
  if (!route) {
    return false;
  }
  const body = asRecord(currentBody) || {};
  if (route.kind === "accept") {
    return !normalizeIotaAddress(body.reviewerRegistryObjectId || "") ||
      !normalizeIotaAddress(body.reviewerEntryObjectId || "") ||
      !normalizeIotaAddress(body.reputationProfileObjectId || "") ||
      !normalizeIotaAddress(body.disputeQuorumConfigObjectId || "");
  }
  if (route.kind === "commit" || route.kind === "reveal") {
    return !normalizeIotaAddress(body.reviewerEntryObjectId || "");
  }
  if (route.kind === "claim_metrics") {
    return !normalizeIotaAddress(body.disputeCaseObjectId || "") ||
      !normalizeIotaAddress(body.reviewerRegistryObjectId || "") ||
      !normalizeIotaAddress(body.reviewerEntryObjectId || "") ||
      !normalizeIotaAddress(body.disputeQuorumConfigObjectId || "");
  }
  return false;
}

function buildJsonBodyOverrideOptions(options, mergedBody) {
  const nextOptions = { ...options, body: JSON.stringify(mergedBody) };
  delete nextOptions["body-file"];
  delete nextOptions["body-select"];
  return nextOptions;
}

async function hydrateReviewerSelfTxPlanRequest({ method, rawPath, options, timeoutMs, currentBody, apiBase }) {
  const route = classifyReviewerSelfTxPlanRoute(method, rawPath, apiBase);
  if (!route || !reviewerSelfRouteNeedsHydration(route, currentBody)) {
    return null;
  }
  const helperOptions = { ...options };
  delete helperOptions.body;
  delete helperOptions["body-file"];
  delete helperOptions["body-select"];
  delete helperOptions["idempotency-key"];
  const metricsCall = await callApiRoute({
    method: "GET",
    rawPath: "/reviewers/me/metrics",
    options: helperOptions,
    timeoutMs,
  });
  if (!metricsCall.result.ok) {
    return {
      ok: false,
      error: "reviewer_self_context_lookup_failed",
      metricsStatus: metricsCall.result.status,
      metricsResponse: metricsCall.result.body,
    };
  }
  const reviewer = asRecord(metricsCall.result.body?.reviewer);
  const reviewerRuntime = asRecord(metricsCall.result.body?.runtime);
  if (metricsCall.result.body?.registered !== true || !reviewer) {
    return {
      ok: false,
      error: "reviewer_not_registered",
    };
  }
  const reviewerEntryObjectId = normalizeIotaAddress(reviewer.objectId || "");
  const reviewerOwnerAddress =
    normalizeIotaAddress(metricsCall.result.body?.reviewerAddress || "") || normalizeIotaAddress(reviewer.owner || "");
  if (!reviewerEntryObjectId) {
    return {
      ok: false,
      error: "reviewer_entry_object_missing",
    };
  }
  const mergedBody = { ...(asRecord(currentBody) || {}) };
  let reviewerRegistryObjectIdHint = normalizeIotaAddress(reviewerRuntime?.reviewerRegistryObjectId || "");
  let disputeQuorumConfigObjectIdHint = normalizeIotaAddress(reviewerRuntime?.disputeQuorumConfigObjectId || "");
  let resolvedReputationProfileObjectId = "";
  if (route.kind === "accept") {
    const { chainConfig } = await fetchPolicyAndChainConfig(helperOptions, {
      requireDisputeQuorumConfig: true,
      requireEscrowFeeConfig: false,
      requireGovernanceConfig: false,
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    reviewerRegistryObjectIdHint = reviewerRegistryObjectIdHint || chainConfig.reviewerRegistryObjectId || "";
    disputeQuorumConfigObjectIdHint = disputeQuorumConfigObjectIdHint || chainConfig.disputeQuorumConfigObjectId;
    resolvedReputationProfileObjectId = normalizeIotaAddress(metricsCall.result.body?.reputationProfileObjectId || "");
    if (!resolvedReputationProfileObjectId) {
      try {
        resolvedReputationProfileObjectId = await resolveClawdexReputationProfileObjectIdByOwner({
          packageId: chainConfig.packageId,
          ownerAddress: reviewerOwnerAddress,
          disputeQuorumConfigObjectId: disputeQuorumConfigObjectIdHint,
          network: options.network,
          rpcUrl: options["rpc-url"],
        });
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "reviewer_reputation_profile_lookup_failed",
        };
      }
    }
    mergedBody.reviewerRegistryObjectId =
      normalizeIotaAddress(mergedBody.reviewerRegistryObjectId || "") || reviewerRegistryObjectIdHint;
    mergedBody.reviewerEntryObjectId =
      normalizeIotaAddress(mergedBody.reviewerEntryObjectId || "") || reviewerEntryObjectId;
    mergedBody.reputationProfileObjectId =
      normalizeIotaAddress(mergedBody.reputationProfileObjectId || "") || resolvedReputationProfileObjectId;
    mergedBody.disputeQuorumConfigObjectId =
      normalizeIotaAddress(mergedBody.disputeQuorumConfigObjectId || "") || disputeQuorumConfigObjectIdHint;
    if (
      !mergedBody.reviewerRegistryObjectId ||
      !mergedBody.reviewerEntryObjectId ||
      !mergedBody.reputationProfileObjectId ||
      !mergedBody.disputeQuorumConfigObjectId
    ) {
      return {
        ok: false,
        error: "reviewer_self_context_incomplete",
        route: route.kind,
      };
    }
  } else if (route.kind === "commit" || route.kind === "reveal") {
    mergedBody.reviewerEntryObjectId =
      normalizeIotaAddress(mergedBody.reviewerEntryObjectId || "") || reviewerEntryObjectId;
    if (!mergedBody.reviewerEntryObjectId) {
      return {
        ok: false,
        error: "reviewer_self_context_incomplete",
        route: route.kind,
      };
    }
  } else if (route.kind === "claim_metrics") {
    const pendingDecisionMetricsClaimRequired =
      typeof reviewer.pendingDecisionMetricsClaimRequired === "boolean"
        ? reviewer.pendingDecisionMetricsClaimRequired
        : undefined;
    if (pendingDecisionMetricsClaimRequired === false) {
      return {
        ok: false,
        error: "reviewer_metrics_claim_not_required",
        status: 409,
        response: {
          error: "reviewer_metrics_claim_not_required",
          reviewerAddress: reviewerOwnerAddress || null,
        },
      };
    }
    if (!reviewerRegistryObjectIdHint || !disputeQuorumConfigObjectIdHint) {
      const { chainConfig } = await fetchPolicyAndChainConfig(helperOptions, {
        requireDisputeQuorumConfig: true,
        requireEscrowFeeConfig: false,
        requireGovernanceConfig: false,
        network: options.network,
        rpcUrl: options["rpc-url"],
      });
      reviewerRegistryObjectIdHint = reviewerRegistryObjectIdHint || chainConfig.reviewerRegistryObjectId || "";
      disputeQuorumConfigObjectIdHint = disputeQuorumConfigObjectIdHint || chainConfig.disputeQuorumConfigObjectId;
    }
    mergedBody.reviewerRegistryObjectId =
      normalizeIotaAddress(mergedBody.reviewerRegistryObjectId || "") || reviewerRegistryObjectIdHint;
    mergedBody.reviewerEntryObjectId =
      normalizeIotaAddress(mergedBody.reviewerEntryObjectId || "") || reviewerEntryObjectId;
    mergedBody.disputeQuorumConfigObjectId =
      normalizeIotaAddress(mergedBody.disputeQuorumConfigObjectId || "") || disputeQuorumConfigObjectIdHint;
    mergedBody.disputeCaseObjectId = normalizeIotaAddress(mergedBody.disputeCaseObjectId || "");
    if (!mergedBody.disputeCaseObjectId) {
      const invitesCall = await callApiRoute({
        method: "GET",
        rawPath: "/reviewers/me/invites",
        options: helperOptions,
        timeoutMs,
      });
      if (!invitesCall.result.ok) {
        return {
          ok: false,
          error: "reviewer_invites_lookup_failed",
          invitesStatus: invitesCall.result.status,
          invitesResponse: invitesCall.result.body,
        };
      }
      const resolvedClaimMetricsCase = resolveClaimMetricsDisputeCaseCandidate(
        invitesCall.result.body,
        reviewerOwnerAddress
      );
      if (!resolvedClaimMetricsCase.ok) {
        return {
          ok: false,
          error:
            resolvedClaimMetricsCase.disputeCaseObjectIds.length === 0
              ? "claim_metrics_dispute_case_required"
              : "claim_metrics_dispute_case_ambiguous",
          disputeCaseObjectIds: resolvedClaimMetricsCase.disputeCaseObjectIds,
          hint: buildClaimMetricsDisputeCaseHint(rawPath, resolvedClaimMetricsCase.disputeCaseObjectIds),
        };
      }
      mergedBody.disputeCaseObjectId = resolvedClaimMetricsCase.disputeCaseObjectId;
    }
    if (
      !mergedBody.disputeCaseObjectId ||
      !mergedBody.reviewerRegistryObjectId ||
      !mergedBody.reviewerEntryObjectId ||
      !mergedBody.disputeQuorumConfigObjectId
    ) {
      return {
        ok: false,
        error: "reviewer_self_context_incomplete",
        route: route.kind,
      };
    }
  }
  return {
    ok: true,
    mergedBody,
    autoHydrated: {
      route: route.kind,
      reviewerEntryObjectId,
      reputationProfileObjectId: resolvedReputationProfileObjectId || null,
      reviewerRegistryObjectId: reviewerRegistryObjectIdHint || null,
      disputeQuorumConfigObjectId: disputeQuorumConfigObjectIdHint || null,
      disputeCaseObjectId:
        route.kind === "claim_metrics" ? normalizeIotaAddress(mergedBody.disputeCaseObjectId || "") || null : null,
    },
  };
}

async function maybeRetryReviewerSelfTxPlanRequest({ method, rawPath, options, timeoutMs, apiCall }) {
  if (apiCall.result.ok) {
    return null;
  }
  const route = classifyReviewerSelfTxPlanRoute(method, rawPath, apiCall.apiBase);
  if (!route) {
    return null;
  }
  const responseError = typeof apiCall.result.body?.error === "string" ? apiCall.result.body.error : "";
  const shouldRetry =
    (apiCall.result.status === 400 && responseError === "invalid_request") ||
    (apiCall.result.status === 400 && responseError === "dispute_case_object_id_required") ||
    (apiCall.result.status === 409 &&
      responseError === "reviewer_reputation_profile_not_found");
  if (!shouldRetry) {
    return null;
  }
  const hydrated = await hydrateReviewerSelfTxPlanRequest({
    method,
    rawPath,
    options,
    timeoutMs,
    currentBody: apiCall.jsonBody,
    apiBase: apiCall.apiBase,
  });
  if (!hydrated) {
    return null;
  }
  if (!hydrated.ok) {
    return hydrated;
  }

  const retriedCall = await callApiRoute({
    method,
    rawPath,
    options: buildJsonBodyOverrideOptions(options, hydrated.mergedBody),
    timeoutMs,
  });
  return {
    ok: true,
    retriedCall,
    mergedBody: hydrated.mergedBody,
    autoHydrated: hydrated.autoHydrated,
  };
}

async function fetchLatestCheckpointRefForCli(options = {}) {
  const { rpcUrl } = resolveIotaRpcUrl({
    network: options.network,
    rpcUrl: options["rpc-url"],
  });
  const latestSequence = await requestJson(
    rpcUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "clawnera-help-latest-checkpoint-sequence",
        method: "iota_getLatestCheckpointSequenceNumber",
        params: [],
      }),
    },
    parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
  );
  if (!latestSequence.ok) {
    throw new Error(latestSequence.error || "latest_checkpoint_sequence_failed");
  }
  const latestPayload = asRecord(latestSequence.body);
  const sequenceNumber = typeof latestPayload?.result === "string"
    ? latestPayload.result.trim()
    : Number.isFinite(latestPayload?.result)
      ? String(latestPayload.result)
      : "";
  if (!/^[0-9]+$/.test(sequenceNumber)) {
    throw new Error("invalid_checkpoint_sequence_payload");
  }
  const checkpoint = await requestJson(
    rpcUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `clawnera-help-checkpoint-${sequenceNumber}`,
        method: "iota_getCheckpoint",
        params: [sequenceNumber],
      }),
    },
    parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
  );
  if (!checkpoint.ok) {
    throw new Error(checkpoint.error || "checkpoint_fetch_failed");
  }
  const checkpointPayload = asRecord(checkpoint.body);
  const checkpointRecord = asRecord(checkpointPayload?.result);
  const digest = typeof checkpointRecord?.digest === "string" ? checkpointRecord.digest.trim() : "";
  if (!digest) {
    throw new Error("invalid_checkpoint_payload");
  }
  return {
    rpcUrl,
    digest,
    sequenceNumber,
    timestampMs:
      typeof checkpointRecord?.timestampMs === "string" && /^[0-9]+$/.test(checkpointRecord.timestampMs)
        ? Number.parseInt(checkpointRecord.timestampMs, 10)
        : Number.isFinite(checkpointRecord?.timestampMs)
          ? Number.parseInt(String(checkpointRecord.timestampMs), 10)
          : null,
  };
}

function extractPackageIdFromPolicyResponse(responseBody) {
  const policy = responseBody?.policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("policy_fees_payload_invalid");
  }
  const packageIdCandidates = [
    policy?.chainConfig?.marketplacePackageId,
    policy?.listingDeposit?.packageId,
    policy?.reputationInitFee?.packageId,
    policy?.chain?.packageId,
    policy?.packageId,
  ];
  for (const candidate of packageIdCandidates) {
    const normalized = normalizeIotaAddress(candidate || "");
    if (normalized) {
      return normalized;
    }
  }
  throw new Error("marketplace_package_id_missing");
}

function extractChainConfigHintsFromPolicyResponse(responseBody) {
  const policy = asRecord(responseBody?.policy);
  const chainConfig = asRecord(policy?.chainConfig || policy?.chain);
  return {
    marketplacePackageId: normalizeIotaAddress(chainConfig?.marketplacePackageId || chainConfig?.packageId || ""),
    marketplaceFeeConfigObjectId: normalizeIotaAddress(
      chainConfig?.marketplaceFeeConfigObjectId || chainConfig?.escrowFeeConfigObjectId || "",
    ),
    governanceConfigObjectId: normalizeIotaAddress(chainConfig?.governanceConfigObjectId || ""),
    disputeQuorumConfigObjectId: normalizeIotaAddress(chainConfig?.disputeQuorumConfigObjectId || ""),
    reputationInitFeeConfigObjectId: normalizeIotaAddress(chainConfig?.reputationInitFeeConfigObjectId || ""),
    listingDepositConfigObjectId: normalizeIotaAddress(chainConfig?.listingDepositConfigObjectId || ""),
  };
}

function extractReputationInitFeePolicy(responseBody) {
  const policy = asRecord(responseBody?.policy);
  const reputationInitFee = asRecord(policy?.reputationInitFee);
  const configObjectId = normalizeIotaAddress(reputationInitFee?.configObjectId || "");
  const amount =
    typeof reputationInitFee?.amount === "string" && /^[0-9]+$/.test(reputationInitFee.amount.trim())
      ? reputationInitFee.amount.trim()
      : "";
  if (!configObjectId || !amount) {
    throw new Error("reputation_init_fee_policy_missing");
  }
  return {
    configObjectId,
    amount,
  };
}

function formatDryRunGasSummary(result) {
  const gasUsed = result?.effects?.gasUsed;
  if (!gasUsed || typeof gasUsed !== "object") {
    return null;
  }
  return JSON.stringify(gasUsed);
}

async function runApiRequest(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: apiRequestUsageLines()
    };
  }

  let method;
  let rawPath;
  try {
    ({ method, rawPath } = parseApiMethodPath(positionals));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "invalid_request"
    };
  }

  const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
  let apiCall;
  try {
    apiCall = await callApiRoute({ method, rawPath, options, timeoutMs });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "request_failed",
      hint: "set --api-base, --env-file, or --auth-state-file"
    };
  }
  const { context, apiBase, idempotencyKey, url, result } = apiCall;
  const txPlan = detectTxPlanPayload(result.body);
  const responseTimingHints = extractResponseTimingHints(result.headers);
  const responseOut = resolveOptionalPathOption(options["response-out"]);
  if (responseOut) {
    const responsePayload =
      result.body !== null && result.body !== undefined
        ? `${JSON.stringify(result.body, null, 2)}\n`
        : `${result.raw || ""}`;
    writeOptionalOutputFile(responseOut, responsePayload);
  }

  return {
    ok: result.ok,
    method,
    url,
    apiBase,
    idempotencyKey: idempotencyKey || null,
    usedJwt: Boolean(context.jwt),
    authStateFile: context.authStateFile,
    envFile: context.envFile,
    authStateRefreshed: context.authStateRefreshed,
    status: result.status,
    responseOut: responseOut || null,
    headers: result.headers || {},
    recommendedPollIntervalMs: responseTimingHints.recommendedPollIntervalMs,
    retryAfterMs: responseTimingHints.retryAfterMs,
    response: result.body,
    txPlanDetected: Boolean(txPlan),
    nextCommandHint: txPlan ? buildTxPlanNextCommandHint(method, rawPath, apiCall) : null,
    raw: result.raw || "",
    error: result.ok ? null : summarizeApiFailure(result)
  };
}

function buildForwardedRequestArgs(method, rawPath, options = {}, body) {
  const requestArgs = [method, rawPath];
  const forwardedOptionNames = [
    "auth-state-file",
    "env-file",
    "api-base",
    "jwt",
    "timeout-ms",
    "response-out",
    "idempotency-key",
  ];
  for (const optionName of forwardedOptionNames) {
    if (options[optionName] === undefined || options[optionName] === null || options[optionName] === "") {
      continue;
    }
    requestArgs.push(`--${optionName}`, String(options[optionName]));
  }
  if (body !== undefined) {
    requestArgs.push("--body", JSON.stringify(body));
  }
  return requestArgs;
}

function readNestedString(record, pathParts = []) {
  let cursor = record;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return "";
    }
    cursor = cursor[part];
  }
  return typeof cursor === "string" ? cursor.trim() : "";
}

function extractCommonCreatedId(responseBody, paths = []) {
  for (const parts of paths) {
    const value = readNestedString(responseBody, parts);
    if (value) {
      return value;
    }
  }
  return "";
}

async function resolveRuntimeContextForHelper(options = {}) {
  if (!(options["auth-state-file"] || options["env-file"] || options["api-base"] || options.jwt)) {
    return { authState: null, envValues: {} };
  }
  return resolveApiRuntimeContext(options);
}

function listingCreateUsageLines() {
  return [
    "Listing create helper:",
    "- Usage: clawnera-help listing-create --title <text> --description <text> --category <slug> --currency <IOTA|CLAW> --milestones '<title:amount;title:amount>' [auth options]",
    "- Required auth: --auth-state-file <file> or --env-file <file> or --api-base <url> --jwt <token>",
    "- Optional: --budget-amount <int> (defaults to the milestone sum), --creator-address <0x...>, --milestones-json <json>, --milestones-file <file>",
    "- Thin wrapper over POST /listings that infers creatorAddress from the saved auth state when possible",
  ];
}

function bidCreateUsageLines() {
  return [
    "Bid create helper:",
    "- Usage: clawnera-help bid-create --listing-id <listing-id> --amount <int> --currency <IOTA|CLAW> [auth options]",
    "- Required auth: --auth-state-file <file> or --env-file <file> or --api-base <url> --jwt <token>",
    "- Optional: --message <text>, --bidder-address <0x...>",
    "- Thin wrapper over POST /bids that infers bidderAddress from the saved auth state when possible",
  ];
}

function bidAcceptUsageLines() {
  return [
    "Bid accept helper:",
    "- Usage: clawnera-help bid-accept --bid-id <bid-id> [auth options]",
    "- Required auth: --auth-state-file <file> or --env-file <file> or --api-base <url> --jwt <token>",
    "- Optional advanced pair: --order-id <order-id> plus --communication-proposal-json <json> or --communication-proposal-file <file>",
    "- Thin wrapper over POST /bids/{bidId}/accept",
  ];
}

function reviewerInvitesUsageLines() {
  return [
    "Reviewer invites helper:",
    "- Usage: clawnera-help reviewer-invites [auth options]",
    "- Required auth: --auth-state-file <file> or --env-file <file> or --api-base <url> --jwt <token>",
    "- Reads GET /reviewers/me/invites and surfaces invite states plus recommendedPollIntervalMs when the API sends x-clawdex-recommended-poll-interval-ms",
  ];
}

async function runListingCreate(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return { ok: true, help: true, usage: listingCreateUsageLines() };
  }
  if (positionals.length > 0) {
    return { ok: false, error: "unexpected_positional_arguments", details: positionals };
  }
  try {
    const runtimeContext = await resolveRuntimeContextForHelper(options);
    const creatorAddress =
      normalizeIotaAddress(options["creator-address"] || "") || resolveActorAddressForSignedRun(options, runtimeContext);
    if (!creatorAddress) {
      return { ok: false, error: "missing_creator_address" };
    }
    const title = normalizeString(options.title);
    const description = normalizeString(options.description);
    const category = normalizeString(options.category);
    const currency = normalizeString(options.currency).toUpperCase();
    if (!title || !description || !category || !currency) {
      return { ok: false, error: "missing_required_listing_fields" };
    }
    const milestones = parseListingMilestonesOptions(options);
    const budgetAmount = options["budget-amount"] !== undefined
      ? parsePositiveBigIntOption(options["budget-amount"], "budget_amount").toString()
      : sumMilestoneAmounts(milestones).toString();
    const result = await runApiRequest(
      buildForwardedRequestArgs("POST", "/listings", options, {
        creatorAddress,
        title,
        description,
        category,
        currency,
        budgetAmount,
        milestones,
      }),
    );
    return {
      ...result,
      creatorAddress,
      listingId: extractCommonCreatedId(result.response, [["listingId"], ["listing", "id"], ["id"]]) || null,
      budgetAmount,
      milestones,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "listing_create_failed" };
  }
}

async function runBidCreate(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return { ok: true, help: true, usage: bidCreateUsageLines() };
  }
  if (positionals.length > 0) {
    return { ok: false, error: "unexpected_positional_arguments", details: positionals };
  }
  try {
    const runtimeContext = await resolveRuntimeContextForHelper(options);
    const bidderAddress =
      normalizeIotaAddress(options["bidder-address"] || "") || resolveActorAddressForSignedRun(options, runtimeContext);
    if (!bidderAddress) {
      return { ok: false, error: "missing_bidder_address" };
    }
    const listingId = normalizeString(options["listing-id"]);
    const amount = parsePositiveBigIntOption(options.amount, "amount").toString();
    const currency = normalizeString(options.currency).toUpperCase();
    if (!listingId || !currency) {
      return { ok: false, error: "missing_required_bid_fields" };
    }
    const body = {
      listingId,
      bidderAddress,
      amount,
      currency,
      ...(normalizeString(options.message) ? { message: normalizeString(options.message) } : {}),
    };
    const result = await runApiRequest(buildForwardedRequestArgs("POST", "/bids", options, body));
    return {
      ...result,
      bidderAddress,
      bidId: extractCommonCreatedId(result.response, [["bidId"], ["bid", "id"], ["id"]]) || null,
      listingId,
      amount,
      currency,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "bid_create_failed" };
  }
}

async function runBidAccept(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return { ok: true, help: true, usage: bidAcceptUsageLines() };
  }
  if (positionals.length > 0) {
    return { ok: false, error: "unexpected_positional_arguments", details: positionals };
  }
  try {
    const bidId = normalizeString(options["bid-id"]);
    if (!bidId) {
      return { ok: false, error: "missing_bid_id" };
    }
    const orderId = normalizeString(options["order-id"]);
    const communicationProposalJson = normalizeString(options["communication-proposal-json"]);
    const communicationProposalFile = resolveOptionalPathOption(options["communication-proposal-file"]);
    const proposalInputs = [Boolean(communicationProposalJson), Boolean(communicationProposalFile)].filter(Boolean).length;
    if (proposalInputs > 1) {
      return { ok: false, error: "multiple_communication_proposal_inputs" };
    }
    let body = {};
    if (orderId || proposalInputs > 0) {
      if (!orderId || proposalInputs === 0) {
        return { ok: false, error: "order_id_and_communication_proposal_must_travel_together" };
      }
      const communicationProposal = communicationProposalJson
        ? JSON.parse(communicationProposalJson)
        : JSON.parse(fs.readFileSync(communicationProposalFile, "utf8"));
      body = { orderId, communicationProposal };
    }
    const result = await runApiRequest(buildForwardedRequestArgs("POST", `/bids/${bidId}/accept`, options, body));
    return {
      ...result,
      bidId,
      orderId: extractCommonCreatedId(result.response, [["orderId"], ["order", "id"], ["id"]]) || null,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "bid_accept_failed" };
  }
}

function summarizeInviteStates(invites = []) {
  return invites.reduce((counts, invite) => {
    const status = typeof invite?.status === "string" ? invite.status : "unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

async function runReviewerInvites(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return { ok: true, help: true, usage: reviewerInvitesUsageLines() };
  }
  if (positionals.length > 0) {
    return { ok: false, error: "unexpected_positional_arguments", details: positionals };
  }
  const result = await runApiRequest(buildForwardedRequestArgs("GET", "/reviewers/me/invites", options));
  if (!result.ok) {
    return result;
  }
  const invites = Array.isArray(result.response?.invites) ? result.response.invites : [];
  const actionableInvites = invites.filter((invite) => {
    return typeof invite?.status === "string" && ["invited", "accepted"].includes(invite.status);
  });
  const closedInvites = invites.filter((invite) => typeof invite?.status === "string" && invite.status === "closed");
  return {
    ...result,
    inviteCount: invites.length,
    actionableInviteCount: actionableInvites.length,
    closedInviteCount: closedInvites.length,
    inviteStates: summarizeInviteStates(invites),
    invites,
  };
}

function resolveActorAddressForSignedRun(options = {}, context = {}) {
  return normalizeIotaAddress(
    options.address ||
      context?.authState?.address ||
      context?.envValues?.CLAWNERA_API_ADDRESS ||
      "",
  );
}

function writeOptionalOutputFile(targetPath, payload, mode = 0o600) {
  if (!targetPath) {
    return null;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, payload, { mode });
  fs.chmodSync(targetPath, mode);
  return targetPath;
}

function ensureOrderPayload(responseBody) {
  const order = responseBody?.order;
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    throw new Error("order_payload_invalid");
  }
  return order;
}

async function fetchReviewerRuntimeHints(contextOptions = {}, timeoutMs = 20_000) {
  const helperOptions = { ...contextOptions };
  delete helperOptions.body;
  delete helperOptions["body-file"];
  delete helperOptions["idempotency-key"];
  const metricsCall = await callApiRoute({
    method: "GET",
    rawPath: "/reviewers/me/metrics",
    options: helperOptions,
    timeoutMs,
  });
  if (!metricsCall.result.ok) {
    return {
      ok: false,
      status: metricsCall.result.status,
      error: summarizeApiFailure(metricsCall.result),
      response: metricsCall.result.body,
    };
  }
  const runtime = asRecord(metricsCall.result.body?.runtime);
  if (!runtime) {
    return {
      ok: false,
      status: 200,
      error: "reviewer_runtime_missing",
      response: metricsCall.result.body,
    };
  }
  return {
    ok: true,
    runtime,
    registered: metricsCall.result.body?.registered === true,
    metricsResponse: metricsCall.result.body,
  };
}

function mergeChainConfigWithReviewerRuntime(chainConfig, reviewerRuntime) {
  if (!reviewerRuntime || typeof reviewerRuntime !== "object" || Array.isArray(reviewerRuntime)) {
    return chainConfig;
  }
  const merged = { ...chainConfig };
  const runtimePackageId = normalizeIotaAddress(reviewerRuntime.marketplacePackageId || "");
  const runtimeDisputeQuorumConfigObjectId = normalizeIotaAddress(
    reviewerRuntime.disputeQuorumConfigObjectId || "",
  );
  const runtimeReviewerRegistryObjectId = normalizeIotaAddress(reviewerRuntime.reviewerRegistryObjectId || "");
  let runtimeReviewerMinStakeIota = 0n;
  if (
    reviewerRuntime.reviewerMinStakeIota !== undefined &&
    reviewerRuntime.reviewerMinStakeIota !== null &&
    /^[0-9]+$/.test(String(reviewerRuntime.reviewerMinStakeIota).trim())
  ) {
    runtimeReviewerMinStakeIota = BigInt(String(reviewerRuntime.reviewerMinStakeIota).trim());
  }
  if (runtimePackageId) {
    merged.packageId = runtimePackageId;
  }
  if (runtimeDisputeQuorumConfigObjectId) {
    merged.disputeQuorumConfigObjectId = runtimeDisputeQuorumConfigObjectId;
  }
  if (runtimeReviewerRegistryObjectId) {
    merged.reviewerRegistryObjectId = runtimeReviewerRegistryObjectId;
  }
  if (runtimeReviewerMinStakeIota > 0n) {
    merged.reviewerMinStakeIota = runtimeReviewerMinStakeIota;
  }
  return merged;
}

async function fetchPolicyAndChainConfig(contextOptions = {}, runtimeOptions = {}) {
  const feesCall = await callApiRoute({
    method: "GET",
    rawPath: "/policy/fees",
    options: contextOptions,
    timeoutMs: parsePositiveIntOption(contextOptions["timeout-ms"], "timeout_ms", 20_000),
  });
  if (!feesCall.result.ok) {
    throw new Error(summarizeApiFailure(feesCall.result));
  }
  const packageId = extractPackageIdFromPolicyResponse(feesCall.result.body);
  const policyChainConfig = extractChainConfigHintsFromPolicyResponse(feesCall.result.body);
  const timeoutMs = parsePositiveIntOption(contextOptions["timeout-ms"], "timeout_ms", 20_000);
  let reviewerRuntime = null;
  const reviewerRuntimeResult = await fetchReviewerRuntimeHints(contextOptions, timeoutMs);
  if (reviewerRuntimeResult.ok) {
    reviewerRuntime = reviewerRuntimeResult.runtime;
  }
  const chainConfig = await resolveClawdexChainConfig({
    packageId,
    disputeQuorumConfigObjectId:
      normalizeIotaAddress(reviewerRuntime?.disputeQuorumConfigObjectId || "") ||
      policyChainConfig.disputeQuorumConfigObjectId,
    escrowFeeConfigObjectId: policyChainConfig.marketplaceFeeConfigObjectId,
    governanceConfigObjectId: policyChainConfig.governanceConfigObjectId,
    reviewerRegistryObjectId: normalizeIotaAddress(reviewerRuntime?.reviewerRegistryObjectId || ""),
    requireDisputeQuorumConfig: runtimeOptions.requireDisputeQuorumConfig,
    requireEscrowFeeConfig: runtimeOptions.requireEscrowFeeConfig,
    requireGovernanceConfig: runtimeOptions.requireGovernanceConfig,
    network: runtimeOptions.network,
    rpcUrl: runtimeOptions.rpcUrl,
  });
  return {
    feesCall,
    chainConfig: mergeChainConfigWithReviewerRuntime(chainConfig, reviewerRuntime),
    packageId,
    reviewerRuntime,
  };
}

async function runChainConfig(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: chainConfigUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }
  try {
    const { feesCall, chainConfig } = await fetchPolicyAndChainConfig(options, {
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    return {
      ok: true,
      apiBase: feesCall.apiBase,
      authStateFile: feesCall.context.authStateFile,
      envFile: feesCall.context.envFile,
      chainConfig,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "chain_config_failed",
    };
  }
}

async function runTxPlanCommand(commandArgs, mode) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: txPlanUsageLines(mode),
    };
  }

  let method;
  let rawPath;
  try {
    ({ method, rawPath } = parseApiMethodPath(positionals));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "invalid_request",
    };
  }

  const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
  let apiCall;
  let requestOptions = options;
  let autoHydratedReviewerContext = null;
  try {
    const proactiveHydration = await hydrateReviewerSelfTxPlanRequest({
      method,
      rawPath,
      options,
      timeoutMs,
      currentBody: loadApiRequestBody(options).jsonBody,
      apiBase: options["api-base"],
    });
    if (proactiveHydration) {
      if (!proactiveHydration.ok) {
        return {
          ok: false,
          error: proactiveHydration.error,
          status: proactiveHydration.status,
          response: proactiveHydration.response,
          hint: proactiveHydration.hint,
          disputeCaseObjectIds: proactiveHydration.disputeCaseObjectIds,
        };
      }
      requestOptions = buildJsonBodyOverrideOptions(options, proactiveHydration.mergedBody);
      autoHydratedReviewerContext = proactiveHydration.autoHydrated;
    }
    apiCall = await callApiRoute({ method, rawPath, options: requestOptions, timeoutMs });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "tx_plan_fetch_failed",
      hint: "set --api-base, --env-file, or --auth-state-file",
    };
  }
  if (!apiCall.result.ok && !autoHydratedReviewerContext) {
    const retried = await maybeRetryReviewerSelfTxPlanRequest({
      method,
      rawPath,
      options: requestOptions,
      timeoutMs,
      apiCall,
    });
    if (retried && retried.ok) {
      apiCall = retried.retriedCall;
      autoHydratedReviewerContext = retried.autoHydrated;
    } else if (retried && !retried.ok) {
      return {
        ok: false,
        error: retried.error,
        status: retried.status ?? apiCall.result.status,
        response: retried.response ?? apiCall.result.body,
        hint: retried.hint,
        disputeCaseObjectIds: retried.disputeCaseObjectIds,
      };
    }
  }
  if (!apiCall.result.ok) {
    return {
      ok: false,
      error: summarizeApiFailure(apiCall.result),
      status: apiCall.result.status,
      response: apiCall.result.body,
      autoHydratedReviewerContext,
    };
  }

  const txPlan = detectTxPlanPayload(apiCall.result.body);
  if (!txPlan) {
    return {
      ok: false,
      error: "response_not_tx_plan",
      status: apiCall.result.status,
      response: apiCall.result.body,
    };
  }

  const planOut = resolveOptionalPathOption(options["plan-out"]);
  const txBytesOut = resolveOptionalPathOption(options["tx-bytes-out"]);
  try {
    const transaction = buildClawdexTxFromPlan(txPlan);
    const signer = resolveRuntimeSigner(options, apiCall.context);
    if (planOut) {
      writeOptionalOutputFile(planOut, JSON.stringify(apiCall.result.body, null, 2));
    }

    if (mode === "dry_run") {
      const dryRun = await dryRunTransaction(transaction, {
        network: options.network,
        rpcUrl: options["rpc-url"],
      });
      if (txBytesOut) {
        writeOptionalOutputFile(txBytesOut, `${dryRun.txBytesB64}\n`);
      }
      return {
        ok: true,
        mode,
        method,
        rawPath,
        apiBase: apiCall.apiBase,
        txBuilder: txPlan.txBuilder,
        signerAddress: txPlan.request.sender || null,
        autoHydratedReviewerContext,
        txBytesOut: txBytesOut || null,
        planOut: planOut || null,
        dryRun: dryRun.result,
        gasSummary: formatDryRunGasSummary(dryRun.result),
      };
    }

    const executed = await executeTransaction(transaction, {
      alias: signer.alias,
      address: signer.address,
      keystorePath: signer.keystorePath,
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    if (txBytesOut) {
      writeOptionalOutputFile(txBytesOut, `${executed.txBytesB64}\n`);
    }
    const disputeCaseObjectId = resolveDisputeCaseObjectIdForInviteBinding(txPlan, executed);
    let postExecuteBinding = null;
    const inviteBinding = txPlan.inviteBinding;
    if (
      inviteBinding &&
      typeof inviteBinding === "object" &&
      !Array.isArray(inviteBinding) &&
      inviteBinding.postExecuteBindingRequired === true &&
      typeof inviteBinding.bindRoute === "string" &&
      inviteBinding.bindRoute.trim()
    ) {
      if (!disputeCaseObjectId) {
        return {
          ok: false,
          error: "post_execute_invite_binding_missing_dispute_case_id",
          txBuilder: txPlan.txBuilder,
          txDigest: resolveTxExecutionDigest(executed),
          bindRoute: inviteBinding.bindRoute.trim(),
        };
      }
      const bindCall = await callApiRoute({
        method: "POST",
        rawPath: inviteBinding.bindRoute.trim(),
        options: {
          ...options,
          body: JSON.stringify({
            disputeCaseObjectId,
            activationTxDigest: resolveTxExecutionDigest(executed),
          }),
        },
        timeoutMs,
      });
      postExecuteBinding = {
        route: inviteBinding.bindRoute.trim(),
        disputeCaseObjectId,
        ok: bindCall.result.ok,
        status: bindCall.result.status,
        response: bindCall.result.body,
      };
      if (!bindCall.result.ok) {
        return {
          ok: false,
          error: "post_execute_invite_binding_failed",
          txBuilder: txPlan.txBuilder,
          txDigest: resolveTxExecutionDigest(executed),
          disputeCaseObjectId,
          bindRoute: inviteBinding.bindRoute.trim(),
          status: bindCall.result.status,
          response: bindCall.result.body,
        };
      }
    }
    return {
      ok: true,
      mode,
      method,
      rawPath,
      apiBase: apiCall.apiBase,
      txBuilder: txPlan.txBuilder,
      signerAddress: executed.verifyResult?.signerAddress || signer.address || txPlan.request.sender || null,
      autoHydratedReviewerContext,
      txDigest: resolveTxExecutionDigest(executed),
      txBytesOut: txBytesOut || null,
      planOut: planOut || null,
      execution: executed.result,
      createdObjects: extractCreatedObjects(executed),
      disputeCaseObjectId,
      postExecuteBinding,
      mailboxSignalPosted: extractMailboxSignalPosted(executed),
      mailboxSignalAcked: extractMailboxSignalAcked(executed),
      quorumResolutionTicketObjectId:
        extractCreatedObjectIdByTypeSuffix(executed, "::dispute_quorum::QuorumResolutionTicket") || null,
      disputeBondObjectId:
        extractCreatedObjectIdByTypeSuffix(executed, "::dispute_quorum::OrderDisputeBond") || null,
      orderMailboxObjectId:
        extractCreatedObjectIdByTypeSuffix(executed, "::order_mailbox::OrderMailbox") || null,
      orderEscrowObjectId:
        extractCreatedObjectIdByTypeFragment(executed, "::order_escrow::OrderEscrow<") || null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "tx_plan_execute_failed",
      txBuilder: txPlan.txBuilder,
    };
  }
}

async function runOrderInitBond(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: orderInitBondUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  if (!orderId) {
    return {
      ok: false,
      error: "missing_order_id",
    };
  }

  try {
    const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
    const orderCall = await callApiRoute({
      method: "GET",
      rawPath: `/orders/${orderId}`,
      options,
      timeoutMs,
    });
    if (!orderCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(orderCall.result),
        status: orderCall.result.status,
        response: orderCall.result.body,
      };
    }
    const order = ensureOrderPayload(orderCall.result.body);
    const actorAddress = resolveActorAddressForSignedRun(options, orderCall.context);
    if (!actorAddress) {
      return {
        ok: false,
        error: "missing_actor_address",
      };
    }
    if (
      actorAddress !== normalizeIotaAddress(order.buyerAddress || "") &&
      actorAddress !== normalizeIotaAddress(order.sellerAddress || "")
    ) {
      return {
        ok: false,
        error: "actor_not_order_party",
      };
    }

    const { chainConfig, packageId } = await fetchPolicyAndChainConfig(options, {
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    const requiredReviewerVotes =
      options["required-reviewer-votes"] !== undefined
        ? parsePositiveBigIntOption(options["required-reviewer-votes"], "required_reviewer_votes")
        : chainConfig.defaultRequiredReviewerVotes;
    const requiredReviewerVotesFloor =
      options["required-reviewer-votes-floor"] !== undefined
        ? parsePositiveBigIntOption(options["required-reviewer-votes-floor"], "required_reviewer_votes_floor")
        : chainConfig.minRequiredReviewerVotes;
    const marketingCampaignId =
      typeof options["marketing-campaign-id"] === "string" && options["marketing-campaign-id"].trim()
        ? options["marketing-campaign-id"].trim()
        : "";
    const request = {
      packageId,
      sender: actorAddress,
      orderId,
      buyer: normalizeIotaAddress(order.buyerAddress),
      seller: normalizeIotaAddress(order.sellerAddress),
      requiredReviewerVotes,
      requiredReviewerVotesFloor,
      disputeQuorumConfigObjectId: chainConfig.disputeQuorumConfigObjectId,
      ...(marketingCampaignId ? { marketingCampaignId } : {}),
    };
    const transaction = buildInitOrderBondTx(request);
    const signer = resolveRuntimeSigner(options, orderCall.context);
    const dryRun = parseBooleanOption(options["dry-run"], false);
    if (dryRun) {
      const result = await dryRunTransaction(transaction, {
        network: options.network,
        rpcUrl: options["rpc-url"],
      });
      return {
        ok: true,
        mode: "dry_run",
        orderId,
        packageId,
        actorAddress,
        chainConfig,
        gasSummary: formatDryRunGasSummary(result.result),
        dryRun: result.result,
      };
    }
    const executed = await executeTransaction(transaction, {
      alias: signer.alias,
      address: signer.address,
      keystorePath: signer.keystorePath,
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    return {
      ok: true,
      mode: "execute",
      orderId,
      packageId,
      actorAddress,
      chainConfig,
      txDigest: executed.result?.digest || null,
      disputeBondObjectId: extractCreatedObjectIdByTypeSuffix(executed, "::dispute_quorum::OrderDisputeBond") || null,
      createdObjects: extractCreatedObjects(executed),
      execution: executed.result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "order_init_bond_failed",
    };
  }
}

async function runOrderCreateEscrow(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: orderCreateEscrowUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  if (!orderId) {
    return {
      ok: false,
      error: "missing_order_id",
    };
  }

  try {
    const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
    const orderCall = await callApiRoute({
      method: "GET",
      rawPath: `/orders/${orderId}`,
      options,
      timeoutMs,
    });
    if (!orderCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(orderCall.result),
        status: orderCall.result.status,
        response: orderCall.result.body,
      };
    }
    const order = ensureOrderPayload(orderCall.result.body);
    const actorAddress = resolveActorAddressForSignedRun(options, orderCall.context);
    if (!actorAddress) {
      return {
        ok: false,
        error: "missing_actor_address",
      };
    }
    if (actorAddress !== normalizeIotaAddress(order.buyerAddress || "")) {
      return {
        ok: false,
        error: "actor_not_order_buyer",
      };
    }

    const { chainConfig, packageId } = await fetchPolicyAndChainConfig(options, {
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    const deadlineMs =
      options["deadline-ms"] !== undefined
        ? parsePositiveBigIntOption(options["deadline-ms"], "deadline_ms")
        : BigInt(Date.now()) + DEFAULT_ORDER_ESCROW_DEADLINE_DELTA_MS;
    const requestBase = {
      packageId,
      sender: actorAddress,
      orderId,
      seller: normalizeIotaAddress(order.sellerAddress),
      amount: parsePositiveBigIntOption(order.amount, "order_amount"),
      deadlineMs,
      governanceConfigObjectId: chainConfig.governanceConfigObjectId,
      feeConfigObjectId: chainConfig.escrowFeeConfigObjectId,
      currency: order.currency,
    };
    let request;
    if (order.currency === "IOTA") {
      request = {
        ...requestBase,
        ...(typeof options["payment-coin-object-id"] === "string" && options["payment-coin-object-id"].trim()
          ? { paymentCoinObjectId: options["payment-coin-object-id"].trim() }
          : {}),
      };
    } else if (order.currency === "CLAW") {
      const clawCoinType = typeof options["claw-coin-type"] === "string" ? options["claw-coin-type"].trim() : "";
      if (!clawCoinType) {
        return {
          ok: false,
          error: "missing_claw_coin_type",
        };
      }
      const paymentCoinObjectId =
        typeof options["payment-coin-object-id"] === "string" ? options["payment-coin-object-id"].trim() : "";
      const clawCoinObjectId =
        typeof options["claw-coin-object-id"] === "string" ? options["claw-coin-object-id"].trim() : "";
      if (!paymentCoinObjectId && !clawCoinObjectId) {
        return {
          ok: false,
          error: "missing_claw_funding_source",
        };
      }
      request = {
        ...requestBase,
        clawCoinType,
        ...(paymentCoinObjectId ? { paymentCoinObjectId } : {}),
        ...(clawCoinObjectId
          ? {
              clawCoinObjectId,
              allowUncheckedClawCoinObjectId: true,
            }
          : {}),
      };
    } else {
      return {
        ok: false,
        error: "unsupported_order_currency",
      };
    }

    const transaction = buildCreateOrderEscrowTx(request);
    const signer = resolveRuntimeSigner(options, orderCall.context);
    const dryRun = parseBooleanOption(options["dry-run"], false);
    if (dryRun) {
      const result = await dryRunTransaction(transaction, {
        network: options.network,
        rpcUrl: options["rpc-url"],
      });
      return {
        ok: true,
        mode: "dry_run",
        orderId,
        actorAddress,
        packageId,
        chainConfig,
        gasSummary: formatDryRunGasSummary(result.result),
        dryRun: result.result,
      };
    }

    const executed = await executeTransaction(transaction, {
      alias: signer.alias,
      address: signer.address,
      keystorePath: signer.keystorePath,
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    return {
      ok: true,
      mode: "execute",
      orderId,
      actorAddress,
      packageId,
      chainConfig,
      txDigest: executed.result?.digest || null,
      orderEscrowObjectId:
        extractCreatedObjectIdByTypeFragment(executed, "::order_escrow::OrderEscrow<") || null,
      createdObjects: extractCreatedObjects(executed),
      execution: executed.result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "order_create_escrow_failed",
    };
  }
}

async function runKeyAgreementUpsert(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: keyAgreementUpsertUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  try {
    const runtimeContext = await resolveApiRuntimeContext(options);
    if (!runtimeContext.apiBase) {
      return {
        ok: false,
        error: "missing_or_invalid_api_base",
      };
    }
    const signer = await resolveRuntimeSignerEntry(options, runtimeContext);
    const actorAddress =
      normalizeIotaAddress(options.address || "") ||
      normalizeIotaAddress(runtimeContext.authState?.address || runtimeContext.envValues?.CLAWNERA_API_ADDRESS || "") ||
      normalizeIotaAddress(signer.entry.address || "");
    if (!actorAddress) {
      return {
        ok: false,
        error: "missing_actor_address",
      };
    }
    if (actorAddress !== normalizeIotaAddress(signer.entry.address)) {
      return {
        ok: false,
        error: "signer_actor_mismatch",
      };
    }

    const keyVersion = parsePositiveIntOption(options["key-version"], "key_version", 1);
    const ttlSec = parsePositiveIntOption(options["ttl-sec"], "ttl_sec", 86_400);
    const expiresAtMs = options["expires-at-ms"] !== undefined
      ? parsePositiveIntOption(options["expires-at-ms"], "expires_at_ms", Date.now() + ttlSec * 1000)
      : Date.now() + ttlSec * 1000;
    const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
    const keyFile = resolveKeyAgreementRecordPathOption(
      actorAddress,
      keyVersion,
      options["key-file"],
      runtimeContext.authStateFile,
    );
    const rotate = parseBooleanOption(options.rotate, false);
    const readPath = `/users/${actorAddress}/key-agreement?keyVersion=${keyVersion}`;
    const initialRead = await callApiRoute({
      method: "GET",
      rawPath: readPath,
      options,
      timeoutMs,
    });
    const remoteKeyAgreement = initialRead.result.ok ? initialRead.result.body?.keyAgreement || null : null;
    const remoteExpiresAtMs =
      remoteKeyAgreement && typeof remoteKeyAgreement.expiresAt === "string"
        ? Date.parse(remoteKeyAgreement.expiresAt)
        : null;

    let keyRecord;
    if (remoteKeyAgreement) {
      if (rotate) {
        return {
          ok: false,
          error: "remote_key_agreement_version_already_bound",
          keyFile,
          keyVersion,
          remoteKeyAgreement,
          hint: "choose a new --key-version when rotating an existing delivery key"
        };
      }
      if (!fs.existsSync(keyFile)) {
        return {
          ok: false,
          error: "existing_remote_key_requires_local_key_file",
          keyFile,
          keyVersion,
          remoteKeyAgreement,
          hint: "use --key-file with the matching local private key record or pick a new --key-version"
        };
      }
      keyRecord = await loadKeyAgreementRecord(keyFile, {
        expectedAddress: actorAddress,
        expectedKeyVersion: keyVersion,
        fallbackExpiresAtMs:
          Number.isSafeInteger(remoteExpiresAtMs) && remoteExpiresAtMs > 0 ? remoteExpiresAtMs : expiresAtMs
      });
      if (keyRecord.address !== actorAddress || keyRecord.keyVersion !== keyVersion) {
        return {
          ok: false,
          error: "key_agreement_file_actor_or_version_mismatch",
          keyFile,
        };
      }
      if (keyRecord.publicKeyMultibase !== remoteKeyAgreement.publicKeyMultibase) {
        return {
          ok: false,
          error: "existing_remote_key_conflicts_with_local_private_key",
          keyFile,
          keyVersion,
          localPublicKeyMultibase: keyRecord.publicKeyMultibase,
          remoteKeyAgreement,
          hint: "reuse the correct local key file or rotate with a new --key-version"
        };
      }
      keyRecord = await saveKeyAgreementRecord({
        ...keyRecord,
        expiresAtMs,
        filePath: keyFile,
        createdAt: keyRecord.createdAt || undefined,
      });
    } else if (!rotate && fs.existsSync(keyFile)) {
      keyRecord = await loadKeyAgreementRecord(keyFile, {
        expectedAddress: actorAddress,
        expectedKeyVersion: keyVersion,
        fallbackExpiresAtMs: expiresAtMs
      });
      if (keyRecord.address !== actorAddress || keyRecord.keyVersion !== keyVersion) {
        return {
          ok: false,
          error: "key_agreement_file_actor_or_version_mismatch",
          keyFile,
        };
      }
      keyRecord = await saveKeyAgreementRecord({
        ...keyRecord,
        expiresAtMs,
        filePath: keyFile,
        createdAt: keyRecord.createdAt || undefined,
      });
    } else {
      const generated = generateKeyAgreementKeypair("u");
      keyRecord = await saveKeyAgreementRecord({
        address: actorAddress,
        keyVersion,
        publicKeyMultibase: generated.publicKeyMultibase,
        privateKeyMultibase: generated.privateKeyMultibase,
        expiresAtMs,
        filePath: keyFile,
      });
    }

    const walletBindingMessage = buildKeyAgreementBindingMessage(
      actorAddress,
      keyVersion,
      keyRecord.publicKeyMultibase,
      expiresAtMs,
    );
    const signed = await signer.keypair.signPersonalMessage(new TextEncoder().encode(walletBindingMessage));
    const requestBody = {
      publicKeyMultibase: keyRecord.publicKeyMultibase,
      keyVersion,
      expiresAtMs,
      walletBindingMessage,
      walletBindingSignature: signed.signature,
    };

    const putCall = await callApiRoute({
      method: "PUT",
      rawPath: "/users/me/key-agreement",
      options: {
        ...options,
        body: JSON.stringify(requestBody),
      },
      timeoutMs,
    });
    if (!putCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(putCall.result),
        status: putCall.result.status,
        response: putCall.result.body,
      };
    }
    let readCall = null;
    for (const retryDelayMs of [0, 500, 1500, 3000, 5000]) {
      if (retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
      readCall = await callApiRoute({
        method: "GET",
        rawPath: readPath,
        options,
        timeoutMs,
      });
      const storedCandidate = readCall.result.body?.keyAgreement;
      if (readCall.result.ok && storedCandidate?.publicKeyMultibase === keyRecord.publicKeyMultibase) {
        break;
      }
    }
    if (!readCall || !readCall.result.ok) {
      return {
        ok: true,
        apiBase: putCall.apiBase,
        address: actorAddress,
        keyVersion,
        keyFile,
        publicKeyMultibase: keyRecord.publicKeyMultibase,
        expiresAtMs,
        walletBindingMessage,
        requestBody,
        readback: null,
        readbackPending: true,
        warning: "key_agreement_readback_pending",
        verifyHint: `clawnera-help request GET '/users/${actorAddress}/key-agreement?keyVersion=${keyVersion}' --auth-state-file ${shellQuote(putCall.context.authStateFile || "~/.config/clawnera/auth-state.json")}`,
        readbackStatus: readCall?.result?.status ?? null,
        readbackResponse: readCall?.result?.body ?? null,
        authStateFile: putCall.context.authStateFile,
        authStateRefreshed: putCall.context.authStateRefreshed || readCall?.context?.authStateRefreshed || false,
      };
    }
    const stored = readCall.result.body?.keyAgreement;
    if (!stored || stored.publicKeyMultibase !== keyRecord.publicKeyMultibase) {
      return {
        ok: true,
        apiBase: putCall.apiBase,
        address: actorAddress,
        keyVersion,
        keyFile,
        publicKeyMultibase: keyRecord.publicKeyMultibase,
        expiresAtMs,
        walletBindingMessage,
        requestBody,
        readback: stored || null,
        readbackPending: true,
        warning: "key_agreement_readback_pending",
        verifyHint: `clawnera-help request GET '/users/${actorAddress}/key-agreement?keyVersion=${keyVersion}' --auth-state-file ${shellQuote(putCall.context.authStateFile || "~/.config/clawnera/auth-state.json")}`,
        readbackStatus: readCall.result.status,
        readbackResponse: readCall.result.body,
        authStateFile: putCall.context.authStateFile,
        authStateRefreshed: putCall.context.authStateRefreshed || readCall.context.authStateRefreshed,
      };
    }
    return {
      ok: true,
      apiBase: putCall.apiBase,
      address: actorAddress,
      keyVersion,
      keyFile,
      publicKeyMultibase: keyRecord.publicKeyMultibase,
      expiresAtMs,
      walletBindingMessage,
      requestBody,
      readback: stored,
      authStateFile: putCall.context.authStateFile,
      authStateRefreshed: putCall.context.authStateRefreshed || readCall.context.authStateRefreshed,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "key_agreement_upsert_failed",
    };
  }
}

async function runReputationInit(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: reputationInitUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  try {
    const runtimeContext = await resolveApiRuntimeContext(options);
    const signer = await resolveRuntimeSignerEntry(options, runtimeContext);
    const actorAddress =
      normalizeIotaAddress(runtimeContext.authState?.address || runtimeContext.envValues?.CLAWNERA_API_ADDRESS || "") ||
      normalizeIotaAddress(signer.entry.address || "");
    if (!actorAddress) {
      return {
        ok: false,
        error: "missing_actor_address",
      };
    }
    if (actorAddress !== normalizeIotaAddress(signer.entry.address)) {
      return {
        ok: false,
        error: "signer_actor_mismatch",
      };
    }

    const { feesCall, chainConfig, packageId } = await fetchPolicyAndChainConfig(options, {
      requireDisputeQuorumConfig: false,
      requireEscrowFeeConfig: false,
      requireGovernanceConfig: false,
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    const feePolicy = extractReputationInitFeePolicy(feesCall.result.body);
    const paymentCoinObjectId =
      typeof options["payment-coin-object-id"] === "string" && options["payment-coin-object-id"].trim()
        ? options["payment-coin-object-id"].trim()
        : undefined;

    try {
      const existingObjectId = await resolveClawdexReputationProfileObjectIdByOwner({
        packageId,
        ownerAddress: actorAddress,
        reputationInitFeeConfigObjectId: feePolicy.configObjectId,
        network: options.network,
        rpcUrl: options["rpc-url"],
      });
      return {
        ok: true,
        mode: "existing",
        actorAddress,
        packageId,
        chainConfig,
        reputationProfileObjectId: existingObjectId,
        feePolicy,
      };
    } catch (error) {
      if ((error instanceof Error ? error.message : "") !== "reputation_profile_not_found") {
        throw error;
      }
    }

    const request = {
      packageId,
      sender: actorAddress,
      reputationFeeConfigObjectId: feePolicy.configObjectId,
      initFeeAmount: BigInt(feePolicy.amount),
      expectedInitFeeAmount: BigInt(feePolicy.amount),
      ...(paymentCoinObjectId ? { paymentCoinObjectId } : {}),
    };
    const transaction = buildCreateReputationProfileTx(request);
    const dryRun = parseBooleanOption(options["dry-run"], false);
    if (dryRun) {
      const result = await dryRunTransaction(transaction, {
        network: options.network,
        rpcUrl: options["rpc-url"],
      });
      return {
        ok: true,
        mode: "dry_run",
        actorAddress,
        packageId,
        chainConfig,
        feePolicy,
        gasSummary: formatDryRunGasSummary(result.result),
        dryRun: result.result,
      };
    }

    const executed = await executeTransaction(transaction, {
      alias: signer.alias,
      address: signer.address,
      keystorePath: signer.keystorePath,
      network: options.network,
      rpcUrl: options["rpc-url"],
    });

    let reputationProfileObjectId = extractCreatedObjectIdByTypeSuffix(executed, "::reputation::ReputationProfile");
    if (!reputationProfileObjectId) {
      for (const retryDelayMs of [0, 500, 1200]) {
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs);
        }
        try {
          reputationProfileObjectId = await resolveClawdexReputationProfileObjectIdByOwner({
            packageId,
            ownerAddress: actorAddress,
            reputationInitFeeConfigObjectId: feePolicy.configObjectId,
            network: options.network,
            rpcUrl: options["rpc-url"],
          });
          if (reputationProfileObjectId) {
            break;
          }
        } catch {
          // Continue retries against index lag.
        }
      }
    }

    return {
      ok: true,
      mode: "execute",
      actorAddress,
      packageId,
      chainConfig,
      feePolicy,
      txDigest: executed.result?.digest || null,
      reputationProfileObjectId: reputationProfileObjectId || null,
      createdObjects: extractCreatedObjects(executed),
      execution: executed.result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "reputation_init_failed",
    };
  }
}

async function runReviewerRegister(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: reviewerRegisterUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  try {
    const runtimeContext = await resolveApiRuntimeContext(options);
    const signer = await resolveRuntimeSignerEntry(options, runtimeContext);
    const actorAddress =
      normalizeIotaAddress(runtimeContext.authState?.address || runtimeContext.envValues?.CLAWNERA_API_ADDRESS || "") ||
      normalizeIotaAddress(signer.entry.address || "");
    if (!actorAddress) {
      return {
        ok: false,
        error: "missing_actor_address",
      };
    }
    if (actorAddress !== normalizeIotaAddress(signer.entry.address)) {
      return {
        ok: false,
        error: "signer_actor_mismatch",
      };
    }

    const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
    const currentMetrics = await callApiRoute({
      method: "GET",
      rawPath: "/reviewers/me/metrics",
      options,
      timeoutMs,
    });
    if (currentMetrics.result.ok && currentMetrics.result.body?.registered === true) {
      return {
        ok: true,
        mode: "existing",
        actorAddress,
        reviewer: currentMetrics.result.body?.reviewer || null,
        metrics: currentMetrics.result.body?.metrics || null,
      };
    }

    const { chainConfig } = await fetchPolicyAndChainConfig(options, {
      requireDisputeQuorumConfig: true,
      requireEscrowFeeConfig: false,
      requireGovernanceConfig: false,
      network: options.network,
      rpcUrl: options["rpc-url"],
    });

    let reputationProfileObjectId = "";
    try {
      reputationProfileObjectId = await resolveClawdexReputationProfileObjectIdByOwner({
        packageId: chainConfig.packageId,
        ownerAddress: actorAddress,
        disputeQuorumConfigObjectId: chainConfig.disputeQuorumConfigObjectId,
        network: options.network,
        rpcUrl: options["rpc-url"],
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "reviewer_reputation_profile_not_found",
        hint: "run clawnera-help reputation-init first",
      };
    }

    const transportKeyVersion = parsePositiveIntOption(options["transport-key-version"], "transport_key_version", 1);
    const transportKeyFile = resolveKeyAgreementRecordPathOption(
      actorAddress,
      transportKeyVersion,
      options["transport-key-file"] || options["key-file"],
      runtimeContext.authStateFile,
    );
    let keyRecord;
    try {
      keyRecord = await loadKeyAgreementRecord(transportKeyFile, {
        expectedAddress: actorAddress,
        expectedKeyVersion: transportKeyVersion,
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "missing_key_agreement_record",
        keyFile: transportKeyFile,
        hint: "run clawnera-help key-agreement-upsert first",
      };
    }

    const body = {
      reviewerRegistryObjectId: chainConfig.reviewerRegistryObjectId,
      disputeQuorumConfigObjectId: chainConfig.disputeQuorumConfigObjectId,
      reputationProfileObjectId,
      transportType: parseU8Option(options["transport-type"], "transport_type", 0),
      transportPubkeyHex: keyAgreementPublicKeyHex(keyRecord.publicKeyMultibase),
      minCaseRewardIota:
        options["min-case-reward-iota"] !== undefined
          ? parsePositiveBigIntOption(options["min-case-reward-iota"], "min_case_reward_iota").toString()
          : "1",
      stakeAmount:
        options["stake-amount"] !== undefined
          ? parsePositiveBigIntOption(options["stake-amount"], "stake_amount").toString()
          : chainConfig.reviewerMinStakeIota.toString(),
    };

    const planCall = await callApiRoute({
      method: "POST",
      rawPath: "/reviewers/register",
      options: {
        ...options,
        body: JSON.stringify(body),
      },
      timeoutMs,
    });
    if (!planCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(planCall.result),
        status: planCall.result.status,
        response: planCall.result.body,
        requestBody: body,
      };
    }
    const txPlan = detectTxPlanPayload(planCall.result.body);
    if (!txPlan) {
      return {
        ok: false,
        error: "missing_tx_plan",
        response: planCall.result.body,
      };
    }

    const transaction = buildClawdexTxFromPlan(planCall.result.body);
    const dryRun = parseBooleanOption(options["dry-run"], false);
    if (dryRun) {
      const result = await dryRunTransaction(transaction, {
        network: options.network,
        rpcUrl: options["rpc-url"],
      });
      return {
        ok: true,
        mode: "dry_run",
        actorAddress,
        txBuilder: txPlan.txBuilder,
        requestBody: body,
        gasSummary: formatDryRunGasSummary(result.result),
        dryRun: result.result,
      };
    }

    const executed = await executeTransaction(transaction, {
      alias: signer.alias,
      address: signer.address,
      keystorePath: signer.keystorePath,
      network: options.network,
      rpcUrl: options["rpc-url"],
    });

    let reviewerReadback = null;
    for (const retryDelayMs of [0, 400, 1000]) {
      if (retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
      const readback = await callApiRoute({
        method: "GET",
        rawPath: `/reviewers/${actorAddress}`,
        options,
        timeoutMs,
      });
      if (readback.result.ok && readback.result.body?.reviewer) {
        reviewerReadback = readback.result.body.reviewer;
        break;
      }
    }

    return {
      ok: true,
      mode: "execute",
      actorAddress,
      txBuilder: txPlan.txBuilder,
      txDigest: executed.result?.digest || null,
      requestBody: body,
      reviewer: reviewerReadback,
      createdObjects: extractCreatedObjects(executed),
      execution: executed.result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "reviewer_register_failed",
    };
  }
}

async function runDeliverableEncrypt(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: deliverableEncryptUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  const milestoneId = typeof options["milestone-id"] === "string" ? options["milestone-id"].trim() : "";
  const plaintextFile =
    typeof options["plaintext-file"] === "string" && options["plaintext-file"].trim()
      ? path.resolve(String(options["plaintext-file"]).trim())
      : "";
  if (!orderId || !milestoneId || !plaintextFile) {
    return {
      ok: false,
      error: "missing_order_id_milestone_id_or_plaintext_file",
    };
  }
  if (!fs.existsSync(plaintextFile)) {
    return {
      ok: false,
      error: "missing_plaintext_file",
      plaintextFile,
    };
  }

  try {
    const runtimeContext = await resolveApiRuntimeContext(options);
    const signer = await resolveRuntimeSignerEntry(options, runtimeContext);
    const actorAddress =
      normalizeIotaAddress(runtimeContext.authState?.address || runtimeContext.envValues?.CLAWNERA_API_ADDRESS || "") ||
      normalizeIotaAddress(signer.entry.address || "");
    const orderCall = await callApiRoute({
      method: "GET",
      rawPath: `/orders/${orderId}`,
      options,
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    if (!orderCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(orderCall.result),
        status: orderCall.result.status,
        response: orderCall.result.body,
      };
    }
    const order = ensureOrderPayload(orderCall.result.body);
    const sellerAddress = normalizeIotaAddress(order.sellerAddress || "");
    const buyerAddress = normalizeIotaAddress(order.buyerAddress || "");
    if (!sellerAddress || !buyerAddress) {
      return {
        ok: false,
        error: "order_party_addresses_missing",
      };
    }
    if (actorAddress !== sellerAddress) {
      return {
        ok: false,
        error: "actor_not_order_seller",
      };
    }

    const sellerKeyVersion = parsePositiveIntOption(options["seller-key-version"], "seller_key_version", 1);
    const sellerKeyFile = resolveKeyAgreementRecordPathOption(
      sellerAddress,
      sellerKeyVersion,
      options["seller-key-file"],
      runtimeContext.authStateFile,
    );
    const sellerKeyRead = await callApiRoute({
      method: "GET",
      rawPath: `/users/${sellerAddress}/key-agreement?keyVersion=${sellerKeyVersion}`,
      options,
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    if (!sellerKeyRead.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(sellerKeyRead.result),
        status: sellerKeyRead.result.status,
        response: sellerKeyRead.result.body,
      };
    }
    const sellerRemoteKeyAgreement = sellerKeyRead.result.body?.keyAgreement;
    const sellerRemoteExpiresAtMs =
      sellerRemoteKeyAgreement && typeof sellerRemoteKeyAgreement.expiresAt === "string"
        ? Date.parse(sellerRemoteKeyAgreement.expiresAt)
        : null;
    const sellerKeyRecord = await loadKeyAgreementRecord(sellerKeyFile, {
      expectedAddress: sellerAddress,
      expectedKeyVersion: sellerKeyVersion,
      fallbackExpiresAtMs:
        Number.isSafeInteger(sellerRemoteExpiresAtMs) && sellerRemoteExpiresAtMs > 0
          ? sellerRemoteExpiresAtMs
          : Date.now() + 86_400_000
    });
    if (sellerKeyRecord.address !== sellerAddress) {
      return {
        ok: false,
        error: "seller_key_file_address_mismatch",
        sellerKeyFile,
      };
    }
    if (sellerRemoteKeyAgreement?.publicKeyMultibase !== sellerKeyRecord.publicKeyMultibase) {
      return {
        ok: false,
        error: "seller_key_agreement_readback_mismatch",
      };
    }

    const buyerKeyVersion = parsePositiveIntOption(options["buyer-key-version"], "buyer_key_version", 1);
    const buyerKeyRead = await callApiRoute({
      method: "GET",
      rawPath: `/users/${buyerAddress}/key-agreement?keyVersion=${buyerKeyVersion}`,
      options,
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    if (!buyerKeyRead.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(buyerKeyRead.result),
        status: buyerKeyRead.result.status,
        response: buyerKeyRead.result.body,
      };
    }
    const buyerKeyAgreement = buyerKeyRead.result.body?.keyAgreement;
    if (!buyerKeyAgreement?.publicKeyMultibase) {
      return {
        ok: false,
        error: "buyer_key_agreement_missing",
      };
    }

    const plaintext = fs.readFileSync(plaintextFile);
    const plaintextLabel =
      typeof options.label === "string" && options.label.trim()
        ? String(options.label).trim()
        : path.basename(plaintextFile);
    const encrypted = await createEncryptedDeliverable({
      plaintext,
      recipients: [
        {
          recipientAddress: sellerAddress,
          keyVersion: sellerKeyRecord.keyVersion,
          recipientPublicKeyMultibase: sellerKeyRecord.publicKeyMultibase,
        },
        {
          recipientAddress: buyerAddress,
          keyVersion: buyerKeyVersion,
          recipientPublicKeyMultibase: buyerKeyAgreement.publicKeyMultibase,
        },
      ],
    });
    const payload = buildManagedDeliverablePayload({
      orderId,
      milestoneId,
      plaintextLabel,
      encrypted,
    });
    const payloadOut =
      resolveOptionalPathOption(options["payload-out"]) ||
      path.resolve(process.cwd(), `clawnera-deliverable-${orderId}-${milestoneId}.json`);
    await writeManagedDeliverablePayload(payloadOut, payload);
    const storagePolicyCall = await callApiRoute({
      method: "GET",
      rawPath: "/policy/storage",
      options,
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    const managedJsonAllowed = Boolean(
      storagePolicyCall.result.ok &&
        storagePolicyCall.result.body?.policy?.modes?.managed?.enabled &&
        Array.isArray(storagePolicyCall.result.body?.policy?.modes?.managed?.allowedMimeTypes) &&
        storagePolicyCall.result.body.policy.modes.managed.allowedMimeTypes.includes("application/json"),
    );
    const authStateHint = shellQuote(runtimeContext.authStateFile || "~/.config/clawnera/auth-state.json");
    const managedNextUploadHint = managedJsonAllowed
      ? `clawnera-help managed-storage-fee-pay --order-id ${shellQuote(orderId)} --milestone-id ${shellQuote(milestoneId)} --auth-state-file ${authStateHint}`
      : null;
    return {
      ok: true,
      orderId,
      milestoneId,
      sellerAddress,
      buyerAddress,
      sellerKeyVersion: sellerKeyRecord.keyVersion,
      buyerKeyVersion,
      cipherSuite: encrypted.cipherSuite,
      plaintextLabel,
      plaintextFile,
      plaintextBytes: plaintext.length,
      ciphertextSha256: encrypted.blob.ciphertextSha256,
      payloadOut,
      payload,
      nextUploadHint:
        managedNextUploadHint ||
        `clawnera-help pinata-upload-json --file ${shellQuote(payloadOut)} --jwt-env PINATA_JWT`,
      nextSubmitHint:
        `clawnera-help milestone-submit-byo --order-id ${shellQuote(orderId)} --milestone-id ${shellQuote(milestoneId)} ` +
        `--payload-file ${shellQuote(payloadOut)} --manifest-cid 'ipfs://<cid>' --auth-state-file ${authStateHint}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "deliverable_encrypt_failed",
    };
  }
}

async function runManagedStorageFeePay(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: managedStorageFeePayUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  const milestoneId = typeof options["milestone-id"] === "string" ? options["milestone-id"].trim() : "";
  if (!orderId || !milestoneId) {
    return {
      ok: false,
      error: "missing_order_id_or_milestone_id",
    };
  }

  try {
    const runtimeContext = await resolveApiRuntimeContext(options);
    const signer = await resolveRuntimeSignerEntry(options, runtimeContext);
    const actorAddress = resolveActorAddressForSignedRun(options, runtimeContext) || normalizeIotaAddress(signer.entry.address || "");
    if (!actorAddress) {
      return {
        ok: false,
        error: "missing_actor_address",
      };
    }
    if (actorAddress !== normalizeIotaAddress(signer.entry.address || "")) {
      return {
        ok: false,
        error: "signer_actor_mismatch",
      };
    }
    const orderCall = await callApiRoute({
      method: "GET",
      rawPath: `/orders/${orderId}`,
      options,
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    if (!orderCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(orderCall.result),
        status: orderCall.result.status,
        response: orderCall.result.body,
      };
    }
    const order = ensureOrderPayload(orderCall.result.body);
    const parties = new Set([
      normalizeIotaAddress(order.sellerAddress || ""),
      normalizeIotaAddress(order.buyerAddress || ""),
    ]);
    if (!parties.has(actorAddress)) {
      return {
        ok: false,
        error: "actor_not_order_party",
      };
    }

    const storagePolicyCall = await callApiRoute({
      method: "GET",
      rawPath: "/policy/storage",
      options,
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    if (!storagePolicyCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(storagePolicyCall.result),
        status: storagePolicyCall.result.status,
        response: storagePolicyCall.result.body,
      };
    }
    const managedPolicy = storagePolicyCall.result.body?.policy?.modes?.managed;
    const feePolicy = managedPolicy?.fee;
    if (!managedPolicy?.enabled || !feePolicy) {
      return {
        ok: false,
        error: "managed_storage_disabled",
      };
    }
    if (String(feePolicy.asset || "").trim().toUpperCase() !== "IOTA") {
      return {
        ok: false,
        error: "managed_storage_fee_asset_unsupported",
        feeAsset: feePolicy.asset || null,
      };
    }
    const amountAtomic = parsePositiveBigIntOption(feePolicy.minAtomic, "managed_storage_fee_min_atomic");
    const recipientAddress = normalizeIotaAddress(feePolicy.recipient || "");
    if (!recipientAddress) {
      return {
        ok: false,
        error: "managed_storage_fee_recipient_missing",
      };
    }

    const { packageId } = await fetchPolicyAndChainConfig(options, {
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    const tx = buildManagedStorageFeeTx({
      packageId,
      sender: actorAddress,
      orderId,
      milestoneId,
      recipientAddress,
      amountAtomic,
    });
    const dryRun = parseBooleanOption(options["dry-run"], false);
    if (dryRun) {
      const dryRunResult = await dryRunTransaction(tx, {
        alias: signer.alias,
        address: signer.address,
        keystorePath: signer.keystorePath,
        network: options.network,
        rpcUrl: options["rpc-url"],
      });
      return {
        ok: true,
        mode: "dry_run",
        orderId,
        milestoneId,
        actorAddress,
        packageId,
        managedStoragePolicy: managedPolicy,
        paymentProof: {
          txDigest: null,
          amountAtomic: amountAtomic.toString(),
          asset: "IOTA",
          recipientAddress,
        },
        dryRun: dryRunResult,
      };
    }

    const executed = await executeTransaction(tx, {
      alias: signer.alias,
      address: signer.address,
      keystorePath: signer.keystorePath,
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    const txDigest = executed.result?.digest || null;
    if (!txDigest) {
      return {
        ok: false,
        error: "managed_storage_fee_tx_digest_missing",
      };
    }
    const paymentProof = {
      txDigest,
      amountAtomic: amountAtomic.toString(),
      asset: "IOTA",
      recipientAddress,
    };
    const proofOut = resolveOptionalPathOption(options["proof-out"]) || defaultManagedStorageFeeProofPath(orderId, milestoneId);
    writeOptionalOutputFile(
      proofOut,
      `${JSON.stringify(
        {
          orderId,
          milestoneId,
          actorAddress,
          paymentProof,
        },
        null,
        2,
      )}\n`,
    );
    return {
      ok: true,
      mode: "execute",
      orderId,
      milestoneId,
      actorAddress,
      packageId,
      txDigest,
      paymentProof,
      proofOut,
      execution: executed.result,
      nextPresignHint:
        `clawnera-help managed-storage-presign --order-id ${shellQuote(orderId)} --milestone-id ${shellQuote(milestoneId)} ` +
        `--file <payload.json> --payment-proof-file ${shellQuote(proofOut)} --auth-state-file ${shellQuote(runtimeContext.authStateFile || "~/.config/clawnera/auth-state.json")}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "managed_storage_fee_pay_failed",
    };
  }
}

async function runManagedStoragePresign(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: managedStoragePresignUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  const milestoneId = typeof options["milestone-id"] === "string" ? options["milestone-id"].trim() : "";
  const filePath = resolveOptionalPathOption(options.file);
  const paymentProofFile = resolveOptionalPathOption(options["payment-proof-file"]);
  if (!orderId || !milestoneId || !filePath || !paymentProofFile) {
    return {
      ok: false,
      error: "missing_order_id_milestone_id_file_or_payment_proof_file",
    };
  }
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      error: "missing_upload_file",
      filePath,
    };
  }
  if (!fs.existsSync(paymentProofFile)) {
    return {
      ok: false,
      error: "missing_payment_proof_file",
      paymentProofFile,
    };
  }

  try {
    const runtimeContext = await resolveApiRuntimeContext(options);
    const fileMetadata = computeFileMetadata(filePath, typeof options["mime-type"] === "string" ? options["mime-type"] : "");
    const paymentProof = normalizeManagedStoragePaymentProof(readJsonFileSync(paymentProofFile, "invalid_payment_proof_file"));
    const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
    const maxAttempts = parsePositiveIntOption(options["attempts"], "attempts", 8);
    const delayMs = parsePositiveIntOption(options["delay-ms"], "delay_ms", 2_500);
    const requestBody = {
      orderId,
      milestoneId,
      mode: "managed",
      fileName:
        typeof options["file-name"] === "string" && options["file-name"].trim()
          ? String(options["file-name"]).trim()
          : fileMetadata.fileName,
      mimeType: fileMetadata.mimeType,
      fileSizeBytes: fileMetadata.fileSizeBytes,
      sha256: fileMetadata.sha256,
      paymentProof,
    };

    let lastCall = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      lastCall = await callApiRoute({
        method: "POST",
        rawPath: "/storage/uploads/presign",
        options: {
          ...options,
          body: JSON.stringify(requestBody),
        },
        timeoutMs,
      });
      if (lastCall.result.ok) {
        break;
      }
      if (lastCall.result.body?.error !== "storage_fee_event_not_found" || attempt === maxAttempts) {
        break;
      }
      await sleep(delayMs);
    }

    if (!lastCall || !lastCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(lastCall?.result),
        status: lastCall?.result?.status,
        response: lastCall?.result?.body,
      };
    }
    const signedUrl = typeof lastCall.result.body?.upload?.signedUrl === "string" ? lastCall.result.body.upload.signedUrl.trim() : "";
    if (!signedUrl) {
      return {
        ok: false,
        error: "managed_storage_presign_missing_signed_url",
        response: lastCall.result.body,
      };
    }
    const presignOut = resolveOptionalPathOption(options["presign-out"]) || defaultManagedStoragePresignPath(orderId, milestoneId);
    const presignBundle = {
      orderId,
      milestoneId,
      request: requestBody,
      response: lastCall.result.body,
      apiBase: lastCall.apiBase,
      authStateFile: runtimeContext.authStateFile || null,
    };
    writeOptionalOutputFile(presignOut, `${JSON.stringify(presignBundle, null, 2)}\n`);
    return {
      ok: true,
      orderId,
      milestoneId,
      filePath,
      fileName: requestBody.fileName,
      mimeType: requestBody.mimeType,
      fileSizeBytes: requestBody.fileSizeBytes,
      sha256: requestBody.sha256,
      paymentProof,
      presignOut,
      response: lastCall.result.body,
      nextUploadHint:
        `clawnera-help managed-storage-upload --file ${shellQuote(filePath)} --presign-file ${shellQuote(presignOut)}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "managed_storage_presign_failed",
    };
  }
}

async function runManagedStorageUpload(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: managedStorageUploadUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  const filePath = resolveOptionalPathOption(options.file);
  const presignFile = resolveOptionalPathOption(options["presign-file"]);
  if (!filePath) {
    return {
      ok: false,
      error: "missing_upload_file",
    };
  }
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      error: "missing_upload_file",
      filePath,
    };
  }

  try {
    const explicitSignedUrl = typeof options["signed-url"] === "string" ? options["signed-url"].trim() : "";
    let presign = {
      signedUrl: explicitSignedUrl,
      expiresAt: null,
      fileName: "",
      mimeType: "",
      fileSizeBytes: null,
      sha256: "",
      orderId: "",
      milestoneId: "",
      raw: null,
    };
    if (presignFile) {
      if (!fs.existsSync(presignFile)) {
        return {
          ok: false,
          error: "missing_presign_file",
          presignFile,
        };
      }
      presign = parseManagedStoragePresignBundle(readJsonFileSync(presignFile, "invalid_managed_storage_presign_file"));
    }
    const signedUrl = presign.signedUrl || explicitSignedUrl;
    if (!signedUrl) {
      return {
        ok: false,
        error: "missing_signed_url_or_presign_file",
      };
    }
    const expiresAtMs = parseOptionalIsoTimestamp(presign.expiresAt);
    if (expiresAtMs !== null && expiresAtMs <= Date.now() + 5_000) {
      return {
        ok: false,
        error: "managed_storage_signed_url_expired",
        expiresAt: presign.expiresAt,
      };
    }

    const fileMetadata = computeFileMetadata(filePath, typeof options["mime-type"] === "string" ? options["mime-type"] : presign.mimeType);
    if (presign.sha256 && presign.sha256 !== fileMetadata.sha256) {
      return {
        ok: false,
        error: "managed_storage_upload_sha256_mismatch",
        expectedSha256: presign.sha256,
        actualSha256: fileMetadata.sha256,
      };
    }
    if (presign.fileSizeBytes !== null && presign.fileSizeBytes !== fileMetadata.fileSizeBytes) {
      return {
        ok: false,
        error: "managed_storage_upload_file_size_mismatch",
        expectedFileSizeBytes: presign.fileSizeBytes,
        actualFileSizeBytes: fileMetadata.fileSizeBytes,
      };
    }

    const uploadFileName =
      typeof options["file-name"] === "string" && options["file-name"].trim()
        ? String(options["file-name"]).trim()
        : presign.fileName || fileMetadata.fileName;
    const formData = new FormData();
    formData.set("file", new Blob([fileMetadata.buffer], { type: fileMetadata.mimeType }), uploadFileName);
    const response = await fetch(signedUrl, {
      method: "POST",
      body: formData,
    });
    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        error: `managed_storage_upload_failed:${response.status}`,
        status: response.status,
        response: parsed,
        raw,
      };
    }
    const uploadParsed = parseSignedUploadPayload(parsed);
    const uploadOut =
      resolveOptionalPathOption(options["upload-out"]) ||
      (presign.orderId && presign.milestoneId ? defaultManagedStorageUploadPath(presign.orderId, presign.milestoneId) : "");
    if (uploadOut) {
      writeOptionalOutputFile(
        uploadOut,
        `${JSON.stringify(
          {
            orderId: presign.orderId || null,
            milestoneId: presign.milestoneId || null,
            request: {
              fileName: uploadFileName,
              mimeType: fileMetadata.mimeType,
              fileSizeBytes: fileMetadata.fileSizeBytes,
              sha256: fileMetadata.sha256,
            },
            response: parsed,
            ipfsUri: uploadParsed.ipfsUri,
          },
          null,
          2,
        )}\n`,
      );
    }
    return {
      ok: true,
      orderId: presign.orderId || null,
      milestoneId: presign.milestoneId || null,
      filePath,
      fileName: uploadFileName,
      mimeType: fileMetadata.mimeType,
      fileSizeBytes: fileMetadata.fileSizeBytes,
      sha256: fileMetadata.sha256,
      presignFile: presignFile || null,
      uploadOut: uploadOut || null,
      response: parsed,
      cid: uploadParsed.cid || null,
      ipfsUri: uploadParsed.ipfsUri,
      nextSubmitHint:
        uploadParsed.ipfsUri && presign.orderId && presign.milestoneId
          ? `clawnera-help milestone-submit-byo --order-id ${shellQuote(presign.orderId)} --milestone-id ${shellQuote(presign.milestoneId)} --payload-file ${shellQuote(filePath)} --manifest-cid ${shellQuote(uploadParsed.ipfsUri)} --auth-state-file <file>`
          : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "managed_storage_upload_failed",
    };
  }
}

async function runPinataUploadJson(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: pinataUploadJsonUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }
  const filePath =
    typeof options.file === "string" && options.file.trim() ? path.resolve(String(options.file).trim()) : "";
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      ok: false,
      error: "missing_upload_file",
      filePath,
    };
  }
  const jwtEnvName = typeof options["jwt-env"] === "string" && options["jwt-env"].trim()
    ? String(options["jwt-env"]).trim()
    : "PINATA_JWT";
  const jwtFile =
    typeof options["jwt-file"] === "string" && options["jwt-file"].trim()
      ? path.resolve(String(options["jwt-file"]).trim())
      : "";
  const fileJwt = jwtFile && fs.existsSync(jwtFile) ? fs.readFileSync(jwtFile, "utf8").trim() : "";
  const jwt =
    (typeof options.jwt === "string" && options.jwt.trim() ? String(options.jwt).trim() : "") ||
    fileJwt ||
    (typeof process.env[jwtEnvName] === "string" ? process.env[jwtEnvName].trim() : "");
  if (!jwt) {
    return {
      ok: false,
      error: "missing_pinata_jwt",
      hint: `set --jwt <token>, --jwt-file <file>, or export ${jwtEnvName}=...`,
    };
  }

  try {
    const parsed = readJsonFileSync(filePath, "invalid_json_upload_file");
    const name =
      typeof options.name === "string" && options.name.trim()
        ? String(options.name).trim()
        : path.basename(filePath);
    const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        pinataContent: parsed,
        pinataMetadata: { name },
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.IpfsHash) {
      return {
        ok: false,
        error: `pinata_upload_failed:${response.status}`,
        response: body,
      };
    }
    return {
      ok: true,
      filePath,
      name,
      cid: body.IpfsHash,
      ipfsUri: `ipfs://${body.IpfsHash}`,
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${body.IpfsHash}`,
      pinSize: body.PinSize ?? null,
      timestamp: body.Timestamp ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "pinata_upload_failed",
    };
  }
}

async function runMilestoneSubmitByo(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: milestoneSubmitByoUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }
  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  const milestoneId = typeof options["milestone-id"] === "string" ? options["milestone-id"].trim() : "";
  const payloadFile =
    typeof options["payload-file"] === "string" && options["payload-file"].trim()
      ? path.resolve(String(options["payload-file"]).trim())
      : "";
  const manifestCid = typeof options["manifest-cid"] === "string" ? options["manifest-cid"].trim() : "";
  if (!orderId || !milestoneId || !payloadFile || !manifestCid) {
    return {
      ok: false,
      error: "missing_order_id_milestone_id_payload_file_or_manifest_cid",
    };
  }
  if (!fs.existsSync(payloadFile)) {
    return {
      ok: false,
      error: "missing_payload_file",
      payloadFile,
    };
  }

  try {
    const runtimeContext = await resolveApiRuntimeContext(options);
    const signer = await resolveRuntimeSignerEntry(options, runtimeContext);
    const actorAddress =
      normalizeIotaAddress(runtimeContext.authState?.address || runtimeContext.envValues?.CLAWNERA_API_ADDRESS || "") ||
      normalizeIotaAddress(signer.entry.address || "");
    const orderCall = await callApiRoute({
      method: "GET",
      rawPath: `/orders/${orderId}`,
      options,
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    if (!orderCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(orderCall.result),
        status: orderCall.result.status,
        response: orderCall.result.body,
      };
    }
    const order = ensureOrderPayload(orderCall.result.body);
    const sellerAddress = normalizeIotaAddress(order.sellerAddress || "");
    if (actorAddress !== sellerAddress) {
      return {
        ok: false,
        error: "actor_not_order_seller",
      };
    }

    const payload = normalizeManagedDeliverablePayload(readJsonFileSync(payloadFile, "invalid_payload_file"));
    const recipients = Array.isArray(payload?.encrypted?.cekWraps) ? payload.encrypted.cekWraps : [];
    const sellerRecipient = recipients.find((entry) => normalizeIotaAddress(entry.recipientAddress || "") === sellerAddress);
    if (!sellerRecipient) {
      return {
        ok: false,
        error: "seller_recipient_wrap_missing",
      };
    }
    const prepared = await prepareMilestoneManifestForSigning({
      orderId,
      milestoneId,
      sellerAddress,
      sellerKeyVersion: sellerRecipient.keyVersion,
      manifestCid,
      cipherSuite: payload?.encrypted?.blob ? DEFAULT_E2EE_CIPHER_SUITE : DEFAULT_E2EE_CIPHER_SUITE,
      recipients,
    });
    const signed = await signer.keypair.signPersonalMessage(new TextEncoder().encode(prepared.signingMessage));
    const submitBody = buildSignedMilestoneSubmitPayload(prepared, signed.signature);
    const bodyOut =
      resolveOptionalPathOption(options["body-out"]) ||
      path.resolve(process.cwd(), `clawnera-milestone-submit-${orderId}-${milestoneId}.json`);
    writeOptionalOutputFile(bodyOut, `${JSON.stringify(submitBody, null, 2)}\n`);

    const submitCall = await callApiRoute({
      method: "POST",
      rawPath: `/orders/${orderId}/milestones/${milestoneId}/submit`,
      options: {
        ...options,
        body: JSON.stringify(submitBody),
      },
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    if (!submitCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(submitCall.result),
        status: submitCall.result.status,
        response: submitCall.result.body,
      };
    }
    return {
      ok: true,
      orderId,
      milestoneId,
      bodyOut,
      manifestCid,
      manifestSha256: prepared.manifest.manifestSha256,
      sellerSignatureHash: sha256Hex(signed.signature),
      response: submitCall.result.body,
      nextAnchorHint:
        `clawnera-help milestone-anchor --order-id ${shellQuote(orderId)} --milestone-id ${shellQuote(milestoneId)} ` +
        `--submit-body-file ${shellQuote(bodyOut)} --auth-state-file ${shellQuote(runtimeContext.authStateFile || "~/.config/clawnera/auth-state.json")}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "milestone_submit_byo_failed",
    };
  }
}

async function runMilestoneAnchor(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: milestoneAnchorUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }
  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  const milestoneId = typeof options["milestone-id"] === "string" ? options["milestone-id"].trim() : "";
  if (!orderId || !milestoneId) {
    return {
      ok: false,
      error: "missing_order_id_or_milestone_id",
    };
  }

  try {
    const runtimeContext = await resolveApiRuntimeContext(options);
    const signer = await resolveRuntimeSignerEntry(options, runtimeContext);
    const actorAddress =
      normalizeIotaAddress(runtimeContext.authState?.address || runtimeContext.envValues?.CLAWNERA_API_ADDRESS || "") ||
      normalizeIotaAddress(signer.entry.address || "");
    const orderCall = await callApiRoute({
      method: "GET",
      rawPath: `/orders/${orderId}`,
      options,
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    if (!orderCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(orderCall.result),
        status: orderCall.result.status,
        response: orderCall.result.body,
      };
    }
    const order = ensureOrderPayload(orderCall.result.body);
    const sellerAddress = normalizeIotaAddress(order.sellerAddress || "");
    if (actorAddress !== sellerAddress) {
      return {
        ok: false,
        error: "actor_not_order_seller",
      };
    }

    let manifestCid = typeof options["manifest-cid"] === "string" ? options["manifest-cid"].trim() : "";
    let manifestSha256 = typeof options["manifest-sha256"] === "string" ? options["manifest-sha256"].trim() : "";
    let sellerSignature = typeof options["seller-signature"] === "string" ? options["seller-signature"].trim() : "";
    const submitBodyFile =
      typeof options["submit-body-file"] === "string" && options["submit-body-file"].trim()
        ? path.resolve(String(options["submit-body-file"]).trim())
        : "";
    if (submitBodyFile) {
      const submitBody = readJsonFileSync(submitBodyFile, "invalid_submit_body_file");
      manifestCid = manifestCid || submitBody?.manifest?.manifestCid || "";
      manifestSha256 = manifestSha256 || submitBody?.manifest?.manifestSha256 || "";
      sellerSignature = sellerSignature || submitBody?.manifest?.sellerSignature || "";
    }
    manifestCid = assertIpfsManifestCid(manifestCid);
    manifestSha256 = assertLowerHex64(manifestSha256, "manifest_sha256");
    sellerSignature = normalizeString(sellerSignature);
    if (!sellerSignature) {
      return {
        ok: false,
        error: "missing_seller_signature",
      };
    }

    const { packageId } = await fetchPolicyAndChainConfig(options, {
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    const anchorTx = buildMilestoneAnchorTx({
      packageId,
      sender: sellerAddress,
      sellerAddress,
      orderId,
      milestoneId,
      manifestCid,
      manifestSha256,
      sellerSignatureHash: sha256Hex(sellerSignature),
    });
    const executed = await executeTransaction(anchorTx, {
      alias: signer.alias,
      address: signer.address,
      keystorePath: signer.keystorePath,
      network: options.network,
      rpcUrl: options["rpc-url"],
    });
    const txDigest = executed.result?.digest || null;
    if (!txDigest) {
      return {
        ok: false,
        error: "missing_anchor_tx_digest",
      };
    }
    const postCall = await callApiRoute({
      method: "POST",
      rawPath: `/orders/${orderId}/milestones/${milestoneId}/anchor`,
      options: {
        ...options,
        body: JSON.stringify({ txDigest }),
      },
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    if (!postCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(postCall.result),
        status: postCall.result.status,
        response: postCall.result.body,
      };
    }
    let getCall = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      getCall = await callApiRoute({
        method: "GET",
        rawPath: `/orders/${orderId}/milestones/${milestoneId}/anchor`,
        options,
        timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
      });
      if (getCall.result.ok) {
        break;
      }
      const errorCode = asRecord(getCall.result.body)?.error;
      if (errorCode !== "anchor_not_found" || attempt === 4) {
        break;
      }
      await sleep(1_000);
    }
    if (!getCall?.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(getCall?.result),
        status: getCall?.result?.status || null,
        response: getCall?.result?.body || null,
      };
    }
    return {
      ok: true,
      orderId,
      milestoneId,
      txDigest,
      anchor: getCall.result.body?.anchor || postCall.result.body?.anchor || null,
      reconcile: postCall.result.body?.reconcile || null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "milestone_anchor_failed",
    };
  }
}

async function runDeliverableDecrypt(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: deliverableDecryptUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  const resolvedManifestFile =
    typeof options["resolved-manifest-file"] === "string" && options["resolved-manifest-file"].trim()
      ? path.resolve(String(options["resolved-manifest-file"]).trim())
      : "";
  const payloadFile =
    typeof options["payload-file"] === "string" && options["payload-file"].trim()
      ? path.resolve(String(options["payload-file"]).trim())
      : "";
  if (!resolvedManifestFile && !payloadFile) {
    return {
      ok: false,
      error: "missing_resolved_manifest_file_or_payload_file",
    };
  }
  const inputFile = resolvedManifestFile || payloadFile;
  if (!fs.existsSync(inputFile)) {
    return {
      ok: false,
      error: "missing_decrypt_input_file",
      inputFile,
    };
  }

  try {
    const runtimeContext =
      options["auth-state-file"] || options["env-file"] || options["api-base"] || options.jwt
        ? await resolveApiRuntimeContext(options)
        : { authState: null, envValues: {} };
    const actorAddress =
      normalizeIotaAddress(options["recipient-address"] || "") ||
      resolveActorAddressForSignedRun(options, runtimeContext);
    if (!actorAddress) {
      return {
        ok: false,
        error: "missing_recipient_address",
      };
    }
    const raw = readJsonFileSync(inputFile, "invalid_decrypt_input_file");
    const payload = resolvedManifestFile
      ? normalizeManagedDeliverablePayload(raw?.resolvedManifest?.payload)
      : normalizeManagedDeliverablePayload(raw);
    const recipients = Array.isArray(payload?.encrypted?.cekWraps) ? payload.encrypted.cekWraps : [];
    const wrap = recipients.find((entry) => normalizeIotaAddress(entry.recipientAddress || "") === actorAddress);
    if (!wrap) {
      return {
        ok: false,
        error: "recipient_wrap_not_found",
      };
    }
    const keyFile = resolveKeyAgreementRecordPathOption(
      actorAddress,
      wrap.keyVersion,
      options["key-file"],
      runtimeContext.authStateFile,
    );
    const keyRecord = await loadKeyAgreementRecord(keyFile, {
      expectedAddress: actorAddress,
      expectedKeyVersion: wrap.keyVersion,
      fallbackExpiresAtMs: Date.now() + 86_400_000
    });
    if (keyRecord.address !== actorAddress || keyRecord.keyVersion !== wrap.keyVersion) {
      return {
        ok: false,
        error: "key_agreement_record_mismatch",
        keyFile,
      };
    }
    const plaintext = await decryptDeliverableForRecipient({
      blob: payload.encrypted.blob,
      wrap,
      recipientPrivateKeyMultibase: keyRecord.privateKeyMultibase,
    });
    const plaintextOut =
      resolveOptionalPathOption(options["plaintext-out"]) ||
      path.resolve(process.cwd(), `clawnera-deliverable-${payload.orderId}-${payload.milestoneId}-${actorAddress.slice(2, 10)}.bin`);
    fs.mkdirSync(path.dirname(plaintextOut), { recursive: true });
    fs.writeFileSync(plaintextOut, Buffer.from(plaintext), { mode: 0o600 });
    fs.chmodSync(plaintextOut, 0o600);
    return {
      ok: true,
      orderId: payload.orderId,
      milestoneId: payload.milestoneId,
      recipientAddress: actorAddress,
      plaintextOut,
      plaintextBytes: plaintext.length,
      plaintextSha256: sha256Hex(Buffer.from(plaintext)),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "deliverable_decrypt_failed",
    };
  }
}

function normalizeMailboxPostedEvent(item) {
  const payload = item?.payloadJson && typeof item.payloadJson === "object" && !Array.isArray(item.payloadJson)
    ? item.payloadJson
    : {};
  const seq = typeof payload.seq === "string" ? payload.seq.trim() : String(payload.seq ?? "").trim();
  return {
    category: "posted",
    id: typeof item?.id === "string" ? item.id : null,
    eventType: typeof item?.eventType === "string" ? item.eventType : "mailbox.signal_posted",
    mailboxObjectId: typeof payload.mailboxObjectId === "string" ? payload.mailboxObjectId : item?.entityId || null,
    orderId: typeof payload.orderId === "string" ? payload.orderId : null,
    seq: seq || null,
    sender: typeof payload.sender === "string" ? payload.sender : null,
    senderRole: typeof payload.senderRole === "string" ? payload.senderRole : null,
    signalIntent: typeof payload.signalIntent === "string" ? payload.signalIntent : null,
    payloadRef: typeof payload.payloadRef === "string" ? payload.payloadRef : null,
    ciphertextHash: typeof payload.ciphertextHash === "string" ? payload.ciphertextHash : null,
    txDigest: typeof payload.txDigest === "string" ? payload.txDigest : null,
    chainTimestampMs: typeof payload.chainCreatedAtMs === "string" ? payload.chainCreatedAtMs : null,
    createdAt: typeof item?.createdAt === "string" ? item.createdAt : null,
    raw: item,
  };
}

function normalizeMailboxAckedEvent(item) {
  const payload = item?.payloadJson && typeof item.payloadJson === "object" && !Array.isArray(item.payloadJson)
    ? item.payloadJson
    : {};
  const ackedSeq = typeof payload.ackedSeq === "string" ? payload.ackedSeq.trim() : String(payload.ackedSeq ?? "").trim();
  return {
    category: "acked",
    id: typeof item?.id === "string" ? item.id : null,
    eventType: typeof item?.eventType === "string" ? item.eventType : "mailbox.signal_acked",
    mailboxObjectId: typeof payload.mailboxObjectId === "string" ? payload.mailboxObjectId : item?.entityId || null,
    orderId: typeof payload.orderId === "string" ? payload.orderId : null,
    ackedSeq: ackedSeq || null,
    acker: typeof payload.acker === "string" ? payload.acker : null,
    ackerRole: typeof payload.ackerRole === "string" ? payload.ackerRole : null,
    txDigest: typeof payload.txDigest === "string" ? payload.txDigest : null,
    chainTimestampMs: typeof payload.chainAckedAtMs === "string" ? payload.chainAckedAtMs : null,
    createdAt: typeof item?.createdAt === "string" ? item.createdAt : null,
    raw: item,
  };
}

function mailboxEventSortKey(event) {
  const chainMs = Number.parseInt(String(event?.chainTimestampMs ?? ""), 10);
  if (Number.isFinite(chainMs)) {
    return chainMs;
  }
  const createdAtMs = Date.parse(String(event?.createdAt ?? ""));
  if (Number.isFinite(createdAtMs)) {
    return createdAtMs;
  }
  const seq = Number.parseInt(String(event?.seq ?? event?.ackedSeq ?? ""), 10);
  return Number.isFinite(seq) ? seq : 0;
}

async function runMailboxEvents(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: mailboxEventsUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  if (!orderId) {
    return {
      ok: false,
      error: "missing_order_id",
    };
  }

  try {
    const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
    const limit = parsePositiveIntOption(options.limit, "limit", 20);
    const includeAcked = parseBooleanOption(options["include-acked"], true);
    const mailboxCall = await callApiRoute({
      method: "GET",
      rawPath: `/orders/${orderId}/mailbox`,
      options,
      timeoutMs,
    });
    if (!mailboxCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(mailboxCall.result),
        status: mailboxCall.result.status,
        response: mailboxCall.result.body,
      };
    }
    const mailboxObjectId =
      typeof mailboxCall.result.body?.mailboxObjectId === "string" ? mailboxCall.result.body.mailboxObjectId.trim() : "";
    if (!mailboxObjectId) {
      return {
        ok: false,
        error: "mailbox_object_id_missing",
      };
    }

    const postedCall = await callApiRoute({
      method: "GET",
      rawPath: `/events?scope=all&type=mailbox.signal_posted&limit=${limit}`,
      options,
      timeoutMs,
    });
    if (!postedCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(postedCall.result),
        status: postedCall.result.status,
        response: postedCall.result.body,
      };
    }
    const postedItems = Array.isArray(postedCall.result.body?.items) ? postedCall.result.body.items : [];
    const postedEvents = postedItems
      .filter((item) => {
        const payload = item?.payloadJson && typeof item.payloadJson === "object" && !Array.isArray(item.payloadJson)
          ? item.payloadJson
          : {};
        return payload.orderId === orderId || payload.mailboxObjectId === mailboxObjectId || item?.entityId === mailboxObjectId;
      })
      .map(normalizeMailboxPostedEvent);

    let ackedEvents = [];
    if (includeAcked) {
      const ackCall = await callApiRoute({
        method: "GET",
        rawPath: `/events?scope=all&type=mailbox.signal_acked&limit=${limit}`,
        options,
        timeoutMs,
      });
      if (!ackCall.result.ok) {
        return {
          ok: false,
          error: summarizeApiFailure(ackCall.result),
          status: ackCall.result.status,
          response: ackCall.result.body,
        };
      }
      const ackItems = Array.isArray(ackCall.result.body?.items) ? ackCall.result.body.items : [];
      ackedEvents = ackItems
        .filter((item) => {
          const payload = item?.payloadJson && typeof item.payloadJson === "object" && !Array.isArray(item.payloadJson)
            ? item.payloadJson
            : {};
          return payload.orderId === orderId || payload.mailboxObjectId === mailboxObjectId || item?.entityId === mailboxObjectId;
        })
        .map(normalizeMailboxAckedEvent);
    }

    const events = postedEvents.concat(ackedEvents).sort((left, right) => mailboxEventSortKey(left) - mailboxEventSortKey(right));
    const latestPostedSeq = postedEvents.reduce((max, event) => {
      const seq = Number.parseInt(String(event.seq ?? ""), 10);
      return Number.isFinite(seq) && seq > max ? seq : max;
    }, 0);
    const latestAckByRole = ackedEvents.reduce((acc, event) => {
      const role = event.ackerRole || "unknown";
      const seq = Number.parseInt(String(event.ackedSeq ?? ""), 10);
      if (Number.isFinite(seq) && (!Number.isFinite(acc[role]) || seq > acc[role])) {
        acc[role] = seq;
      }
      return acc;
    }, {});
    const eventsOut = resolveOptionalPathOption(options["events-out"]);
    if (eventsOut) {
      writeOptionalOutputFile(eventsOut, `${JSON.stringify({ orderId, mailboxObjectId, events }, null, 2)}\n`);
    }
    return {
      ok: true,
      orderId,
      mailboxObjectId,
      limit,
      includeAcked,
      eventCount: events.length,
      latestPostedSeq: latestPostedSeq || null,
      latestAckByRole,
      eventsOut: eventsOut || null,
      events,
      note:
        "Current runtime can map seller DELIVERABLE_READY signals back as CHECKPOINT in the event feed; use payloadRef + ciphertextHash + seq, not only the label.",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "mailbox_events_failed",
    };
  }
}

async function runMilestoneReject(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: milestoneRejectUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }
  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  const milestoneId = typeof options["milestone-id"] === "string" ? options["milestone-id"].trim() : "";
  if (!orderId || !milestoneId) {
    return {
      ok: false,
      error: "missing_order_id_or_milestone_id",
    };
  }

  try {
    let rejectionReasonHash = "";
    let reasonSource = "hash";
    if (typeof options["reason-hash"] === "string" && options["reason-hash"].trim()) {
      rejectionReasonHash = normalizeSha256HashOption(options["reason-hash"], "reason_hash");
    } else if (typeof options["reason-text"] === "string") {
      const reasonText = String(options["reason-text"]);
      if (!reasonText.trim()) {
        return {
          ok: false,
          error: "missing_reason_text",
        };
      }
      rejectionReasonHash = sha256Hex(Buffer.from(reasonText, "utf8"));
      reasonSource = "text";
    } else if (typeof options["reason-file"] === "string" && options["reason-file"].trim()) {
      const reasonFile = path.resolve(String(options["reason-file"]).trim());
      if (!fs.existsSync(reasonFile)) {
        return {
          ok: false,
          error: "missing_reason_file",
          reasonFile,
        };
      }
      rejectionReasonHash = sha256Hex(fs.readFileSync(reasonFile));
      reasonSource = "file";
    } else {
      return {
        ok: false,
        error: "missing_reason_text_file_or_hash",
      };
    }

    const hashOut = resolveOptionalPathOption(options["hash-out"]);
    if (hashOut) {
      writeOptionalOutputFile(hashOut, `${rejectionReasonHash}\n`);
    }
    const rejectCall = await callApiRoute({
      method: "POST",
      rawPath: `/orders/${orderId}/milestones/${milestoneId}/reject`,
      options: {
        ...options,
        body: JSON.stringify({ rejectionReasonHash }),
      },
      timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
    });
    if (!rejectCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(rejectCall.result),
        status: rejectCall.result.status,
        response: rejectCall.result.body,
        rejectionReasonHash,
      };
    }
    return {
      ok: true,
      orderId,
      milestoneId,
      rejectionReasonHash,
      reasonSource,
      hashOut: hashOut || null,
      response: rejectCall.result.body,
      nextDisputeHint: "clawnera-help recipe dispute-open",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "milestone_reject_failed",
    };
  }
}

function defaultReviewerShortlistReceiptPath(orderId, milestoneId) {
  return path.resolve(process.cwd(), `clawnera-reviewer-shortlist-${orderId}-${milestoneId}.json`);
}

function defaultReviewerShortlistPublishPath(orderId, milestoneId) {
  return path.resolve(process.cwd(), `clawnera-dispute-open-${orderId}-${milestoneId}.json`);
}

function parseOrderContextFile(contextFilePath, expectedOrderId, expectedMilestoneId) {
  const raw = readJsonFileSync(contextFilePath, "invalid_order_context_file");
  const wrapper = asRecord(raw);
  const response = asRecord(wrapper?.response);
  const order = asRecord(response?.order || wrapper?.order);
  if (!order) {
    throw new Error("order_context_missing_order");
  }
  const orderId = typeof order.id === "string" ? order.id.trim() : "";
  if (expectedOrderId && orderId !== expectedOrderId) {
    throw new Error("order_context_order_id_mismatch");
  }
  const buyerAddress = normalizeIotaAddress(order.buyerAddress || "");
  const sellerAddress = normalizeIotaAddress(order.sellerAddress || "");
  const escrowObjectId = normalizeIotaAddress(order.escrowObjectId || "");
  const disputeBondObjectId = normalizeIotaAddress(order.disputeBondObjectId || "");
  const orderStatus = typeof order.status === "string" ? order.status.trim() : null;
  if (!buyerAddress || !sellerAddress) {
    throw new Error("order_context_party_addresses_missing");
  }
  const milestones = Array.isArray(response?.milestones)
    ? response.milestones
    : Array.isArray(wrapper?.milestones)
      ? wrapper.milestones
      : [];
  let milestoneStatus = null;
  if (expectedMilestoneId && milestones.length > 0) {
    const milestone = milestones.find((entry) => entry && typeof entry === "object" && entry.id === expectedMilestoneId);
    if (!milestone) {
      throw new Error("order_context_milestone_missing");
    }
    milestoneStatus = typeof milestone.status === "string" ? milestone.status.trim() : null;
  }
  return {
    orderId,
    buyerAddress,
    sellerAddress,
    escrowObjectId,
    disputeBondObjectId,
    orderStatus,
    milestoneStatus,
  };
}

async function runReviewerShortlist(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: reviewerShortlistUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  const orderId = typeof options["order-id"] === "string" ? options["order-id"].trim() : "";
  const milestoneId = typeof options["milestone-id"] === "string" ? options["milestone-id"].trim() : "";
  const scopeRaw = typeof options.scope === "string" ? options.scope.trim().toUpperCase() : "OPEN";
  const scope = scopeRaw === "REPLACEMENT" ? "REPLACEMENT" : "OPEN";
  const contextFile =
    typeof options["order-context-file"] === "string" && options["order-context-file"].trim()
      ? path.resolve(String(options["order-context-file"]).trim())
      : "";
  if (scope === "OPEN" && (!orderId || !milestoneId)) {
    return {
      ok: false,
      error: "missing_order_id_or_milestone_id",
    };
  }
  if (contextFile && !fs.existsSync(contextFile)) {
    return {
      ok: false,
      error: "missing_order_context_file",
      contextFile,
    };
  }

  try {
    const checkpoint = await fetchLatestCheckpointRefForCli(options);
    const { chainConfig } =
      scope === "REPLACEMENT"
        ? await fetchPolicyAndChainConfig(options, {
            network: options.network,
            rpcUrl: options["rpc-url"],
          })
        : { chainConfig: null };
    let replacementRequiredReviewerVotes = null;
    if (scope === "REPLACEMENT") {
      const disputeCaseObjectId = normalizeIotaAddress(options["dispute-case-id"] || "");
      if (!disputeCaseObjectId) {
        return {
          ok: false,
          error: "missing_dispute_case_id",
        };
      }
      const disputeRead = await callApiRoute({
        method: "GET",
        rawPath: `/disputes/${disputeCaseObjectId}`,
        options,
        timeoutMs: parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000),
      });
      if (!disputeRead.result.ok) {
        return {
          ok: false,
          error: summarizeApiFailure(disputeRead.result),
          status: disputeRead.result.status,
          response: disputeRead.result.body,
        };
      }
      const liveDispute = asRecord(disputeRead.result.body?.disputeCase) || {};
      const requiredReviewerVotesRaw = liveDispute.requiredReviewerVotes;
      if (typeof requiredReviewerVotesRaw === "string" && /^\d+$/.test(requiredReviewerVotesRaw)) {
        replacementRequiredReviewerVotes = Number.parseInt(requiredReviewerVotesRaw, 10);
      } else if (typeof requiredReviewerVotesRaw === "number" && Number.isFinite(requiredReviewerVotesRaw)) {
        replacementRequiredReviewerVotes = requiredReviewerVotesRaw;
      }
    }
    let buyerAddress = normalizeIotaAddress(options["buyer-address"] || "");
    let sellerAddress = normalizeIotaAddress(options["seller-address"] || "");
    let escrowObjectId = normalizeIotaAddress(options["escrow-object-id"] || "");
    let disputeBondObjectId = normalizeIotaAddress(options["bond-object-id"] || "");
    let milestoneStatus = null;
    let orderStatus = null;
    if (contextFile) {
      const context = parseOrderContextFile(contextFile, orderId, milestoneId);
      buyerAddress = buyerAddress || context.buyerAddress;
      sellerAddress = sellerAddress || context.sellerAddress;
      escrowObjectId = escrowObjectId || context.escrowObjectId;
      disputeBondObjectId = disputeBondObjectId || context.disputeBondObjectId;
      orderStatus = context.orderStatus;
      milestoneStatus = context.milestoneStatus;
    }
    if (scope === "OPEN" && (!buyerAddress || !sellerAddress)) {
      return {
        ok: false,
        error: "missing_buyer_or_seller_address",
        hint: "pass --buyer-address and --seller-address, or provide --order-context-file from a stored order/timeline readback",
      };
    }
    if (scope === "OPEN" && (!escrowObjectId || !disputeBondObjectId)) {
      return {
        ok: false,
        error: "missing_escrow_or_bond_object_id",
        hint: "pass --escrow-object-id and --bond-object-id, or provide --order-context-file from a stored order/timeline readback that includes order bindings",
      };
    }

    const reviewerCount =
      scope === "REPLACEMENT" && replacementRequiredReviewerVotes && options["reviewer-count"] === undefined
        ? replacementRequiredReviewerVotes
        : parsePositiveIntOption(options["reviewer-count"], "reviewer_count", 3);
    if (
      scope === "REPLACEMENT" &&
      replacementRequiredReviewerVotes &&
      reviewerCount < replacementRequiredReviewerVotes
    ) {
      return {
        ok: false,
        error: "replacement_reviewer_count_below_required_votes",
        requiredReviewerVotes: replacementRequiredReviewerVotes,
        requestedReviewerCount: reviewerCount,
        hint: "replacement rounds fully reset reviewer assignment; use at least the live requiredReviewerVotes count unless the dispute already lowered quorum size",
      };
    }

    let effectiveCheckpointDigest = checkpoint.digest;
    let effectiveCheckpointSequenceNumber = checkpoint.sequenceNumber;
    let effectiveCheckpointTimestampMs = checkpoint.timestampMs;
    const shortlistTimeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 20_000);
    const body = {
      scope,
      orderId: scope === "OPEN" ? orderId : undefined,
      milestoneId: scope === "OPEN" ? milestoneId : undefined,
      buyerAddress: scope === "OPEN" ? buyerAddress : undefined,
      sellerAddress: scope === "OPEN" ? sellerAddress : undefined,
      disputeCaseObjectId: scope === "REPLACEMENT" ? normalizeIotaAddress(options["dispute-case-id"] || "") || undefined : undefined,
      checkpointDigest: effectiveCheckpointDigest,
      reviewerCount,
      directoryScanLimit: parsePositiveIntOption(options["directory-scan-limit"], "directory_scan_limit", 1000),
      minPerformanceScore: parsePositiveIntOption(options["min-performance-score"], "min_performance_score", 50),
      minReputationScore: parsePositiveIntOption(options["min-reputation-score"], "min_reputation_score", 50),
      minReputationConfidence: parsePositiveIntOption(options["min-reputation-confidence"], "min_reputation_confidence", 20),
      allowNewReviewers: parseBooleanOption(options["allow-new-reviewers"], true),
      minDecisionsTotal: parsePositiveIntOption(options["min-decisions-total"], "min_decisions_total", 0),
      maxNoshowCount: parsePositiveIntOption(options["max-noshow-count"], "max_noshow_count", 3),
      maxCommitRevealFailures: parsePositiveIntOption(options["max-commit-reveal-failures"], "max_commit_reveal_failures", 3),
      excludedReviewerAddresses:
        typeof options["excluded-reviewers"] === "string" && options["excluded-reviewers"].trim()
          ? parseCommaSeparatedIotaAddresses(options["excluded-reviewers"], "excluded_reviewers")
          : undefined,
      blockedReviewerAddresses:
        typeof options["blocked-reviewers"] === "string" && options["blocked-reviewers"].trim()
          ? parseCommaSeparatedIotaAddresses(options["blocked-reviewers"], "blocked_reviewers")
          : undefined,
    };
    const requestShortlist = async () =>
      callApiRoute({
        method: "POST",
        rawPath: "/admin/reviewer-selection/shortlist",
        options: {
          ...options,
          body: JSON.stringify(body),
        },
        timeoutMs: shortlistTimeoutMs,
      });
    let shortlistCall = await requestShortlist();
    let checkpointDigestRetryCount = 0;
    const maxCheckpointDigestRetries = 4;
    while (checkpointDigestRetryCount < maxCheckpointDigestRetries) {
      const shortlistFailureBody = asRecord(shortlistCall.result.body) || {};
      const latestCheckpointDigest =
        shortlistCall.result.status === 409 && shortlistFailureBody.error === "checkpoint_digest_mismatch"
          ? typeof shortlistFailureBody.latestCheckpointDigest === "string"
            ? shortlistFailureBody.latestCheckpointDigest.trim()
            : ""
          : "";
      if (!latestCheckpointDigest || latestCheckpointDigest === effectiveCheckpointDigest) {
        break;
      }
      effectiveCheckpointDigest = latestCheckpointDigest;
      body.checkpointDigest = latestCheckpointDigest;
      if (
        typeof shortlistFailureBody.latestCheckpointSequenceNumber === "string" &&
        /^\d+$/.test(shortlistFailureBody.latestCheckpointSequenceNumber)
      ) {
        effectiveCheckpointSequenceNumber = shortlistFailureBody.latestCheckpointSequenceNumber;
      } else if (
        typeof shortlistFailureBody.latestCheckpointSequenceNumber === "number" &&
        Number.isFinite(shortlistFailureBody.latestCheckpointSequenceNumber)
      ) {
        effectiveCheckpointSequenceNumber = String(shortlistFailureBody.latestCheckpointSequenceNumber);
      }
      checkpointDigestRetryCount += 1;
      shortlistCall = await requestShortlist();
    }
    if (!shortlistCall.result.ok) {
      return {
        ok: false,
        error: summarizeApiFailure(shortlistCall.result),
        status: shortlistCall.result.status,
        response: shortlistCall.result.body,
        checkpointDigest: effectiveCheckpointDigest,
      };
    }
    const payload = asRecord(shortlistCall.result.body) || {};
    const publishTarget = asRecord(payload.publishTarget) || {};
    const requestPatch = asRecord(publishTarget.requestPatch) || null;
    const publishRoute = typeof publishTarget.route === "string" ? publishTarget.route.trim() : "";
    const receipt = asRecord(payload.receipt) || null;
    const publishBody =
      scope === "OPEN" && requestPatch
        ? {
            escrowObjectId,
            bondObjectId: disputeBondObjectId,
            ...requestPatch,
          }
        : scope === "REPLACEMENT" && requestPatch
          ? {
              reviewerRegistryObjectId: chainConfig?.reviewerRegistryObjectId || "",
              ...requestPatch,
            }
        : requestPatch;
    const receiptOut =
      resolveOptionalPathOption(options["receipt-out"]) ||
      defaultReviewerShortlistReceiptPath(orderId || "replacement", milestoneId || "case");
    writeOptionalOutputFile(receiptOut, `${JSON.stringify(payload, null, 2)}\n`);
    const publishBodyOut =
      publishBody && publishRoute
        ? resolveOptionalPathOption(options["publish-body-out"]) ||
          defaultReviewerShortlistPublishPath(orderId || "replacement", milestoneId || "case")
        : null;
    if (publishBodyOut && publishBody) {
      writeOptionalOutputFile(publishBodyOut, `${JSON.stringify(publishBody, null, 2)}\n`);
    }

    const selectionComplete = payload.selectionComplete === true;
    const directoryScanTruncated = payload.directoryScanTruncated === true;
    const allowTruncatedScan = parseBooleanOption(options["allow-truncated-scan"], false);
    if (!selectionComplete) {
      return {
        ok: false,
        error: "selection_incomplete",
        checkpointDigest: effectiveCheckpointDigest,
        receiptOut,
        publishBodyOut,
        response: payload,
      };
    }
    if (directoryScanTruncated && !allowTruncatedScan) {
      return {
        ok: false,
        error: "directory_scan_truncated",
        checkpointDigest: effectiveCheckpointDigest,
        receiptOut,
        publishBodyOut,
        response: payload,
      };
    }
    const publishAuthStateFile =
      typeof options["publish-auth-state-file"] === "string" && options["publish-auth-state-file"].trim()
        ? path.resolve(String(options["publish-auth-state-file"]).trim())
        : null;
    const publishAuthHint = publishAuthStateFile
      ? shellQuote(publishAuthStateFile)
      : "<buyer-or-seller-auth-state-file>";
    const warnings = [];
    if (effectiveCheckpointDigest !== checkpoint.digest) {
      warnings.push(
        `checkpoint_digest_advanced_to=${effectiveCheckpointDigest}; retried shortlist automatically ${checkpointDigestRetryCount} time(s) after server reported newer finalized checkpoints`
      );
    }
    if (scope === "OPEN" && milestoneStatus && !["REJECTED", "DISPUTED"].includes(milestoneStatus)) {
      warnings.push(
        `context_milestone_status=${milestoneStatus}; the saved context file may be stale. Re-read GET /orders/${orderId}/timeline with a buyer or seller auth state before publish if unsure.`
      );
    }
    if (scope === "OPEN" && orderStatus && !["DISPUTED", "IN_PROGRESS"].includes(orderStatus)) {
      warnings.push(
        `context_order_status=${orderStatus}; verify the freshest party timeline before publish if this looks unexpected.`
      );
    }

    return {
      ok: true,
      scope,
      orderId: orderId || null,
      milestoneId: milestoneId || null,
      checkpointDigest: effectiveCheckpointDigest,
      checkpointSequenceNumber: effectiveCheckpointSequenceNumber,
      checkpointTimestampMs: effectiveCheckpointTimestampMs,
      receiptId: typeof receipt?.id === "string" ? receipt.id : null,
      receiptOut,
      publishRoute,
      publishBodyOut,
      contextOrderStatus: orderStatus,
      contextMilestoneStatus: milestoneStatus,
      shortlistedReviewerAddresses: Array.isArray(receipt?.shortlistedReviewerAddresses)
        ? receipt.shortlistedReviewerAddresses
        : [],
      warnings,
      response: payload,
      requiredReviewerVotes: replacementRequiredReviewerVotes,
      nextPublishHint:
        publishRoute && publishBodyOut
          ? `clawnera-help tx-plan-execute POST ${shellQuote(publishRoute)} --auth-state-file ${publishAuthHint} --body-file ${shellQuote(publishBodyOut)}`
          : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "reviewer_shortlist_failed",
    };
  }
}

async function runReviewerVotePrepare(commandArgs) {
  const { options, positionals } = parseLongOptions(commandArgs);
  if (options.help || options.h) {
    return {
      ok: true,
      help: true,
      usage: reviewerVotePrepareUsageLines(),
    };
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      error: "unexpected_positional_arguments",
      details: positionals,
    };
  }

  const caseId = typeof options["case-id"] === "string" ? options["case-id"].trim() : "";
  if (!normalizeIotaAddress(caseId)) {
    return {
      ok: false,
      error: "invalid_case_id",
    };
  }

  try {
    const vote = normalizeReviewerVoteValue(options.vote);
    const runtimeContext =
      options["auth-state-file"] || options["env-file"] || options["api-base"] || options.jwt
        ? await resolveApiRuntimeContext(options)
        : { authState: null, envValues: {} };
    const reviewerAddress =
      normalizeIotaAddress(options.address || "") ||
      resolveActorAddressForSignedRun(options, runtimeContext);
    if (!reviewerAddress) {
      return {
        ok: false,
        error: "missing_reviewer_address",
      };
    }

    let nonceHex = typeof options["nonce-hex"] === "string" ? options["nonce-hex"].trim().toLowerCase() : "";
    if (nonceHex) {
      bufferFromHex(nonceHex, "nonce_hex");
    } else {
      const nonceBytes =
        options["nonce-bytes"] !== undefined
          ? parsePositiveIntOption(options["nonce-bytes"], "nonce_bytes", 16)
          : 16;
      nonceHex = randomBytes(nonceBytes).toString("hex");
    }

    const evidenceHashHexInput =
      typeof options["evidence-hash-hex"] === "string" ? options["evidence-hash-hex"].trim().toLowerCase() : "";
    const evidenceFile = resolveOptionalPathOption(options["evidence-file"]);
    const evidenceText = typeof options["evidence-text"] === "string" ? options["evidence-text"] : "";
    const evidenceModes = [Boolean(evidenceHashHexInput), Boolean(evidenceFile), Boolean(evidenceText)].filter(Boolean).length;
    if (evidenceModes > 1) {
      return {
        ok: false,
        error: "multiple_evidence_sources",
      };
    }

    let evidenceHashHex = null;
    if (evidenceHashHexInput) {
      evidenceHashHex = bufferFromHex(evidenceHashHexInput, "evidence_hash_hex").toString("hex");
    } else if (evidenceFile) {
      evidenceHashHex = createHash("sha256").update(fs.readFileSync(evidenceFile)).digest("hex");
    } else if (evidenceText) {
      evidenceHashHex = createHash("sha256").update(Buffer.from(evidenceText, "utf8")).digest("hex");
    }

    const commitHashHex = computeReviewerVoteCommitHashHex(caseId, reviewerAddress, vote, nonceHex);
    const payload = {
      ok: true,
      caseId: normalizeIotaAddress(caseId),
      reviewerAddress,
      vote,
      voteLabel: vote === 1 ? "seller" : "buyer",
      settlementTarget: vote === 1 ? "seller" : "buyer",
      nonceHex,
      commitHashHex,
      evidenceHashHex,
      commitRequestBody: {
        commitHashHex,
      },
      revealRequestBody: {
        vote,
        nonceHex,
        ...(evidenceHashHex ? { evidenceHashHex } : {}),
      },
    };
    const outFile = resolveOptionalPathOption(options.out);
    if (outFile) {
      writeOptionalOutputFile(outFile, `${JSON.stringify(payload, null, 2)}\n`);
      payload.outFile = outFile;
    }
    return payload;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "reviewer_vote_prepare_failed",
    };
  }
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
    "- Optional auth-state shortcut: --auth-state-file <file>",
    "- Optional env shortcut: --env-file <file>",
    "- Optional auth check: --jwt <token>",
    "- Optional timeout override: --timeout-ms <ms>",
    `- If unresolved after doctor, report in GitHub Issues: ${ISSUE_TRACKER_URL}`
  ];
}

function walletListUsageLines() {
  return [
    "Wallet list helper:",
    `- Defaults to local keystore path ${defaultIotaKeystorePath()}`,
    "- Optional: --keystore-path <file>",
    "- Lists local keystore aliases and addresses so weaker bots can stop guessing selectors",
    "- Also reports the active IOTA CLI address when available"
  ];
}

function apiRequestUsageLines() {
  return [
    "Authenticated request helper:",
    "- Usage: clawnera-help request <GET|POST|PUT|PATCH|DELETE> </path>",
    "- Use API paths like /health or /orders/<order-id>; full URLs are rejected on purpose",
    "- Optional auth shortcuts: --auth-state-file <file> or --env-file <file>",
    "- Optional explicit auth: --api-base <url> --jwt <token>",
    "- Optional body: --body '{\"json\":true}' or --body-file ./payload.json",
    "- Optional nested body selection: --body-file ./payload.json --body-select commitRequestBody",
    "- Optional output: --response-out ./response.json",
    "- Optional idempotency: --idempotency-key <value|auto>",
    "- POST/PUT/PATCH default to idempotency-key=auto unless you override it",
    "- Use this instead of ad-hoc curl when following package recipes"
  ];
}

function chainConfigUsageLines() {
  return [
    "Live chain config helper:",
    "- Usage: clawnera-help chain-config [--api-base <url>] [--auth-state-file <file>]",
    "- Reads /policy/fees to resolve packageId, then looks up governance/dispute-quorum/escrow config ids on-chain",
    "- Optional IOTA runtime overrides: --network <name> --rpc-url <url>",
    "- Use this when a bot must build local bond/escrow PTBs without guessing object ids"
  ];
}

function txPlanUsageLines(mode) {
  const label = mode === "dry_run" ? "dry-run" : "execute";
  const verb = mode === "dry_run" ? "dry-runs" : "signs and broadcasts";
  return [
    `Tx-plan ${label} helper:`,
    `- Usage: clawnera-help tx-plan-${label} <GET|POST|PUT|PATCH|DELETE> </path>`,
    "- Reuses the same auth/body flags as `clawnera-help request`",
    "- Use API paths only; full URLs are rejected to avoid leaking auth tokens to other hosts",
    "- Fetches a canonical API tx plan, builds the PTB locally, then dry-runs or executes it",
    "- Optional auth shortcuts: --auth-state-file <file> or --env-file <file>",
    "- Optional explicit auth: --api-base <url> --jwt <token>",
    "- Optional body: --body '{\"json\":true}' or --body-file ./payload.json",
    "- Optional nested body selection: --body-file ./vote-prepare.json --body-select commitRequestBody",
    "- Optional signer overrides: --alias <wallet-alias> --address <0x...> --keystore-path <file>",
    "- Optional outputs: --plan-out <file> --tx-bytes-out <file>",
    `- The package never sends a generic user PTB through the Clawnera worker; it ${verb} locally`
  ];
}

function orderInitBondUsageLines() {
  return [
    "Local order bond init helper:",
    "- Usage: clawnera-help order-init-bond --order-id <id> --auth-state-file <file>",
    "- Reads the order + fee policy, resolves live chain config, then builds `init_order_dispute_bond` locally",
    "- Optional: --required-reviewer-votes <odd-int> --required-reviewer-votes-floor <odd-int>",
    "- Optional marketing: --marketing-campaign-id <id>",
    "- Optional execution mode: --dry-run",
    "- Optional signer overrides: --alias <wallet-alias> --address <0x...> --keystore-path <file>",
    "- Use this before `tx-plan-execute POST /orders/{orderId}/dispute-bond/fund ...`"
  ];
}

function orderCreateEscrowUsageLines() {
  return [
    "Local order escrow create helper:",
    "- Usage: clawnera-help order-create-escrow --order-id <id> --auth-state-file <file>",
    "- Reads the order + fee policy, resolves live chain config, then builds the buyer escrow creation PTB locally",
    "- Default escrow deadline is now + 172800000 ms (2 days); override with --deadline-ms <unix-ms>",
    "- IOTA orders may omit --payment-coin-object-id to split from tx.gas",
    "- CLAW orders require --claw-coin-type plus either --payment-coin-object-id or --claw-coin-object-id",
    "- Optional execution mode: --dry-run",
    "- After execute, bind the created escrow object id with `clawnera-help request POST /orders/{orderId}/escrow/bind ...`"
  ];
}

function keyAgreementUpsertUsageLines() {
  return [
    "Key agreement upsert helper:",
    "- Usage: clawnera-help key-agreement-upsert --auth-state-file <file>",
    "- Generates or reuses a local X25519 key-agreement key, wallet-signs the binding message, then PUTs /users/me/key-agreement",
    "- Optional key selection: --key-version <int> --key-file <file> --rotate",
    "- Optional lifetime: --ttl-sec <sec> or --expires-at-ms <unix-ms>",
    "- Optional signer overrides: --alias <wallet-alias> --address <0x...> --keystore-path <file>",
    "- Run this for seller and buyer before encrypted milestone delivery",
    "- The helper now keeps retrying readback for indexer lag; if it still prints readback_pending, re-run GET /users/{address}/key-agreement before encrypted delivery"
  ];
}

function reputationInitUsageLines() {
  return [
    "Reputation profile init helper:",
    "- Usage: clawnera-help reputation-init --auth-state-file <file>",
    "- Reads /policy/fees, resolves the live reputation fee config, then builds `reputation::create_reputation_profile_iota_entry` locally",
    "- Uses tx.gas by default; fund the wallet first or pass --payment-coin-object-id <coin>",
    "- Optional: --dry-run --alias <wallet-alias> --address <0x...> --keystore-path <file>",
    "- Safe to rerun: if the actor already owns a reputation profile, this helper returns the existing object id"
  ];
}

function reviewerRegisterUsageLines() {
  return [
    "Reviewer register helper:",
    "- Usage: clawnera-help reviewer-register --auth-state-file <file>",
    "- Requires a local key-agreement record and an on-chain reputation profile for the same actor",
    "- Auto-resolves reviewer registry + dispute quorum config ids from the live chain config",
    "- Uses the actor key-agreement public key as reviewer transportPubkeyHex",
    "- Defaults: --min-case-reward-iota 1 and --stake-amount <live reviewer_min_stake_iota>",
    "- Optional: --transport-type <u8> --transport-key-file <file> --transport-key-version <int> --dry-run",
    "- Run `clawnera-help key-agreement-upsert` and `clawnera-help reputation-init` first when onboarding a fresh reviewer"
  ];
}

function deliverableEncryptUsageLines() {
  return [
    "Deliverable encrypt helper:",
    "- Usage: clawnera-help deliverable-encrypt --order-id <id> --milestone-id <id> --plaintext-file <file> --auth-state-file <file>",
    "- Reads seller + buyer key-agreement records, encrypts the file locally, and writes one managed payload JSON",
    "- Optional: --label <display-name> --payload-out <file> --seller-key-file <file> --seller-key-version <int> --buyer-key-version <int>",
    "- The payload JSON is the file you upload next, preferably with managed storage if application/json is allowed"
  ];
}

function managedStorageFeePayUsageLines() {
  return [
    "Managed storage fee helper:",
    "- Usage: clawnera-help managed-storage-fee-pay --order-id <id> --milestone-id <id> --auth-state-file <file>",
    "- Reads /policy/storage + /policy/fees, builds `manifest_anchor::pay_managed_storage_fee_iota` locally, then signs and broadcasts locally",
    "- Optional: --proof-out <file> --dry-run --alias <wallet-alias> --address <0x...> --keystore-path <file>",
    "- Use this before managed-storage presign. The same actor must later use the payment proof."
  ];
}

function managedStoragePresignUsageLines() {
  return [
    "Managed storage presign helper:",
    "- Usage: clawnera-help managed-storage-presign --order-id <id> --milestone-id <id> --file <payload.json> --payment-proof-file <file> --auth-state-file <file>",
    "- Computes fileSizeBytes + sha256 locally, then POSTs /storage/uploads/presign in managed mode",
    "- Optional: --mime-type <type> --file-name <name> --presign-out <file> --attempts <n> --delay-ms <ms>",
    "- Retries `storage_fee_event_not_found` automatically so bots do not race the indexer"
  ];
}

function managedStorageUploadUsageLines() {
  return [
    "Managed storage upload helper:",
    "- Usage: clawnera-help managed-storage-upload --file <payload.json> --presign-file <file>",
    "- Alternative: --signed-url <url>",
    "- Uploads the local file to the signed managed-storage URL and prints the resulting CID / ipfs:// URI",
    "- Optional: --mime-type <type> --file-name <name> --upload-out <file>",
    "- Fails closed if the local file no longer matches the presigned size or sha256"
  ];
}

function reviewerShortlistUsageLines() {
  return [
    "Reviewer shortlist helper:",
    "- Usage: clawnera-help reviewer-shortlist --order-id <id> --milestone-id <id> --order-context-file <file> --auth-state-file <operator-auth-state>",
    "- Replacement usage: clawnera-help reviewer-shortlist --scope REPLACEMENT --dispute-case-id <0x...> --auth-state-file <operator-auth-state>",
    "- Fetches the latest finalized checkpoint digest, builds the canonical shortlist body, and writes the exact publish body for dispute-open or reviewer-replace",
    "- The safest --order-context-file is a freshly saved buyer/seller GET /orders/{orderId}/timeline readback; operators may not be allowed to read actor-scoped order timeline routes directly",
    "- Optional: --reviewer-count <n> --allow-new-reviewers <true|false> --min-decisions-total <n> --allow-truncated-scan <true|false>",
    "- Optional: --escrow-object-id <0x...> --bond-object-id <0x...> when no stored order/timeline file is available",
    "- Optional outputs: --receipt-out <file> --publish-body-out <file> --publish-auth-state-file <buyer-or-seller-auth-state> --rpc-url <url>",
    "- The shortlist call itself uses operator auth. The saved publish body must then be published by the buyer or seller for that order.",
    "- After publish, tx-plan-execute prints dispute_case_object_id and post_execute_binding_ok when receipt activation succeeded automatically.",
    "- Important: shortlist success only prepares the exact publish body; current runtimes can still hard-stop on 409 reviewer_invite_tx_not_supported until the live package exposes invite-aware callables.",
    "- Important: replacement rounds are full reassignment rounds; do not request only the missing delta slots unless the live case already lowered requiredReviewerVotes."
  ];
}

function mailboxEventsUsageLines() {
  return [
    "Mailbox events helper:",
    "- Usage: clawnera-help mailbox-events --order-id <id> --auth-state-file <file>",
    "- Reads the bound mailbox object id, then fetches mailbox.signal_posted and mailbox.signal_acked events for that order",
    "- Optional: --limit <n> --include-acked <true|false> --events-out <file>",
    "- Use this instead of guessing seq numbers from raw /events queries",
    "- If indexing is still catching up, use the mailbox_signal_posted_seq or mailbox_signal_acked_seq printed by tx-plan-execute as the temporary source of truth and re-read later"
  ];
}

function pinataUploadJsonUsageLines() {
  return [
    "Pinata JSON upload helper:",
    "- Usage: clawnera-help pinata-upload-json --file <payload.json>",
    "- Auth: --jwt <token>, --jwt-file <file>, or export PINATA_JWT=...",
    "- Optional: --jwt-env <ENV_NAME> --name <pin-name>",
    "- Uploads one JSON file with pinJSONToIPFS and prints cid + ipfs:// URI"
  ];
}

function milestoneSubmitByoUsageLines() {
  return [
    "Milestone submit helper (bring your own encrypted payload):",
    "- Usage: clawnera-help milestone-submit-byo --order-id <id> --milestone-id <id> --payload-file <file> --manifest-cid ipfs://<cid> --auth-state-file <file>",
    "- Builds the canonical managed-deliverable manifest, signs it with the seller wallet, and POSTs /orders/{orderId}/milestones/{milestoneId}/submit",
    "- Optional output: --body-out <file>",
    "- Run this only after the encrypted payload JSON is already uploaded"
  ];
}

function milestoneAnchorUsageLines() {
  return [
    "Milestone anchor helper:",
    "- Usage: clawnera-help milestone-anchor --order-id <id> --milestone-id <id> --submit-body-file <file> --auth-state-file <file>",
    "- Builds the on-chain manifest-anchor PTB locally, executes it locally, then POSTs /orders/{orderId}/milestones/{milestoneId}/anchor",
    "- Optional overrides: --manifest-cid ipfs://<cid> --manifest-sha256 <hex> --seller-signature <base64>",
    "- Use the submit body from milestone-submit-byo unless you intentionally override fields"
  ];
}

function milestoneRejectUsageLines() {
  return [
    "Milestone reject helper:",
    "- Usage: clawnera-help milestone-reject --order-id <id> --milestone-id <id> --reason-text <text> --auth-state-file <file>",
    "- Alternative inputs: --reason-file <file> or --reason-hash <64-hex|sha256:64-hex>",
    "- Computes the canonical rejectionReasonHash locally when text/file input is used",
    "- Optional: --hash-out <file>",
    "- Use this instead of hand-building /reject bodies"
  ];
}

function deliverableDecryptUsageLines() {
  return [
    "Deliverable decrypt helper:",
    "- Usage: clawnera-help deliverable-decrypt --resolved-manifest-file <file> --auth-state-file <file>",
    "- Alternative input: --payload-file <managed-payload.json>",
    "- Optional key selection: --recipient-address <0x...> --key-file <file>",
    "- Optional output: --plaintext-out <file>",
    "- Decrypts locally from the actor key-agreement private key; the worker never sees plaintext"
  ];
}

function reviewerVotePrepareUsageLines() {
  return [
    "Reviewer vote prepare helper:",
    "- Usage: clawnera-help reviewer-vote-prepare --case-id <0x...> --vote <seller|buyer|0|1> [auth options]",
    "- Optional auth shortcuts: --auth-state-file <file> or --env-file <file>",
    "- Optional explicit reviewer selector: --address <0x...>",
    "- Optional nonce input: --nonce-hex <hex> or --nonce-bytes <n> (default 16 random bytes)",
    "- Optional evidence sources: --evidence-hash-hex <hex> | --evidence-file <path> | --evidence-text <text>",
    "- Canonical secure file path: --out reviewer-vote.json",
    "- Alternative secure file path: --json > reviewer-vote.json",
    "- Default stdout redacts commit and reveal payloads; plain stdout redirection alone is not a usable reveal file unless you also pass --json",
    "- Direct next step: tx-plan-execute ... --body-file ./reviewer-vote.json --body-select commitRequestBody",
    "- Commit hash rule: sha256(vote_byte || case_id_bytes || reviewer_address_bytes || nonce_bytes)",
    "- Contract truth: vote=1 means seller settlement, vote=0 means buyer settlement",
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

  const timeoutMs = parsePositiveIntOption(options["timeout-ms"], "timeout_ms", 8000);
  const runtimeContext = await resolveApiRuntimeContext({
    ...options,
    "timeout-ms": timeoutMs
  });

  if (runtimeContext.apiBase) {
    report.remote = await collectRemoteDoctor(runtimeContext.apiBase, runtimeContext.jwt, timeoutMs);
    report.ok = report.remote.ok;
  } else {
    report.remote = null;
  }

  report.authContext = {
    envFile: runtimeContext.envFile,
    authStateFile: runtimeContext.authStateFile,
    authStateRefreshed: runtimeContext.authStateRefreshed
  };

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
    if (report.authContext?.envFile) {
      console.log(`- envFile: ${report.authContext.envFile}`);
    }
    if (report.authContext?.authStateFile) {
      console.log(`- authStateFile: ${report.authContext.authStateFile}`);
    }
    if (report.authContext?.authStateRefreshed) {
      console.log("- authStateRefreshed: yes");
    }
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
  process.stdout.write(
    `${JSON.stringify(
      payload,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    )}\n`,
  );
}

  const { flags, command: parsedCommand, commandArgs } = parseArgs(process.argv.slice(2));
const topics = loadTopics();
const recipes = loadRecipes();
const journeys = loadJourneys();
const aliasCommands = new Map([
  ["list", "topics"],
  ["flows", "journeys"],
  ["flow-list", "journeys"],
  ["journey-list", "journeys"],
  ["task-list", "recipes"],
  ["tasks", "recipes"],
  ["flow", "journey"],
  ["role", "journey"],
  ["task", "recipe"],
  ["next", "recipe"],
  ["runbook", "recipe"],
  ["sponsor-run", "sponsor-execute"],
  ["sponsor-plan", "sponsor-preflight"],
  ["ask", "triage"],
  ["support", "triage"],
  ["issue", "report-issue"],
  ["login", "auth-login"],
  ["jwt-login", "auth-login"],
  ["wallets", "wallet-list"],
  ["wallet-ls", "wallet-list"],
  ["create-listing", "listing-create"],
  ["place-bid", "bid-create"],
  ["accept-bid", "bid-accept"],
  ["chain", "chain-config"],
  ["tx-dry-run", "tx-plan-dry-run"],
  ["tx-execute", "tx-plan-execute"],
  ["plan-dry-run", "tx-plan-dry-run"],
  ["plan-execute", "tx-plan-execute"],
  ["bond-init", "order-init-bond"],
  ["escrow-create", "order-create-escrow"],
  ["key-agreement", "key-agreement-upsert"],
  ["rep-init", "reputation-init"],
  ["reviewer-onboard", "reviewer-register"],
  ["delivery-encrypt", "deliverable-encrypt"],
  ["storage-fee-pay", "managed-storage-fee-pay"],
  ["storage-presign", "managed-storage-presign"],
  ["storage-upload", "managed-storage-upload"],
  ["operator-shortlist", "reviewer-shortlist"],
  ["shortlist-reviewers", "reviewer-shortlist"],
  ["reviewer-inbox", "reviewer-invites"],
  ["mailbox-read", "mailbox-events"],
  ["mailbox-history", "mailbox-events"],
  ["delivery-decrypt", "deliverable-decrypt"],
  ["milestone-submit", "milestone-submit-byo"],
  ["delivery-reject", "milestone-reject"],
  ["milestone-reject-hash", "milestone-reject"],
  ["anchor-manifest", "milestone-anchor"],
  ["vote-prepare", "reviewer-vote-prepare"],
  ["notify", "notifications"],
  ["api-request", "request"],
  ["http", "request"],
  ["iota-balance", "iota-get-balance"],
  ["iota-gas", "iota-get-gas"],
  ["iota-transfer-prepare", "iota-prepare-transfer"],
  ["iota-transfer-dry-run", "iota-dry-run-transfer"],
  ["iota-transfer-execute", "iota-execute-transfer"]
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
        "journeys",
        "journey",
        "recipes",
        "show",
        "recipe",
        "search",
        "doctor",
        "triage",
        "report-issue",
        "path",
        "wallet-init",
        "wallet-list",
        "auth-login",
        "request",
        "listing-create",
        "bid-create",
        "bid-accept",
        "chain-config",
        "tx-plan-dry-run",
        "tx-plan-execute",
        "order-init-bond",
        "order-create-escrow",
        "key-agreement-upsert",
        "reputation-init",
        "reviewer-register",
        "deliverable-encrypt",
        "managed-storage-fee-pay",
        "managed-storage-presign",
        "managed-storage-upload",
        "reviewer-shortlist",
        "reviewer-invites",
        "mailbox-events",
        "pinata-upload-json",
        "milestone-submit-byo",
        "milestone-anchor",
        "milestone-reject",
        "deliverable-decrypt",
        "reviewer-vote-prepare",
        "iota-active-env",
        "iota-get-balance",
        "iota-get-gas",
        "iota-prepare-transfer",
        "iota-dry-run-transfer",
        "iota-execute-transfer",
        "notifications",
        "first-steps",
        "sponsor-preflight",
        "sponsor-execute",
        "validate",
        "sync",
        "bootstrap",
        "version"
      ],
      topics,
      journeys,
      recipes
    });
  } else {
    printUsage();
    console.log("");
    printTopics(topics);
    console.log("");
    printJourneys(journeys);
    console.log("");
    printRecipes(recipes);
  }
} else if (effectiveCommand === "topics") {
  if (flags.json) {
    printJson({ topics });
  } else {
    printTopics(topics);
  }
} else if (effectiveCommand === "journeys") {
  if (flags.json) {
    printJson({ journeys });
  } else {
    printJourneys(journeys);
  }
} else if (effectiveCommand === "recipes") {
  if (flags.json) {
    printJson({ recipes });
  } else {
    printRecipes(recipes);
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
} else if (effectiveCommand === "journey") {
  const journey = resolveJourney(journeys, commandArgs[0]);
  if (flags.json) {
    if (!journey) {
      printJson({ ok: false, error: `unknown_journey: ${String(commandArgs[0] || "")}` });
      process.exitCode = 1;
    } else {
      printJson({
        ok: true,
        journey
      });
    }
  } else if (!journey) {
    console.error(`unknown_journey: ${String(commandArgs[0] || "")}`);
    process.exitCode = 1;
  } else {
    printJourney(journey, recipes);
  }
} else if (effectiveCommand === "recipe") {
  const recipe = resolveRecipe(recipes, commandArgs[0]);
  if (flags.json) {
    if (!recipe) {
      printJson({ ok: false, error: `unknown_recipe: ${String(commandArgs[0] || "")}` });
      process.exitCode = 1;
    } else {
      printJson({
        ok: true,
        recipe
      });
    }
  } else if (!recipe) {
    console.error(`unknown_recipe: ${String(commandArgs[0] || "")}`);
    process.exitCode = 1;
  } else {
    printRecipe(recipe);
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
} else if (effectiveCommand === "wallet-init") {
  const result = await runWalletInit(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`wallet_init_ok address=${result.address}`);
    if (result.alias) {
      console.log(`wallet_alias=${result.alias}`);
    }
    console.log(`keystore_path=${result.keystorePath}`);
    console.log(`clawnera-help auth-login --api-base https://api.clawnera.com --keystore-path ${shellQuote(result.keystorePath)}${result.alias ? ` --alias ${shellQuote(result.alias)}` : ""}`);
  } else {
    console.error(`wallet_init_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "wallet-list") {
  const result = await runWalletList(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`wallet_list_ok entries=${result.entryCount}`);
    console.log(`keystore_path=${result.keystorePath}`);
    if (result.activeCliAddressDetected) {
      console.log(`active_cli_address=${result.activeCliAddress}`);
    } else {
      console.log("active_cli_address=unavailable");
    }
    for (const entry of result.entries) {
      const alias = entry.alias || "<no-alias>";
      const active = entry.active ? " active" : "";
      console.log(`- ${alias}: ${entry.address}${active}`);
    }
  } else {
    console.error(`wallet_list_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
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
} else if (effectiveCommand === "request") {
  const result = await runApiRequest(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "listing-create") {
  const result = await runListingCreate(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`listing_create_ok listing_id=${result.listingId || "unknown"}`);
    console.log(`creator_address=${result.creatorAddress}`);
    console.log(`budget_amount=${result.budgetAmount}`);
    console.log(`milestone_count=${Array.isArray(result.milestones) ? result.milestones.length : 0}`);
    console.log("next_readback=clawnera-help request GET /listings --auth-state-file <seller-auth-state-file>");
  } else {
    console.error(`listing_create_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "bid-create") {
  const result = await runBidCreate(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`bid_create_ok bid_id=${result.bidId || "unknown"}`);
    console.log(`listing_id=${result.listingId}`);
    console.log(`bidder_address=${result.bidderAddress}`);
    console.log(`amount=${result.amount}`);
    console.log(`currency=${result.currency}`);
    console.log("next_readback=clawnera-help request GET /listings/<listing-id>/bids --auth-state-file <buyer-auth-state-file>");
  } else {
    console.error(`bid_create_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "bid-accept") {
  const result = await runBidAccept(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`bid_accept_ok bid_id=${result.bidId}`);
    console.log(`order_id=${result.orderId || "unknown"}`);
    console.log("next_readback=clawnera-help request GET /orders/<order-id> --auth-state-file <buyer-auth-state-file>");
  } else {
    console.error(`bid_accept_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "chain-config") {
  const result = await runChainConfig(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`chain_config_ok package_id=${result.chainConfig.packageId}`);
    console.log(`governance_config_object_id=${result.chainConfig.governanceConfigObjectId}`);
    console.log(`dispute_quorum_config_object_id=${result.chainConfig.disputeQuorumConfigObjectId}`);
    console.log(`escrow_fee_config_object_id=${result.chainConfig.escrowFeeConfigObjectId}`);
    console.log(`default_required_reviewer_votes=${result.chainConfig.defaultRequiredReviewerVotes}`);
    console.log(`min_required_reviewer_votes=${result.chainConfig.minRequiredReviewerVotes}`);
    console.log(`min_dispute_bond_per_side_iota=${result.chainConfig.minDisputeBondPerSideIota}`);
    console.log(`reviewer_min_stake_iota=${result.chainConfig.reviewerMinStakeIota}`);
  } else {
    console.error(`chain_config_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "tx-plan-dry-run") {
  const result = await runTxPlanCommand(commandArgs, "dry_run");
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`tx_plan_dry_run_ok builder=${result.txBuilder}`);
    console.log(`path=${result.rawPath}`);
    if (result.gasSummary) {
      console.log(`gas_used=${result.gasSummary}`);
    }
    if (result.planOut) {
      console.log(`plan_file=${result.planOut}`);
    }
    if (result.txBytesOut) {
      console.log(`tx_bytes_file=${result.txBytesOut}`);
    }
  } else {
    console.error(`tx_plan_dry_run_error: ${result.error}`);
    if (result.txBuilder) {
      console.error(`tx_builder=${result.txBuilder}`);
    }
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "tx-plan-execute") {
  const result = await runTxPlanCommand(commandArgs, "execute");
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`tx_plan_execute_ok builder=${result.txBuilder}`);
    console.log(`tx_digest=${result.txDigest || "unknown"}`);
    if (result.signerAddress) {
      console.log(`signer_address=${result.signerAddress}`);
    }
    if (result.disputeCaseObjectId) {
      console.log(`dispute_case_object_id=${result.disputeCaseObjectId}`);
    }
    if (result.postExecuteBinding?.route) {
      console.log(`post_execute_binding_route=${result.postExecuteBinding.route}`);
      console.log(`post_execute_binding_ok=${result.postExecuteBinding.ok === true ? "true" : "false"}`);
      if (result.postExecuteBinding.disputeCaseObjectId) {
        console.log(`post_execute_binding_dispute_case_id=${result.postExecuteBinding.disputeCaseObjectId}`);
      }
    }
    if (result.disputeBondObjectId) {
      console.log(`dispute_bond_object_id=${result.disputeBondObjectId}`);
    }
    if (result.orderEscrowObjectId) {
      console.log(`order_escrow_object_id=${result.orderEscrowObjectId}`);
    }
    if (result.orderMailboxObjectId) {
      console.log(`order_mailbox_object_id=${result.orderMailboxObjectId}`);
    }
    if (result.mailboxSignalPosted?.seq) {
      console.log(`mailbox_signal_posted_seq=${result.mailboxSignalPosted.seq}`);
      if (result.mailboxSignalPosted.signalIntent) {
        console.log(`mailbox_signal_posted_intent=${result.mailboxSignalPosted.signalIntent}`);
      }
      if (result.mailboxSignalPosted.payloadRef) {
        console.log(`mailbox_signal_posted_payload_ref=${result.mailboxSignalPosted.payloadRef}`);
      }
      if (result.mailboxSignalPosted.ciphertextHash) {
        console.log(`mailbox_signal_posted_ciphertext_hash=${result.mailboxSignalPosted.ciphertextHash}`);
      }
    }
    if (result.mailboxSignalAcked?.ackedSeq) {
      console.log(`mailbox_signal_acked_seq=${result.mailboxSignalAcked.ackedSeq}`);
      if (result.mailboxSignalAcked.ackerRole) {
        console.log(`mailbox_signal_acker_role=${result.mailboxSignalAcked.ackerRole}`);
      }
    }
    if (result.quorumResolutionTicketObjectId) {
      console.log(`quorum_resolution_ticket_object_id=${result.quorumResolutionTicketObjectId}`);
    }
    if (result.planOut) {
      console.log(`plan_file=${result.planOut}`);
    }
    if (result.txBytesOut) {
      console.log(`tx_bytes_file=${result.txBytesOut}`);
    }
  } else {
    console.error(`tx_plan_execute_error: ${result.error}`);
    if (result.txBuilder) {
      console.error(`tx_builder=${result.txBuilder}`);
    }
    if (result.txDigest) {
      console.error(`tx_digest=${result.txDigest}`);
    }
    if (result.disputeCaseObjectId) {
      console.error(`dispute_case_object_id=${result.disputeCaseObjectId}`);
    }
    if (result.bindRoute) {
      console.error(`post_execute_binding_route=${result.bindRoute}`);
    }
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "order-init-bond") {
  const result = await runOrderInitBond(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`order_init_bond_ok order_id=${result.orderId}`);
    if (result.txDigest) {
      console.log(`tx_digest=${result.txDigest}`);
    }
    if (result.disputeBondObjectId) {
      console.log(`dispute_bond_object_id=${result.disputeBondObjectId}`);
    }
    console.log(`default_required_reviewer_votes=${result.chainConfig.defaultRequiredReviewerVotes}`);
    console.log(`min_dispute_bond_per_side_iota=${result.chainConfig.minDisputeBondPerSideIota}`);
  } else {
    console.error(`order_init_bond_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "order-create-escrow") {
  const result = await runOrderCreateEscrow(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`order_create_escrow_ok order_id=${result.orderId}`);
    if (result.txDigest) {
      console.log(`tx_digest=${result.txDigest}`);
    }
    if (result.orderEscrowObjectId) {
      console.log(`order_escrow_object_id=${result.orderEscrowObjectId}`);
      console.log(
        `next_bind=clawnera-help request POST /orders/${result.orderId}/escrow/bind --auth-state-file ~/.config/clawnera/auth-state.json --body '{\"escrowObjectId\":\"${result.orderEscrowObjectId}\"}'`,
      );
    }
  } else {
    console.error(`order_create_escrow_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "key-agreement-upsert") {
  const result = await runKeyAgreementUpsert(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`key_agreement_upsert_ok address=${result.address}`);
    console.log(`key_version=${result.keyVersion}`);
    console.log(`key_file=${result.keyFile}`);
    console.log(`public_key_multibase=${result.publicKeyMultibase}`);
    if (result.readbackPending) {
      console.log("warning=key_agreement_readback_pending");
      if (result.verifyHint) {
        console.log(`verify_readback=${result.verifyHint}`);
      }
    }
  } else {
    console.error(`key_agreement_upsert_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "reputation-init") {
  const result = await runReputationInit(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`reputation_init_ok address=${result.actorAddress}`);
    if (result.mode === "existing") {
      console.log("mode=existing");
    } else if (result.mode === "dry_run") {
      console.log("mode=dry_run");
      if (result.gasSummary) {
        console.log(`gas_used=${result.gasSummary}`);
      }
    } else {
      console.log("mode=execute");
      if (result.txDigest) {
        console.log(`tx_digest=${result.txDigest}`);
      }
    }
    if (result.reputationProfileObjectId) {
      console.log(`reputation_profile_object_id=${result.reputationProfileObjectId}`);
    }
    if (result.feePolicy?.configObjectId) {
      console.log(`reputation_fee_config_object_id=${result.feePolicy.configObjectId}`);
    }
    if (result.feePolicy?.amount) {
      console.log(`reputation_init_fee_amount=${result.feePolicy.amount}`);
    }
  } else {
    console.error(`reputation_init_error: ${result.error}`);
    if (result.hint) {
      console.error(`hint=${result.hint}`);
    }
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "reviewer-register") {
  const result = await runReviewerRegister(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`reviewer_register_ok address=${result.actorAddress}`);
    if (result.mode) {
      console.log(`mode=${result.mode}`);
    }
    if (result.txDigest) {
      console.log(`tx_digest=${result.txDigest}`);
    }
    if (result.reviewer?.objectId) {
      console.log(`reviewer_entry_object_id=${result.reviewer.objectId}`);
    }
    if (result.requestBody?.reputationProfileObjectId) {
      console.log(`reputation_profile_object_id=${result.requestBody.reputationProfileObjectId}`);
    }
    if (result.requestBody?.stakeAmount) {
      console.log(`stake_amount=${result.requestBody.stakeAmount}`);
    }
    if (result.requestBody?.transportPubkeyHex) {
      console.log(`transport_pubkey_hex=${result.requestBody.transportPubkeyHex}`);
    }
  } else {
    console.error(`reviewer_register_error: ${result.error}`);
    if (result.hint) {
      console.error(`hint=${result.hint}`);
    }
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "deliverable-encrypt") {
  const result = await runDeliverableEncrypt(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`deliverable_encrypt_ok order_id=${result.orderId} milestone_id=${result.milestoneId}`);
    console.log(`payload_out=${result.payloadOut}`);
    console.log(`ciphertext_sha256=${result.ciphertextSha256}`);
    console.log(`next_upload=${result.nextUploadHint}`);
    console.log(`next_submit=${result.nextSubmitHint}`);
  } else {
    console.error(`deliverable_encrypt_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "managed-storage-fee-pay") {
  const result = await runManagedStorageFeePay(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`managed_storage_fee_pay_ok order_id=${result.orderId} milestone_id=${result.milestoneId}`);
    if (result.txDigest) {
      console.log(`tx_digest=${result.txDigest}`);
    }
    if (result.proofOut) {
      console.log(`payment_proof_file=${result.proofOut}`);
    }
    if (result.nextPresignHint) {
      console.log(`next_presign=${result.nextPresignHint}`);
    }
  } else {
    console.error(`managed_storage_fee_pay_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "managed-storage-presign") {
  const result = await runManagedStoragePresign(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`managed_storage_presign_ok order_id=${result.orderId} milestone_id=${result.milestoneId}`);
    console.log(`presign_file=${result.presignOut}`);
    if (result.response?.upload?.expiresAt) {
      console.log(`expires_at=${result.response.upload.expiresAt}`);
    }
    console.log(`next_upload=${result.nextUploadHint}`);
  } else {
    console.error(`managed_storage_presign_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "managed-storage-upload") {
  const result = await runManagedStorageUpload(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`managed_storage_upload_ok file=${result.filePath}`);
    if (result.ipfsUri) {
      console.log(`ipfs_uri=${result.ipfsUri}`);
    }
    if (result.uploadOut) {
      console.log(`upload_file=${result.uploadOut}`);
    }
    if (result.nextSubmitHint) {
      console.log(`next_submit=${result.nextSubmitHint}`);
    }
  } else {
    console.error(`managed_storage_upload_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "reviewer-shortlist") {
  const result = await runReviewerShortlist(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`reviewer_shortlist_ok scope=${result.scope}`);
    if (result.orderId) {
      console.log(`order_id=${result.orderId}`);
    }
    if (result.milestoneId) {
      console.log(`milestone_id=${result.milestoneId}`);
    }
    console.log(`checkpoint_digest=${result.checkpointDigest}`);
    console.log(`checkpoint_sequence_number=${result.checkpointSequenceNumber}`);
    if (result.receiptId) {
      console.log(`receipt_id=${result.receiptId}`);
    }
    if (result.receiptOut) {
      console.log(`receipt_file=${result.receiptOut}`);
    }
    if (result.publishBodyOut) {
      console.log(`publish_body_file=${result.publishBodyOut}`);
    }
    if (Array.isArray(result.shortlistedReviewerAddresses) && result.shortlistedReviewerAddresses.length > 0) {
      console.log(`shortlisted_reviewers=${result.shortlistedReviewerAddresses.join(",")}`);
    }
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.log(`warning=${warning}`);
      }
    }
    if (result.nextPublishHint) {
      console.log(`next_publish=${result.nextPublishHint}`);
    }
  } else {
    console.error(`reviewer_shortlist_error: ${result.error}`);
    if (result.receiptOut) {
      console.error(`receipt_file=${result.receiptOut}`);
    }
    if (result.publishBodyOut) {
      console.error(`publish_body_file=${result.publishBodyOut}`);
    }
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "reviewer-invites") {
  const result = await runReviewerInvites(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`reviewer_invites_ok invite_count=${result.inviteCount}`);
    console.log(`actionable_invite_count=${result.actionableInviteCount}`);
    if (result.recommendedPollIntervalMs) {
      console.log(`recommended_poll_interval_ms=${result.recommendedPollIntervalMs}`);
    }
    for (const invite of Array.isArray(result.invites) ? result.invites : []) {
      const disputeCaseObjectId =
        typeof invite?.disputeCaseObjectId === "string" ? invite.disputeCaseObjectId : "unknown";
      const status = typeof invite?.status === "string" ? invite.status : "unknown";
      console.log(`invite dispute_case_object_id=${disputeCaseObjectId} status=${status}`);
      if (status === "invited") {
        console.log(`next_accept=clawnera-help tx-plan-execute POST /disputes/${disputeCaseObjectId}/reviewers/accept --auth-state-file <reviewer-auth-state-file> --body '{}'`);
      }
      if (status === "closed") {
        console.log(`next_claim_metrics=clawnera-help tx-plan-execute POST /reviewers/<reviewer-address>/claim-metrics --auth-state-file <reviewer-auth-state-file> --body '{\"disputeCaseObjectId\":\"${disputeCaseObjectId}\"}'`);
      }
    }
  } else {
    console.error(`reviewer_invites_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "mailbox-events") {
  const result = await runMailboxEvents(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`mailbox_events_ok order_id=${result.orderId}`);
    console.log(`mailbox_object_id=${result.mailboxObjectId}`);
    console.log(`event_count=${result.eventCount}`);
    if (result.latestPostedSeq !== null) {
      console.log(`latest_posted_seq=${result.latestPostedSeq}`);
    }
    for (const [role, ackedSeq] of Object.entries(result.latestAckByRole || {})) {
      console.log(`latest_ack_${role}=${ackedSeq}`);
    }
    if (result.eventsOut) {
      console.log(`events_file=${result.eventsOut}`);
    }
    if (result.note) {
      console.log(`note=${result.note}`);
    }
  } else {
    console.error(`mailbox_events_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "pinata-upload-json") {
  const result = await runPinataUploadJson(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`pinata_upload_json_ok file=${result.filePath}`);
    console.log(`cid=${result.cid}`);
    console.log(`ipfs_uri=${result.ipfsUri}`);
  } else {
    console.error(`pinata_upload_json_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "milestone-submit-byo") {
  const result = await runMilestoneSubmitByo(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`milestone_submit_byo_ok order_id=${result.orderId} milestone_id=${result.milestoneId}`);
    console.log(`body_out=${result.bodyOut}`);
    console.log(`manifest_cid=${result.manifestCid}`);
    console.log(`manifest_sha256=${result.manifestSha256}`);
    console.log(`next_anchor=${result.nextAnchorHint}`);
  } else {
    console.error(`milestone_submit_byo_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "milestone-anchor") {
  const result = await runMilestoneAnchor(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`milestone_anchor_ok order_id=${result.orderId} milestone_id=${result.milestoneId}`);
    console.log(`tx_digest=${result.txDigest}`);
  } else {
    console.error(`milestone_anchor_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "milestone-reject") {
  const result = await runMilestoneReject(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`milestone_reject_ok order_id=${result.orderId} milestone_id=${result.milestoneId}`);
    console.log(`rejection_reason_hash=${result.rejectionReasonHash}`);
    if (result.hashOut) {
      console.log(`hash_file=${result.hashOut}`);
    }
    if (result.nextDisputeHint) {
      console.log(`next_dispute=${result.nextDisputeHint}`);
    }
  } else {
    console.error(`milestone_reject_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "deliverable-decrypt") {
  const result = await runDeliverableDecrypt(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`deliverable_decrypt_ok order_id=${result.orderId} milestone_id=${result.milestoneId}`);
    console.log(`plaintext_out=${result.plaintextOut}`);
    console.log(`plaintext_sha256=${result.plaintextSha256}`);
  } else {
    console.error(`deliverable_decrypt_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "reviewer-vote-prepare") {
  const result = await runReviewerVotePrepare(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`reviewer_vote_prepare_ok case_id=${result.caseId}`);
    console.log(`reviewer_address=${result.reviewerAddress}`);
    console.log(`vote=${result.vote}`);
    console.log(`settlement_target=${result.settlementTarget}`);
    if (result.evidenceHashHex) {
      console.log(`evidence_hash_hex=${result.evidenceHashHex}`);
    }
    if (result.outFile) {
      console.log(`vote_file=${result.outFile}`);
      console.log(`next_secure_file=stored_full_payload_in_${result.outFile}`);
    } else {
      console.log("commit_payload_redacted=rerun with --out reviewer-vote.json");
      console.log("reveal_body_redacted=rerun with --out reviewer-vote.json");
      console.log("next_secure_file=rerun with --out reviewer-vote.json or --json > reviewer-vote.json");
    }
  } else {
    console.error(`reviewer_vote_prepare_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "iota-active-env") {
  const result = await runIotaActiveEnv(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`iota_active_env_ok network=${result.activeEnv}`);
    console.log(`rpc_url=${result.rpcUrl}`);
    console.log(`keystore_path=${result.keystorePath}`);
  } else {
    console.error(`iota_active_env_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "iota-get-balance") {
  const result = await runIotaGetBalance(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`iota_get_balance_ok owner=${result.owner}`);
    console.log(`network=${result.network}`);
    if (result.balance) {
      console.log(`coin_type=${result.balance.coinType || "unknown"}`);
      console.log(`total_balance=${result.balance.totalBalance || "0"}`);
    } else if (Array.isArray(result.balances)) {
      console.log(`balance_entries=${result.balances.length}`);
    }
    if (Array.isArray(result.coins?.data)) {
      console.log(`coin_objects=${result.coins.data.length}`);
    } else if (Array.isArray(result.coins)) {
      console.log(`coin_objects=${result.coins.length}`);
    }
  } else {
    console.error(`iota_get_balance_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "iota-get-gas") {
  const result = await runIotaGetGas(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`iota_get_gas_ok owner=${result.owner}`);
    console.log(`network=${result.network}`);
    console.log(`coin_type=${result.coinType}`);
    console.log(`gas_coin_objects=${Array.isArray(result.gasCoins?.data) ? result.gasCoins.data.length : 0}`);
  } else {
    console.error(`iota_get_gas_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "iota-prepare-transfer") {
  const result = await runIotaPrepareTransfer(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`iota_prepare_transfer_ok draft_id=${result.draft.id}`);
    console.log(`signer_address=${result.draft.signerAddress}`);
    console.log(`recipient=${result.draft.recipient}`);
    console.log(`amount_nanos=${result.draft.amountNanos}`);
    console.log(`drafts_file=${result.draftsPath}`);
    console.log(`clawnera-help iota-dry-run-transfer --draft-id ${shellQuote(result.draft.id)} --drafts-file ${shellQuote(result.draftsPath)}`);
    console.log(`clawnera-help iota-execute-transfer --draft-id ${shellQuote(result.draft.id)} --drafts-file ${shellQuote(result.draftsPath)}`);
  } else {
    console.error(`iota_prepare_transfer_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "iota-dry-run-transfer") {
  const result = await runIotaDryRunTransfer(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`iota_dry_run_transfer_ok draft_id=${result.draftId}`);
    if (result.result?.effects?.gasUsed) {
      console.log(`gas_used=${JSON.stringify(result.result.effects.gasUsed)}`);
    }
  } else {
    console.error(`iota_dry_run_transfer_error: ${result.error}`);
    process.exitCode = 1;
  }
  if (!result.ok && !result.help) {
    process.exitCode = 1;
  }
} else if (effectiveCommand === "iota-execute-transfer") {
  const result = await runIotaExecuteTransfer(commandArgs);
  if (flags.json) {
    printJson(result);
  } else if (result.help && Array.isArray(result.usage)) {
    for (const line of result.usage) {
      console.log(line);
    }
  } else if (result.ok) {
    console.log(`iota_execute_transfer_ok tx_digest=${result.txDigest || "unknown"}`);
    console.log(`signer_address=${result.signerAddress}`);
    console.log(`drafts_file=${result.draftsPath}`);
    if (typeof result.result?.confirmedLocalExecution === "boolean") {
      console.log(`confirmed_local_execution=${String(result.result.confirmedLocalExecution)}`);
    }
    console.log("next_readback=use tx_digest as the canonical on-chain lookup handle");
  } else {
    console.error(`iota_execute_transfer_error: ${result.error}`);
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

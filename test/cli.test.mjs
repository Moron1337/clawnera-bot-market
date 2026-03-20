import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliFile = path.join(repoRoot, "bin", "clawnera-help.mjs");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

function buildJwtWithExp(expSeconds) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp: expSeconds })}.signature`;
}

function runCli(args = [], options = {}) {
  return spawnSync(process.execPath, [cliFile, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env
    }
  });
}

function runCliAsync(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        status: code,
        signal,
        stdout,
        stderr
      });
    });
  });
}

test("help command prints usage", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /CLAWNERA Bot Market CLI/);
  assert.match(result.stdout, /Fast path for bots:/);
  assert.match(result.stdout, /clawnera-help journeys/);
  assert.match(result.stdout, /clawnera-help journey seller --compact/);
  assert.match(result.stdout, /clawnera-help auth-login/);
  assert.match(result.stdout, /clawnera-help recipes/);
  assert.match(result.stdout, /clawnera-help recipe <id>/);
  assert.match(result.stdout, /clawnera-help next seller-create-listing/);
  assert.match(result.stdout, /clawnera-help next seller\s+Show the first safe recipe hints from a role journey/);
  assert.match(result.stdout, /journey\|recipe --compact/);
  assert.match(result.stdout, /clawnera-help wallet-init/);
  assert.match(result.stdout, /clawnera-help wallet-list/);
  assert.match(result.stdout, /clawnera-help ensure-auth/);
  assert.match(result.stdout, /clawnera-help request <METHOD> <path>/);
  assert.match(result.stdout, /clawnera-help listing-categories/);
  assert.match(result.stdout, /clawnera-help listing-create/);
  assert.match(result.stdout, /clawnera-help listing-cancel/);
  assert.match(result.stdout, /clawnera-help listing-renew/);
  assert.match(result.stdout, /clawnera-help bid-create/);
  assert.match(result.stdout, /clawnera-help bid-accept/);
  assert.match(result.stdout, /clawnera-help key-agreement-upsert/);
  assert.match(result.stdout, /clawnera-help reputation-init/);
  assert.match(result.stdout, /clawnera-help reviewer-register/);
  assert.match(result.stdout, /clawnera-help reviewer-invites/);
  assert.match(result.stdout, /clawnera-help deliverable-encrypt/);
  assert.match(result.stdout, /clawnera-help mailbox-events/);
  assert.match(result.stdout, /clawnera-help milestone-submit-byo/);
  assert.match(result.stdout, /clawnera-help milestone-anchor/);
  assert.match(result.stdout, /clawnera-help milestone-reject/);
  assert.match(result.stdout, /clawnera-help deliverable-decrypt/);
  assert.match(result.stdout, /clawnera-help reviewer-vote-prepare/);
  assert.match(result.stdout, /clawnera-help iota-get-balance/);
  assert.match(result.stdout, /clawnera-help iota-prepare-transfer/);
  assert.match(result.stdout, /clawnera-help iota-execute-transfer/);
  assert.match(result.stdout, /clawnera-help notifications/);
  assert.match(result.stdout, /clawnera-help validate/);
  assert.match(result.stdout, /clawnera-help triage/);
  assert.match(result.stdout, /clawnera-help report-issue/);
});

test("help json output includes auth-login command", () => {
  const result = runCli(["--help", "--json"]);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payload.commands));
  assert.ok(payload.commands.includes("auth-login"));
  assert.ok(payload.commands.includes("journeys"));
  assert.ok(payload.commands.includes("journey"));
  assert.ok(payload.commands.includes("recipes"));
  assert.ok(payload.commands.includes("recipe"));
  assert.ok(payload.commands.includes("wallet-init"));
  assert.ok(payload.commands.includes("wallet-list"));
  assert.ok(payload.commands.includes("ensure-auth"));
  assert.ok(payload.commands.includes("request"));
  assert.ok(payload.commands.includes("listing-categories"));
  assert.ok(payload.commands.includes("listing-create"));
  assert.ok(payload.commands.includes("listing-cancel"));
  assert.ok(payload.commands.includes("listing-renew"));
  assert.ok(payload.commands.includes("bid-create"));
  assert.ok(payload.commands.includes("bid-accept"));
  assert.ok(payload.commands.includes("key-agreement-upsert"));
  assert.ok(payload.commands.includes("reputation-init"));
  assert.ok(payload.commands.includes("reviewer-register"));
  assert.ok(payload.commands.includes("reviewer-invites"));
  assert.ok(payload.commands.includes("deliverable-encrypt"));
  assert.ok(payload.commands.includes("mailbox-events"));
  assert.ok(payload.commands.includes("milestone-submit-byo"));
  assert.ok(payload.commands.includes("milestone-anchor"));
  assert.ok(payload.commands.includes("milestone-reject"));
  assert.ok(payload.commands.includes("deliverable-decrypt"));
  assert.ok(payload.commands.includes("reviewer-vote-prepare"));
  assert.ok(payload.commands.includes("iota-prepare-transfer"));
  assert.ok(payload.commands.includes("iota-execute-transfer"));
});

test("wallet list help prints usage", () => {
  const result = runCli(["wallet-list", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Wallet list helper/);
  assert.match(result.stdout, /Lists local keystore aliases and addresses/);
});

test("request help prints usage", () => {
  const result = runCli(["request", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Authenticated request helper/);
  assert.match(result.stdout, /--auth-state-file <file> or --env-file <file>/);
  assert.match(result.stdout, /--response-out/);
  assert.match(result.stdout, /Use API paths like \/health or \/orders\/<order-id>/);
});

test("encrypted delivery helpers print usage", () => {
  const commands = [
    ["key-agreement-upsert", /Key agreement upsert helper/],
    ["reputation-init", /Reputation profile init helper/],
    ["reviewer-register", /Reviewer register helper/],
    ["deliverable-encrypt", /Deliverable encrypt helper/],
    ["mailbox-events", /Mailbox events helper/],
    ["pinata-upload-json", /Pinata JSON upload helper/],
    ["milestone-submit-byo", /Milestone submit helper/],
    ["milestone-anchor", /Milestone anchor helper/],
    ["milestone-reject", /Milestone reject helper/],
    ["deliverable-decrypt", /Deliverable decrypt helper/]
  ];
  for (const [command, pattern] of commands) {
    const result = runCli([command, "--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, pattern);
  }
});

test("reviewer vote prepare help prints usage", () => {
  const result = runCli(["reviewer-vote-prepare", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Reviewer vote prepare helper/);
  assert.match(result.stdout, /--out reviewer-vote\.json/);
  assert.match(result.stdout, /vote=1 means seller settlement/);
});

test("thin write helpers print usage", () => {
  for (const [command, pattern] of [
    ["listing-categories", /Listing categories helper/],
    ["listing-create", /Listing create helper/],
    ["listing-cancel", /Listing cancel helper/],
    ["listing-renew", /Listing renew helper/],
    ["bid-create", /Bid create helper/],
    ["bid-accept", /Bid accept helper/],
    ["reviewer-invites", /Reviewer invites helper/],
  ]) {
    const result = runCli([command, "--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, pattern);
  }
});

test("listing-create help explains display values and categories", () => {
  const result = runCli(["listing-create", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Valid category slugs: dev, design, marketing, ops, security, other/);
  assert.match(result.stdout, /clawnera-help listing-categories/);
  assert.match(result.stdout, /--display-values/);
  assert.match(result.stdout, /--listing-mode OFFER\|REQUEST/);
  assert.match(result.stdout, /REQUEST means the listing creator is the future buyer/);
  assert.match(result.stdout, /--expires-in-days <1-30>/);
  assert.match(result.stdout, /--use-default-expiry/);
});

test("listing lifecycle helpers explain canonical POST routes", () => {
  const cancelResult = runCli(["listing-cancel", "--help"]);
  assert.equal(cancelResult.status, 0);
  assert.match(cancelResult.stdout, /POST \/listings\/\{listingId\}\/cancel/);
  assert.match(cancelResult.stdout, /not DELETE or PATCH/);

  const renewResult = runCli(["listing-renew", "--help"]);
  assert.equal(renewResult.status, 0);
  assert.match(renewResult.stdout, /POST \/listings\/\{listingId\}\/renew/);
  assert.match(renewResult.stdout, /--expires-at-ms <unix-ms> \| --expires-at '<iso8601>'/);
  assert.match(renewResult.stdout, /not PUT or PATCH/);
});

test("natural lifecycle aliases resolve to the canonical listing helpers", () => {
  const deleteAlias = runCli(["delete-listing", "--help"]);
  assert.equal(deleteAlias.status, 0);
  assert.match(deleteAlias.stdout, /Listing cancel helper/);

  const reopenAlias = runCli(["reopen-listing", "--help"]);
  assert.equal(reopenAlias.status, 0);
  assert.match(reopenAlias.stdout, /Listing renew helper/);
});

test("compact cancel recipe prints the direct helper command", () => {
  const result = runCli(["next", "creator-cancel-listing"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /do:clawnera-help listing-cancel --auth-state-file ~\/\.config\/clawnera\/auth-state\.json --listing-id <listingId>/);
  assert.match(result.stdout, /write:POST \/listings\/\{listingId\}\/cancel/);
});

test("bid-create help explains display values", () => {
  const result = runCli(["bid-create", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--display-values/);
  assert.match(result.stdout, /On REQUEST listings the bidder becomes the future seller/);
});

test("reviewer shortlist help prints operator and publish role split", () => {
  const result = runCli(["reviewer-shortlist", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Reviewer shortlist helper/);
  assert.match(result.stdout, /Replacement usage:/);
  assert.match(result.stdout, /writes the exact publish body for dispute-open or reviewer-replace/);
  assert.match(result.stdout, /buyer\/seller GET \/orders\/\{orderId\}\/timeline readback/);
  assert.match(result.stdout, /The shortlist call itself uses operator auth/);
  assert.match(result.stdout, /must then be published by the buyer or seller/);
  assert.match(result.stdout, /post_execute_binding_ok/);
  assert.match(result.stdout, /full reassignment rounds/);
});

test("reviewer register help explains onboarding prerequisites", () => {
  const result = runCli(["reviewer-register", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Reviewer register helper/);
  assert.match(result.stdout, /Requires a local key-agreement record and an on-chain reputation profile/);
  assert.match(result.stdout, /key-agreement-upsert/);
  assert.match(result.stdout, /reputation-init/);
});

test("iota prepare transfer help prints usage", () => {
  const result = runCli(["iota-prepare-transfer", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /IOTA prepare transfer helper/);
  assert.match(result.stdout, /--recipient <0x\.\.\.>/);
  assert.match(result.stdout, /Builds tx bytes locally on the user machine/);
});

test("iota execute transfer help prints usage", () => {
  const result = runCli(["iota-execute-transfer", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /IOTA execute transfer helper/);
  assert.match(result.stdout, /Signs and broadcasts locally on the user machine/);
});

test("topics command includes onboarding topic", () => {
  const result = runCli(["topics"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /onboarding: Bot Onboarding/);
  assert.match(result.stdout, /journeys: Role Journeys/);
  assert.match(result.stdout, /recipes: Task Recipes/);
  assert.match(result.stdout, /auth-runtime: Authenticated Runtime Checks/);
  assert.match(result.stdout, /canonical-flow: Canonical Live Run Checklist/);
  assert.match(result.stdout, /live-order-flow: Manual Live Order Flow/);
  assert.match(result.stdout, /reviewer-selector: Reviewer Selector Flow/);
  assert.match(result.stdout, /mailbox-flow: Mailbox Communication Flow/);
  assert.match(result.stdout, /notifications: Notifications/);
  assert.match(result.stdout, /playbooks: Role Playbooks/);
});

test("journeys command lists minimal role paths", () => {
  const result = runCli(["journeys"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Available journeys:/);
  assert.match(result.stdout, /seller: Seller Minimal Path/);
  assert.match(result.stdout, /request-buyer: Request Buyer Minimal Path/);
  assert.match(result.stdout, /request-seller: Request Seller Minimal Path/);
  assert.match(result.stdout, /reviewer: Reviewer Minimal Path/);
});

test("journeys compact output is token-light", () => {
  const result = runCli(["journeys", "--compact"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "journeys:seller | buyer | request-buyer | request-seller | reviewer | operator | all");
});

test("reviewer journey includes key agreement and reputation prerequisites", () => {
  const result = runCli(["journey", "reviewer"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /key-agreement-upsert/);
  assert.match(result.stdout, /reputation-init/);
  assert.ok(result.stdout.indexOf("key-agreement-upsert") < result.stdout.indexOf("reviewer-register"));
  assert.ok(result.stdout.indexOf("reputation-init") < result.stdout.indexOf("reviewer-register"));
});

test("reviewer vote prepare default output redacts nonce and reveal body", () => {
  const result = runCli([
    "reviewer-vote-prepare",
    "--case-id",
    `0x${"1".repeat(64)}`,
    "--address",
    `0x${"2".repeat(64)}`,
    "--vote",
    "seller"
  ]);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /nonce_hex=/);
  assert.doesNotMatch(result.stdout, /reveal_body=\{/);
  assert.doesNotMatch(result.stdout, /commit_body=/);
  assert.doesNotMatch(result.stdout, /commit_hash_hex=/);
  assert.match(result.stdout, /commit_payload_redacted=/);
  assert.match(result.stdout, /reveal_body_redacted=/);
  assert.match(result.stdout, /next_secure_file=rerun with --out reviewer-vote\.json/);
});

test("reviewer vote prepare can write the full payload to --out", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-vote-out-"));
  const outFile = path.join(tempDir, "reviewer-vote.json");
  const result = runCli([
    "reviewer-vote-prepare",
    "--case-id",
    `0x${"1".repeat(64)}`,
    "--address",
    `0x${"2".repeat(64)}`,
    "--vote",
    "seller",
    "--out",
    outFile
  ]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /vote_file=/);
  const payload = JSON.parse(readFileSync(outFile, "utf8"));
  assert.equal(payload.ok, true);
  assert.equal(payload.vote, 1);
  assert.match(payload.commitHashHex, /^[a-f0-9]{64}$/);
  assert.equal(payload.revealRequestBody.vote, 1);
});

test("journey command prints a strict ordered role path", () => {
  const result = runCli(["journey", "buyer"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /# Buyer Minimal Path/);
  assert.match(result.stdout, /Do In This Order:/);
  assert.match(result.stdout, /buyer-place-bid: Buyer Place Bid \[role: buyer]/);
  assert.match(result.stdout, /buyer-accept-bid: Buyer Accept Bid And Create Order \[role: buyer] \[wait_for_seller_choice]/);
  assert.match(result.stdout, /Conditional Delivery Prerequisite:/);
  assert.match(result.stdout, /key-agreement-upsert/);
  assert.match(result.stdout, /If setup is not complete: clawnera-help recipe setup-quick/);
  assert.match(result.stdout, /If setup is already complete: clawnera-help recipe buyer-place-bid/);
});

test("journey compact output keeps only ids, handoffs, and next hints", () => {
  const result = runCli(["journey", "seller", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^journey:seller/m);
  assert.match(result.stdout, /steps:setup-quick > seller-create-listing > seller-review-bids > buyer-accept-bid\[handoff,wait_for_buyer_accept]/);
  assert.match(result.stdout, /later:creator-cancel-listing \| creator-renew-listing \| dispute-open \| resolve-dispute/);
  assert.match(result.stdout, /next_if_not_setup:setup-quick/);
  assert.match(result.stdout, /next_if_setup:seller-create-listing/);
  assert.doesNotMatch(result.stdout, /Do In This Order:/);
  assert.doesNotMatch(result.stdout, /Optional Later:/);
});

test("seller journey shows seller review and buyer accept separation", () => {
  const result = runCli(["journey", "seller"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /seller-review-bids: Seller Review Bids And Hand Off Accept \[role: seller]/);
  assert.match(result.stdout, /buyer-accept-bid: Buyer Accept Bid And Create Order \[role: buyer] \[handoff] \[wait_for_buyer_accept]/);
});

test("request journeys separate buyer-created requests from offer flow", () => {
  const buyerResult = runCli(["journey", "request-buyer", "--compact"]);
  assert.equal(buyerResult.status, 0);
  assert.match(buyerResult.stdout, /^journey:request-buyer/m);
  assert.match(
    buyerResult.stdout,
    /steps:setup-quick > buyer-create-request > buyer-review-request-bids > buyer-accept-request-bid > fund-order/
  );
  assert.match(
    buyerResult.stdout,
    /later:creator-cancel-listing \| creator-renew-listing \| buyer-reject-delivery \| dispute-open \| resolve-dispute/
  );
  assert.match(
    buyerResult.stdout,
    /prereq:mailbox-handshake before first seller submit; key-agreement-upsert before encrypted delivery or reviewer onboarding/
  );

  const sellerResult = runCli(["journey", "request-seller", "--compact"]);
  assert.equal(sellerResult.status, 0);
  assert.match(sellerResult.stdout, /^journey:request-seller/m);
  assert.match(
    sellerResult.stdout,
    /steps:setup-quick > seller-answer-request > buyer-accept-request-bid\[handoff,wait_for_request_buyer_accept] > fund-order/
  );
  assert.match(sellerResult.stdout, /later:dispute-open \| resolve-dispute/);
});

test("buyer compact journey does not suggest listing-creator maintenance actions", () => {
  const result = runCli(["journey", "buyer", "--compact"]);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /creator-cancel-listing/);
  assert.doesNotMatch(result.stdout, /creator-renew-listing/);
  assert.match(result.stdout, /later:buyer-reject-delivery \| dispute-open \| resolve-dispute/);
});

test("next on a journey id returns setup and post-setup hints instead of unknown recipe", () => {
  const result = runCli(["next", "seller"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^journey_next:seller/m);
  assert.match(result.stdout, /^next_if_not_setup:setup-quick/m);
  assert.match(result.stdout, /^next_if_setup:seller-create-listing/m);
  assert.match(result.stdout, /hint:clawnera-help journey seller --compact/);
});

test("reviewer journey includes the post-case claim step", () => {
  const result = runCli(["journey", "reviewer"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /reviewer-vote: Reviewer Commit And Reveal Vote/);
  assert.match(result.stdout, /reviewer-claim-metrics: Reviewer Claim Metrics/);
});

test("recipes command lists minimal task recipes", () => {
  const result = runCli(["recipes"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Available recipes:/);
  assert.match(result.stdout, /setup-quick: Quick Setup/);
  assert.match(result.stdout, /seller-create-listing: Seller Create Listing/);
  assert.match(result.stdout, /buyer-create-request: Buyer Create Request Listing/);
  assert.match(result.stdout, /seller-answer-request: Seller Answer Request Listing/);
  assert.match(result.stdout, /buyer-accept-request-bid: Buyer Accept Seller Bid On Request/);
  assert.match(result.stdout, /reviewer-vote: Reviewer Commit And Reveal Vote.*reviewer-vote-reveal/);
  assert.match(result.stdout, /reviewer-claim-metrics: Reviewer Claim Metrics/);
  assert.match(result.stdout, /operator-shortlist-replacement: Operator Shortlist Replacement/);
});

test("recipes compact output is token-light", () => {
  const result = runCli(["recipes", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^recipes:/);
  assert.match(result.stdout, /setup-quick/);
  assert.match(result.stdout, /seller-create-listing/);
  assert.match(result.stdout, /reviewer-vote/);
  assert.doesNotMatch(result.stdout, /Available recipes:/);
});

test("recipe command prints a concise task runbook", () => {
  const result = runCli(["recipe", "seller-create-listing"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /# Seller Create Listing/);
  assert.match(result.stdout, /Need:/);
  assert.match(result.stdout, /Seller compliance is ready: the actor is TRADER/);
  assert.match(result.stdout, /Store:/);
  assert.match(result.stdout, /Routes:/);
  assert.match(result.stdout, /GET \/compliance\/me/);
  assert.match(result.stdout, /Prefer clawnera-help listing-create/);
  assert.match(result.stdout, /Stop Conditions:/);
  assert.match(result.stdout, /guessing reputation-init/i);
  assert.match(result.stdout, /Next Recipes:/);
  assert.match(result.stdout, /clawnera-help show discovery/);
});

test("recipe compact output focuses on immediate command, readback, and next", () => {
  const result = runCli(["recipe", "seller-create-listing", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^recipe:seller-create-listing/m);
  assert.match(result.stdout, /^do:clawnera-help listing-categories --compact && clawnera-help listing-create /m);
  assert.match(result.stdout, /--category <canonical-category>/);
  assert.match(result.stdout, /--display-values/);
  assert.match(result.stdout, /--expires-in-days 7/);
  assert.match(result.stdout, /^write:POST \/listings/m);
  assert.match(result.stdout, /^read:GET \/compliance\/me \| GET \/listings/m);
  assert.match(result.stdout, /^next:seller-review-bids/m);
  assert.doesNotMatch(result.stdout, /Steps:/);
  assert.doesNotMatch(result.stdout, /Examples:/);
});

test("request recipe compact output uses explicit request mode", () => {
  const result = runCli(["recipe", "buyer-create-request", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^recipe:buyer-create-request/m);
  assert.match(result.stdout, /listing-categories --compact --listing-mode REQUEST/);
  assert.match(result.stdout, /listing-create .* --listing-mode REQUEST /);
  assert.match(result.stdout, /--expires-in-days 7/);
  assert.match(result.stdout, /^next:buyer-review-request-bids/m);
});

test("setup-quick compact output uses ensure-auth", () => {
  const result = runCli(["recipe", "setup-quick", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^recipe:setup-quick/m);
  assert.match(result.stdout, /do:clawnera-help wallet-list && clawnera-help ensure-auth --api-base https:\/\/api\.clawnera\.com --alias <wallet-alias>/);
  assert.doesNotMatch(result.stdout, /^write:GET /m);
  assert.match(result.stdout, /^read:GET \/actors\/me\/capabilities \| GET \/ready/m);
});

test("ensure-auth recipe compact output uses the self-auth helper", () => {
  const result = runCli(["recipe", "ensure-auth", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^recipe:ensure-auth/m);
  assert.match(result.stdout, /do:clawnera-help ensure-auth --api-base https:\/\/api\.clawnera\.com --alias <wallet-alias>/);
});

test("key agreement compact output points only to real next recipes", () => {
  const result = runCli(["recipe", "key-agreement-upsert", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^do:clawnera-help key-agreement-upsert --auth-state-file ~\/\.config\/clawnera\/auth-state\.json/m);
  assert.match(result.stdout, /^next:mailbox-handshake \| reputation-init \| reviewer-register/m);
  assert.doesNotMatch(result.stdout, /seller-deliverable-flow/);
});

test("seller review compact output stays read-only and marks the buyer handoff", () => {
  const result = runCli(["recipe", "seller-review-bids", "--compact"]);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /^write:GET /m);
  assert.match(result.stdout, /^read:GET \/listings\/\{listingId\}\/bids/m);
  assert.match(result.stdout, /^next:buyer-accept-bid\[handoff] \| fund-order\[after_buyer_accept]/m);
});

test("seller delivery compact output highlights delivery writes instead of key setup", () => {
  const result = runCli(["recipe", "seller-deliver-encrypted-byo", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^do:clawnera-help deliverable-encrypt --order-id <orderId> --milestone-id <milestoneId> --plaintext-file \.\/deliverable\.bin /m);
  assert.match(
    result.stdout,
    /^write:POST \/storage\/uploads\/presign \| POST \/orders\/\{orderId\}\/milestones\/\{milestoneId\}\/submit \| POST \/orders\/\{orderId\}\/milestones\/\{milestoneId\}\/anchor/m
  );
  assert.match(
    result.stdout,
    /^read:GET \/orders\/\{orderId\}\/milestones\/\{milestoneId\}\/anchor \| GET \/events\?scope=all&type=mailbox\.signal_posted/m
  );
  assert.doesNotMatch(result.stdout, /^write:PUT \/users\/me\/key-agreement/m);
});

test("creator cancel compact output uses mode-aware feed wording", () => {
  const result = runCli(["recipe", "creator-cancel-listing", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^read:GET \/listings for OFFER \| GET \/listings\?listingMode=REQUEST for REQUEST/m);
});

test("dispute-open compact output highlights the canonical dispute-open route", () => {
  const result = runCli(["recipe", "dispute-open", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /^do:clawnera-help tx-plan-execute POST \/orders\/<orderId>\/milestones\/<milestoneId>\/disputes\/open --auth-state-file ~\/\.config\/clawnera\/auth-state\.json --body-file \.\/clawnera-dispute-open-<orderId>-<milestoneId>\.json/m
  );
  assert.match(result.stdout, /^write:POST \/orders\/\{orderId\}\/milestones\/\{milestoneId\}\/disputes\/open/m);
  assert.doesNotMatch(result.stdout, /^write:POST \/admin\/reviewer-selection\/shortlist/m);
});

test("replacement compact output highlights live case readback and replace publish route", () => {
  const result = runCli(["recipe", "operator-shortlist-replacement", "--compact"]);
  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /^do:clawnera-help reviewer-shortlist --scope REPLACEMENT --dispute-case-id <disputeCaseId> --auth-state-file ~\/\.config\/clawnera\/auth-state\.json/m
  );
  assert.match(
    result.stdout,
    /^write:POST \/admin\/reviewer-selection\/shortlist \| POST \/disputes\/\{disputeCaseId\}\/reviewers\/replace/m
  );
  assert.match(result.stdout, /^read:GET \/disputes\/\{disputeCaseId\}/m);
});

test("recipe json output is parseable", () => {
  const result = runCli(["recipe", "reviewer-vote", "--json"]);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.recipe.id, "reviewer-vote");
  assert.ok(Array.isArray(payload.recipe.steps));
  assert.ok(payload.recipe.steps.some((step) => /tx-plan-execute POST .*votes\/commit/.test(step)));
  assert.ok(payload.recipe.steps.some((step) => /reviewer-vote-prepare/.test(step)));
});

test("dispute-open recipe explains manual bind inputs and auto-bind success", () => {
  const result = runCli(["recipe", "dispute-open"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /post_execute_binding_ok=true/);
  assert.match(result.stdout, /disputeCaseObjectId/);
  assert.match(result.stdout, /activationTxDigest/);
});

test("mailbox handshake recipe explains tx output seq fallback", () => {
  const result = runCli(["recipe", "mailbox-handshake"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /mailbox_signal_posted_seq/);
  assert.match(result.stdout, /mailbox_signal_acked_seq/);
});

test("replacement recipe explains full reassignment semantics", () => {
  const result = runCli(["recipe", "operator-shortlist-replacement"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /# Operator Shortlist Replacement/);
  assert.match(result.stdout, /full replacement round/);
  assert.match(result.stdout, /requiredReviewerVotes/);
  assert.match(result.stdout, /do not request only the missing delta slots/);
});

test("reviewer vote prepare json output matches contract semantics", () => {
  const result = runCli([
    "reviewer-vote-prepare",
    "--case-id",
    "0x1111111111111111111111111111111111111111111111111111111111111111",
    "--address",
    "0x2222222222222222222222222222222222222222222222222222222222222222",
    "--vote",
    "seller",
    "--nonce-hex",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "--evidence-text",
    "proof",
    "--json",
  ]);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.vote, 1);
  assert.equal(payload.voteLabel, "seller");
  assert.equal(payload.settlementTarget, "seller");
  assert.equal(payload.revealRequestBody.vote, 1);
  assert.match(payload.commitHashHex, /^[a-f0-9]{64}$/);
  assert.match(payload.evidenceHashHex, /^[a-f0-9]{64}$/);
});

test("milestone reject computes canonical rejection reason hash", async () => {
  const expectedHash = createHash("sha256").update("bad jpeg", "utf8").digest("hex");
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
    }
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/orders/order-1/milestones/milestone-2/reject");
    const body = JSON.parse(raw);
    assert.equal(body.rejectionReasonHash, expectedHash);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, milestone: { status: "REJECTED" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const result = await runCliAsync([
    "milestone-reject",
    "--api-base",
    `http://127.0.0.1:${port}`,
    "--jwt",
    "test-jwt",
    "--order-id",
    "order-1",
    "--milestone-id",
    "milestone-2",
    "--reason-text",
    "bad jpeg",
    "--json",
  ]);
  server.close();
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.rejectionReasonHash, expectedHash);
  assert.equal(payload.reasonSource, "text");
});

test("recipe aliases work", () => {
  const result = runCli(["next", "buyer-place-bid"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^recipe:buyer-place-bid/m);
  assert.match(result.stdout, /^do:clawnera-help bid-create .* --display-values/m);
  assert.match(result.stdout, /^write:POST \/bids/m);
  assert.match(result.stdout, /^next:buyer-accept-bid/m);
});

test("reviewer reveal alias resolves to the reviewer vote recipe", () => {
  const result = runCli(["recipe", "reviewer-vote-reveal", "--json"]);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.recipe.id, "reviewer-vote");
  assert.ok(payload.recipe.steps.some((step) => /votes\/reveal/.test(step)));
});

test("mailbox signal alias resolves to the mailbox handshake recipe", () => {
  const result = runCli(["recipe", "mailbox-signal", "--json"]);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.recipe.id, "mailbox-handshake");
  assert.ok(payload.recipe.routes.some((route) => /mailbox\/post-signal-plan/.test(route)));
});

test("resolve dispute alias resolves to the canonical resolve recipe", () => {
  const result = runCli(["recipe", "dispute-resolve", "--json"]);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.recipe.id, "resolve-dispute");
  assert.ok(payload.recipe.examples.some((example) => /quorumResolutionTicketObjectId/.test(example)));
});

test("seller review recipe warns that seller cannot accept the bid", () => {
  const result = runCli(["recipe", "seller-review-bids"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /403 buyer_mismatch/);
  assert.match(result.stdout, /Tell the chosen buyer to run the buyer-accept-bid recipe/);
});

test("request buyer review recipe warns that seller must not accept the request bid", () => {
  const result = runCli(["recipe", "buyer-review-request-bids"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Do not ask the seller to call POST \/bids\/\{bidId\}\/accept/);
  assert.match(result.stdout, /Stop if you were about to hand the accept call to the seller wallet/);
});

test("buyer accept recipe uses exact bid accept route", () => {
  const result = runCli(["recipe", "buyer-accept-bid"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /POST \/bids\/\{bidId\}\/accept/);
  assert.match(result.stdout, /403 buyer_mismatch/);
});

test("fund-order recipe clarifies seller identity for REQUEST mode", () => {
  const result = runCli(["recipe", "fund-order"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /In REQUEST mode the seller is the accepted bidder, not the request creator/);
});

test("creator cancel recipe shows request-specific readback guidance", () => {
  const result = runCli(["recipe", "creator-cancel-listing"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Immediate REQUEST readback/);
  assert.match(result.stdout, /GET '\/listings\?listingMode=REQUEST&limit=5'/);
});

test("creator renew recipe shows request-specific readback guidance", () => {
  const result = runCli(["recipe", "creator-renew-listing"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Immediate REQUEST readback/);
  assert.match(result.stdout, /GET '\/listings\?listingMode=REQUEST&limit=5'/);
});

test("reviewer claim recipe explains explicit case-id versus safe inference", () => {
  const result = runCli(["recipe", "reviewer-claim-metrics"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /GET \/reviewers\/me\/metrics/);
  assert.match(result.stdout, /exactly one closed case/);
  assert.match(result.stdout, /claim_metrics_dispute_case_ambiguous/);
  assert.match(result.stdout, /reviewer_metrics_claim_not_required/);
});

test("resolve dispute recipe shows the exact ticket body", () => {
  const result = runCli(["recipe", "resolve-dispute"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /quorumResolutionTicketObjectId/);
  assert.match(result.stdout, /GET \/disputes\/<dispute-case-id>/);
});

test("show recipes topic works", () => {
  const result = runCli(["show", "recipes"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /# Task Recipes/);
  assert.match(result.stdout, /clawnera-help journey seller/);
  assert.match(result.stdout, /clawnera-help recipe setup-quick/);
});

test("show journeys topic works", () => {
  const result = runCli(["show", "journeys"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /# Role Journeys/);
  assert.match(result.stdout, /clawnera-help journey reviewer/);
  assert.match(result.stdout, /request-buyer/);
  assert.match(result.stdout, /key-agreement-upsert/);
  assert.match(result.stdout, /reputation-init/);
});

test("show canonical-flow topic works", () => {
  const result = runCli(["show", "canonical-flow"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Canonical Live Run Checklist/);
  assert.match(result.stdout, /One live write, one readback/);
  assert.match(result.stdout, /choose exactly one wake-up path before writing anything live/);
});

test("show live-order-flow topic works", () => {
  const result = runCli(["show", "live-order-flow"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Manual Live Order Flow/);
  assert.match(result.stdout, /managed upload fee proofs as single-use/);
  assert.match(result.stdout, /explicit polling fallback/);
  assert.match(result.stdout, /`vote=1` resolves to seller settlement/);
});

test("show http-examples topic works", () => {
  const result = runCli(["show", "http-examples"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /# Minimal HTTP Examples/);
  assert.match(result.stdout, /clawnera-help listing-create/);
  assert.match(result.stdout, /clawnera-help bid-create/);
  assert.match(result.stdout, /order-init-bond/);
  assert.match(result.stdout, /clawnera-help bid-accept/);
  assert.match(result.stdout, /reviewer-vote-prepare/);
  assert.match(result.stdout, /seller calling accept returns `403 buyer_mismatch`/);
});

test("curated docs do not contain stale reviewer vote redirection examples", () => {
  const files = [
    "README.md",
    "docs/guides/BOT_ONBOARDING.md",
    "docs/guides/BOT_PLAYBOOKS.md",
    "docs/guides/MINIMAL_HTTP_EXAMPLES.md",
    "docs/guides/REVIEWER_SELECTOR_FLOW.md",
  ];
  for (const relativePath of files) {
    const text = readFileSync(path.join(repoRoot, relativePath), "utf8");
    const matches = text.matchAll(/reviewer-vote-prepare[\s\S]{0,240}> *reviewer-vote\.json/g);
    for (const match of matches) {
      assert.match(match[0], /--json/, `${relativePath} contains a stale reviewer-vote redirect example without --json`);
    }
  }
});

test("show reviewer-selector topic works", () => {
  const result = runCli(["show", "reviewer-selector"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Reviewer Selector Flow/);
  assert.match(result.stdout, /publishTarget\.requestPatch/);
  assert.match(result.stdout, /ReviewerInvited/);
});

test("show auth-runtime topic works", () => {
  const result = runCli(["show", "auth-runtime"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Authenticated Runtime Checks/);
  assert.match(result.stdout, /sponsor-preflight/);
  assert.match(result.stdout, /sponsor-execute/);
});

test("show mailbox-flow topic works", () => {
  const result = runCli(["show", "mailbox"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Mailbox Communication Flow/);
  assert.match(result.stdout, /communicationAgreement/);
  assert.match(result.stdout, /mailbox\/post-signal-plan/);
  assert.match(result.stdout, /buildOrderMailboxTxFromPlan/);
});

test("show notifications topic works", () => {
  const result = runCli(["show", "notifications"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /# Notifications/);
  assert.match(result.stdout, /telegram-event-notifier/);
  assert.match(result.stdout, /bid\.created/);
});

test("notifications presets json output is parseable", () => {
  const result = runCli(["notifications", "presets", "--json"]);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.presets));
  assert.ok(payload.presets.some((preset) => preset.id === "seller"));
});

test("notifications init help prints usage", () => {
  const result = runCli(["notifications", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Notifications helper/);
  assert.match(result.stdout, /notifications init telegram/);
  assert.match(result.stdout, /notifications presets/);
});

test("notifications init telegram scaffolds env and service files from existing auth state", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");
  const cursorFile = path.join(tempDir, "telegram-event-notifier.cursor.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token",
        session: {
          id: "session-1",
          refreshAvailable: true
        }
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    envFile,
    "--service-out",
    serviceFile,
    "--cursor-out",
    cursorFile,
    "--preset",
    "seller"
  ]);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /notifications_init_ok/);
  assert.ok(existsSync(envFile));
  assert.ok(existsSync(serviceFile));
  assert.match(readFileSync(envFile, "utf8"), /CLAWNERA_NOTIFY_PRESET=seller/);
  assert.match(readFileSync(envFile, "utf8"), /bid\.created/);
  assert.match(readFileSync(envFile, "utf8"), /CLAWNERA_NOTIFY_TIMEOUT_MS=30000/);
  assert.match(readFileSync(serviceFile, "utf8"), /telegram-event-notifier\.mjs/);
});

test("notifications init uses preset-specific default artifact paths", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-default-paths-"));
  const fakeHome = path.join(tempDir, "home");
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli(
    [
      "--json",
      "notifications",
      "init",
      "telegram",
      "--auth-state-file",
      authStateFile,
      "--preset",
      "mailbox"
    ],
    {
      env: {
        HOME: fakeHome
      }
    }
  );

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.envOut, /telegram-event-notifier\.mailbox\.env$/);
  assert.match(payload.serviceOut, /clawnera-telegram-event-notifier-mailbox\.service$/);
  assert.match(payload.cursorOut, /telegram-event-notifier\.mailbox\.cursor\.json$/);
  assert.equal(existsSync(payload.envOut), true);
  assert.equal(existsSync(payload.serviceOut), true);
});

test("notifications init with explicit event types and no preset writes custom-only selection", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-custom-default-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "telegram-event-notifier.env");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    envFile,
    "--service-out",
    path.join(tempDir, "notify.service"),
    "--event-types",
    "bid.created,order.status_changed"
  ]);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const envText = readFileSync(envFile, "utf8");
  assert.match(envText, /CLAWNERA_NOTIFY_PRESET=custom/);
  assert.match(envText, /CLAWNERA_NOTIFY_EVENT_TYPES=bid\.created,order\.status_changed/);
});

test("notifications doctor validates generated notifier files", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );
  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      `CLAWNERA_AUTH_STATE_FILE=${authStateFile}`,
      "CLAWNERA_NOTIFY_PRESET=seller",
      "CLAWNERA_NOTIFY_EVENT_TYPES=bid.created,mailbox.signal_posted",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, "ExecStart=/usr/bin/env bash -lc 'node ./examples/telegram-event-notifier.mjs'\n");

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.issues, []);
});

test("notifications doctor accepts export-style env files", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-export-env-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );
  writeFileSync(
    envFile,
    [
      "export CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      `export CLAWNERA_AUTH_STATE_FILE=${authStateFile}`,
      "export CLAWNERA_NOTIFY_PRESET=seller",
      "export CLAWNERA_NOTIFY_EVENT_TYPES=bid.created,mailbox.signal_posted",
      "export TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "export TELEGRAM_CHAT_ID=123456 # bot inbox"
    ].join("\n")
  );
  writeFileSync(serviceFile, 'ExecStart="/usr/bin/node" "/tmp/telegram-event-notifier.mjs"\n');

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
});

test("notifications doctor plain output does not print preset list", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-plain-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );
  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      `CLAWNERA_AUTH_STATE_FILE=${authStateFile}`,
      "CLAWNERA_NOTIFY_PRESET=seller",
      "CLAWNERA_NOTIFY_EVENT_TYPES=bid.created,mailbox.signal_posted",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, 'ExecStart="/usr/bin/node" "/tmp/telegram-event-notifier.mjs"\n');

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile
  ]);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /notifications_doctor_ok/);
  assert.doesNotMatch(result.stdout, /Notification presets:/);
});

test("notifications doctor flags auth state api base mismatch", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-authstate-mismatch-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.other.example",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );
  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      `CLAWNERA_AUTH_STATE_FILE=${authStateFile}`,
      "CLAWNERA_NOTIFY_PRESET=seller",
      "CLAWNERA_NOTIFY_EVENT_TYPES=bid.created,mailbox.signal_posted",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, 'ExecStart="/usr/bin/node" "/tmp/telegram-event-notifier.mjs"\n');

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.issues.includes("auth_state_api_base_mismatch"));
});

test("notifications doctor validates notifier numeric env values", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-numeric-env-"));
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");
  const validJwt = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      `CLAWNERA_API_JWT=${validJwt}`,
      "CLAWNERA_NOTIFY_PRESET=seller",
      "CLAWNERA_NOTIFY_EVENT_TYPES=bid.created,mailbox.signal_posted",
      "CLAWNERA_NOTIFY_POLL_MS=10ms",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, 'ExecStart="/usr/bin/node" "/tmp/telegram-event-notifier.mjs"\n');

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.issues.includes("invalid_env_CLAWNERA_NOTIFY_POLL_MS"));
});

test("notifications doctor accepts auth-state-only api base resolution", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-authstate-api-base-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );
  writeFileSync(
    envFile,
    [
      `CLAWNERA_AUTH_STATE_FILE=${authStateFile}`,
      "CLAWNERA_NOTIFY_PRESET=seller",
      "CLAWNERA_NOTIFY_EVENT_TYPES=bid.created,mailbox.signal_posted",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, 'ExecStart="/usr/bin/node" "/tmp/telegram-event-notifier.mjs"\n');

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.issues, []);
});

test("notifications doctor flags quoted placeholder telegram values", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-quoted-placeholder-"));
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");

  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      "CLAWNERA_API_JWT=jwt-token",
      'TELEGRAM_BOT_TOKEN=" <botfather token> "',
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, 'ExecStart="/usr/bin/node" "/tmp/telegram-event-notifier.mjs"\n');

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.issues.includes("invalid_env_TELEGRAM_BOT_TOKEN"));
});

test("notifications doctor validates env jwt expiry", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-expired-jwt-"));
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");
  const expiredJwt = buildJwtWithExp(Math.floor(Date.now() / 1000) - 60);

  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      `CLAWNERA_API_JWT=${expiredJwt}`,
      "CLAWNERA_NOTIFY_PRESET=seller",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, 'ExecStart="/usr/bin/node" "/tmp/telegram-event-notifier.mjs"\n');

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.issues.includes("expired_auth_no_refresh"));
});

test("notifications doctor accepts JWT-only notifier auth", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-jwt-"));
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");
  const validJwt = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      `CLAWNERA_API_JWT=${validJwt}`,
      "CLAWNERA_NOTIFY_PRESET=seller",
      "CLAWNERA_NOTIFY_EVENT_TYPES=bid.created,mailbox.signal_posted",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, "ExecStart=/usr/bin/env bash -lc 'node ./examples/telegram-event-notifier.mjs'\n");

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.issues, []);
});

test("notifications doctor ignores broken auth state when env auth is valid", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-env-wins-"));
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");
  const validJwt = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      `CLAWNERA_API_JWT=${validJwt}`,
      `CLAWNERA_AUTH_STATE_FILE=${path.join(tempDir, "missing-auth-state.json")}`,
      "CLAWNERA_NOTIFY_PRESET=seller",
      "CLAWNERA_NOTIFY_EVENT_TYPES=bid.created",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, "ExecStart=/usr/bin/env bash -lc 'node ./examples/telegram-event-notifier.mjs'\n");

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.issues, []);
});

test("notifications doctor accepts refresh-token-only notifier auth", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-refresh-"));
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");

  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      "CLAWNERA_API_REFRESH_TOKEN=refresh-token",
      "CLAWNERA_NOTIFY_PRESET=seller",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, "ExecStart=/usr/bin/env bash -lc 'node ./examples/telegram-event-notifier.mjs'\n");

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.issues, []);
});

test("notifications init rejects unknown event types", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-events-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service"),
    "--event-types",
    "not.real.event"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid_notification_event_types/);
});

test("notifications init rejects invalid preset values even with explicit events", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-preset-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service"),
    "--preset",
    "typo",
    "--event-types",
    "bid.created"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid_notification_preset/);
});

test("notifications init requires explicit event types for custom preset", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-custom-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service"),
    "--preset",
    "custom"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing_notification_event_types/);
});

test("notifications init protects existing auth state during fresh login unless forced", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-authstate-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  writeFileSync(
    authStateFile,
    JSON.stringify({ token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600) }, null, 2)
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--api-base",
    "https://api.clawnera.com",
    "--alias",
    "seller-bot",
    "--state-out",
    authStateFile,
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service")
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /notifications_output_exists/);
  assert.match(result.stderr, new RegExp(authStateFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("notifications init rejects state-out without login selector", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-state-out-reuse-"));
  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--state-out",
    path.join(tempDir, "auth-state.json"),
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service")
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /notifications_state_out_requires_login_selector/);
});

test("notifications init rejects auth-state-file when fresh login is requested", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-auth-state-reuse-only-"));
  const authStateFile = path.join(tempDir, "existing-auth-state.json");
  writeFileSync(authStateFile, JSON.stringify({ token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600) }, null, 2));

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--api-base",
    "https://api.clawnera.com",
    "--alias",
    "seller-bot",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service")
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /notifications_auth_state_file_reuse_only/);
});

test("notifications doctor flags invalid preset values", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-preset-"));
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");

  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      "CLAWNERA_API_JWT=jwt-token",
      "CLAWNERA_NOTIFY_PRESET=typo",
      "CLAWNERA_NOTIFY_EVENT_TYPES=bid.created",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, "ExecStart=/usr/bin/env bash -lc 'node ./examples/telegram-event-notifier.mjs'\n");

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.issues.includes("invalid_notification_preset"));
});

test("notifications doctor rejects invalid preset selectors instead of falling back silently", () => {
  const result = runCli(["notifications", "doctor", "--preset", "seler", "--json"]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "invalid_notification_preset");
  assert.equal(payload.invalidPreset, "seler");
});

test("notifications doctor validates auth state contents, not just file presence", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-doctor-auth-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "telegram-event-notifier.env");
  const serviceFile = path.join(tempDir, "clawnera-telegram-event-notifier.service");

  writeFileSync(authStateFile, JSON.stringify({ apiBase: "https://api.clawnera.com" }, null, 2));
  writeFileSync(
    envFile,
    [
      "CLAWNERA_API_BASE_URL=https://api.clawnera.com",
      `CLAWNERA_AUTH_STATE_FILE=${authStateFile}`,
      "CLAWNERA_NOTIFY_PRESET=seller",
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF-real-token",
      "TELEGRAM_CHAT_ID=123456"
    ].join("\n")
  );
  writeFileSync(serviceFile, "ExecStart=/usr/bin/env bash -lc 'node ./examples/telegram-event-notifier.mjs'\n");

  const result = runCli([
    "notifications",
    "doctor",
    "--env-file",
    envFile,
    "--service-file",
    serviceFile,
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.issues.includes("missing_or_invalid_auth_token"));
});

test("notifications init rejects non-decimal poll values", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-poll-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service"),
    "--poll-ms",
    "10ms"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid_poll_ms/);
});

test("notifications init rejects placeholder telegram token values", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-placeholder-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service"),
    "--telegram-bot-token",
    "<botfather token>"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid_env_TELEGRAM_BOT_TOKEN/);
});

test("notifications init rejects malformed telegram chat ids", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-bad-chat-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service"),
    "--telegram-bot-token",
    "123456:ABCDEF-real-token",
    "--telegram-chat-id",
    "not-a-chat-id"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid_env_TELEGRAM_CHAT_ID/);
});

test("notifications init rejects existing auth state without usable auth tokens", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-bad-auth-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot"
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service")
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing_or_invalid_auth_token/);
});

test("notifications init rejects auth state apiBase mismatch", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-api-base-mismatch-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://staging.clawnera.example",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--api-base",
    "https://api.clawnera.com",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    path.join(tempDir, "notify.env"),
    "--service-out",
    path.join(tempDir, "notify.service")
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /auth_state_api_base_mismatch/);
  assert.match(result.stderr, /staging\.clawnera\.example/);
});

test("notifications init rejects invalid package roots before writing files", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-invalid-package-root-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--package-root",
    path.join(tempDir, "missing-package-root"),
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "invalid_notification_package_root");
});

test("notifications init returns structured write failures for notifier outputs", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-output-write-failure-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const blockerFile = path.join(tempDir, "not-a-dir");
  const envOut = path.join(blockerFile, "notify.env");
  const serviceOut = path.join(tempDir, "notify.service");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );
  writeFileSync(blockerFile, "blocker");

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    envOut,
    "--service-out",
    serviceOut,
    "--json"
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "notifications_output_write_failed");
  assert.equal(payload.file, envOut);
});

test("notifications init treats --force false as disabled", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-force-false-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "notify.env");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );
  writeFileSync(envFile, "existing=true\n");

  const result = runCli([
    "notifications",
    "init",
    "telegram",
    "--auth-state-file",
    authStateFile,
    "--env-out",
    envFile,
    "--service-out",
    path.join(tempDir, "notify.service"),
    "--force",
    "false"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /notifications_output_exists/);
});

test("notifications init emits link command for custom service paths", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-service-path-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const serviceFile = path.join(tempDir, "custom", "clawnera-telegram-event-notifier.service");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli(
    [
      "--json",
      "notifications",
      "init",
      "telegram",
      "--auth-state-file",
      authStateFile,
      "--env-out",
      path.join(tempDir, "notify.env"),
      "--service-out",
      serviceFile,
      "--telegram-bot-token",
      "123456:ABCDEF-real-token",
      "--telegram-chat-id",
      "123456"
    ]
  );

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.commands));
  assert.ok(payload.commands.some((line) => line.includes("systemctl --user link")));
});

test("notifications init without telegram creds scaffolds files but does not suggest start commands", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-notify-no-creds-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        version: "clawnera.auth.v1",
        apiBase: "https://api.clawnera.com",
        address: "0xabc",
        alias: "seller-bot",
        token: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token"
      },
      null,
      2
    )
  );

  const result = runCli(
    [
      "--json",
      "notifications",
      "init",
      "telegram",
      "--auth-state-file",
      authStateFile,
      "--env-out",
      path.join(tempDir, "notify.env"),
      "--service-out",
      path.join(tempDir, "notify.service")
    ]
  );

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.readyToStart, false);
  assert.deepEqual(payload.commands, []);
  assert.ok(Array.isArray(payload.warnings));
  assert.ok(payload.warnings.includes("missing_telegram_credentials"));
});

test("show with unknown topic fails", () => {
  const result = runCli(["show", "does-not-exist"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown_topic/);
});

test("validate strict succeeds", () => {
  const result = runCli(["validate", "--strict"]);
  assert.equal(result.status, 0, `validate failed\\nstdout:\\n${result.stdout}\\nstderr:\\n${result.stderr}`);
  assert.match(result.stdout, /Validation \(strict\)/);
});

test("doctor json output is parseable", () => {
  const result = runCli(["doctor", "--json"]);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.ok(payload.tools.node);
});

test("triage command suggests sponsor docs", () => {
  const result = runCli(["triage", "sponsor execute failed"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Triage for: sponsor execute failed/);
  assert.match(result.stdout, /Likely topics/);
  assert.match(result.stdout, /show sponsor/);
  assert.match(result.stdout, /GitHub issues/);
});

test("report-issue json output contains issue url", () => {
  const result = runCli([
    "report-issue",
    "--category",
    "integration-help",
    "--summary",
    "managed storage issue",
    "--json"
  ]);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.category, "integration-help");
  assert.match(payload.issueUrl, /github\.com\/Moron1337\/clawnera-bot-market\/issues\/new\/choose/);
  assert.match(payload.body, /managed storage issue/);
});

test("version command matches package.json", () => {
  const result = runCli(["version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), packageJson.version);
});

test("first-steps command prints instructions by default", () => {
  const result = runCli(["first-steps"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /IOTA first steps/);
  assert.match(result.stdout, /bootstrap-iota-first-steps\.sh/);
});

test("auth-login help prints usage", () => {
  const result = runCli(["auth-login", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Auth login helper/);
  assert.match(result.stdout, /--state-out/);
  assert.match(result.stdout, /auto-refresh sessions/);
});

test("ensure-auth help prints usage", () => {
  const result = runCli(["ensure-auth", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Ensure auth helper/);
  assert.match(result.stdout, /Preferred bot path/);
  assert.match(result.stdout, /Do not ask the user for a raw JWT/);
});

test("auth-login short help prints usage", () => {
  const result = runCli(["auth-login", "-h"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Auth login helper/);
});

test("wallet-init creates a local keystore entry", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-wallet-init-"));
  const keystoreFile = path.join(tempDir, "iota.keystore");

  try {
    const result = runCli(["wallet-init", "--alias", "sdk-buyer", "--keystore-path", keystoreFile]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /wallet_init_ok/);
    assert.match(result.stdout, /wallet_alias=sdk-buyer/);
    assert.match(result.stdout, /clawnera-help ensure-auth --api-base https:\/\/api\.clawnera\.com/);
    assert.equal(existsSync(keystoreFile), true);

    const payload = JSON.parse(readFileSync(keystoreFile, "utf8"));
    assert.equal(payload.version, 2);
    assert.equal(Array.isArray(payload.keys), true);
    assert.equal(payload.keys.length, 1);
    assert.equal(payload.keys[0].alias, "sdk-buyer");
    assert.match(payload.keys[0].address, /^0x[a-f0-9]{64}$/);
    assert.match(payload.keys[0].key.value, /^iotaprivkey1/);
  } finally {
    // cleanup best-effort
  }
});

test("auth-login falls back to the sole keystore entry when no IOTA CLI address is available", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-auth-sdk-only-"));
  const keystoreFile = path.join(tempDir, "iota.keystore");
  const stateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "auth.env");

  const initResult = runCli(["wallet-init", "--alias", "sdk-only", "--keystore-path", keystoreFile]);
  assert.equal(initResult.status, 0);
  const createdKeystore = JSON.parse(readFileSync(keystoreFile, "utf8"));
  const createdAddress = createdKeystore.keys[0].address;

  const issuedToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = bodyText ? JSON.parse(bodyText) : {};

    if (req.url === "/auth/challenge" && req.method === "POST") {
      assert.equal(body.address, createdAddress);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ messageToSign: "clawnera-auth-test", nonce: "nonce-1" }));
      return;
    }

    if (req.url === "/auth/verify" && req.method === "POST") {
      assert.equal(body.address, createdAddress);
      assert.equal(body.message, "clawnera-auth-test");
      assert.equal(typeof body.signature, "string");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          token: issuedToken,
          refreshToken: "refresh-token-1",
          expiresAtMs: Date.now() + 3600_000,
          session: {
            id: "session-1",
            refreshAvailable: true,
            refreshExpiresAtMs: Date.now() + 7200_000
          }
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const apiBase = `http://127.0.0.1:${address.port}`;

  try {
    const result = await runCliAsync(
      [
        "auth-login",
        "--api-base",
        apiBase,
        "--keystore-path",
        keystoreFile,
        "--state-out",
        stateFile,
        "--env-out",
        envFile
      ],
      {
        env: {
          PATH: "/usr/bin:/bin"
        }
      }
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /auth_login_ok/);
    assert.equal(existsSync(stateFile), true);
    assert.equal(existsSync(envFile), true);

    const savedState = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.equal(savedState.address, createdAddress);
    assert.equal(savedState.alias, "sdk-only");
    assert.equal(savedState.token, issuedToken);
    assert.match(readFileSync(envFile, "utf8"), /CLAWNERA_API_JWT=/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("ensure-auth alias help resolves to the canonical helper", () => {
  const result = runCli(["self-auth", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Ensure auth helper/);
});

test("sponsor-execute help prints usage", () => {
  const result = runCli(["sponsor-execute", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Sponsor execute helper/);
  assert.match(result.stdout, /reserve -> run --build-cmd -> execute/);
});

test("sponsor-preflight help prints usage", () => {
  const result = runCli(["sponsor-preflight", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Sponsor preflight helper/);
  assert.match(result.stdout, /strategy, diagnostics, tx family, and gas recommendations/);
});

test("telegram event notifier example prints help", () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "examples", "telegram-event-notifier.mjs"), "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Telegram event notifier/);
  assert.match(result.stdout, /CLAWNERA_AUTH_STATE_FILE/);
  assert.match(result.stdout, /TELEGRAM_BOT_TOKEN/);
  assert.match(result.stdout, /CLAWNERA_NOTIFY_PRESET/);
});

test("legacy telegram mailbox notifier wrapper still prints help", () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "examples", "telegram-mailbox-notifier.mjs"), "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Telegram event notifier/);
  assert.match(result.stdout, /CLAWNERA_NOTIFY_PRESET/);
});

test("sponsor-execute fails without api base and jwt", () => {
  const result = runCli(["sponsor-execute", "--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sponsor_execute_helper_error/);
});

test("sponsor-preflight fails without api base and jwt", () => {
  const result = runCli(["sponsor-preflight"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sponsor_preflight_helper_error/);
});

test("sync skips cleanly without maintainer source repos", () => {
  const result = runCli(["sync"], {
    env: {
      HOME: "/tmp/clawnera-no-sources-home"
    }
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /sync_skipped: local source repos not found/);
  assert.match(result.stdout, /This command is for maintainers/);
});

test("sync fails in strict mode when maintainer source repos are missing", () => {
  const result = runCli(["sync", "--require-sources"], {
    env: {
      HOME: "/tmp/clawnera-no-sources-home"
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /missing_marketplace_source_root/);
  assert.match(result.stderr, /sync_failed_exit_1/);
});

test("bootstrap with sync still succeeds when maintainer sources are missing", () => {
  const result = runCli(["bootstrap", "--sync"], {
    env: {
      HOME: "/tmp/clawnera-no-sources-home"
    }
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Bootstrap checks:/);
  assert.match(result.stdout, /sync_skipped: local source repos not found/);
  assert.match(result.stdout, /bootstrap_ok/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliFile = path.join(repoRoot, "bin", "clawnera-help.mjs");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

function runCli(args = []) {
  return spawnSync(process.execPath, [cliFile, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

test("help command prints usage", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /CLAWNERA Bot Market CLI/);
  assert.match(result.stdout, /clawnera-help validate/);
  assert.match(result.stdout, /clawnera-help triage/);
  assert.match(result.stdout, /clawnera-help report-issue/);
});

test("topics command includes onboarding topic", () => {
  const result = runCli(["topics"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /onboarding: Bot Onboarding/);
  assert.match(result.stdout, /auth-runtime: Authenticated Runtime Checks/);
  assert.match(result.stdout, /mailbox-flow: Mailbox Communication Flow/);
  assert.match(result.stdout, /playbooks: Role Playbooks/);
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

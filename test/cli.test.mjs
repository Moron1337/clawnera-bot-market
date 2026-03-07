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

test("help command prints usage", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /CLAWNERA Bot Market CLI/);
  assert.match(result.stdout, /clawnera-help auth-login/);
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
});

test("topics command includes onboarding topic", () => {
  const result = runCli(["topics"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /onboarding: Bot Onboarding/);
  assert.match(result.stdout, /auth-runtime: Authenticated Runtime Checks/);
  assert.match(result.stdout, /mailbox-flow: Mailbox Communication Flow/);
  assert.match(result.stdout, /notifications: Mailbox Notifications/);
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

test("show notifications topic works", () => {
  const result = runCli(["show", "notifications"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Mailbox Notifications/);
  assert.match(result.stdout, /telegram-mailbox-notifier/);
  assert.match(result.stdout, /mailbox\.signal_posted/);
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

test("telegram mailbox notifier example prints help", () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "examples", "telegram-mailbox-notifier.mjs"), "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Telegram mailbox notifier/);
  assert.match(result.stdout, /CLAWNERA_AUTH_STATE_FILE/);
  assert.match(result.stdout, /TELEGRAM_BOT_TOKEN/);
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

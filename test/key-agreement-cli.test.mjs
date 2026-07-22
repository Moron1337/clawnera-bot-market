import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateKeyAgreementKeypair } from "../lib/e2ee-local.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "clawnera-help.mjs");
const address = `0x${"c".repeat(64)}`;

function runCli(args, home) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });
}

test("key-agreement-migrate encrypts a legacy record without exposing private material", async () => {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "clawnera-key-cli-"));
  const keyFile = path.join(directory, "legacy.json");
  const keys = generateKeyAgreementKeypair();
  const legacy = {
    version: "clawnera.key-agreement.v1",
    address,
    keyVersion: 1,
    publicKeyMultibase: keys.publicKeyMultibase,
    privateKeyMultibase: keys.privateKeyMultibase,
    expiresAtMs: Date.now() + 60_000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  try {
    await fsPromises.writeFile(keyFile, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });
    const result = runCli(["key-agreement-migrate", "--key-file", keyFile, "--json"], directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.version, "clawnera.key-agreement.v2");
    assert.equal(Object.prototype.hasOwnProperty.call(output, "privateKeyMultibase"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(output, "privateKeyEnvelope"), false);
    assert.equal(result.stdout.includes(keys.privateKeyMultibase), false);
    assert.equal(result.stderr.includes(keys.privateKeyMultibase), false);
    const stored = await fsPromises.readFile(keyFile, "utf8");
    assert.equal(stored.includes(keys.privateKeyMultibase), false);
    assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});

test("key-agreement migration reports a fail-closed stale-lock recovery path without leaking", async () => {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "clawnera-key-cli-lock-"));
  const keyFile = path.join(directory, "legacy.json");
  const keys = generateKeyAgreementKeypair();
  const legacy = {
    version: "clawnera.key-agreement.v1",
    address,
    keyVersion: 2,
    publicKeyMultibase: keys.publicKeyMultibase,
    privateKeyMultibase: keys.privateKeyMultibase,
    expiresAtMs: Date.now() + 60_000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  try {
    await fsPromises.writeFile(keyFile, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });
    await fsPromises.writeFile(
      `${keyFile}.lock`,
      `${JSON.stringify({
        version: "clawnera.private-file-lock.v1",
        target: keyFile,
        pid: 2_147_483_647,
        createdAtMs: Date.now() - 86_400_000,
      })}\n`,
      { mode: 0o600 },
    );
    const result = runCli(["key-agreement-migrate", "--key-file", keyFile, "--json"], directory);
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error, "secret_file_write_in_progress");
    assert.equal(output.lockFile, `${keyFile}.lock`);
    assert.match(output.hint, /recorded PID is no longer running/);
    assert.equal(result.stdout.includes(keys.privateKeyMultibase), false);
    assert.equal(result.stderr, "");
    assert.equal((await fsPromises.readFile(keyFile, "utf8")).includes(keys.privateKeyMultibase), true);
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});

test("key-agreement migration rejects inline protection secrets", async () => {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "clawnera-key-cli-inline-"));
  const keyFile = path.join(directory, "legacy.json");
  try {
    await fsPromises.writeFile(keyFile, "{}\n", { mode: 0o600 });
    const result = runCli(
      ["key-agreement-migrate", "--key-file", keyFile, "--passphrase", "not-a-real-secret", "--json"],
      directory,
    );
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error, "inline_key_agreement_secret_rejected");
    assert.equal(result.stdout.includes("not-a-real-secret"), false);
    assert.equal(result.stderr, "");
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});

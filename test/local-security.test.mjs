import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  copyAndClearSensitiveBytes,
  normalizeAuthenticatedBaseUrl,
  readPrivateFile,
  writePrivateFileAtomic,
} from "../lib/local-security.mjs";
import {
  DEFAULT_E2EE_CIPHER_SUITE,
  defaultKeyAgreementMasterKeyPath,
  generateKeyAgreementKeypair,
  isExactKeyAgreementNotFound,
  loadKeyAgreementRecord,
  migrateLegacyKeyAgreementRecord,
  saveKeyAgreementRecord,
} from "../lib/e2ee-local.mjs";

const ADDRESS = `0x${"a".repeat(64)}`;

test("key-agreement absence accepts only the exact API 404 contract", () => {
  assert.equal(isExactKeyAgreementNotFound({
    ok: false,
    status: 404,
    body: { error: "key_agreement_not_found" },
  }), true);
  for (const result of [
    { ok: false, status: 404, body: { error: "not_found" } },
    { ok: false, status: 404, body: { error: "route_not_found" } },
    { ok: false, status: 404, body: null },
    { ok: false, status: 500, body: { error: "key_agreement_not_found" } },
  ]) {
    assert.equal(isExactKeyAgreementNotFound(result), false);
  }
});

test("authenticated URLs require HTTPS except for exact loopback hosts", () => {
  assert.equal(normalizeAuthenticatedBaseUrl(""), "");
  assert.equal(normalizeAuthenticatedBaseUrl(null), "");
  assert.equal(normalizeAuthenticatedBaseUrl("https://api.clawnera.com/"), "https://api.clawnera.com");
  assert.equal(normalizeAuthenticatedBaseUrl("http://127.0.0.1:8787/"), "http://127.0.0.1:8787");
  assert.equal(normalizeAuthenticatedBaseUrl("http://localhost:8787/"), "http://localhost:8787");
  assert.throws(() => normalizeAuthenticatedBaseUrl("http://api.clawnera.com"), /invalid_url/);
  assert.throws(() => normalizeAuthenticatedBaseUrl("http://127.0.0.1.example.com"), /invalid_url/);
  assert.throws(() => normalizeAuthenticatedBaseUrl("https://user:secret@api.clawnera.com"), /invalid_url/);
  assert.throws(() => normalizeAuthenticatedBaseUrl("https://api.clawnera.com/#fragment"), /invalid_url/);
  assert.throws(() => normalizeAuthenticatedBaseUrl("https://api.clawnera.com/tenant"), /invalid_url/);
  assert.throws(() => normalizeAuthenticatedBaseUrl("https://api.clawnera.com?tenant=one"), /invalid_url/);
  assert.throws(
    () => normalizeAuthenticatedBaseUrl("not a URL", { errorCode: "custom_url_error" }),
    /custom_url_error/,
  );
});

test("sensitive byte copies clear the original read buffer", () => {
  const original = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const copy = copyAndClearSensitiveBytes(original);
  assert.deepEqual([...copy], [0x11, 0x22, 0x33, 0x44]);
  assert.deepEqual([...original], [0, 0, 0, 0]);
  copy[0] = 0xff;
  assert.equal(original[0], 0);
  assert.throws(() => copyAndClearSensitiveBytes("secret"), /invalid_sensitive_byte_buffer/);
});

test("private files are atomic, owner-only, and reject symlinks and wrong modes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-private-file-"));
  const target = path.join(directory, "state.json");
  const symlink = path.join(directory, "state-link.json");
  try {
    await writePrivateFileAtomic(target, "secret\n");
    assert.equal(await readPrivateFile(target), "secret\n");
    assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);

    await fs.symlink(target, symlink);
    await assert.rejects(() => readPrivateFile(symlink), /unsafe_secret_file_symlink/);
    await assert.rejects(() => writePrivateFileAtomic(symlink, "replacement"), /unsafe_secret_file_target/);

    await fs.chmod(target, 0o644);
    await assert.rejects(() => readPrivateFile(target), /unsafe_secret_file_mode/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("private writes fail closed while another writer lock exists", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-private-lock-"));
  const target = path.join(directory, "state.json");
  try {
    await fs.writeFile(`${target}.lock`, "locked", { mode: 0o600 });
    await assert.rejects(
      () => writePrivateFileAtomic(target, "secret"),
      (error) => error?.message === "secret_file_write_in_progress" && error?.lockPath === `${target}.lock`,
    );
    assert.equal(await fs.stat(`${target}.lock`).then(() => true), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("private writes support compare-and-swap without replacing newer state", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-private-cas-"));
  const target = path.join(directory, "state.json");
  try {
    await writePrivateFileAtomic(target, "first\n", { expectedSha256: null });
    const firstSha256 = createHash("sha256").update("first\n").digest("hex");
    await writePrivateFileAtomic(target, "second\n", { expectedSha256: firstSha256 });

    await assert.rejects(
      () => writePrivateFileAtomic(target, "stale replacement\n", { expectedSha256: firstSha256 }),
      /secret_file_compare_and_swap_conflict/,
    );
    assert.equal(await readPrivateFile(target), "second\n");
    await assert.rejects(
      () => writePrivateFileAtomic(target, "duplicate create\n", { expectedSha256: null }),
      /secret_file_compare_and_swap_conflict/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("diagnostic stale locks remain fail closed until explicitly verified and removed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-private-stale-lock-"));
  const target = path.join(directory, "state.json");
  const lockPath = `${target}.lock`;
  const staleLock = {
    version: "clawnera.private-file-lock.v1",
    target,
    pid: 2_147_483_647,
    createdAtMs: Date.now() - 86_400_000,
  };
  try {
    await fs.writeFile(lockPath, `${JSON.stringify(staleLock)}\n`, { mode: 0o600 });
    await assert.rejects(
      () => writePrivateFileAtomic(target, "secret"),
      (error) => error?.message === "secret_file_write_in_progress" && error?.lockPath === lockPath,
    );
    assert.deepEqual(JSON.parse(await fs.readFile(lockPath, "utf8")), staleLock);
    await fs.rm(lockPath);
    await writePrivateFileAtomic(target, "secret");
    assert.equal(await readPrivateFile(target), "secret");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("key-agreement records reject expired private keys", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-expired-key-"));
  const filePath = path.join(directory, "key.json");
  const keys = generateKeyAgreementKeypair();
  try {
    await saveKeyAgreementRecord({
      address: ADDRESS,
      keyVersion: 1,
      publicKeyMultibase: keys.publicKeyMultibase,
      privateKeyMultibase: keys.privateKeyMultibase,
      expiresAtMs: Date.now() + 60_000,
      filePath,
    });
    await assert.rejects(
      () => loadKeyAgreementRecord(filePath, { nowMs: Date.now() + 120_000 }),
      /expired_key_agreement_record/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("key-agreement records encrypt private keys at rest with an owner-only master key", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-encrypted-key-"));
  const filePath = path.join(directory, "key.json");
  const keys = generateKeyAgreementKeypair();
  try {
    await saveKeyAgreementRecord({
      address: ADDRESS,
      keyVersion: 2,
      publicKeyMultibase: keys.publicKeyMultibase,
      privateKeyMultibase: keys.privateKeyMultibase,
      expiresAtMs: Date.now() + 60_000,
      filePath,
    });
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(raw.includes(keys.privateKeyMultibase), false);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "privateKeyMultibase"), false);
    assert.equal(parsed.version, "clawnera.key-agreement.v2");
    assert.equal(parsed.privateKeyEnvelope.cipher, DEFAULT_E2EE_CIPHER_SUITE.split("+")[0]);
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(defaultKeyAgreementMasterKeyPath(filePath))).mode & 0o777, 0o600);

    const loaded = await loadKeyAgreementRecord(filePath);
    assert.equal(loaded.privateKeyMultibase, keys.privateKeyMultibase);
    assert.equal(loaded.publicKeyMultibase, keys.publicKeyMultibase);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("strict key-agreement storage requires a pre-provisioned master key outside the record directory", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-external-key-"));
  const recordDirectory = path.join(directory, "records");
  const keyDirectory = path.join(directory, "protected-keys");
  const filePath = path.join(recordDirectory, "key.json");
  const sameDirectoryMasterKey = path.join(recordDirectory, "master.key");
  const externalMasterKey = path.join(keyDirectory, "master.key");
  const keys = generateKeyAgreementKeypair();
  const previousPolicy = process.env.CLAWNERA_KEY_AGREEMENT_REQUIRE_EXTERNAL_MASTER_KEY;
  const previousMasterKeyFile = process.env.CLAWNERA_KEY_AGREEMENT_MASTER_KEY_FILE;
  process.env.CLAWNERA_KEY_AGREEMENT_REQUIRE_EXTERNAL_MASTER_KEY = "1";
  delete process.env.CLAWNERA_KEY_AGREEMENT_MASTER_KEY_FILE;
  try {
    const input = {
      address: ADDRESS,
      keyVersion: 20,
      publicKeyMultibase: keys.publicKeyMultibase,
      privateKeyMultibase: keys.privateKeyMultibase,
      expiresAtMs: Date.now() + 60_000,
      filePath,
    };
    await assert.rejects(
      () => saveKeyAgreementRecord(input),
      /key_agreement_external_master_key_required/,
    );

    await writePrivateFileAtomic(sameDirectoryMasterKey, Buffer.alloc(32, 0x31));
    await assert.rejects(
      () => saveKeyAgreementRecord({ ...input, masterKeyFile: sameDirectoryMasterKey }),
      /key_agreement_external_master_key_required/,
    );

    await writePrivateFileAtomic(externalMasterKey, Buffer.alloc(32, 0x32));
    await saveKeyAgreementRecord({ ...input, masterKeyFile: externalMasterKey });
    const loaded = await loadKeyAgreementRecord(filePath, { masterKeyFile: externalMasterKey });
    assert.equal(loaded.privateKeyMultibase, keys.privateKeyMultibase);
    assert.equal(loaded.publicKeyMultibase, keys.publicKeyMultibase);
    await assert.rejects(
      () => fs.stat(defaultKeyAgreementMasterKeyPath(filePath)),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    if (previousPolicy === undefined) {
      delete process.env.CLAWNERA_KEY_AGREEMENT_REQUIRE_EXTERNAL_MASTER_KEY;
    } else {
      process.env.CLAWNERA_KEY_AGREEMENT_REQUIRE_EXTERNAL_MASTER_KEY = previousPolicy;
    }
    if (previousMasterKeyFile === undefined) {
      delete process.env.CLAWNERA_KEY_AGREEMENT_MASTER_KEY_FILE;
    } else {
      process.env.CLAWNERA_KEY_AGREEMENT_MASTER_KEY_FILE = previousMasterKeyFile;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("strict key-agreement storage rejects invalid policy values", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-external-key-policy-"));
  const filePath = path.join(directory, "key.json");
  const keys = generateKeyAgreementKeypair();
  const previousPolicy = process.env.CLAWNERA_KEY_AGREEMENT_REQUIRE_EXTERNAL_MASTER_KEY;
  process.env.CLAWNERA_KEY_AGREEMENT_REQUIRE_EXTERNAL_MASTER_KEY = "true";
  try {
    await assert.rejects(
      () => saveKeyAgreementRecord({
        address: ADDRESS,
        keyVersion: 21,
        publicKeyMultibase: keys.publicKeyMultibase,
        privateKeyMultibase: keys.privateKeyMultibase,
        expiresAtMs: Date.now() + 60_000,
        filePath,
      }),
      /invalid_key_agreement_external_master_key_policy/,
    );
  } finally {
    if (previousPolicy === undefined) {
      delete process.env.CLAWNERA_KEY_AGREEMENT_REQUIRE_EXTERNAL_MASTER_KEY;
    } else {
      process.env.CLAWNERA_KEY_AGREEMENT_REQUIRE_EXTERNAL_MASTER_KEY = previousPolicy;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("key-agreement envelope rejects the wrong protected master key and ciphertext tampering", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-key-tamper-"));
  const filePath = path.join(directory, "key.json");
  const primaryMasterKey = path.join(directory, "primary.master");
  const wrongMasterKey = path.join(directory, "wrong.master");
  const keys = generateKeyAgreementKeypair();
  try {
    await writePrivateFileAtomic(primaryMasterKey, Buffer.alloc(32, 0x11));
    await writePrivateFileAtomic(wrongMasterKey, Buffer.alloc(32, 0x22));
    await saveKeyAgreementRecord({
      address: ADDRESS,
      keyVersion: 3,
      publicKeyMultibase: keys.publicKeyMultibase,
      privateKeyMultibase: keys.privateKeyMultibase,
      expiresAtMs: Date.now() + 60_000,
      filePath,
      masterKeyFile: primaryMasterKey,
    });
    await assert.rejects(
      () => loadKeyAgreementRecord(filePath, { masterKeyFile: wrongMasterKey }),
      /key_agreement_record_decryption_failed/,
    );

    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    const ciphertext = parsed.privateKeyEnvelope.ciphertextB64u;
    parsed.privateKeyEnvelope.ciphertextB64u = `${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}`;
    await writePrivateFileAtomic(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
    await assert.rejects(
      () => loadKeyAgreementRecord(filePath, { masterKeyFile: primaryMasterKey }),
      /key_agreement_record_decryption_failed/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("key-agreement master keys must be exactly 32 bytes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-key-length-"));
  const keys = generateKeyAgreementKeypair();
  try {
    for (const length of [16, 31, 33, 64]) {
      const masterKeyFile = path.join(directory, `master-${length}`);
      const filePath = path.join(directory, `key-${length}.json`);
      await writePrivateFileAtomic(masterKeyFile, Buffer.alloc(length, 0x42));
      await assert.rejects(
        () => saveKeyAgreementRecord({
          address: ADDRESS,
          keyVersion: length,
          publicKeyMultibase: keys.publicKeyMultibase,
          privateKeyMultibase: keys.privateKeyMultibase,
          expiresAtMs: Date.now() + 60_000,
          filePath,
          masterKeyFile,
        }),
        /invalid_key_agreement_master_key_length/,
      );
      await assert.rejects(() => fs.stat(filePath), (error) => error?.code === "ENOENT");
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("key-agreement encrypted records reject unsafe record and master-key files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-key-files-"));
  const filePath = path.join(directory, "key.json");
  const recordLink = path.join(directory, "record-link.json");
  const masterKeyPath = defaultKeyAgreementMasterKeyPath(filePath);
  const masterKeyBackup = path.join(directory, "master-backup");
  const keys = generateKeyAgreementKeypair();
  try {
    await saveKeyAgreementRecord({
      address: ADDRESS,
      keyVersion: 4,
      publicKeyMultibase: keys.publicKeyMultibase,
      privateKeyMultibase: keys.privateKeyMultibase,
      expiresAtMs: Date.now() + 60_000,
      filePath,
    });
    await fs.symlink(filePath, recordLink);
    await assert.rejects(() => loadKeyAgreementRecord(recordLink), /unsafe_secret_file_symlink/);

    await fs.chmod(filePath, 0o644);
    await assert.rejects(() => loadKeyAgreementRecord(filePath), /unsafe_secret_file_mode/);
    await fs.chmod(filePath, 0o600);

    await fs.rename(masterKeyPath, masterKeyBackup);
    await fs.symlink(masterKeyBackup, masterKeyPath);
    await assert.rejects(() => loadKeyAgreementRecord(filePath), /unsafe_secret_file_symlink/);
    await fs.rm(masterKeyPath);
    await fs.rename(masterKeyBackup, masterKeyPath);
    await fs.chmod(masterKeyPath, 0o644);
    await assert.rejects(() => loadKeyAgreementRecord(filePath), /unsafe_secret_file_mode/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("concurrent master-key creation converges and interrupted record replacement preserves ciphertext", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-key-race-"));
  const firstPath = path.join(directory, "first.json");
  const secondPath = path.join(directory, "second.json");
  const firstKeys = generateKeyAgreementKeypair();
  const secondKeys = generateKeyAgreementKeypair();
  const expiresAtMs = Date.now() + 120_000;
  try {
    await Promise.all([
      saveKeyAgreementRecord({
        address: ADDRESS,
        keyVersion: 5,
        publicKeyMultibase: firstKeys.publicKeyMultibase,
        privateKeyMultibase: firstKeys.privateKeyMultibase,
        expiresAtMs,
        filePath: firstPath,
      }),
      saveKeyAgreementRecord({
        address: `0x${"b".repeat(64)}`,
        keyVersion: 6,
        publicKeyMultibase: secondKeys.publicKeyMultibase,
        privateKeyMultibase: secondKeys.privateKeyMultibase,
        expiresAtMs,
        filePath: secondPath,
      }),
    ]);
    assert.equal((await loadKeyAgreementRecord(firstPath)).privateKeyMultibase, firstKeys.privateKeyMultibase);
    assert.equal((await loadKeyAgreementRecord(secondPath)).privateKeyMultibase, secondKeys.privateKeyMultibase);

    const original = await fs.readFile(firstPath, "utf8");
    await fs.writeFile(`${firstPath}.lock`, "interrupted", { mode: 0o600 });
    await assert.rejects(
      () => saveKeyAgreementRecord({
        address: ADDRESS,
        keyVersion: 5,
        publicKeyMultibase: firstKeys.publicKeyMultibase,
        privateKeyMultibase: firstKeys.privateKeyMultibase,
        expiresAtMs: expiresAtMs + 60_000,
        filePath: firstPath,
      }),
      /secret_file_write_in_progress/,
    );
    assert.equal(await fs.readFile(firstPath, "utf8"), original);
    await fs.rm(`${firstPath}.lock`);
    assert.equal((await loadKeyAgreementRecord(firstPath)).privateKeyMultibase, firstKeys.privateKeyMultibase);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("plaintext legacy key records are rejected by default and migrate atomically without stdout material", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-key-migrate-"));
  const filePath = path.join(directory, "legacy.json");
  const keys = generateKeyAgreementKeypair();
  const expiresAtMs = Date.now() - 1_000;
  const legacy = {
    version: "clawnera.key-agreement.v1",
    address: ADDRESS,
    keyVersion: 7,
    publicKeyMultibase: keys.publicKeyMultibase,
    privateKeyMultibase: keys.privateKeyMultibase,
    expiresAtMs,
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  };
  try {
    await writePrivateFileAtomic(filePath, `${JSON.stringify(legacy, null, 2)}\n`);
    await assert.rejects(() => loadKeyAgreementRecord(filePath), /plaintext_key_agreement_record_rejected/);
    const migrated = await migrateLegacyKeyAgreementRecord(filePath);
    assert.equal(migrated.expired, true);
    assert.equal(Object.prototype.hasOwnProperty.call(migrated, "privateKeyMultibase"), false);
    const raw = await fs.readFile(filePath, "utf8");
    assert.equal(raw.includes(keys.privateKeyMultibase), false);
    assert.equal(JSON.parse(raw).version, "clawnera.key-agreement.v2");
    await assert.rejects(() => loadKeyAgreementRecord(filePath), /expired_key_agreement_record/);
    assert.equal(
      (await loadKeyAgreementRecord(filePath, { allowExpired: true })).privateKeyMultibase,
      keys.privateKeyMultibase,
    );
    await assert.rejects(() => migrateLegacyKeyAgreementRecord(filePath), /already_encrypted/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("legacy key migration never overwrites a concurrently changed record", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-key-migrate-cas-"));
  const filePath = path.join(directory, "legacy.json");
  const keys = generateKeyAgreementKeypair();
  const legacy = {
    version: "clawnera.key-agreement.v1",
    address: ADDRESS,
    keyVersion: 8,
    publicKeyMultibase: keys.publicKeyMultibase,
    privateKeyMultibase: keys.privateKeyMultibase,
    expiresAtMs: Date.now() + 60_000,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 30_000).toISOString(),
  };
  try {
    await writePrivateFileAtomic(filePath, `${JSON.stringify(legacy, null, 2)}\n`);
    const migration = migrateLegacyKeyAgreementRecord(filePath);
    const masterKeyPath = defaultKeyAgreementMasterKeyPath(filePath);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        await fs.stat(masterKeyPath);
        break;
      } catch (error) {
        if (error?.code !== "ENOENT" || attempt === 199) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
    const changed = {
      ...legacy,
      updatedAt: new Date().toISOString(),
      concurrentUpdate: true,
    };
    await fs.writeFile(filePath, `${JSON.stringify(changed, null, 2)}\n`, { mode: 0o600 });
    await assert.rejects(migration, /secret_file_compare_and_swap_conflict/);
    const finalRecord = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(finalRecord.concurrentUpdate, true);
    assert.equal(finalRecord.version, "clawnera.key-agreement.v1");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

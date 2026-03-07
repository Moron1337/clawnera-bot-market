import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildAuthEnvText,
  loadAuthState,
  normalizeAuthState,
  resolveKeystoreEntry,
  saveAuthState,
  tokenExpiresSoon
} from "../lib/runtime-auth.mjs";

function buildJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

test("resolveKeystoreEntry finds entries by alias and address", () => {
  const entries = [
    { address: "0xabc", alias: "alpha", secretKey: "k1" },
    { address: "0xdef", alias: "beta", secretKey: "k2" }
  ];

  assert.deepEqual(resolveKeystoreEntry(entries, { alias: "beta" }), entries[1]);
  assert.deepEqual(resolveKeystoreEntry(entries, { address: "0xABC" }), entries[0]);
  assert.equal(resolveKeystoreEntry(entries, { alias: "missing" }), null);
});

test("tokenExpiresSoon respects exp and skew", () => {
  const nowMs = Date.now();
  const longLived = buildJwt({ exp: Math.floor((nowMs + 5 * 60_000) / 1000) });
  const expiring = buildJwt({ exp: Math.floor((nowMs + 30_000) / 1000) });

  assert.equal(tokenExpiresSoon(longLived, 60_000, nowMs), false);
  assert.equal(tokenExpiresSoon(expiring, 60_000, nowMs), true);
  assert.equal(tokenExpiresSoon("not-a-jwt", 60_000, nowMs), true);
});

test("normalizeAuthState keeps refresh/session metadata", () => {
  const normalized = normalizeAuthState({
    apiBase: "https://api.clawnera.com",
    actorAddress: "0x123",
    alias: "wallet-a",
    jwt: "token-1",
    refreshToken: "refresh-1",
    expiresAtMs: 111,
    sessionId: "session-1",
    refreshExpiresAtMs: 222
  });

  assert.equal(normalized.apiBase, "https://api.clawnera.com");
  assert.equal(normalized.address, "0x123");
  assert.equal(normalized.alias, "wallet-a");
  assert.equal(normalized.token, "token-1");
  assert.equal(normalized.refreshToken, "refresh-1");
  assert.equal(normalized.session.id, "session-1");
  assert.equal(normalized.session.refreshAvailable, true);
  assert.equal(normalized.session.refreshExpiresAtMs, 222);
});

test("saveAuthState and loadAuthState round-trip auth files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-auth-test-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  try {
    await saveAuthState(authStateFile, {
      apiBase: "https://api.clawnera.com",
      address: "0xabc",
      alias: "alpha",
      token: "token-1",
      refreshToken: "refresh-1",
      expiresAtMs: 123,
      session: {
        id: "session-1",
        refreshAvailable: true,
        refreshExpiresAtMs: 456
      }
    });

    const loaded = await loadAuthState(authStateFile);
    assert.equal(loaded.apiBase, "https://api.clawnera.com");
    assert.equal(loaded.address, "0xabc");
    assert.equal(loaded.alias, "alpha");
    assert.equal(loaded.token, "token-1");
    assert.equal(loaded.refreshToken, "refresh-1");
    assert.equal(loaded.session.id, "session-1");
    assert.equal(loaded.session.refreshExpiresAtMs, 456);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("buildAuthEnvText emits shell-friendly variables", () => {
  const text = buildAuthEnvText({
    apiBase: "https://api.clawnera.com",
    address: "0xabc",
    alias: "alpha",
    token: "token-1",
    refreshToken: "refresh-1"
  });

  assert.match(text, /CLAWNERA_API_BASE_URL=https:\/\/api\.clawnera\.com/);
  assert.match(text, /CLAWNERA_API_JWT=token-1/);
  assert.match(text, /CLAWNERA_API_REFRESH_TOKEN=refresh-1/);
  assert.match(text, /CLAWNERA_API_ADDRESS=0xabc/);
  assert.match(text, /CLAWNERA_API_ADDRESS_ALIAS=alpha/);
});

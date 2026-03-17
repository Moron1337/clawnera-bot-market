import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendEd25519KeystoreEntry,
  buildAuthEnvText,
  loadKeystoreEntries,
  refreshAuthState,
  loadAuthState,
  normalizeAuthState,
  resolveKeystoreEntry,
  saveAuthState,
  tokenExpiresSoon,
  validateRuntimeAuthState
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

test("normalizeAuthState keeps missing numeric session fields null", () => {
  const normalized = normalizeAuthState({
    apiBase: "https://api.clawnera.com",
    token: "token-1",
    refreshToken: "refresh-1",
    session: {}
  });

  assert.equal(normalized.expiresAtMs, null);
  assert.equal(normalized.session.refreshExpiresAtMs, null);
  assert.equal(normalized.session.lastRefreshedAtMs, null);
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

test("appendEd25519KeystoreEntry creates a readable keystore entry", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawnera-keystore-test-"));
  const keystoreFile = path.join(tempDir, "iota.keystore");

  try {
    const created = await appendEd25519KeystoreEntry(keystoreFile, "sdk-wallet");
    const loaded = await loadKeystoreEntries(keystoreFile);
    const raw = JSON.parse(await fs.readFile(keystoreFile, "utf8"));

    assert.equal(created.alias, "sdk-wallet");
    assert.match(created.address, /^0x[a-f0-9]{64}$/);
    assert.equal(raw.version, 2);
    assert.equal(Array.isArray(raw.keys), true);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].alias, "sdk-wallet");
    assert.equal(loaded[0].address, created.address);
    assert.match(loaded[0].secretKey, /^iotaprivkey1/);
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

test("validateRuntimeAuthState rejects expired refresh tokens when refresh is required", () => {
  const nowMs = Date.now();
  const validation = validateRuntimeAuthState(
    {
      apiBase: "https://api.clawnera.com",
      refreshToken: "refresh-token",
      session: {
        refreshAvailable: true,
        refreshExpiresAtMs: nowMs - 1_000
      }
    },
    {
      nowMs
    }
  );

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.includes("expired_auth_refresh_token"));
});

test("validateRuntimeAuthState rejects malformed access tokens even with refresh token present", () => {
  const validation = validateRuntimeAuthState({
    apiBase: "https://api.clawnera.com",
    token: "bad.token.value",
    refreshToken: "refresh-token",
    session: {
      refreshAvailable: true,
      refreshExpiresAtMs: Date.now() + 60_000
    }
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.includes("invalid_auth_token_format"));
});

test("validateRuntimeAuthState allows valid access token with expired refresh token", () => {
  const nowMs = Date.now();
  const validation = validateRuntimeAuthState(
    {
      apiBase: "https://api.clawnera.com",
      token: buildJwt({ exp: Math.floor((nowMs + 5 * 60_000) / 1000) }),
      refreshToken: "refresh-token",
      session: {
        refreshAvailable: true,
        refreshExpiresAtMs: nowMs - 1_000
      }
    },
    {
      nowMs
    }
  );

  assert.equal(validation.ok, true);
  assert.deepEqual(validation.issues, []);
});

test("validateRuntimeAuthState rejects mismatched required api base", () => {
  const validation = validateRuntimeAuthState(
    {
      apiBase: "https://api.other.example",
      token: buildJwt({ exp: Math.floor((Date.now() + 5 * 60_000) / 1000) })
    },
    {
      requiredApiBase: "https://api.clawnera.com"
    }
  );

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.includes("auth_state_api_base_mismatch"));
});

test("refreshAuthState preserves existing refresh token when server omits a new one", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        token: "token-2",
        expiresAtMs: 456,
        session: {
          id: "session-1",
          refreshAvailable: true,
          refreshExpiresAtMs: 789
        }
      }),
    json: async () => ({
      token: "token-2",
      expiresAtMs: 456,
      session: {
        id: "session-1",
        refreshAvailable: true,
        refreshExpiresAtMs: 789
      }
    })
  });

  try {
    const refreshed = await refreshAuthState({
      apiBase: "https://api.clawnera.com",
      authState: {
        apiBase: "https://api.clawnera.com",
        token: "token-1",
        refreshToken: "refresh-1",
        session: {
          id: "session-1",
          refreshAvailable: true
        }
      }
    });

    assert.equal(refreshed.token, "token-2");
    assert.equal(refreshed.refreshToken, "refresh-1");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

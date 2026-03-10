import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function defaultIotaKeystorePath(homeDir = os.homedir()) {
  return path.join(homeDir, ".iota", "iota_config", "iota.keystore");
}

export function defaultAuthStatePath(homeDir = os.homedir()) {
  return path.join(homeDir, ".config", "clawnera", "auth-state.json");
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeApiBase(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }
    const out = parsed.toString();
    return out.endsWith("/") ? out.slice(0, -1) : out;
  } catch {
    return "";
  }
}

function normalizeAddress(value) {
  return normalizeString(value).toLowerCase();
}

function fromBase64Url(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

async function requestJson(url, init = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    return {
      ok: response.ok,
      status: response.status,
      body,
      raw: text
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function keypairFromSecret(secretKey) {
  const [
    { decodeIotaPrivateKey },
    { Ed25519Keypair },
    { Secp256k1Keypair },
    { Secp256r1Keypair }
  ] = await Promise.all([
    import("@iota/iota-sdk/cryptography"),
    import("@iota/iota-sdk/keypairs/ed25519"),
    import("@iota/iota-sdk/keypairs/secp256k1"),
    import("@iota/iota-sdk/keypairs/secp256r1")
  ]);

  const decoded = decodeIotaPrivateKey(secretKey);
  if (decoded.schema === "ED25519") {
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  if (decoded.schema === "Secp256k1") {
    return Secp256k1Keypair.fromSecretKey(secretKey);
  }
  if (decoded.schema === "Secp256r1") {
    return Secp256r1Keypair.fromSecretKey(secretKey);
  }
  throw new Error(`unsupported_schema:${decoded.schema}`);
}

export async function loadKeystoreEntries(keystorePath = defaultIotaKeystorePath()) {
  const raw = await fs.readFile(keystorePath, "utf8");
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed?.keys) ? parsed.keys : [];
  return entries
    .map((entry) => {
      const keyRecord =
        entry && typeof entry === "object" && !Array.isArray(entry) && entry.key && typeof entry.key === "object"
          ? entry.key
          : null;
      const secretKey = normalizeString(keyRecord?.value);
      const address = normalizeString(entry?.address);
      const alias = normalizeString(entry?.alias);
      return secretKey && address
        ? {
            address,
            alias,
            secretKey
          }
        : null;
    })
    .filter(Boolean);
}

export function resolveKeystoreEntry(entries, input = {}) {
  const address = normalizeAddress(input.address);
  const alias = normalizeString(input.alias).toLowerCase();

  if (address) {
    return entries.find((entry) => normalizeAddress(entry.address) === address) ?? null;
  }

  if (alias) {
    return entries.find((entry) => normalizeString(entry.alias).toLowerCase() === alias) ?? null;
  }

  return null;
}

export function parseJwtPayload(token) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(fromBase64Url(parts[1]));
  } catch {
    return null;
  }
}

export function tokenExpiresSoon(token, skewMs = 60_000, nowMs = Date.now()) {
  const payload = parseJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") {
    return true;
  }
  return payload.exp * 1000 <= nowMs + skewMs;
}

export function normalizeAuthState(input, apiBaseFallback = "") {
  const record = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const sessionRecord =
    record.session && typeof record.session === "object" && !Array.isArray(record.session) ? record.session : {};
  const apiBase = normalizeApiBase(record.apiBase || apiBaseFallback);
  const token = normalizeString(record.token || record.jwt);
  const refreshToken = normalizeString(record.refreshToken);
  const address = normalizeString(record.address || record.actorAddress);
  const alias = normalizeString(record.alias);
  const expiresAtMs = normalizeOptionalNumber(record.expiresAtMs);
  const refreshExpiresAtMs =
    normalizeOptionalNumber(sessionRecord.refreshExpiresAtMs) ?? normalizeOptionalNumber(record.refreshExpiresAtMs);

  return {
    version: "clawnera.auth.v1",
    apiBase,
    address,
    alias,
    token,
    refreshToken,
    expiresAtMs,
    session: {
      id: normalizeString(sessionRecord.id || record.sessionId),
      refreshAvailable: Boolean(sessionRecord.refreshAvailable ?? refreshToken),
      refreshExpiresAtMs,
      lastRefreshedAtMs: normalizeOptionalNumber(sessionRecord.lastRefreshedAtMs)
    },
    updatedAt: normalizeString(record.updatedAt)
  };
}

export function validateRuntimeAuthState(input, options = {}) {
  const normalized = normalizeAuthState(input, options.apiBaseFallback || "");
  const requiredApiBase = normalizeApiBase(options.requiredApiBase || "");
  const refreshSkewMs = Number.isFinite(Number(options.refreshSkewMs)) ? Number(options.refreshSkewMs) : 60_000;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const issues = [];

  if (!normalized.apiBase) {
    issues.push("missing_or_invalid_api_base");
  }
  if (requiredApiBase && normalized.apiBase && normalized.apiBase !== requiredApiBase) {
    issues.push("auth_state_api_base_mismatch");
  }
  if (!normalized.token && !normalized.refreshToken) {
    issues.push("missing_or_invalid_auth_token");
  }
  const refreshRequired = !normalized.token || tokenExpiresSoon(normalized.token, refreshSkewMs, nowMs);
  if (
    normalized.refreshToken &&
    normalized.session.refreshExpiresAtMs !== null &&
    normalized.session.refreshExpiresAtMs <= nowMs &&
    refreshRequired
  ) {
    issues.push("expired_auth_refresh_token");
  }
  if (normalized.token && tokenExpiresSoon(normalized.token, refreshSkewMs, nowMs) && !normalized.refreshToken) {
    issues.push("expired_auth_no_refresh");
  }

  return {
    ok: issues.length === 0,
    authState: normalized,
    issues
  };
}

export async function loadAuthState(authStateFile) {
  const raw = await fs.readFile(authStateFile, "utf8");
  return normalizeAuthState(JSON.parse(raw));
}

export async function saveAuthState(authStateFile, authState) {
  const target = path.resolve(authStateFile);
  const directory = path.dirname(target);
  const normalized = {
    ...normalizeAuthState(authState),
    updatedAt: new Date().toISOString()
  };
  const tempFile = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempFile, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  await fs.chmod(tempFile, 0o600);
  await fs.rename(tempFile, target);
  return normalized;
}

export function buildAuthEnvText(authState) {
  const normalized = normalizeAuthState(authState);
  const lines = [];
  if (normalized.apiBase) {
    lines.push(`CLAWNERA_API_BASE_URL=${normalized.apiBase}`);
  }
  if (normalized.token) {
    lines.push(`CLAWNERA_API_JWT=${normalized.token}`);
  }
  if (normalized.refreshToken) {
    lines.push(`CLAWNERA_API_REFRESH_TOKEN=${normalized.refreshToken}`);
  }
  if (normalized.address) {
    lines.push(`CLAWNERA_API_ADDRESS=${normalized.address}`);
  }
  if (normalized.alias) {
    lines.push(`CLAWNERA_API_ADDRESS_ALIAS=${normalized.alias}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function signInWithKeystoreEntry({
  apiBase,
  entry,
  timeoutMs = 10_000
}) {
  const keypair = await keypairFromSecret(entry.secretKey);
  const challengeResponse = await requestJson(
    new URL("/auth/challenge", apiBase),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ address: entry.address })
    },
    timeoutMs
  );
  if (!challengeResponse.ok || !challengeResponse.body?.messageToSign || !challengeResponse.body?.nonce) {
    throw new Error(`auth_challenge_failed:${challengeResponse.status}`);
  }

  const signed = await keypair.signPersonalMessage(new TextEncoder().encode(challengeResponse.body.messageToSign));
  const verifyResponse = await requestJson(
    new URL("/auth/verify", apiBase),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        nonce: challengeResponse.body.nonce,
        address: entry.address,
        message: challengeResponse.body.messageToSign,
        signature: signed.signature
      })
    },
    timeoutMs
  );
  if (!verifyResponse.ok || !verifyResponse.body?.token) {
    throw new Error(`auth_verify_failed:${verifyResponse.status}`);
  }

  return normalizeAuthState({
    apiBase,
    address: entry.address,
    alias: entry.alias,
    token: verifyResponse.body.token,
    refreshToken: verifyResponse.body.refreshToken,
    expiresAtMs: verifyResponse.body.expiresAtMs,
    session: verifyResponse.body.session,
    updatedAt: new Date().toISOString()
  });
}

export async function refreshAuthState({ apiBase, authState, timeoutMs = 10_000 }) {
  const normalized = normalizeAuthState(authState, apiBase);
  if (!normalized.refreshToken) {
    throw new Error("missing_refresh_token");
  }

  const refreshResponse = await requestJson(
    new URL("/auth/refresh", normalized.apiBase || apiBase),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        refreshToken: normalized.refreshToken
      })
    },
    timeoutMs
  );

  if (!refreshResponse.ok || !refreshResponse.body?.token) {
    throw new Error(`auth_refresh_failed:${refreshResponse.status}`);
  }

  return normalizeAuthState({
    ...normalized,
    token: refreshResponse.body.token,
    refreshToken: refreshResponse.body.refreshToken,
    expiresAtMs: refreshResponse.body.expiresAtMs,
    session: refreshResponse.body.session,
    updatedAt: new Date().toISOString()
  });
}

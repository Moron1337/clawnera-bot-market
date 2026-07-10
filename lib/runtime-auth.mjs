import os from "node:os";
import path from "node:path";
import {
  normalizeAuthenticatedBaseUrl,
  readPrivateFile,
  writePrivateJsonAtomic,
} from "./local-security.mjs";

export function defaultIotaKeystorePath(homeDir = os.homedir()) {
  return path.join(homeDir, ".iota", "iota_config", "iota.keystore");
}

export function defaultAuthStatePath(homeDir = os.homedir()) {
  return path.join(homeDir, ".config", "clawnera", "auth-state.json");
}

async function loadKeystoreDocument(keystorePath) {
  try {
    const raw = await readPrivateFile(keystorePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: typeof parsed?.version === "number" ? parsed.version : 2,
      keys: Array.isArray(parsed?.keys) ? parsed.keys : []
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        version: 2,
        keys: []
      };
    }
    throw error;
  }
}

async function saveKeystoreDocument(keystorePath, document) {
  const target = path.resolve(keystorePath);
  await writePrivateJsonAtomic(target, {
    version: typeof document?.version === "number" ? document.version : 2,
    keys: Array.isArray(document?.keys) ? document.keys : []
  });
  return target;
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
    return normalizeAuthenticatedBaseUrl(normalized, { errorCode: "invalid_api_base" });
  } catch {
    return "";
  }
}

function normalizeAddress(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeAuthContextToken(value, fieldName) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized || normalized.length > 128 || !/^[a-z0-9._:-]+$/.test(normalized)) {
    throw new Error(`invalid_auth_challenge_${fieldName}`);
  }
  return normalized;
}

function normalizeChainFamily(value) {
  const normalized = normalizeString(value || "iota").toLowerCase();
  if (normalized !== "iota" && normalized !== "sui") {
    throw new Error("invalid_auth_chain_family");
  }
  return normalized;
}

function authOrigin(apiBase) {
  const normalized = normalizeApiBase(apiBase);
  if (!normalized) {
    throw new Error("invalid_api_base");
  }
  return new URL(normalized).origin.toLowerCase();
}

export function buildAuthChallengeV2Message(input = {}) {
  const origin = authOrigin(input.origin);
  const audience = normalizeAuthContextToken(input.audience, "audience");
  const environment = normalizeAuthContextToken(input.environment, "environment");
  const chainFamily = normalizeChainFamily(input.chainFamily);
  const network = normalizeAuthContextToken(input.network, "network");
  const address = normalizeAddress(input.address);
  const nonce = normalizeString(input.nonce);
  const issuedAtMs = Number(input.issuedAtMs);
  const expiresAtMs = Number(input.expiresAtMs);
  if (!address || !nonce || nonce.length > 256 || /[\0\r\n]/.test(nonce)) {
    throw new Error("invalid_auth_challenge_identity");
  }
  if (
    !Number.isSafeInteger(issuedAtMs) ||
    !Number.isSafeInteger(expiresAtMs) ||
    issuedAtMs <= 0 ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > 10 * 60_000
  ) {
    throw new Error("invalid_auth_challenge_window");
  }
  return [
    "CLAWDEX Sign-In v2",
    "protocol:clawdex.auth",
    "version:2",
    `origin:${origin}`,
    `audience:${audience}`,
    `environment:${environment}`,
    `chainFamily:${chainFamily}`,
    `network:${network}`,
    `address:${address}`,
    `nonce:${nonce}`,
    `issuedAt:${issuedAtMs}`,
    `expiresAt:${expiresAtMs}`,
  ].join("\n");
}

export function validateAuthChallengeV2(challenge, options = {}) {
  if (!challenge || typeof challenge !== "object" || Array.isArray(challenge)) {
    throw new Error("invalid_auth_challenge_v2");
  }
  const expectedOrigin = authOrigin(options.apiBase);
  const expectedAddress = normalizeAddress(options.address);
  const expectedChainFamily = normalizeChainFamily(options.chainFamily);
  const origin = authOrigin(challenge.origin);
  const address = normalizeAddress(challenge.address);
  const chainFamily = normalizeChainFamily(challenge.chainFamily);
  if (
    challenge.protocol !== "clawdex.auth" ||
    challenge.version !== 2 ||
    challenge.audience !== "clawdex-client" ||
    origin !== expectedOrigin ||
    address !== expectedAddress ||
    chainFamily !== expectedChainFamily
  ) {
    throw new Error("auth_challenge_context_mismatch");
  }
  if (options.network && normalizeAuthContextToken(challenge.network, "network") !== normalizeAuthContextToken(options.network, "network")) {
    throw new Error("auth_challenge_network_mismatch");
  }
  if (
    options.environment &&
    normalizeAuthContextToken(challenge.environment, "environment") !==
      normalizeAuthContextToken(options.environment, "environment")
  ) {
    throw new Error("auth_challenge_environment_mismatch");
  }
  const nowMs = Number.isSafeInteger(options.nowMs) ? options.nowMs : Date.now();
  const issuedAtMs = Number(challenge.issuedAtMs);
  const expiresAtMs = Number(challenge.expiresAtMs);
  if (issuedAtMs > nowMs + 30_000 || expiresAtMs <= nowMs) {
    throw new Error("auth_challenge_expired_or_not_yet_valid");
  }
  const context = {
    protocol: "clawdex.auth",
    version: 2,
    origin,
    audience: "clawdex-client",
    environment: normalizeAuthContextToken(challenge.environment, "environment"),
    chainFamily,
    network: normalizeAuthContextToken(challenge.network, "network"),
    address,
    nonce: normalizeString(challenge.nonce),
    issuedAtMs,
    expiresAtMs,
  };
  const expectedMessage = buildAuthChallengeV2Message(context);
  if (challenge.messageToSign !== expectedMessage) {
    throw new Error("auth_challenge_message_mismatch");
  }
  return { ...context, messageToSign: expectedMessage };
}

function assertSingleLineEnvValue(value, fieldName) {
  if (/[\0\r\n]/.test(String(value || ""))) {
    throw new Error(`invalid_env_value_${fieldName}`);
  }
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
      redirect: "error",
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

export async function keypairFromSecretKey(secretKey) {
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
  const parsed = await loadKeystoreDocument(keystorePath);
  const entries = parsed.keys;
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

export async function createEd25519KeystoreEntry(alias = "") {
  const { Ed25519Keypair } = await import("@iota/iota-sdk/keypairs/ed25519");
  const keypair = typeof Ed25519Keypair.generate === "function" ? Ed25519Keypair.generate() : new Ed25519Keypair();
  const normalizedAlias = normalizeString(alias);
  return {
    address: keypair.getPublicKey().toIotaAddress(),
    alias: normalizedAlias,
    key: {
      type: "key_pair",
      value: keypair.getSecretKey()
    }
  };
}

export async function appendEd25519KeystoreEntry(keystorePath = defaultIotaKeystorePath(), alias = "") {
  const target = path.resolve(keystorePath);
  const normalizedAlias = normalizeString(alias);
  const document = await loadKeystoreDocument(target);
  if (
    normalizedAlias &&
    document.keys.some(
      (entry) =>
        normalizeString(entry?.alias).toLowerCase() === normalizedAlias.toLowerCase()
    )
  ) {
    throw new Error("keystore_alias_exists");
  }

  const entry = await createEd25519KeystoreEntry(normalizedAlias);
  document.keys.push(entry);
  await saveKeystoreDocument(target, document);
  return {
    keystorePath: target,
    address: entry.address,
    alias: entry.alias || null
  };
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

export function quoteEnvAssignmentValue(value, fieldName = "value") {
  const normalized = normalizeString(value);
  assertSingleLineEnvValue(normalized, fieldName);
  return `'${normalized.replace(/'/g, `'\"'\"'`)}'`;
}

export function parseEnvAssignmentValue(value) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  let out = "";
  let quote = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (!quote) {
      if (/\s/.test(char)) {
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === "\\") {
        if (index + 1 < raw.length) {
          out += raw[index + 1];
          index += 1;
        }
        continue;
      }
      out += char;
      continue;
    }
    if (quote === "'") {
      if (char === "'") {
        quote = "";
      } else {
        out += char;
      }
      continue;
    }
    if (char === '"') {
      quote = "";
      continue;
    }
    if (char === "\\") {
      const next = raw[index + 1];
      if (next === "\n") {
        index += 1;
        continue;
      }
      if (next && (next === "$" || next === "`" || next === '"' || next === "\\")) {
        out += next;
        index += 1;
        continue;
      }
      out += "\\";
      continue;
    }
    out += char;
  }
  return quote ? normalizeString(raw) : out.trim();
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
    version: "clawnera.auth.v2",
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
    authContext: {
      protocol: normalizeString(record.authContext?.protocol || record.protocol),
      version: normalizeOptionalNumber(record.authContext?.version || record.authVersion),
      origin: normalizeString(record.authContext?.origin || record.origin),
      audience: normalizeString(record.authContext?.audience || record.audience),
      environment: normalizeString(record.authContext?.environment || record.environment),
      chainFamily: normalizeString(record.authContext?.chainFamily || record.chainFamily).toLowerCase(),
      network: normalizeString(record.authContext?.network || record.network).toLowerCase(),
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
  if (normalized.token && parseJwtPayload(normalized.token) === null) {
    issues.push("invalid_auth_token_format");
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
  const raw = await readPrivateFile(authStateFile, "utf8");
  return normalizeAuthState(JSON.parse(raw));
}

export async function saveAuthState(authStateFile, authState) {
  const target = path.resolve(authStateFile);
  const normalized = {
    ...normalizeAuthState(authState),
    updatedAt: new Date().toISOString()
  };
  await writePrivateJsonAtomic(target, normalized);
  return normalized;
}

export function buildAuthEnvText(authState) {
  const normalized = normalizeAuthState(authState);
  const lines = [];
  if (normalized.apiBase) {
    lines.push(`CLAWNERA_API_BASE_URL=${quoteEnvAssignmentValue(normalized.apiBase, "api_base_url")}`);
  }
  if (normalized.token) {
    lines.push(`CLAWNERA_API_JWT=${quoteEnvAssignmentValue(normalized.token, "api_jwt")}`);
  }
  if (normalized.refreshToken) {
    lines.push(`CLAWNERA_API_REFRESH_TOKEN=${quoteEnvAssignmentValue(normalized.refreshToken, "api_refresh_token")}`);
  }
  if (normalized.address) {
    lines.push(`CLAWNERA_API_ADDRESS=${quoteEnvAssignmentValue(normalized.address, "api_address")}`);
  }
  if (normalized.alias) {
    lines.push(`CLAWNERA_API_ADDRESS_ALIAS=${quoteEnvAssignmentValue(normalized.alias, "api_address_alias")}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function signInWithKeystoreEntry({
  apiBase,
  entry,
  chainFamily = "iota",
  network = "",
  environment = "",
  timeoutMs = 10_000
}) {
  const keypair = await keypairFromSecretKey(entry.secretKey);
  const normalizedChainFamily = normalizeChainFamily(chainFamily);
  const challengeResponse = await requestJson(
    new URL("/auth/challenge", apiBase),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ address: entry.address, chainFamily: normalizedChainFamily })
    },
    timeoutMs
  );
  if (!challengeResponse.ok) {
    throw new Error(`auth_challenge_failed:${challengeResponse.status}`);
  }
  const challenge = validateAuthChallengeV2(challengeResponse.body, {
    apiBase,
    address: entry.address,
    chainFamily: normalizedChainFamily,
    network,
    environment,
  });
  const signed = await keypair.signPersonalMessage(new TextEncoder().encode(challenge.messageToSign));
  const { messageToSign, ...challengeContext } = challenge;
  const verifyResponse = await requestJson(
    new URL("/auth/verify", apiBase),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        ...challengeContext,
        message: messageToSign,
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
    authContext: challengeContext,
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
    refreshToken: refreshResponse.body.refreshToken || normalized.refreshToken,
    expiresAtMs: refreshResponse.body.expiresAtMs,
    session: refreshResponse.body.session,
    updatedAt: new Date().toISOString()
  });
}

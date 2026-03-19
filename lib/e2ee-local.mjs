import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import bs58 from "bs58";
import { isValidIotaAddress, normalizeIotaAddress } from "@iota/iota-sdk/utils";

const BASE64URL_NO_PAD = /^[A-Za-z0-9\-_]+$/;
const KEY_LENGTH = 32;
const CEK_BYTES = 32;
const NONCE_BYTES = 24;
const WRAP_NONCE_BYTES = 24;
const WRAPPED_CEK_BYTES = CEK_BYTES + 16;
const MAX_DELIVERABLE_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const MAX_DELIVERABLE_CIPHERTEXT_BYTES = MAX_DELIVERABLE_PLAINTEXT_BYTES + 16;
const WRAP_INFO_PREFIX = "clawdex:cek-wrap:v1";
const MANIFEST_SIGNING_PREFIX = "CLAWDEX Milestone Manifest v1";
const LEGACY_MANIFEST_SIGNING_INTENT_LINE = "intent=clawdex.milestone.submit.v1;chain=iota";
const DEFAULT_MANIFEST_SIGNING_INTENT = "clawdex.milestone.submit.v1";
const DEFAULT_MANIFEST_SIGNING_CHAIN = "iota";
const DEFAULT_MANIFEST_SIGNING_AUDIENCE = "clawdex-api";
const DEFAULT_MANIFEST_SIGNING_TTL_MS = 15 * 60 * 1000;
const MAX_MANIFEST_SIGNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MANIFEST_SIGNING_CONTEXT_TOKEN = /^[A-Za-z0-9._:-]+$/;
const MAX_MANIFEST_ORDER_ID_BYTES = 128;
const MAX_MANIFEST_MILESTONE_ID_BYTES = 128;
const MAX_MANIFEST_CID_BYTES = 512;
const MAX_MANIFEST_CIPHER_SUITE_BYTES = 128;
const MAX_MANIFEST_CONTEXT_INTENT_BYTES = 128;
const MAX_MANIFEST_CONTEXT_CHAIN_BYTES = 32;
const MAX_MANIFEST_CONTEXT_AUDIENCE_BYTES = 128;
const MAX_MANIFEST_CONTEXT_NONCE_BYTES = 128;
const MANIFEST_RECIPIENT_HPKE_EPHEMERAL_BYTES = 32;
const MANIFEST_RECIPIENT_HPKE_NONCE_BYTES = 24;
const MANIFEST_RECIPIENT_WRAPPED_CEK_BYTES = 48;
const MIN_SERIALIZED_SIGNATURE_BYTES = 64;
const MAX_SERIALIZED_SIGNATURE_BYTES = 256;
const MIN_SERIALIZED_SIGNATURE_LENGTH = 80;
const MAX_SERIALIZED_SIGNATURE_LENGTH = 512;
export const DEFAULT_E2EE_CIPHER_SUITE = "xchacha20poly1305+hpke-x25519";
const KEY_AGREEMENT_FILE_VERSION = "clawnera.key-agreement.v1";
const utf8Encoder = new TextEncoder();
const PUBLIC_KEY_VALIDATION_PRIVATE_KEY = (() => {
  const seed = new Uint8Array(KEY_LENGTH);
  seed[0] = 1;
  return seed;
})();

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toBytes(input) {
  if (typeof input === "string") {
    return utf8Encoder.encode(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  throw new Error("invalid_byte_input");
}

function estimateBase64UrlDecodedLength(input) {
  if (!input || !BASE64URL_NO_PAD.test(input) || input.length % 4 === 1) {
    throw new Error("invalid_base64url");
  }
  const padding = (4 - (input.length % 4)) % 4;
  return ((input.length + padding) / 4) * 3 - padding;
}

function encodeBase64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function decodeBase64Url(input) {
  if (!input || !BASE64URL_NO_PAD.test(input) || input.length % 4 === 1) {
    throw new Error("invalid_base64url");
  }
  const canonicalInput = input.replace(/=+$/g, "");
  const decoded = new Uint8Array(Buffer.from(input, "base64url"));
  if (encodeBase64Url(decoded) !== canonicalInput) {
    throw new Error("invalid_base64url");
  }
  return decoded;
}

function encodeKeyMultibase(bytes, prefix = "u") {
  if (prefix === "z") {
    return `z${bs58.encode(bytes)}`;
  }
  return `u${encodeBase64Url(bytes)}`;
}

function decodeKeyMultibase(multibase) {
  const normalized = normalizeString(multibase);
  if (!normalized) {
    throw new Error("invalid_multibase_key");
  }
  if (normalized.startsWith("u")) {
    return decodeBase64Url(normalized.slice(1));
  }
  if (normalized.startsWith("z")) {
    return new Uint8Array(bs58.decode(normalized.slice(1)));
  }
  throw new Error("unsupported_multibase_prefix");
}

function assertKeyLength(bytes, kind) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== KEY_LENGTH) {
    throw new Error(`invalid_${kind}_key_length`);
  }
  return bytes;
}

function isAllZero(bytes) {
  return bytes.every((byte) => byte === 0);
}

function decodeKeyAgreementPublicKey(multibase) {
  const bytes = assertKeyLength(decodeKeyMultibase(multibase), "public");
  if (isAllZero(bytes)) {
    throw new Error("invalid_public_key");
  }
  try {
    x25519.getSharedSecret(PUBLIC_KEY_VALIDATION_PRIVATE_KEY, bytes);
  } catch {
    throw new Error("invalid_public_key");
  }
  return bytes;
}

export function keyAgreementPublicKeyHex(multibase) {
  return Buffer.from(decodeKeyAgreementPublicKey(multibase)).toString("hex");
}

function decodeKeyAgreementPrivateKey(multibase) {
  const bytes = assertKeyLength(decodeKeyMultibase(multibase), "private");
  if (isAllZero(bytes)) {
    throw new Error("invalid_private_key");
  }
  return bytes;
}

function normalizeAddress(value, fieldName = "address") {
  const normalized = normalizeString(value).toLowerCase();
  if (!isValidIotaAddress(normalized)) {
    throw new Error(`invalid_${fieldName}`);
  }
  return normalizeIotaAddress(normalized);
}

function assertBoundedUtf8String(value, fieldName, maxBytes) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`invalid_${fieldName}`);
  }
  const byteLength = utf8Encoder.encode(normalized).byteLength;
  if (byteLength === 0 || byteLength > maxBytes) {
    throw new Error(`invalid_${fieldName}`);
  }
  return normalized;
}

function assertCanonicalProtocolString(value, fieldName, maxBytes) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`invalid_${fieldName}`);
  }
  const byteLength = utf8Encoder.encode(value).byteLength;
  if (byteLength === 0 || byteLength > maxBytes) {
    throw new Error(`invalid_${fieldName}`);
  }
  return value;
}

export function assertIpfsManifestCid(value) {
  const normalized = assertCanonicalProtocolString(value, "manifest_cid", MAX_MANIFEST_CID_BYTES);
  if (!/^ipfs:\/\/[a-z0-9]+(?:[/?#].*)?$/i.test(normalized)) {
    throw new Error("invalid_manifest_cid");
  }
  return normalized;
}

export function assertLowerHex64(value, fieldName) {
  const normalized = normalizeString(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`invalid_${fieldName}`);
  }
  return normalized;
}

function bytesToHex(value) {
  return Buffer.from(value).toString("hex");
}

function sha256HexBytes(value) {
  return bytesToHex(sha256(value));
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deriveWrapKey(sharedSecret, recipientAddress, keyVersion) {
  const info = utf8Encoder.encode(`${WRAP_INFO_PREFIX}:${recipientAddress}:${keyVersion}`);
  return hkdf(sha256, sharedSecret, undefined, info, CEK_BYTES);
}

function parseHpkeEnc(hpkeEnc) {
  const parts = normalizeString(hpkeEnc).split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("invalid_hpke_enc");
  }
  if (
    estimateBase64UrlDecodedLength(parts[1]) !== MANIFEST_RECIPIENT_HPKE_EPHEMERAL_BYTES ||
    estimateBase64UrlDecodedLength(parts[2]) !== MANIFEST_RECIPIENT_HPKE_NONCE_BYTES
  ) {
    throw new Error("invalid_hpke_enc");
  }
  const ephemeralPublicKey = decodeBase64Url(parts[1]);
  const wrapNonce = decodeBase64Url(parts[2]);
  if (
    ephemeralPublicKey.length !== MANIFEST_RECIPIENT_HPKE_EPHEMERAL_BYTES ||
    wrapNonce.length !== MANIFEST_RECIPIENT_HPKE_NONCE_BYTES
  ) {
    throw new Error("invalid_hpke_enc");
  }
  return { ephemeralPublicKey, wrapNonce };
}

function normalizeManifestRecipientWrappedCek(value) {
  const normalized = assertBoundedUtf8String(value, "manifest_recipient_wrapped_cek", 128);
  const decoded = decodeBase64Url(normalized);
  if (decoded.length !== MANIFEST_RECIPIENT_WRAPPED_CEK_BYTES) {
    throw new Error("invalid_manifest_recipient_wrapped_cek");
  }
  return normalized;
}

function normalizeManifestRecipientHpkeEnc(value) {
  const normalized = assertBoundedUtf8String(value, "manifest_recipient_hpke_enc", 192);
  const parts = normalized.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("invalid_manifest_recipient_hpke_enc");
  }
  const ephemeralPublicKey = decodeBase64Url(parts[1] || "");
  const wrapNonce = decodeBase64Url(parts[2] || "");
  if (
    ephemeralPublicKey.length !== MANIFEST_RECIPIENT_HPKE_EPHEMERAL_BYTES ||
    wrapNonce.length !== MANIFEST_RECIPIENT_HPKE_NONCE_BYTES
  ) {
    throw new Error("invalid_manifest_recipient_hpke_enc");
  }
  return normalized;
}

function canonicalizeJson(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("non_finite_number_not_allowed");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    throw new Error("invalid_canonical_json_value");
  }
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(",")}}`;
}

function normalizeManifestSigningContextToken(value, fieldName, maxBytes) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error("invalid_signing_context");
  }
  const normalized = assertBoundedUtf8String(value, fieldName, maxBytes);
  if (!MANIFEST_SIGNING_CONTEXT_TOKEN.test(normalized)) {
    throw new Error("invalid_signing_context");
  }
  return normalized;
}

function createManifestNonce() {
  return randomBytes(16).reduce((out, byte) => out + byte.toString(16).padStart(2, "0"), "");
}

function normalizeManifestSigningContext(input = {}) {
  const nowMs = Date.now();
  const issuedAtMs = Number.isSafeInteger(input.issuedAtMs) ? input.issuedAtMs : nowMs;
  const ttlMs = Number.isSafeInteger(input.ttlMs) ? input.ttlMs : DEFAULT_MANIFEST_SIGNING_TTL_MS;
  const expiresAtMs = Number.isSafeInteger(input.expiresAtMs) ? input.expiresAtMs : issuedAtMs + ttlMs;
  const normalized = {
    intent: normalizeManifestSigningContextToken(
      input.intent || DEFAULT_MANIFEST_SIGNING_INTENT,
      "manifest_signing_intent",
      MAX_MANIFEST_CONTEXT_INTENT_BYTES,
    ),
    chain: normalizeManifestSigningContextToken(
      input.chain || DEFAULT_MANIFEST_SIGNING_CHAIN,
      "manifest_signing_chain",
      MAX_MANIFEST_CONTEXT_CHAIN_BYTES,
    ),
    audience: normalizeManifestSigningContextToken(
      input.audience || DEFAULT_MANIFEST_SIGNING_AUDIENCE,
      "manifest_signing_audience",
      MAX_MANIFEST_CONTEXT_AUDIENCE_BYTES,
    ),
    nonce: normalizeManifestSigningContextToken(
      input.nonce || createManifestNonce(),
      "manifest_signing_nonce",
      MAX_MANIFEST_CONTEXT_NONCE_BYTES,
    ),
    issuedAtMs,
    expiresAtMs,
  };
  if (
    !Number.isSafeInteger(normalized.issuedAtMs) ||
    !Number.isSafeInteger(normalized.expiresAtMs) ||
    normalized.issuedAtMs <= 0 ||
    normalized.expiresAtMs <= 0 ||
    normalized.issuedAtMs > normalized.expiresAtMs ||
    normalized.expiresAtMs - normalized.issuedAtMs > MAX_MANIFEST_SIGNING_WINDOW_MS
  ) {
    throw new Error("invalid_signing_context");
  }
  return normalized;
}

function buildManifestSigningIntentLine(context) {
  return [
    `intent=${context.intent}`,
    `chain=${context.chain}`,
    `aud=${context.audience}`,
    `nonce=${context.nonce}`,
    `iat=${context.issuedAtMs}`,
    `exp=${context.expiresAtMs}`,
  ].join(";");
}

function normalizeManifestRecipientsForCanonicalization(recipients) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("invalid_manifest_recipients");
  }
  const seen = new Set();
  return [...recipients]
    .map((recipient) => {
      const keyVersion = Number(recipient?.keyVersion);
      if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
        throw new Error("invalid_manifest_recipient_key_version");
      }
      const recipientAddress = normalizeAddress(recipient?.recipientAddress, "manifest_recipient_address");
      const wrappedCek = normalizeManifestRecipientWrappedCek(recipient?.wrappedCek || "");
      const hpkeEnc =
        recipient?.hpkeEnc === undefined ? undefined : normalizeManifestRecipientHpkeEnc(recipient.hpkeEnc);
      const key = `${recipientAddress}:${keyVersion}`;
      if (seen.has(key)) {
        throw new Error("duplicate_manifest_recipient");
      }
      seen.add(key);
      return { recipientAddress, keyVersion, wrappedCek, hpkeEnc };
    })
    .sort((left, right) => {
      const byAddress = left.recipientAddress.localeCompare(right.recipientAddress);
      if (byAddress !== 0) {
        return byAddress;
      }
      return left.keyVersion - right.keyVersion;
    });
}

function buildCanonicalMilestoneManifestJson(input) {
  const orderId = assertCanonicalProtocolString(input.orderId, "order_id", MAX_MANIFEST_ORDER_ID_BYTES);
  const milestoneId = assertCanonicalProtocolString(input.milestoneId, "milestone_id", MAX_MANIFEST_MILESTONE_ID_BYTES);
  const sellerAddress = normalizeAddress(input.sellerAddress, "seller_address");
  const manifestCid = assertBoundedUtf8String(input.manifestCid, "manifest_cid", MAX_MANIFEST_CID_BYTES);
  const cipherSuite = assertBoundedUtf8String(input.cipherSuite, "cipher_suite", MAX_MANIFEST_CIPHER_SUITE_BYTES);
  const recipients = normalizeManifestRecipientsForCanonicalization(input.recipients).map((recipient) => {
    const entry = {
      recipient: recipient.recipientAddress,
      keyVersion: recipient.keyVersion,
      wrappedCek: recipient.wrappedCek,
    };
    if (recipient.hpkeEnc !== undefined) {
      entry.hpkeEnc = recipient.hpkeEnc;
    }
    return entry;
  });
  const manifest = {
    manifestVersion: "v1",
    orderId,
    milestoneId,
    sellerAddress,
    blobCid: manifestCid,
    cipherSuite,
    cekWraps: recipients,
  };
  if (input.signingContext) {
    const signingContext = normalizeManifestSigningContext(input.signingContext);
    manifest.signingContext = {
      intent: signingContext.intent,
      chain: signingContext.chain,
      audience: signingContext.audience,
      nonce: signingContext.nonce,
      issuedAtMs: signingContext.issuedAtMs,
      expiresAtMs: signingContext.expiresAtMs,
    };
  }
  return canonicalizeJson(manifest);
}

function buildMilestoneManifestSigningMessage(canonicalManifestJson, signingContext) {
  if (!signingContext) {
    return `${MANIFEST_SIGNING_PREFIX}\n${LEGACY_MANIFEST_SIGNING_INTENT_LINE}\n${canonicalManifestJson}`;
  }
  return `${MANIFEST_SIGNING_PREFIX}\n${buildManifestSigningIntentLine(signingContext)}\n${canonicalManifestJson}`;
}

function formatSha256HexPrefixed(digestHex) {
  return `sha256:${digestHex.toLowerCase()}`;
}

function normalizeManifestSellerSignature(value) {
  const normalized = normalizeString(value);
  if (
    !normalized ||
    /\s/.test(normalized) ||
    normalized.length < MIN_SERIALIZED_SIGNATURE_LENGTH ||
    normalized.length > MAX_SERIALIZED_SIGNATURE_LENGTH ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(normalized)
  ) {
    throw new Error("invalid_seller_signature");
  }
  const decodedLength = Buffer.from(normalized, "base64").length;
  if (decodedLength < MIN_SERIALIZED_SIGNATURE_BYTES || decodedLength > MAX_SERIALIZED_SIGNATURE_BYTES) {
    throw new Error("invalid_seller_signature");
  }
  return normalized;
}

async function writeJsonFile(targetPath, payload, mode = 0o600) {
  const resolved = path.resolve(targetPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, JSON.stringify(payload, null, 2), { mode });
  await fs.chmod(resolved, mode);
  return resolved;
}

export function defaultKeyAgreementRecordPath(address, keyVersion = 1, homeDir = os.homedir()) {
  const normalizedAddress = normalizeAddress(address);
  if (!Number.isSafeInteger(Number(keyVersion)) || Number(keyVersion) <= 0) {
    throw new Error("invalid_key_version");
  }
  return path.join(homeDir, ".config", "clawnera", "key-agreements", `${normalizedAddress}.v${Number(keyVersion)}.json`);
}

export async function loadKeyAgreementRecord(filePath, options = {}) {
  const resolved = path.resolve(filePath);
  const raw = await fs.readFile(resolved, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_key_agreement_record");
  }
  const expectedAddress =
    typeof options.expectedAddress === "string" && options.expectedAddress.trim()
      ? normalizeAddress(options.expectedAddress)
      : "";
  const expectedKeyVersion =
    options.expectedKeyVersion === undefined || options.expectedKeyVersion === null
      ? undefined
      : Number(options.expectedKeyVersion);
  const fallbackExpiresAtMs =
    options.fallbackExpiresAtMs === undefined || options.fallbackExpiresAtMs === null
      ? undefined
      : Number(options.fallbackExpiresAtMs);
  const address = normalizeAddress(parsed.address || expectedAddress);
  const keyVersion = Number(parsed.keyVersion ?? expectedKeyVersion);
  const publicKeyMultibase = assertBoundedUtf8String(parsed.publicKeyMultibase, "public_key_multibase", 256);
  const privateKeyMultibase = assertBoundedUtf8String(parsed.privateKeyMultibase, "private_key_multibase", 256);
  const expiresAtMs = Number(parsed.expiresAtMs ?? fallbackExpiresAtMs);
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0 || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
    throw new Error("invalid_key_agreement_record");
  }
  const derivedPublicKey = derivePublicKeyFromPrivateKey(privateKeyMultibase);
  if (derivedPublicKey !== publicKeyMultibase) {
    throw new Error("key_agreement_public_private_mismatch");
  }
  if (parsed.version !== undefined && parsed.version !== KEY_AGREEMENT_FILE_VERSION) {
    throw new Error("invalid_key_agreement_record_version");
  }
  return {
    version: KEY_AGREEMENT_FILE_VERSION,
    address,
    keyVersion,
    publicKeyMultibase,
    privateKeyMultibase,
    expiresAtMs,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : null,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    filePath: resolved,
  };
}

export async function saveKeyAgreementRecord(input) {
  const address = normalizeAddress(input.address);
  const keyVersion = Number(input.keyVersion);
  const publicKeyMultibase = assertBoundedUtf8String(input.publicKeyMultibase, "public_key_multibase", 256);
  const privateKeyMultibase = assertBoundedUtf8String(input.privateKeyMultibase, "private_key_multibase", 256);
  const expiresAtMs = Number(input.expiresAtMs);
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0 || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
    throw new Error("invalid_key_agreement_record");
  }
  if (derivePublicKeyFromPrivateKey(privateKeyMultibase) !== publicKeyMultibase) {
    throw new Error("key_agreement_public_private_mismatch");
  }
  const createdAt = typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString();
  const updatedAt = new Date().toISOString();
  const filePath =
    typeof input.filePath === "string" && input.filePath.trim()
      ? path.resolve(input.filePath)
      : defaultKeyAgreementRecordPath(address, keyVersion);
  const payload = {
    version: KEY_AGREEMENT_FILE_VERSION,
    address,
    keyVersion,
    publicKeyMultibase,
    privateKeyMultibase,
    expiresAtMs,
    createdAt,
    updatedAt,
  };
  const savedPath = await writeJsonFile(filePath, payload);
  return {
    ...payload,
    filePath: savedPath,
  };
}

export function generateKeyAgreementKeypair(prefix = "u") {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    privateKeyMultibase: encodeKeyMultibase(privateKey, prefix),
    publicKeyMultibase: encodeKeyMultibase(publicKey, prefix),
  };
}

export function derivePublicKeyFromPrivateKey(multibasePrivateKey, prefix = "u") {
  const privateKey = decodeKeyAgreementPrivateKey(multibasePrivateKey);
  return encodeKeyMultibase(x25519.getPublicKey(privateKey), prefix);
}

export function buildKeyAgreementBindingMessage(address, keyVersion, publicKeyMultibase, expiresAtMs) {
  const normalizedAddress = normalizeAddress(address);
  const normalizedKeyVersion = Number(keyVersion);
  if (!Number.isSafeInteger(normalizedKeyVersion) || normalizedKeyVersion <= 0) {
    throw new Error("invalid_key_version");
  }
  const normalizedPublicKey = assertBoundedUtf8String(publicKeyMultibase, "public_key_multibase", 256);
  if (!Number.isSafeInteger(Number(expiresAtMs)) || Number(expiresAtMs) <= 0) {
    throw new Error("invalid_expires_at_ms");
  }
  return [
    "CLAWDEX Key Agreement Binding",
    `address:${normalizedAddress}`,
    `keyVersion:${normalizedKeyVersion}`,
    `keyAgreementPublicKey:${normalizedPublicKey}`,
    `expiresAtMs:${Number(expiresAtMs)}`,
  ].join("\n");
}

export async function createEncryptedDeliverable(input) {
  if (!Array.isArray(input?.recipients) || input.recipients.length === 0) {
    throw new Error("recipients_required");
  }
  const plaintext = toBytes(input.plaintext);
  if (plaintext.length > MAX_DELIVERABLE_PLAINTEXT_BYTES) {
    throw new Error("deliverable_plaintext_too_large");
  }
  const aad = input.aad === undefined ? undefined : toBytes(input.aad);

  const cek = randomBytes(CEK_BYTES);
  const blobNonce = randomBytes(NONCE_BYTES);
  const blobCipher = xchacha20poly1305(cek, blobNonce, aad);
  const ciphertext = blobCipher.encrypt(plaintext);
  const ciphertextSha256 = bytesToHex(sha256(ciphertext));

  const cekWraps = input.recipients.map((recipient) => {
    const recipientAddress = normalizeAddress(recipient.recipientAddress, "recipient_address");
    const keyVersion = Number(recipient.keyVersion);
    if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
      throw new Error("invalid_recipient_key_version");
    }
    const recipientPublicKey = decodeKeyAgreementPublicKey(recipient.recipientPublicKeyMultibase);
    const ephemeralPrivateKey = x25519.utils.randomSecretKey();
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
    const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, recipientPublicKey);
    const wrapKey = deriveWrapKey(sharedSecret, recipientAddress, keyVersion);
    const wrapNonce = randomBytes(WRAP_NONCE_BYTES);
    const wrapCipher = xchacha20poly1305(wrapKey, wrapNonce);
    const wrappedCek = wrapCipher.encrypt(cek);
    return {
      recipientAddress,
      keyVersion,
      wrappedCek: encodeBase64Url(wrappedCek),
      hpkeEnc: `v1.${encodeBase64Url(ephemeralPublicKey)}.${encodeBase64Url(wrapNonce)}`,
    };
  });

  return {
    cipherSuite: DEFAULT_E2EE_CIPHER_SUITE,
    blob: {
      nonceB64u: encodeBase64Url(blobNonce),
      ciphertextB64u: encodeBase64Url(ciphertext),
      plaintextByteLength: plaintext.length,
      ciphertextByteLength: ciphertext.length,
      ciphertextSha256,
    },
    cekWraps,
  };
}

export async function decryptDeliverableForRecipient(input) {
  if (
    !Number.isSafeInteger(input?.blob?.plaintextByteLength) ||
    input.blob.plaintextByteLength < 0 ||
    input.blob.plaintextByteLength > MAX_DELIVERABLE_PLAINTEXT_BYTES
  ) {
    throw new Error("invalid_plaintext_length");
  }
  if (
    !Number.isSafeInteger(input?.blob?.ciphertextByteLength) ||
    input.blob.ciphertextByteLength <= 0 ||
    input.blob.ciphertextByteLength > MAX_DELIVERABLE_CIPHERTEXT_BYTES ||
    input.blob.ciphertextByteLength !== input.blob.plaintextByteLength + 16
  ) {
    throw new Error("invalid_ciphertext_length");
  }
  if (estimateBase64UrlDecodedLength(input.wrap.wrappedCek) !== WRAPPED_CEK_BYTES) {
    throw new Error("invalid_wrapped_cek");
  }
  if (estimateBase64UrlDecodedLength(input.blob.nonceB64u) !== NONCE_BYTES) {
    throw new Error("invalid_blob_nonce");
  }
  if (estimateBase64UrlDecodedLength(input.blob.ciphertextB64u) !== input.blob.ciphertextByteLength) {
    throw new Error("invalid_ciphertext_length");
  }
  const recipientPrivateKey = decodeKeyAgreementPrivateKey(input.recipientPrivateKeyMultibase);
  const { ephemeralPublicKey, wrapNonce } = parseHpkeEnc(input.wrap.hpkeEnc);
  const sharedSecret = x25519.getSharedSecret(recipientPrivateKey, ephemeralPublicKey);
  const wrapKey = deriveWrapKey(sharedSecret, normalizeAddress(input.wrap.recipientAddress), Number(input.wrap.keyVersion));
  const wrappedCek = decodeBase64Url(input.wrap.wrappedCek);
  const wrapCipher = xchacha20poly1305(wrapKey, wrapNonce);
  const cek = wrapCipher.decrypt(wrappedCek);
  if (cek.length !== CEK_BYTES) {
    throw new Error("invalid_cek_length");
  }
  const blobNonce = decodeBase64Url(input.blob.nonceB64u);
  if (blobNonce.length !== NONCE_BYTES) {
    throw new Error("invalid_blob_nonce");
  }
  const ciphertext = decodeBase64Url(input.blob.ciphertextB64u);
  if (ciphertext.length !== input.blob.ciphertextByteLength) {
    throw new Error("invalid_ciphertext_length");
  }
  if (sha256HexBytes(ciphertext) !== normalizeString(input.blob.ciphertextSha256).toLowerCase()) {
    throw new Error("invalid_ciphertext_sha256");
  }
  const aad = input.aad === undefined ? undefined : toBytes(input.aad);
  const blobCipher = xchacha20poly1305(cek, blobNonce, aad);
  const plaintext = blobCipher.decrypt(ciphertext);
  if (plaintext.length !== input.blob.plaintextByteLength) {
    throw new Error("invalid_plaintext_length");
  }
  return plaintext;
}

export async function prepareMilestoneManifestForSigning(input) {
  const orderId = assertCanonicalProtocolString(input.orderId, "order_id", MAX_MANIFEST_ORDER_ID_BYTES);
  const milestoneId = assertCanonicalProtocolString(input.milestoneId, "milestone_id", MAX_MANIFEST_MILESTONE_ID_BYTES);
  const sellerAddress = normalizeAddress(input.sellerAddress, "seller_address");
  const sellerKeyVersion = Number(input.sellerKeyVersion);
  if (!Number.isSafeInteger(sellerKeyVersion) || sellerKeyVersion <= 0) {
    throw new Error("invalid_seller_key_version");
  }
  const manifestCid = assertBoundedUtf8String(input.manifestCid, "manifest_cid", MAX_MANIFEST_CID_BYTES);
  const cipherSuite = assertBoundedUtf8String(input.cipherSuite, "cipher_suite", MAX_MANIFEST_CIPHER_SUITE_BYTES);
  const recipients = normalizeManifestRecipientsForCanonicalization(input.recipients);
  const signingContext = normalizeManifestSigningContext(input.signingContext);
  const canonicalManifestJson = buildCanonicalMilestoneManifestJson({
    orderId,
    milestoneId,
    sellerAddress,
    manifestCid,
    cipherSuite,
    recipients,
    signingContext,
  });
  const manifestSha256 = await sha256Hex(canonicalManifestJson);
  return {
    canonicalManifestJson,
    manifestSha256,
    signingMessage: buildMilestoneManifestSigningMessage(canonicalManifestJson, signingContext),
    submissionProofHash: formatSha256HexPrefixed(manifestSha256),
    submissionRef: manifestCid,
    manifest: {
      manifestVersion: "v1",
      manifestCid,
      manifestSha256,
      sellerKeyVersion,
      cipherSuite,
      signingContext,
      recipients,
    },
  };
}

export function buildSignedMilestoneSubmitPayload(prepared, sellerSignature) {
  return {
    submissionProofHash: prepared.submissionProofHash,
    submissionRef: prepared.submissionRef,
    manifest: {
      ...prepared.manifest,
      sellerSignature: normalizeManifestSellerSignature(sellerSignature),
    },
  };
}

export function buildManagedDeliverablePayload({
  orderId,
  milestoneId,
  plaintextLabel,
  encrypted,
  generatedAt = new Date().toISOString(),
}) {
  return {
    protocol: "clawdex.managed-deliverable.v1",
    orderId: assertCanonicalProtocolString(orderId, "order_id", MAX_MANIFEST_ORDER_ID_BYTES),
    milestoneId: assertCanonicalProtocolString(milestoneId, "milestone_id", MAX_MANIFEST_MILESTONE_ID_BYTES),
    generatedAt,
    metadata: {
      plaintextLabel: normalizeString(plaintextLabel) || "deliverable",
    },
    encrypted: {
      blob: {
        nonceB64u: encrypted.blob.nonceB64u,
        ciphertextB64u: encrypted.blob.ciphertextB64u,
        plaintextByteLength: encrypted.blob.plaintextByteLength,
        ciphertextByteLength: encrypted.blob.ciphertextByteLength,
        ciphertextSha256: encrypted.blob.ciphertextSha256,
      },
      cekWraps: encrypted.cekWraps.map((entry) => ({
        recipientAddress: normalizeAddress(entry.recipientAddress),
        keyVersion: Number(entry.keyVersion),
        wrappedCek: entry.wrappedCek,
        hpkeEnc: entry.hpkeEnc,
      })),
    },
  };
}

export function normalizeManagedDeliverablePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid_deliverable_payload");
  }
  const encrypted = payload.encrypted;
  if (!encrypted || typeof encrypted !== "object" || Array.isArray(encrypted)) {
    throw new Error("invalid_deliverable_payload");
  }
  return buildManagedDeliverablePayload({
    orderId: payload.orderId,
    milestoneId: payload.milestoneId,
    plaintextLabel: payload.metadata?.plaintextLabel || "deliverable",
    encrypted: {
      blob: {
        nonceB64u: encrypted.blob?.nonceB64u,
        ciphertextB64u: encrypted.blob?.ciphertextB64u,
        plaintextByteLength: Number(encrypted.blob?.plaintextByteLength),
        ciphertextByteLength: Number(encrypted.blob?.ciphertextByteLength),
        ciphertextSha256: encrypted.blob?.ciphertextSha256,
      },
      cekWraps: Array.isArray(encrypted.cekWraps) ? encrypted.cekWraps : [],
    },
    generatedAt: typeof payload.generatedAt === "string" ? payload.generatedAt : new Date().toISOString(),
  });
}

export async function writeManagedDeliverablePayload(filePath, payload) {
  return await writeJsonFile(filePath, normalizeManagedDeliverablePayload(payload));
}

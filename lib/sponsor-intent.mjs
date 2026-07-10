import { createHash } from "node:crypto";
import { TransactionDataBuilder as IotaTransactionDataBuilder } from "@iota/iota-sdk/transactions";
import { TransactionDataBuilder as SuiTransactionDataBuilder } from "@mysten/sui/transactions";

export const SPONSOR_EXECUTION_INTENT_VERSION = "sponsor_execute_intent.v2";
export const SPONSOR_EXECUTION_INTENT_PREFIX = "CLAWDEX Sponsor Execute Intent v2";

const SPONSOR_TX_FAMILIES = new Set([
  "marketplace_write",
  "mailbox_signal",
  "milestone_submit",
  "review_post",
  "deadline_extension",
  "dispute_bond",
  "dispute_vote",
  "dispute_resolution",
  "claw_payment",
]);
const SPONSOR_PURPOSES = new Set(["claw_payment", "bond", "marketplace_tx"]);
const INTENT_KEYS = [
  "version",
  "chainFamily",
  "network",
  "txFamily",
  "orderId",
  "reservationId",
  "txDigest",
  "chainTxDigest",
  "expiresAt",
  "purpose",
];
const MAX_TRANSACTION_BYTES = 1_000_000;

function normalizeToken(value, fieldName, maxLength) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    !normalized ||
    normalized.length > maxLength ||
    !/^[a-z0-9][a-z0-9:_./-]*$/.test(normalized)
  ) {
    throw new Error(`invalid_sponsor_intent_${fieldName}`);
  }
  return normalized;
}

function normalizeBoundedValue(value, fieldName, maxLength) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength || /[\0\r\n|]/.test(normalized)) {
    throw new Error(`invalid_sponsor_intent_${fieldName}`);
  }
  return normalized;
}

function decodeCanonicalBase64(value, fieldName, maxBytes) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > Math.ceil(maxBytes / 3) * 4) {
    throw new Error(`invalid_${fieldName}`);
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0 || bytes.length > maxBytes || bytes.toString("base64") !== normalized) {
    throw new Error(`invalid_${fieldName}`);
  }
  return bytes;
}

export function assertCanonicalSponsorSignature(value, fieldName = "sponsor_intent_signature") {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length > 8_192) {
    throw new Error(`invalid_${fieldName}`);
  }
  decodeCanonicalBase64(normalized, fieldName, 8_192);
  return normalized;
}

export function buildSponsorExecutionIntentSigningMessage(intent) {
  return [
    SPONSOR_EXECUTION_INTENT_PREFIX,
    [
      `version=${intent.version}`,
      `chain_family=${intent.chainFamily}`,
      `network=${intent.network}`,
      `tx_family=${intent.txFamily}`,
      `order_id=${intent.orderId}`,
      `reservation_id=${intent.reservationId}`,
      `tx_digest=${intent.txDigest}`,
      `chain_tx_digest=${intent.chainTxDigest}`,
      `expires_at=${intent.expiresAt}`,
      `purpose=${intent.purpose}`,
    ].join("|"),
  ].join("\n");
}

export function prepareSponsorExecutionIntentV2(input) {
  const chainFamily = normalizeToken(input.chainFamily, "chain_family", 8);
  if (chainFamily !== "iota" && chainFamily !== "sui") {
    throw new Error("invalid_sponsor_intent_chain_family");
  }
  const network = normalizeToken(input.network, "network", 64);
  const txFamily = normalizeToken(input.txFamily, "tx_family", 64);
  if (!SPONSOR_TX_FAMILIES.has(txFamily)) {
    throw new Error("invalid_sponsor_intent_tx_family");
  }
  const purpose = normalizeToken(input.purpose, "purpose", 64);
  if (!SPONSOR_PURPOSES.has(purpose)) {
    throw new Error("invalid_sponsor_intent_purpose");
  }
  const orderId = normalizeBoundedValue(input.orderId, "order_id", 200);
  const reservationId = normalizeBoundedValue(input.reservationId, "reservation_id", 256);
  const expiresAtInput = normalizeBoundedValue(input.expiresAt, "expires_at", 64);
  const expiresAtMs = Date.parse(expiresAtInput);
  if (!Number.isFinite(expiresAtMs) || new Date(expiresAtMs).toISOString() !== expiresAtInput) {
    throw new Error("invalid_sponsor_intent_expires_at");
  }

  const txBytes = decodeCanonicalBase64(input.txBytesB64, "sponsor_transaction_bytes_base64", MAX_TRANSACTION_BYTES);
  const txDigest = createHash("sha256").update(txBytes).digest("hex");
  const chainTxDigest =
    chainFamily === "iota"
      ? IotaTransactionDataBuilder.getDigestFromBytes(txBytes)
      : SuiTransactionDataBuilder.getDigestFromBytes(txBytes);
  const intent = {
    version: SPONSOR_EXECUTION_INTENT_VERSION,
    chainFamily,
    network,
    txFamily,
    orderId,
    reservationId,
    txDigest,
    chainTxDigest,
    expiresAt: expiresAtInput,
    purpose,
  };
  return {
    intent,
    signingMessage: buildSponsorExecutionIntentSigningMessage(intent),
  };
}

export function assertSponsorExecutionIntentMatches(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    throw new Error("builder_sponsor_intent_v2_required");
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = [...INTENT_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((entry, index) => entry !== expectedKeys[index])
  ) {
    throw new Error("builder_sponsor_intent_field_set_mismatch");
  }
  for (const field of INTENT_KEYS) {
    if (actual[field] !== expected[field]) {
      throw new Error(`builder_sponsor_intent_mismatch:${field}`);
    }
  }
  return expected;
}

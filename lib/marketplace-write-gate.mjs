import { randomBytes } from "node:crypto";

import { normalizeIotaAddress } from "./iota-local.mjs";
import { normalizeAuthenticatedBaseUrl } from "./local-security.mjs";
import {
  MARKETPLACE_OBJECT_ID_FIELDS,
  MARKETPLACE_PACKAGE_ALIASES,
} from "./marketplace-runtime-topology.mjs";

export const MARKETPLACE_WRITE_GATE_VERSION = "marketplace_write_gate.v1";
export const MARKETPLACE_WRITE_GATE_TTL_MS = 5_000;
export const MARKETPLACE_WRITE_GATE_CLOCK_SKEW_MS = 2_000;
export const CANONICAL_MAINNET_API_ORIGIN = "https://api.clawnera.com";

const CHAIN_IDENTIFIERS = Object.freeze({
  mainnet: "6364aad5",
  testnet: "2304aa97",
});
const ALLOWED_CF_CACHE_STATUSES = new Set(["", "BYPASS", "DYNAMIC", "MISS"]);

function asRecord(value, errorCode) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(errorCode);
  }
  return value;
}

function headerValue(headers, name) {
  if (headers instanceof Headers) {
    return headers.get(name) || "";
  }
  const record = headers && typeof headers === "object" ? headers : {};
  return String(record[name] ?? record[name.toLowerCase()] ?? "").trim();
}

function canonicalObjectId(value, errorCode) {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = normalizeIotaAddress(raw);
  if (!normalized || raw !== normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function canonicalOptionalObjectId(value, errorCode) {
  return value === null ? null : canonicalObjectId(value, errorCode);
}

export function normalizeMarketplaceApiOrigin(value) {
  const origin = normalizeAuthenticatedBaseUrl(value, {
    errorCode: "marketplace_write_gate_api_origin_invalid",
  });
  if (!origin) {
    throw new Error("marketplace_write_gate_api_origin_invalid");
  }
  return origin;
}

export function createMarketplaceWriteGateNonce() {
  return randomBytes(16).toString("hex");
}

export function assertMarketplaceWriteGateFresh(attestation, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs)) {
    throw new Error("marketplace_write_gate_clock_invalid");
  }
  if (
    nowMs < attestation.generatedAtMs - MARKETPLACE_WRITE_GATE_CLOCK_SKEW_MS ||
    nowMs >= attestation.expiresAtMs
  ) {
    throw new Error("marketplace_write_gate_expired");
  }
  return attestation;
}

export function validateMarketplaceWriteGateAttestation({
  body,
  headers,
  apiBase,
  nonce,
  expectedNetwork = "",
  nowMs = Date.now(),
}) {
  const apiOrigin = normalizeMarketplaceApiOrigin(apiBase);
  if (!/^[0-9a-f]{32}$/.test(nonce)) {
    throw new Error("marketplace_write_gate_nonce_invalid");
  }
  const cacheControl = headerValue(headers, "cache-control").toLowerCase();
  if (!cacheControl.split(",").map((entry) => entry.trim()).includes("no-store")) {
    throw new Error("marketplace_write_gate_cache_policy_invalid");
  }
  if (headerValue(headers, "pragma").toLowerCase() !== "no-cache") {
    throw new Error("marketplace_write_gate_cache_policy_invalid");
  }
  const age = headerValue(headers, "age");
  if (age && (!/^[0-9]+$/.test(age) || Number.parseInt(age, 10) !== 0)) {
    throw new Error("marketplace_write_gate_cached_response_rejected");
  }
  const cfCacheStatus = headerValue(headers, "cf-cache-status").toUpperCase();
  if (!ALLOWED_CF_CACHE_STATUSES.has(cfCacheStatus)) {
    throw new Error("marketplace_write_gate_cached_response_rejected");
  }

  const attestation = asRecord(body, "marketplace_write_gate_payload_invalid");
  if (attestation.version !== MARKETPLACE_WRITE_GATE_VERSION || attestation.nonce !== nonce) {
    throw new Error("marketplace_write_gate_identity_mismatch");
  }
  const attestedApiOrigin = normalizeMarketplaceApiOrigin(attestation.apiOrigin);
  if (attestation.apiOrigin !== attestedApiOrigin) {
    throw new Error("marketplace_write_gate_api_origin_invalid");
  }
  if (attestedApiOrigin !== apiOrigin) {
    throw new Error("marketplace_write_gate_api_origin_mismatch");
  }
  if (
    !Number.isSafeInteger(attestation.generatedAtMs) ||
    !Number.isSafeInteger(attestation.expiresAtMs) ||
    attestation.expiresAtMs - attestation.generatedAtMs !== MARKETPLACE_WRITE_GATE_TTL_MS ||
    typeof attestation.generatedAt !== "string" ||
    Date.parse(attestation.generatedAt) !== attestation.generatedAtMs ||
    new Date(attestation.generatedAtMs).toISOString() !== attestation.generatedAt
  ) {
    throw new Error("marketplace_write_gate_time_binding_invalid");
  }

  const gate = asRecord(attestation.gate, "marketplace_write_gate_payload_invalid");
  if (
    gate.source !== "runtime_db" ||
    gate.preset !== "normal" ||
    gate.publicApiWrites !== "live" ||
    gate.marketplaceWrites !== "live" ||
    gate.releaseProfile !== "controlled_v1" ||
    gate.releasePhase !== "canary_allowlisted" ||
    gate.runtimeReady !== true ||
    gate.productiveWritesEnabled !== true
  ) {
    throw new Error("marketplace_write_gate_closed");
  }

  const chain = asRecord(attestation.chain, "marketplace_write_gate_payload_invalid");
  if (chain.family !== "iota" || !Object.hasOwn(CHAIN_IDENTIFIERS, chain.network)) {
    throw new Error("marketplace_write_gate_chain_invalid");
  }
  if (chain.chainIdentifier !== CHAIN_IDENTIFIERS[chain.network]) {
    throw new Error("marketplace_write_gate_chain_identifier_invalid");
  }
  if (expectedNetwork && expectedNetwork !== chain.network) {
    throw new Error("marketplace_write_gate_network_mismatch");
  }
  if (chain.network === "mainnet" && apiOrigin !== CANONICAL_MAINNET_API_ORIGIN) {
    throw new Error("marketplace_write_gate_mainnet_origin_untrusted");
  }

  const rawPackageIds = asRecord(chain.packageIds, "marketplace_write_gate_package_ids_invalid");
  const packageIds = Object.fromEntries(
    MARKETPLACE_PACKAGE_ALIASES.map((alias) => [
      alias,
      canonicalObjectId(rawPackageIds[alias], `marketplace_write_gate_${alias}_package_id_invalid`),
    ]),
  );
  if (new Set(Object.values(packageIds)).size !== MARKETPLACE_PACKAGE_ALIASES.length) {
    throw new Error("marketplace_write_gate_package_dag_not_split");
  }

  const rawObjectIds = asRecord(chain.objectIds, "marketplace_write_gate_object_ids_invalid");
  const objectIds = Object.fromEntries(
    MARKETPLACE_OBJECT_ID_FIELDS.map((field) => [
      field,
      canonicalOptionalObjectId(rawObjectIds[field], `marketplace_write_gate_${field}_invalid`),
    ]),
  );
  if (!objectIds.orderMailboxRegistryObjectId) {
    throw new Error("marketplace_write_gate_order_mailbox_registry_missing");
  }

  const validated = {
    version: MARKETPLACE_WRITE_GATE_VERSION,
    nonce,
    generatedAt: attestation.generatedAt,
    generatedAtMs: attestation.generatedAtMs,
    expiresAtMs: attestation.expiresAtMs,
    apiOrigin,
    gate: { ...gate },
    chain: {
      family: "iota",
      network: chain.network,
      chainIdentifier: chain.chainIdentifier,
      packageIds,
      objectIds,
    },
  };
  return assertMarketplaceWriteGateFresh(validated, nowMs);
}

export function assertMarketplaceDirectIntentBinding({
  attestation,
  packageAlias,
  packageId,
  packageIds = {},
  objectIds = {},
}) {
  if (!MARKETPLACE_PACKAGE_ALIASES.includes(packageAlias)) {
    throw new Error("marketplace_write_gate_package_alias_invalid");
  }
  const boundPackageId = canonicalObjectId(packageId, "marketplace_write_gate_local_package_id_invalid");
  if (boundPackageId !== attestation.chain.packageIds[packageAlias]) {
    throw new Error("marketplace_write_gate_package_mismatch");
  }
  for (const alias of MARKETPLACE_PACKAGE_ALIASES) {
    const policyPackageId = canonicalObjectId(
      packageIds[alias],
      `marketplace_write_gate_policy_${alias}_package_id_invalid`,
    );
    if (policyPackageId !== attestation.chain.packageIds[alias]) {
      throw new Error("marketplace_write_gate_package_dag_mismatch");
    }
  }
  for (const [field, value] of Object.entries(objectIds)) {
    if (!MARKETPLACE_OBJECT_ID_FIELDS.includes(field)) {
      throw new Error("marketplace_write_gate_object_binding_field_invalid");
    }
    const localObjectId = canonicalObjectId(value, `marketplace_write_gate_local_${field}_invalid`);
    if (localObjectId !== attestation.chain.objectIds[field]) {
      throw new Error("marketplace_write_gate_object_mismatch");
    }
  }
  return { packageId: boundPackageId, objectIds: { ...objectIds } };
}

export function assertMarketplacePackageObjectResponse(body, expectedPackageId) {
  const payload = asRecord(body, "marketplace_write_gate_package_rpc_invalid");
  if (payload.error) {
    throw new Error("marketplace_write_gate_package_rpc_error");
  }
  const result = asRecord(payload.result, "marketplace_write_gate_package_rpc_invalid");
  const data = asRecord(result.data, "marketplace_write_gate_package_missing");
  if (
    canonicalObjectId(data.objectId, "marketplace_write_gate_package_object_id_invalid") !== expectedPackageId ||
    asRecord(data.bcs, "marketplace_write_gate_package_bcs_missing").dataType !== "package"
  ) {
    throw new Error("marketplace_write_gate_package_object_invalid");
  }
  return data;
}

export function expectedIotaChainIdentifier(network) {
  return CHAIN_IDENTIFIERS[network] || "";
}

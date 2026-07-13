import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMarketplaceDirectIntentBinding,
  assertMarketplacePackageObjectResponse,
  assertMarketplaceWriteGateFresh,
  validateMarketplaceWriteGateAttestation,
} from "../lib/marketplace-write-gate.mjs";

const id = (byte) => `0x${byte.repeat(64)}`;
const NOW_MS = Date.parse("2026-07-13T12:00:00.000Z");

function attestation(overrides = {}) {
  return {
    version: "marketplace_write_gate.v1",
    nonce: "ab".repeat(16),
    generatedAt: new Date(NOW_MS).toISOString(),
    generatedAtMs: NOW_MS,
    expiresAtMs: NOW_MS + 5_000,
    apiOrigin: "http://127.0.0.1:8787",
    gate: {
      source: "runtime_db",
      preset: "normal",
      publicApiWrites: "live",
      marketplaceWrites: "live",
      releaseProfile: "controlled_v1",
      releasePhase: "canary_allowlisted",
      runtimeReady: true,
      productiveWritesEnabled: true,
    },
    chain: {
      family: "iota",
      network: "testnet",
      chainIdentifier: "2304aa97",
      packageIds: {
        foundation: id("1"),
        settlement: id("2"),
        fulfillment: id("3"),
        ops: id("4"),
      },
      objectIds: {
        governanceConfigObjectId: id("5"),
        disputeQuorumConfigObjectId: id("6"),
        marketplaceFeeConfigObjectId: id("7"),
        reputationInitFeeConfigObjectId: id("8"),
        listingDepositConfigObjectId: id("9"),
        reviewerRegistryObjectId: id("a"),
      },
    },
    ...overrides,
  };
}

const headers = {
  "cache-control": "private, no-store, max-age=0, must-revalidate",
  pragma: "no-cache",
};

test("validates a fresh nonce-bound split-package testnet attestation", () => {
  const value = validateMarketplaceWriteGateAttestation({
    body: attestation(),
    headers,
    apiBase: "http://127.0.0.1:8787",
    nonce: "ab".repeat(16),
    expectedNetwork: "testnet",
    nowMs: NOW_MS + 1_000,
  });

  assert.equal(value.chain.packageIds.settlement, id("2"));
  assert.equal(value.chain.objectIds.governanceConfigObjectId, id("5"));
});

test("rejects cached, incoherent, closed, and non-split attestations", () => {
  const validate = (body, responseHeaders = headers) =>
    validateMarketplaceWriteGateAttestation({
      body,
      headers: responseHeaders,
      apiBase: "http://127.0.0.1:8787",
      nonce: "ab".repeat(16),
      nowMs: NOW_MS + 1_000,
    });

  assert.throws(() => validate(attestation(), { ...headers, age: "1" }), /cached_response_rejected/);
  assert.throws(
    () => validate(attestation(), { ...headers, "cf-cache-status": "HIT" }),
    /cached_response_rejected/,
  );
  assert.throws(
    () => validate(attestation({ generatedAt: "2026-07-13T12:00:00.001Z" })),
    /time_binding_invalid/,
  );
  assert.throws(
    () => validate(attestation({ gate: { ...attestation().gate, marketplaceWrites: "blocked" } })),
    /write_gate_closed/,
  );
  const duplicate = attestation();
  duplicate.chain.packageIds.ops = duplicate.chain.packageIds.settlement;
  assert.throws(() => validate(duplicate), /package_dag_not_split/);
});

test("pins mainnet attestations to the canonical CLAWNERA API origin", () => {
  const body = attestation({
    apiOrigin: "https://untrusted.example",
    chain: {
      ...attestation().chain,
      network: "mainnet",
      chainIdentifier: "6364aad5",
    },
  });
  assert.throws(
    () => validateMarketplaceWriteGateAttestation({
      body,
      headers,
      apiBase: "https://untrusted.example",
      nonce: body.nonce,
      nowMs: NOW_MS + 1_000,
    }),
    /mainnet_origin_untrusted/,
  );
});

test("rejects empty and malformed API bases with the fail-closed origin code", () => {
  for (const apiBase of ["", "   ", "not a URL", "http://api.clawnera.com", "https://api.clawnera.com/path"]) {
    assert.throws(
      () => validateMarketplaceWriteGateAttestation({
        body: attestation({ apiOrigin: apiBase }),
        headers,
        apiBase,
        nonce: "ab".repeat(16),
        nowMs: NOW_MS + 1_000,
      }),
      (error) => error?.message === "marketplace_write_gate_api_origin_invalid",
    );
  }
});

test("rejects empty, malformed, and non-canonical attested API origins", () => {
  for (const apiOrigin of [
    "",
    "   ",
    "not a URL",
    "http://api.clawnera.com",
    "https://api.clawnera.com/path",
    "http://127.0.0.1:8787/",
  ]) {
    assert.throws(
      () => validateMarketplaceWriteGateAttestation({
        body: attestation({ apiOrigin }),
        headers,
        apiBase: "http://127.0.0.1:8787",
        nonce: "ab".repeat(16),
        nowMs: NOW_MS + 1_000,
      }),
      (error) => error?.message === "marketplace_write_gate_api_origin_invalid",
    );
  }
});

test("rejects a valid attested API origin that does not exactly match the request base", () => {
  assert.throws(
    () => validateMarketplaceWriteGateAttestation({
      body: attestation({ apiOrigin: "http://127.0.0.1:8788" }),
      headers,
      apiBase: "http://127.0.0.1:8787",
      nonce: "ab".repeat(16),
      nowMs: NOW_MS + 1_000,
    }),
    (error) => error?.message === "marketplace_write_gate_api_origin_mismatch",
  );
});

test("binds the full policy DAG, action package, and used config pointers", () => {
  const value = validateMarketplaceWriteGateAttestation({
    body: attestation(),
    headers,
    apiBase: "http://127.0.0.1:8787",
    nonce: "ab".repeat(16),
    nowMs: NOW_MS + 1_000,
  });
  const packageIds = { ...value.chain.packageIds };
  assert.doesNotThrow(() => assertMarketplaceDirectIntentBinding({
    attestation: value,
    packageAlias: "ops",
    packageId: packageIds.ops,
    packageIds,
    objectIds: {
      governanceConfigObjectId: id("5"),
      listingDepositConfigObjectId: id("9"),
    },
  }));

  assert.throws(() => assertMarketplaceDirectIntentBinding({
    attestation: value,
    packageAlias: "ops",
    packageId: packageIds.ops,
    packageIds: { ...packageIds, fulfillment: id("f") },
    objectIds: { governanceConfigObjectId: id("5") },
  }), /package_dag_mismatch/);
  assert.throws(() => assertMarketplaceDirectIntentBinding({
    attestation: value,
    packageAlias: "ops",
    packageId: packageIds.ops,
    packageIds,
    objectIds: { governanceConfigObjectId: id("f") },
  }), /object_mismatch/);
});

test("accepts only an RPC object whose BCS payload is the expected package", () => {
  assert.doesNotThrow(() => assertMarketplacePackageObjectResponse({
    jsonrpc: "2.0",
    result: { data: { objectId: id("2"), bcs: { dataType: "package" } } },
  }, id("2")));
  assert.throws(() => assertMarketplacePackageObjectResponse({
    jsonrpc: "2.0",
    result: { data: { objectId: id("2"), bcs: { dataType: "moveObject" } } },
  }, id("2")), /package_object_invalid/);
});

test("fails the final freshness check at expiry", () => {
  const value = validateMarketplaceWriteGateAttestation({
    body: attestation(),
    headers,
    apiBase: "http://127.0.0.1:8787",
    nonce: "ab".repeat(16),
    nowMs: NOW_MS + 1_000,
  });
  assert.throws(() => assertMarketplaceWriteGateFresh(value, NOW_MS + 5_000), /write_gate_expired/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { executeTransaction } from "../lib/clawdex-onchain.mjs";
import { createMarketplaceDirectReattestation } from "../lib/marketplace-direct-reattest.mjs";

const NOW_MS = Date.parse("2026-07-13T12:00:00.000Z");
const API_BASE = "http://127.0.0.1:8787";
const RPC_URL = "https://iota-rpc.example.test";
const SIGNER_ADDRESS = `0x${"a".repeat(64)}`;
const id = (byte) => `0x${byte.repeat(64)}`;

function marketplaceChain() {
  return {
    family: "iota",
    network: "testnet",
    chainIdentifier: "2304aa97",
    packageIds: {
      foundation: id("1"),
      governance: id("b"),
      settlement: id("2"),
      fulfillment: id("3"),
      ops: id("4"),
    },
    objectIds: {
      governanceConfigObjectId: id("5"),
      orderMailboxRegistryObjectId: id("c"),
      disputeQuorumConfigObjectId: id("6"),
      marketplaceFeeConfigObjectId: id("7"),
      reputationInitFeeConfigObjectId: id("8"),
      listingDepositConfigObjectId: id("9"),
      reviewerRegistryObjectId: id("b"),
    },
  };
}

function directGate({ nonce = "11".repeat(16), expiresAtMs = NOW_MS + 5_000 } = {}) {
  return {
    ok: true,
    apiBase: API_BASE,
    attestation: {
      version: "marketplace_write_gate.v1",
      nonce,
      generatedAt: new Date(NOW_MS).toISOString(),
      generatedAtMs: NOW_MS,
      expiresAtMs,
      apiOrigin: API_BASE,
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
      chain: marketplaceChain(),
    },
    iotaRuntime: {
      network: "testnet",
      rpcUrl: RPC_URL,
    },
  };
}

function marketplaceInput() {
  const chain = marketplaceChain();
  return {
    options: {
      "api-base": API_BASE,
      "timeout-ms": "8000",
      network: "testnet",
    },
    runtimeContext: {
      apiBase: API_BASE,
      envValues: { CLAWNERA_IOTA_NETWORK: "testnet" },
    },
    iotaRuntime: { network: "testnet", rpcUrl: RPC_URL },
    packageAlias: "settlement",
    packageId: chain.packageIds.settlement,
    packageIds: chain.packageIds,
    objectIds: {
      governanceConfigObjectId: chain.objectIds.governanceConfigObjectId,
      orderMailboxRegistryObjectId: chain.objectIds.orderMailboxRegistryObjectId,
      disputeQuorumConfigObjectId: chain.objectIds.disputeQuorumConfigObjectId,
    },
    reviewerPlan: null,
  };
}

function startMarketplaceExecution({ initialGate, reattestedGate, nowMs = NOW_MS + 1_000 }) {
  const events = [];
  const state = {
    broadcastCount: 0,
    verifyCount: 0,
    verifyInput: null,
  };
  const input = marketplaceInput();
  const beforeBroadcast = createMarketplaceDirectReattestation({
    initialGate,
    input,
    now: () => nowMs,
    verifyGate: async (candidate) => {
      events.push("reattest");
      state.verifyCount += 1;
      state.verifyInput = candidate;
      return reattestedGate;
    },
  });

  const execution = executeTransaction(
    {
      async build() {
        events.push("build");
        return new Uint8Array([1, 2, 3, 4]);
      },
    },
    {
      address: SIGNER_ADDRESS,
      network: "testnet",
      rpcUrl: RPC_URL,
      beforeBroadcast,
    },
    {
      clientFactory: () => ({
        async executeTransactionBlock() {
          events.push("broadcast");
          state.broadcastCount += 1;
          return {
            digest: "0xsuccess",
            effects: { status: { status: "success" } },
          };
        },
      }),
      loadKeystoreEntries: async () => [
        { address: SIGNER_ADDRESS, alias: "seller", secretKey: "iotaprivkey1fake" },
      ],
      signerFromSecretKey: async () => ({
        async signTransaction() {
          events.push("sign");
          return { signature: "SIGNED" };
        },
      }),
      verifyTransactionSignature: async () => {
        events.push("verify_signature");
        return { toIotaAddress: () => SIGNER_ADDRESS };
      },
    },
  );

  return { events, execution, input, state };
}

test("post-signature Marketplace re-attestation uses a distinct nonce and pinned targets", async () => {
  const initialGate = directGate();
  const reattestedGate = directGate({ nonce: "22".repeat(16) });
  const run = startMarketplaceExecution({ initialGate, reattestedGate });
  const result = await run.execution;

  assert.notEqual(reattestedGate.attestation.nonce, initialGate.attestation.nonce);
  assert.equal(run.state.verifyCount, 1);
  assert.equal(run.state.broadcastCount, 1);
  assert.equal(run.state.verifyInput.options["api-base"], API_BASE);
  assert.equal(run.state.verifyInput.runtimeContext.apiBase, API_BASE);
  assert.deepEqual(run.state.verifyInput.iotaRuntime, initialGate.iotaRuntime);
  assert.equal(run.state.verifyInput.packageId, initialGate.attestation.chain.packageIds.settlement);
  assert.deepEqual(run.events, ["build", "sign", "verify_signature", "reattest", "broadcast"]);
  assert.equal(result.result.digest, "0xsuccess");
});

test("post-signature Marketplace re-attestation blocks every continuity mismatch before broadcast", async (t) => {
  const cases = [
    {
      name: "reused nonce",
      error: /marketplace_write_gate_reattest_nonce_reused/,
      mutate: (gate) => {
        gate.attestation.nonce = "11".repeat(16);
      },
    },
    {
      name: "API base drift",
      error: /marketplace_write_gate_reattest_api_target_drift/,
      mutate: (gate) => {
        gate.apiBase = "http://127.0.0.1:9787";
      },
    },
    {
      name: "API attestation origin drift",
      error: /marketplace_write_gate_reattest_api_target_drift/,
      mutate: (gate) => {
        gate.attestation.apiOrigin = "http://127.0.0.1:9787";
      },
    },
    {
      name: "RPC URL drift",
      error: /marketplace_write_gate_reattest_rpc_target_drift/,
      mutate: (gate) => {
        gate.iotaRuntime.rpcUrl = "https://other-rpc.example.test";
      },
    },
    {
      name: "RPC network drift",
      error: /marketplace_write_gate_reattest_rpc_target_drift/,
      mutate: (gate) => {
        gate.iotaRuntime.network = "mainnet";
      },
    },
    {
      name: "chain binding drift",
      error: /marketplace_write_gate_reattest_chain_binding_drift/,
      mutate: (gate) => {
        gate.attestation.chain.chainIdentifier = "6364aad5";
      },
    },
    {
      name: "package DAG drift",
      error: /marketplace_write_gate_reattest_chain_binding_drift/,
      mutate: (gate) => {
        gate.attestation.chain.packageIds.fulfillment = id("f");
      },
    },
    {
      name: "object pointer drift",
      error: /marketplace_write_gate_reattest_chain_binding_drift/,
      mutate: (gate) => {
        gate.attestation.chain.objectIds.governanceConfigObjectId = id("f");
      },
    },
    {
      name: "expired second attestation",
      error: /marketplace_write_gate_expired/,
      mutate: (gate) => {
        gate.attestation.expiresAtMs = NOW_MS + 1_000;
      },
    },
  ];

  for (const mismatch of cases) {
    await t.test(mismatch.name, async () => {
      const initialGate = directGate();
      const reattestedGate = directGate({ nonce: "22".repeat(16) });
      mismatch.mutate(reattestedGate);
      const run = startMarketplaceExecution({ initialGate, reattestedGate });

      await assert.rejects(run.execution, mismatch.error);
      assert.equal(run.state.verifyCount, 1);
      assert.equal(run.state.broadcastCount, 0);
      assert.deepEqual(run.events, ["build", "sign", "verify_signature", "reattest"]);
    });
  }
});

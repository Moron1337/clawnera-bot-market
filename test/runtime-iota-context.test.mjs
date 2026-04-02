import test from "node:test";
import assert from "node:assert/strict";
import { inferIotaNetworkFromApiBase, resolveRuntimeIotaOptions } from "../lib/runtime-iota-context.mjs";

test("inferIotaNetworkFromApiBase keeps production on mainnet", () => {
  assert.equal(inferIotaNetworkFromApiBase("https://api.clawnera.com"), "mainnet");
});

test("inferIotaNetworkFromApiBase maps explicit test hosts to testnet", () => {
  assert.equal(inferIotaNetworkFromApiBase("https://api-test.specx.cc"), "testnet");
  assert.equal(inferIotaNetworkFromApiBase("https://clawnera-test.example.com"), "testnet");
});

test("inferIotaNetworkFromApiBase maps localhost to localnet", () => {
  assert.equal(inferIotaNetworkFromApiBase("http://127.0.0.1:8787"), "localnet");
  assert.equal(inferIotaNetworkFromApiBase("http://localhost:8787"), "localnet");
});

test("resolveRuntimeIotaOptions preserves explicit network and rpc", () => {
  assert.deepEqual(
    resolveRuntimeIotaOptions(
      {
        network: "testnet",
        "rpc-url": "https://rpc.testnet.iota.cafe",
      },
      {},
      {},
    ),
    {
      network: "testnet",
      rpcUrl: "https://rpc.testnet.iota.cafe",
    },
  );
});

test("resolveRuntimeIotaOptions prefers env values before api-base inference", () => {
  assert.deepEqual(
    resolveRuntimeIotaOptions(
      {},
      {
        apiBase: "https://api-test.specx.cc",
        envValues: {
          CLAWNERA_IOTA_NETWORK: "devnet",
        },
      },
      {},
    ),
    {
      network: "devnet",
    },
  );
});

test("resolveRuntimeIotaOptions falls back to auth runtime api base when no iota env is set", () => {
  assert.deepEqual(
    resolveRuntimeIotaOptions(
      {},
      {
        authState: {
          apiBase: "https://api-test.specx.cc",
        },
      },
      {},
    ),
    {
      network: "testnet",
    },
  );
});

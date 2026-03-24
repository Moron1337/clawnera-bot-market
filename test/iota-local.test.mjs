import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_IOTA_NETWORK,
  IOTA_FAUCET_URL_ENV_NAMES,
  IOTA_NETWORK_ENV_NAMES,
  IOTA_RPC_URL_ENV_NAMES,
  IOTA_COIN_TYPE,
  executeIotaTransfer,
  getIotaActiveEnv,
  getIotaGas,
  prepareIotaTransfer,
  requestIotaFaucet,
  resolveIotaFaucetUrl,
  resolveIotaRpcUrl,
} from "../lib/iota-local.mjs";
import {
  DEFAULT_TRANSFER_DRAFT_TTL_SEC,
  defaultIotaTransferDraftsPath,
  deleteIotaTransferDraft,
  loadIotaTransferDraft,
  saveIotaTransferDraft,
} from "../lib/iota-transfer-drafts.mjs";

const A = `0x${"a".repeat(64)}`;
const B = `0x${"b".repeat(64)}`;
const C = `0x${"c".repeat(64)}`;
const D = `0x${"d".repeat(64)}`;

test("getIotaActiveEnv defaults to mainnet local runtime", async () => {
  const result = await getIotaActiveEnv();
  assert.equal(result.activeEnv, DEFAULT_IOTA_NETWORK);
  assert.match(result.rpcUrl, /^https?:\/\//);
  assert.match(result.keystorePath, /\.iota\/iota_config\/iota\.keystore$/);
});

test("resolveIotaRpcUrl honors CLAWNERA_IOTA_NETWORK before the mainnet fallback", () => {
  const result = resolveIotaRpcUrl(
    {},
    {
      env: {
        [IOTA_NETWORK_ENV_NAMES[0]]: "testnet",
      },
    },
  );

  assert.equal(result.network, "testnet");
  assert.match(result.rpcUrl, /testnet/i);
});

test("resolveIotaRpcUrl lets explicit options override env defaults", () => {
  const result = resolveIotaRpcUrl(
    {
      network: "mainnet",
      rpcUrl: "https://custom.rpc.example",
    },
    {
      env: {
        [IOTA_NETWORK_ENV_NAMES[0]]: "testnet",
        [IOTA_RPC_URL_ENV_NAMES[0]]: "https://testnet.rpc.example",
      },
    },
  );

  assert.equal(result.network, "mainnet");
  assert.equal(result.rpcUrl, "https://custom.rpc.example/");
});

test("resolveIotaFaucetUrl honors CLAWNERA_IOTA_FAUCET_URL before network defaults", () => {
  const result = resolveIotaFaucetUrl(
    {},
    {
      env: {
        [IOTA_NETWORK_ENV_NAMES[0]]: "testnet",
        [IOTA_FAUCET_URL_ENV_NAMES[0]]: "https://faucet.example/v1/gas",
      },
    },
  );

  assert.equal(result.network, "testnet");
  assert.equal(result.faucetUrl, "https://faucet.example/v1/gas");
});

test("requestIotaFaucet accepts an explicit recipient address without keystore lookup", async () => {
  const calls = [];
  const result = await requestIotaFaucet(
    {
      address: B,
      network: "testnet",
    },
    {
      requestIotaFromFaucetV0: async (input) => {
        calls.push(input);
        return { transferredGasObjects: [{ id: C, amount: 10_000_000_000, transferTxDigest: "0xdeadbeef" }] };
      },
    },
  );

  assert.equal(result.recipient, B);
  assert.equal(result.network, "testnet");
  assert.match(result.faucetUrl, /testnet/i);
  assert.deepEqual(calls, [
    {
      host: result.faucetUrl,
      recipient: B,
    },
  ]);
  assert.equal(result.faucet.transferredGasObjects[0].id, C);
});

test("defaultIotaTransferDraftsPath resolves under ~/.config/clawnera", () => {
  assert.equal(
    defaultIotaTransferDraftsPath("/tmp/example-home"),
    "/tmp/example-home/.config/clawnera/iota-transfer-drafts.json",
  );
});

test("prepareIotaTransfer builds tx bytes locally from a selected keystore entry", async () => {
  const txState = {};
  const fakeTx = {
    gas: "GAS",
    setSender(value) {
      txState.sender = value;
    },
    setGasBudget(value) {
      txState.gasBudget = value;
    },
    setGasPayment(value) {
      txState.gasPayment = value;
    },
    object(value) {
      return `obj:${value}`;
    },
    mergeCoins(target, coins) {
      txState.merge = { target, coins };
    },
    splitCoins(target, amounts) {
      txState.split = { target, amounts };
      return ["PAYMENT"];
    },
    transferObjects(objects, recipient) {
      txState.transfer = { objects, recipient };
    },
    async build() {
      return Buffer.from("signed-bytes");
    },
    getData() {
      return { built: true, sender: txState.sender, recipient: txState.transfer?.recipient };
    },
  };

  const fakeClient = {
    async getObject({ id }) {
      return {
        data: {
          objectId: id,
          version: "7",
          digest: `digest:${id}`,
        },
      };
    },
  };

  const result = await prepareIotaTransfer(
    {
      recipient: B,
      amountNanos: 123n,
      inputCoins: [C, D],
      gasBudget: 456789,
    },
    {
      loadKeystoreEntries: async () => [{ address: A, alias: "alpha", secretKey: "iotaprivkey1fake" }],
      clientFactory: () => fakeClient,
      transactionFactory: () => fakeTx,
    },
  );

  assert.equal(result.signerAddress, A);
  assert.equal(result.txBytesB64, Buffer.from("signed-bytes").toString("base64"));
  assert.deepEqual(txState.gasPayment, [
    {
      objectId: C,
      version: "7",
      digest: `digest:${C}`,
    },
  ]);
  assert.deepEqual(txState.merge, {
    target: "GAS",
    coins: [`obj:${D}`],
  });
  assert.equal(txState.transfer.recipient, B);
  assert.deepEqual(result.decodedTx, { built: true, sender: A, recipient: B });
});

test("getIotaGas returns the local IOTA gas objects for the selected signer", async () => {
  const fakeGasCoins = {
    data: [{ coinObjectId: C }, { coinObjectId: D }],
  };
  const result = await getIotaGas(
    {
      alias: "alpha",
      network: "mainnet",
    },
    {
      loadKeystoreEntries: async () => [{ address: A, alias: "alpha", secretKey: "iotaprivkey1fake" }],
      clientFactory: () => ({
        async getCoins() {
          return fakeGasCoins;
        },
      }),
    },
  );

  assert.equal(result.owner, A);
  assert.equal(result.coinType, IOTA_COIN_TYPE);
  assert.deepEqual(result.gasCoins, fakeGasCoins);
});

test("executeIotaTransfer accepts a precomputed signature and executes locally", async () => {
  const executions = [];
  const result = await executeIotaTransfer(
    {
      txBytesB64: Buffer.from("payload").toString("base64"),
      signature: "AQIDBA==",
      signerAddress: A,
    },
    {
      clientFactory: () => ({
        async executeTransactionBlock(input) {
          executions.push(input);
          return { digest: "0xdeadbeef" };
        },
      }),
      verifyTransactionSignature: async () => ({
        toIotaAddress() {
          return A;
        },
      }),
    },
  );

  assert.equal(result.signature, "AQIDBA==");
  assert.equal(result.verifyResult.signerAddress, A);
  assert.deepEqual(executions, [
    {
      transactionBlock: Buffer.from("payload"),
      signature: "AQIDBA==",
    },
  ]);
  assert.equal(result.result.digest, "0xdeadbeef");
});

test("executeIotaTransfer signs locally when no external signature is supplied", async () => {
  const result = await executeIotaTransfer(
    {
      txBytesB64: Buffer.from("payload").toString("base64"),
      address: A,
    },
    {
      loadKeystoreEntries: async () => [{ address: A, alias: "alpha", secretKey: "iotaprivkey1fake" }],
      signerFromSecretKey: async () => ({
        async signTransaction(input) {
          assert.deepEqual(input, Buffer.from("payload"));
          return { signature: "SIGNED" };
        },
      }),
      clientFactory: () => ({
        async executeTransactionBlock(input) {
          assert.equal(input.signature, "SIGNED");
          return { digest: "0xbeef" };
        },
      }),
      verifyTransactionSignature: async () => ({
        toIotaAddress() {
          return A;
        },
      }),
    },
  );

  assert.equal(result.signature, "SIGNED");
  assert.equal(result.verifyResult.signerAddress, A);
  assert.equal(result.result.digest, "0xbeef");
});

test("transfer drafts save, load, and delete cleanly", async () => {
  const draftsPath = defaultIotaTransferDraftsPath(path.join(os.tmpdir(), "clawnera-drafts-test"));
  const draft = {
    id: "draft-1",
    kind: "iota_transfer",
    createdAt: Date.now(),
    expiresAt: Date.now() + DEFAULT_TRANSFER_DRAFT_TTL_SEC * 1000,
    signerAddress: A,
    recipient: B,
    amountNanos: "100",
    inputCoins: [C],
    txBytesB64: "QUJD",
    network: "mainnet",
    rpcUrl: "https://rpc.example",
  };

  await saveIotaTransferDraft(draftsPath, draft);
  const loaded = await loadIotaTransferDraft(draftsPath, "draft-1");
  assert.equal(loaded.id, "draft-1");
  assert.equal(loaded.signerAddress, A);

  await deleteIotaTransferDraft(draftsPath, "draft-1");
  await assert.rejects(async () => loadIotaTransferDraft(draftsPath, "draft-1"), /transfer_draft_not_found/);
});

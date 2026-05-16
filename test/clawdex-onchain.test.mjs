import test from "node:test";
import assert from "node:assert/strict";
import { IotaClient } from "@iota/iota-sdk/client";

import {
  assertExecutionSuccess,
  buildClawdexTxFromPlan,
  buildCreateListingDepositTx,
  buildCreateOrderEscrowTx,
  buildCreateReputationProfileTx,
  buildManagedStorageFeeTx,
  dryRunTransaction,
  executeTransaction,
  extractLatestEventByTypeSuffix,
  resolveClawdexChainConfig,
  extractMailboxSignalAcked,
  extractMailboxSignalPosted,
  getExecutionFailure,
} from "../lib/clawdex-onchain.mjs";

function addr(char) {
  return `0x${char.repeat(64)}`;
}

function extractLastMoveCall(tx) {
  const data = tx.getData();
  const lastCommand = data.commands.at(-1);
  if (!lastCommand || !("MoveCall" in lastCommand) || !lastCommand.MoveCall) {
    throw new Error("missing_move_call");
  }
  return lastCommand.MoveCall;
}

function extractLastMoveCallFunction(tx) {
  return extractLastMoveCall(tx).function;
}

const SUI_NATIVE_COIN_TYPE = `0x${"0".repeat(63)}2::sui::SUI`;
const SUI_USDC_TESTNET_COIN_TYPE = "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

test("mailbox event extractors normalize posted and acked events from execution results", () => {
  const executionResult = {
    result: {
      events: [
        {
          id: { txDigest: "tx-posted-1", eventSeq: "0" },
          type: "0xabc::order_mailbox::SignalPosted",
          parsedJson: {
            mailbox_id: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            order_id: "order-1",
            seq: "7",
            signal_type: 1,
            sender: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            sender_role: 1,
            ciphertext_hash: "11".repeat(32),
            payload_ref: "ipfs://cid-1",
            created_at_ms: "1773960000000",
          },
        },
        {
          id: { txDigest: "tx-acked-1", eventSeq: "1" },
          type: "0xabc::order_mailbox::SignalAcked",
          parsedJson: {
            mailbox_id: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            order_id: "order-1",
            acker: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
            acker_role: "0",
            acked_seq: 7,
            acked_at_ms: "1773960000500",
          },
        },
      ],
    },
  };

  const latestPosted = extractLatestEventByTypeSuffix(executionResult, "::order_mailbox::SignalPosted");
  assert.equal(latestPosted?.id?.txDigest, "tx-posted-1");

  const posted = extractMailboxSignalPosted(executionResult);
  assert.deepEqual(posted, {
    mailboxObjectId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    orderId: "order-1",
    seq: "7",
    signalTypeCode: "1",
    signalIntent: "CHECKPOINT",
    sender: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    senderRoleCode: "1",
    senderRole: "seller",
    ciphertextHash: "11".repeat(32),
    payloadRef: "ipfs://cid-1",
    createdAtMs: "1773960000000",
    txDigest: "tx-posted-1",
  });

  const acked = extractMailboxSignalAcked(executionResult);
  assert.deepEqual(acked, {
    mailboxObjectId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    orderId: "order-1",
    ackedSeq: "7",
    acker: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    ackerRoleCode: "0",
    ackerRole: "buyer",
    ackedAtMs: "1773960000500",
    txDigest: "tx-acked-1",
  });
});

test("mailbox event extractors return null when the expected event is missing", () => {
  const executionResult = { result: { events: [] } };
  assert.equal(extractLatestEventByTypeSuffix(executionResult, "::order_mailbox::SignalPosted"), null);
  assert.equal(extractMailboxSignalPosted(executionResult), null);
  assert.equal(extractMailboxSignalAcked(executionResult), null);
});

test("buildClawdexTxFromPlan dispatches canonical binding-based order-escrow settlement", () => {
  const tx = buildClawdexTxFromPlan({
    txBuilder: "orderEscrow.resolveDisputeWithBinding",
    request: {
      packageId: addr("1"),
      sender: addr("a"),
      escrowObjectId: addr("b"),
      escrowCoinType: `${addr("2")}::coin::COIN`,
      disputeQuorumConfigObjectId: addr("c"),
    },
  });

  assert.equal(extractLastMoveCallFunction(tx), "resolve_dispute_with_binding");
});

test("buildCreateOrderEscrowTx uses guarded IOTA order-escrow entrypoints", () => {
  const tx = buildCreateOrderEscrowTx({
    packageId: addr("1"),
    sender: addr("a"),
    governanceConfigObjectId: addr("b"),
    orderId: "order-1",
    seller: addr("c"),
    amount: 2000000000n,
    deadlineMs: 1776000000000n,
    feeConfigObjectId: addr("d"),
    currency: "IOTA",
  });

  assert.equal(extractLastMoveCallFunction(tx), "create_order_escrow_iota_entry_guarded");
});

test("buildCreateOrderEscrowTx uses guarded CLAW order-escrow entrypoints", () => {
  const tx = buildCreateOrderEscrowTx({
    packageId: addr("1"),
    sender: addr("a"),
    governanceConfigObjectId: addr("b"),
    orderId: "order-2",
    seller: addr("c"),
    amount: 2000000n,
    deadlineMs: 1776000000000n,
    feeConfigObjectId: addr("d"),
    currency: "CLAW",
    clawCoinType: `${addr("2")}::claw::CLAW`,
    paymentCoinObjectId: addr("e"),
  });

  assert.equal(extractLastMoveCallFunction(tx), "create_order_escrow_coin_entry_guarded");
});

test("buildCreateOrderEscrowTx uses Sui native order-escrow entrypoints", () => {
  const tx = buildCreateOrderEscrowTx({
    chainFamily: "sui",
    packageId: addr("1"),
    sender: addr("a"),
    governanceConfigObjectId: addr("b"),
    orderId: "order-sui-1",
    seller: addr("c"),
    amount: 2000000000n,
    deadlineMs: 1776000000000n,
    feeConfigObjectId: addr("d"),
    currency: "SUI",
  });

  assert.equal(extractLastMoveCallFunction(tx), "create_order_escrow_sui_entry");
});

test("buildCreateOrderEscrowTx uses Sui typed asset entrypoints for exact native USDC", () => {
  const coinType = SUI_USDC_TESTNET_COIN_TYPE;
  const tx = buildCreateOrderEscrowTx({
    chainFamily: "sui",
    packageId: addr("1"),
    sender: addr("a"),
    governanceConfigObjectId: addr("b"),
    orderId: "order-sui-usdc-1",
    seller: addr("c"),
    amount: 1000n,
    deadlineMs: 1776000000000n,
    feeConfigObjectId: addr("d"),
    currency: "USDC",
    coinType,
    paymentCoinObjectId: addr("e"),
  });
  const data = tx.getData();
  const lastMoveCall = data.commands.at(-1)?.MoveCall;

  assert.equal(lastMoveCall?.function, "create_order_escrow_typed_order_asset_entry");
  assert.deepEqual(lastMoveCall?.typeArguments, [coinType]);
});

test("buildCreateOrderEscrowTx admits Sui CLAW through the generic typed asset entrypoint", () => {
  const coinType = `${addr("2")}::claw_coin::CLAW_COIN`;
  const tx = buildCreateOrderEscrowTx({
    chainFamily: "sui",
    packageId: addr("1"),
    sender: addr("a"),
    governanceConfigObjectId: addr("b"),
    orderId: "order-sui-claw-1",
    seller: addr("c"),
    amount: 1000n,
    deadlineMs: 1776000000000n,
    feeConfigObjectId: addr("d"),
    currency: "CLAW",
    coinType,
    paymentCoinObjectId: addr("e"),
  });
  const data = tx.getData();
  const lastMoveCall = data.commands.at(-1)?.MoveCall;

  assert.equal(lastMoveCall?.function, "create_order_escrow_typed_order_asset_entry");
  assert.deepEqual(lastMoveCall?.typeArguments, [coinType]);
});

test("buildCreateOrderEscrowTx admits arbitrary Sui typed order assets but keeps native SUI on native builder", () => {
  const coinType = `${addr("2")}::usdx::USDX`;
  const tx = buildCreateOrderEscrowTx({
    chainFamily: "sui",
    packageId: addr("1"),
    sender: addr("a"),
    governanceConfigObjectId: addr("b"),
    orderId: "order-sui-generic-1",
    seller: addr("c"),
    amount: 1000n,
    deadlineMs: 1776000000000n,
    feeConfigObjectId: addr("d"),
    currency: "SPEC",
    coinType,
    paymentCoinObjectId: addr("e"),
  });
  const data = tx.getData();
  const lastMoveCall = data.commands.at(-1)?.MoveCall;

  assert.equal(lastMoveCall?.function, "create_order_escrow_typed_order_asset_entry");
  assert.deepEqual(lastMoveCall?.typeArguments, [coinType]);

  assert.throws(
    () =>
      buildCreateOrderEscrowTx({
        chainFamily: "sui",
        packageId: addr("1"),
        sender: addr("a"),
        governanceConfigObjectId: addr("b"),
        orderId: "order-sui-native-typed-1",
        seller: addr("c"),
        amount: 1000n,
        deadlineMs: 1776000000000n,
        feeConfigObjectId: addr("d"),
        coinType: SUI_NATIVE_COIN_TYPE,
        paymentCoinObjectId: addr("e"),
      }),
    /native_sui_uses_sui_order_escrow_builder/
  );
});

test("buildManagedStorageFeeTx builds Sui native and exact typed fee calls", () => {
  const nativeTx = buildManagedStorageFeeTx({
    chainFamily: "sui",
    packageId: addr("1"),
    sender: addr("a"),
    orderId: "order-sui-storage-1",
    milestoneId: "milestone-1",
    recipientAddress: addr("b"),
    amountAtomic: 1000n,
    currency: "SUI",
  });
  assert.equal(extractLastMoveCallFunction(nativeTx), "pay_managed_storage_fee_sui");

  const typedTx = buildManagedStorageFeeTx({
    chainFamily: "sui",
    packageId: addr("1"),
    sender: addr("a"),
    orderId: "order-sui-storage-2",
    milestoneId: "milestone-1",
    recipientAddress: addr("b"),
    amountAtomic: 1000n,
    currency: "USDC",
    coinType: SUI_USDC_TESTNET_COIN_TYPE,
    paymentCoinObjectId: addr("c"),
  });
  const typedMoveCall = extractLastMoveCall(typedTx);
  assert.equal(typedMoveCall.function, "pay_managed_storage_fee_typed_order_asset");
  assert.deepEqual(typedMoveCall.typeArguments, [SUI_USDC_TESTNET_COIN_TYPE]);
});


test("buildClawdexTxFromPlan dispatches Sui accept through reputation-gated entrypoint", () => {
  const tx = buildClawdexTxFromPlan({
    chainFamily: "sui",
    txBuilder: "disputeQuorum.acceptDisputeCase",
    request: {
      packageId: addr("1"),
      sender: addr("a"),
      disputeCaseObjectId: addr("b"),
      reviewerRegistryObjectId: addr("c"),
      reviewerEntryObjectId: addr("d"),
      disputeQuorumConfigObjectId: addr("e"),
      reputationFeeConfigObjectId: addr("f"),
      reputationProfileObjectId: addr("9"),
    },
  });
  const moveCall = extractLastMoveCall(tx);

  assert.equal(moveCall.module, "dispute_quorum");
  assert.equal(moveCall.function, "accept_dispute_case_with_reputation_cfg");
  assert.equal(moveCall.arguments.length, 7);
});

test("buildClawdexTxFromPlan uses Sui order-escrow closeout entrypoints for Sui plans", () => {
  const tx = buildClawdexTxFromPlan({
    txBuilder: "orderEscrow.release",
    request: {
      chainFamily: "sui",
      packageId: addr("1"),
      sender: addr("a"),
      escrowObjectId: addr("b"),
      escrowCoinType: SUI_NATIVE_COIN_TYPE,
      reputationFeeConfigObjectId: addr("c"),
    },
  });

  assert.equal(extractLastMoveCallFunction(tx), "release_order_escrow_sui_entry");
});

test("buildClawdexTxFromPlan rejects legacy quorum-ticket settlement on Sui", () => {
  assert.throws(
    () =>
      buildClawdexTxFromPlan({
        txBuilder: "orderEscrow.resolveDisputeWithQuorumTicket",
        request: {
          chainFamily: "sui",
          packageId: addr("1"),
          sender: addr("a"),
          escrowObjectId: addr("b"),
          escrowCoinType: SUI_NATIVE_COIN_TYPE,
          quorumResolutionTicketObjectId: addr("c"),
          disputeQuorumConfigObjectId: addr("d"),
        },
      }),
    /unsupported_sui_order_escrow_quorum_ticket/,
  );
});

test("buildClawdexTxFromPlan dispatches Sui order-mailbox plans", () => {
  const tx = buildClawdexTxFromPlan({
    txBuilder: "orderMailbox.postSignal",
    request: {
      chainFamily: "sui",
      packageId: addr("1"),
      sender: addr("a"),
      mailboxObjectId: addr("b"),
      signalIntent: "CHECKPOINT",
      ciphertextHash: "11".repeat(32),
      payloadRef: "ipfs://signal-1",
    },
  });
  const moveCall = extractLastMoveCall(tx);

  assert.equal(moveCall.module, "order_mailbox");
  assert.equal(moveCall.function, "post_signal");
});

test("dryRunTransaction supports direct Sui transaction objects", async () => {
  const txBytes = new Uint8Array([1, 2, 3, 4]);
  const expectedBase64 = Buffer.from(txBytes).toString("base64");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    assert.equal(body.method, "sui_dryRunTransactionBlock");
    assert.deepEqual(body.params, [expectedBase64]);
    return new Response(
      JSON.stringify({
        result: {
          effects: {
            status: {
              status: "success",
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await dryRunTransaction(
      {
        async build({ client }) {
          assert.ok(client);
          return txBytes;
        },
      },
      {
        chainFamily: "sui",
        chainNetwork: "testnet",
        rpcUrl: "https://sui-rpc.example.test",
      },
    );

    assert.equal(result.rpcUrl, "https://sui-rpc.example.test");
    assert.equal(result.network, "testnet");
    assert.equal(result.txBytesB64, expectedBase64);
    assert.equal(result.transactionBytesBase64, expectedBase64);
    assert.equal(result.result.effects.status.status, "success");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("executeTransaction supports direct Sui transaction objects", async () => {
  const txBytes = new Uint8Array([4, 5, 6, 7]);
  const expectedBase64 = Buffer.from(txBytes).toString("base64");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.method, "sui_executeTransactionBlock");
    assert.deepEqual(body.params[0], expectedBase64);
    assert.deepEqual(body.params[1], ["sui-signature-1"]);
    assert.equal(body.params[2].showEffects, true);
    assert.equal(body.params[2].showObjectChanges, true);
    return new Response(
      JSON.stringify({
        result: {
          digest: "sui-digest-1",
          effects: {
            status: {
              status: "success",
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await executeTransaction(
      {
        async build({ client }) {
          assert.ok(client);
          return txBytes;
        },
      },
      {
        chainFamily: "sui",
        chainNetwork: "testnet",
        rpcUrl: "https://sui-rpc.example.test",
        signer: {
          async signTransaction(bytes) {
            assert.deepEqual(Array.from(bytes), Array.from(txBytes));
            return {
              bytes: expectedBase64,
              signature: "sui-signature-1",
            };
          },
        },
      },
    );

    assert.equal(result.rpcUrl, "https://sui-rpc.example.test");
    assert.equal(result.network, "testnet");
    assert.equal(result.txBytesB64, expectedBase64);
    assert.equal(result.signature, "sui-signature-1");
    assert.equal(result.signerSource, "signTransaction");
    assert.equal(result.result.digest, "sui-digest-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("executeTransaction rejects mismatched pre-signed Sui bytes", async () => {
  const txBytes = new Uint8Array([4, 5, 6, 7]);
  const mismatchedBase64 = Buffer.from(new Uint8Array([7, 6, 5, 4])).toString("base64");
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("unexpected_fetch");
  };

  try {
    await assert.rejects(
      () =>
        executeTransaction(
          {
            async build() {
              return txBytes;
            },
          },
          {
            chainFamily: "sui",
            chainNetwork: "testnet",
            rpcUrl: "https://sui-rpc.example.test",
            signature: "sui-signature-1",
            signedBytesBase64: mismatchedBase64,
          },
        ),
      /signed_sui_transaction_bytes_mismatch/,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildClawdexTxFromPlan keeps legacy quorum-ticket settlement as explicit compat path", () => {
  const tx = buildClawdexTxFromPlan({
    txBuilder: "orderEscrow.resolveDisputeWithQuorumTicket",
    request: {
      packageId: addr("1"),
      sender: addr("a"),
      escrowObjectId: addr("b"),
      escrowCoinType: `${addr("2")}::coin::COIN`,
      quorumResolutionTicketObjectId: addr("c"),
      disputeQuorumConfigObjectId: addr("d"),
    },
  });

  assert.equal(extractLastMoveCallFunction(tx), "resolve_dispute_with_quorum_ticket");
});

test("buildClawdexTxFromPlan allows bootstrap whitelist dispute open with an empty invite list", () => {
  const tx = buildClawdexTxFromPlan({
    txBuilder: "disputeQuorum.openMilestoneDisputeCase",
    request: {
      packageId: addr("1"),
      sender: addr("a"),
      milestoneId: "milestone-bootstrap-1",
      escrowObjectId: addr("b"),
      bondObjectId: addr("c"),
      disputeQuorumConfigObjectId: addr("d"),
      governanceConfigObjectId: addr("e"),
      reputationFeeConfigObjectId: addr("f"),
      openDisputeArgMode: "guarded_governance_and_clock",
      escrowCoinType: `${addr("2")}::coin::COIN`,
      invitedReviewerAddresses: [],
    },
  });

  const data = tx.getData();
  const firstCommand = data.commands[0];
  const firstMoveCall = firstCommand && "MoveCall" in firstCommand ? firstCommand.MoveCall : null;

  assert.equal(firstMoveCall?.function, "open_dispute_guarded");
  assert.equal(firstMoveCall?.arguments?.length, 4);
  assert.equal(extractLastMoveCallFunction(tx), "open_milestone_dispute_case_entry");
});

test("buildClawdexTxFromPlan accepts chain-neutral reviewer minimum reward", () => {
  const tx = buildClawdexTxFromPlan({
    txBuilder: "disputeQuorum.registerReviewer",
    request: {
      packageId: addr("1"),
      sender: addr("a"),
      reviewerRegistryObjectId: addr("b"),
      disputeQuorumConfigObjectId: addr("c"),
      reputationFeeConfigObjectId: addr("d"),
      reputationProfileObjectId: addr("e"),
      transportType: 0,
      transportPubkeyHex: "ab".repeat(32),
      minCaseRewardNative: "1",
      stakeAmount: "1",
    },
  });

  assert.equal(extractLastMoveCallFunction(tx), "register_reviewer_entry_with_reputation_cfg");
});

test("Sui helper builders cover reputation and listing-deposit entrypoints", () => {
  const reputationTx = buildCreateReputationProfileTx({
    chainFamily: "sui",
    packageId: addr("1"),
    sender: addr("a"),
    reputationFeeConfigObjectId: addr("b"),
    initFeeAmount: 1000000n,
  });
  const listingTx = buildCreateListingDepositTx({
    chainFamily: "sui",
    packageId: addr("1"),
    sender: addr("a"),
    listingRefDigestHex: "ab".repeat(32),
    listingDepositConfigObjectId: addr("b"),
    depositAmount: 1000000n,
  });

  assert.equal(extractLastMoveCallFunction(reputationTx), "create_reputation_profile_sui_entry");
  assert.equal(extractLastMoveCallFunction(listingTx), "create_listing_deposit_sui_entry");
});

test("resolveClawdexChainConfig prefers created reviewer registry object changes", async () => {
  const packageId = addr("1");
  const disputeQuorumConfigObjectId = addr("2");
  const escrowFeeConfigObjectId = addr("3");
  const governanceConfigObjectId = addr("4");
  const staleReviewerRegistryObjectId = addr("5");
  const reviewerRegistryObjectId = addr("6");
  const initTxDigest = "A".repeat(44);
  const originalGetObject = IotaClient.prototype.getObject;
  const originalGetTransactionBlock = IotaClient.prototype.getTransactionBlock;

  IotaClient.prototype.getObject = async function ({ id }) {
    if (id === disputeQuorumConfigObjectId) {
      return {
        data: {
          previousTransaction: initTxDigest,
          content: {
            fields: {
              default_required_reviewer_votes: "5",
              min_required_reviewer_votes: "3",
              max_required_reviewer_votes: "7",
              min_dispute_bond_per_side_iota: "900000",
              max_dispute_bond_per_side_iota: "1800000",
              min_dispute_bond_per_side_sui: "910000",
              max_dispute_bond_per_side_sui: "1810000",
              reviewer_min_stake_iota: "1200000",
              reviewer_min_stake_sui: "1210000",
            },
          },
        },
      };
    }
    throw new Error(`unexpected_get_object:${id}`);
  };

  IotaClient.prototype.getTransactionBlock = async function ({ digest }) {
    assert.equal(digest, initTxDigest);
    return {
      objectChanges: [
        {
          type: "unwrapped",
          objectType: `${packageId}::dispute_quorum::ReviewerRegistry`,
          objectId: staleReviewerRegistryObjectId,
        },
        {
          type: "created",
          objectType: `${packageId}::dispute_quorum::ReviewerRegistry`,
          objectId: reviewerRegistryObjectId,
        },
      ],
    };
  };

  try {
    const config = await resolveClawdexChainConfig({
      packageId,
      rpcUrl: "https://rpc.example.test",
      disputeQuorumConfigObjectId,
      escrowFeeConfigObjectId,
      governanceConfigObjectId,
    });

    assert.equal(config.packageId, packageId);
    assert.equal(config.disputeQuorumConfigObjectId, disputeQuorumConfigObjectId);
    assert.equal(config.escrowFeeConfigObjectId, escrowFeeConfigObjectId);
    assert.equal(config.governanceConfigObjectId, governanceConfigObjectId);
    assert.equal(config.reviewerRegistryObjectId, reviewerRegistryObjectId);
    assert.equal(config.defaultRequiredReviewerVotes, 5n);
    assert.equal(config.minRequiredReviewerVotes, 3n);
    assert.equal(config.maxRequiredReviewerVotes, 7n);
    assert.equal(config.minDisputeBondPerSideNative, 910000n);
    assert.equal(config.maxDisputeBondPerSideNative, 1810000n);
    assert.equal(config.reviewerMinStakeNative, 1210000n);
    assert.equal(config.minDisputeBondPerSideIota, 900000n);
    assert.equal(config.maxDisputeBondPerSideIota, 1800000n);
    assert.equal(config.reviewerMinStakeIota, 1200000n);
  } finally {
    IotaClient.prototype.getObject = originalGetObject;
    IotaClient.prototype.getTransactionBlock = originalGetTransactionBlock;
  }
});

test("resolveClawdexChainConfig uses Sui JSON-RPC methods for Sui runtimes", async () => {
  const packageId = addr("1");
  const disputeQuorumConfigObjectId = addr("2");
  const escrowFeeConfigObjectId = addr("3");
  const governanceConfigObjectId = addr("4");
  const reviewerRegistryObjectId = addr("6");
  const initTxDigest = "B".repeat(44);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.method);
    if (body.method === "sui_getObject") {
      assert.equal(body.params[0], disputeQuorumConfigObjectId);
      return new Response(
        JSON.stringify({
          result: {
            data: {
              previousTransaction: initTxDigest,
              content: {
                fields: {
                  default_required_reviewer_votes: "5",
                  min_required_reviewer_votes: "3",
                  max_required_reviewer_votes: "7",
                  min_dispute_bond_per_side_sui: "910000",
                  max_dispute_bond_per_side_sui: "1810000",
                  reviewer_min_stake_sui: "1210000",
                },
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (body.method === "sui_getTransactionBlock") {
      assert.equal(body.params[0], initTxDigest);
      return new Response(
        JSON.stringify({
          result: {
            objectChanges: [
              {
                type: "created",
                objectType: `${packageId}::dispute_quorum::ReviewerRegistry`,
                objectId: reviewerRegistryObjectId,
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected_method:${body.method}`);
  };

  try {
    const config = await resolveClawdexChainConfig({
      chainFamily: "sui",
      packageId,
      rpcUrl: "https://sui-rpc.example.test",
      disputeQuorumConfigObjectId,
      escrowFeeConfigObjectId,
      governanceConfigObjectId,
    });

    assert.deepEqual(calls, ["sui_getObject", "sui_getTransactionBlock"]);
    assert.equal(config.reviewerRegistryObjectId, reviewerRegistryObjectId);
    assert.equal(config.reviewerMinStakeNative, 1210000n);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("execution helpers surface on-chain failure reasons from effects.status", () => {
  const executionResult = {
    result: {
      effects: {
        status: {
          status: "failure",
          error: "Error in 1st command, Insufficient coin balance for operation.",
        },
      },
    },
  };

  assert.equal(getExecutionFailure(executionResult), "Error in 1st command, Insufficient coin balance for operation.");
  assert.throws(
    () => assertExecutionSuccess(executionResult, "transaction_execution_failed"),
    /transaction_execution_failed:Error in 1st command, Insufficient coin balance for operation\./,
  );
});

test("execution helpers ignore successful effects.status payloads", () => {
  const executionResult = {
    result: {
      effects: {
        status: {
          status: "success",
        },
      },
    },
  };

  assert.equal(getExecutionFailure(executionResult), "");
  assert.doesNotThrow(() => assertExecutionSuccess(executionResult, "transaction_execution_failed"));
});

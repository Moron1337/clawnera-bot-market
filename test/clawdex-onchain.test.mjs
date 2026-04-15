import test from "node:test";
import assert from "node:assert/strict";
import { IotaClient } from "@iota/iota-sdk/client";

import {
  assertExecutionSuccess,
  buildClawdexTxFromPlan,
  buildCreateOrderEscrowTx,
  extractLatestEventByTypeSuffix,
  resolveClawdexChainConfig,
  extractMailboxSignalAcked,
  extractMailboxSignalPosted,
  getExecutionFailure,
} from "../lib/clawdex-onchain.mjs";

function addr(char) {
  return `0x${char.repeat(64)}`;
}

function extractLastMoveCallFunction(tx) {
  const data = tx.getData();
  const lastCommand = data.commands.at(-1);
  if (!lastCommand || !("MoveCall" in lastCommand) || !lastCommand.MoveCall) {
    throw new Error("missing_move_call");
  }
  return lastCommand.MoveCall.function;
}

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
              reviewer_min_stake_iota: "1200000",
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
    assert.equal(config.minDisputeBondPerSideIota, 900000n);
    assert.equal(config.maxDisputeBondPerSideIota, 1800000n);
    assert.equal(config.reviewerMinStakeIota, 1200000n);
  } finally {
    IotaClient.prototype.getObject = originalGetObject;
    IotaClient.prototype.getTransactionBlock = originalGetTransactionBlock;
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

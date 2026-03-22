import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClawdexTxFromPlan,
  extractLatestEventByTypeSuffix,
  extractMailboxSignalAcked,
  extractMailboxSignalPosted,
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

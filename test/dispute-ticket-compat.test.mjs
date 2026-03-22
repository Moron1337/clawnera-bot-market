import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalPackageIdFromObjectType,
  isMissingResolveDisputeWithBindingFunctionError,
  resolveQuorumTicketFromFinalizeTx,
} from "../lib/dispute-ticket-compat.mjs";

test("detects missing resolve_dispute_with_binding function errors", () => {
  assert.equal(
    isMissingResolveDisputeWithBindingFunctionError("No function was found with function name resolve_dispute_with_binding"),
    true,
  );
  assert.equal(isMissingResolveDisputeWithBindingFunctionError("some other error"), false);
});

test("extracts canonical package ids from object types", () => {
  assert.equal(
    canonicalPackageIdFromObjectType(
      "0x8b40faecc76a6bd7bd346d370e08f0c05435f33b7cf355a1cad43854ecb56ef2::dispute_quorum::MilestoneDisputeCase",
    ),
    "0x8b40faecc76a6bd7bd346d370e08f0c05435f33b7cf355a1cad43854ecb56ef2",
  );
  assert.equal(canonicalPackageIdFromObjectType("bad"), "");
});

test("finds quorum resolution tickets from finalize tx payloads", () => {
  const resolved = resolveQuorumTicketFromFinalizeTx({
    disputeCaseObjectId: "0x61fbd42b338b78b03e8043c505cee38417bed5e5959051d86843c1cdc8797906",
    disputeCaseType:
      "0x8b40faecc76a6bd7bd346d370e08f0c05435f33b7cf355a1cad43854ecb56ef2::dispute_quorum::MilestoneDisputeCase",
    resolvedEvents: [
      {
        type: "0x8b40faecc76a6bd7bd346d370e08f0c05435f33b7cf355a1cad43854ecb56ef2::dispute_quorum::DisputeQuorumResolved",
        id: {
          txDigest: "2rQqv4uAhowNqoaQGwKkcuEvxdSWHtGXoZV9dhhZf53w",
        },
        parsedJson: {
          dispute_case_id: "0x61fbd42b338b78b03e8043c505cee38417bed5e5959051d86843c1cdc8797906",
        },
      },
    ],
    transactionBlock: {
      transaction: {
        data: {
          sender: "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7",
        },
      },
      events: [
        {
          type: "0x8b40faecc76a6bd7bd346d370e08f0c05435f33b7cf355a1cad43854ecb56ef2::dispute_quorum::QuorumResolutionTicketIssued",
          parsedJson: {
            ticket_id: "0x10790768788e6ecc6f0b442e870d0936429923e3fd4976a22f07895f0de83155",
          },
        },
      ],
    },
  });

  assert.deepEqual(resolved, {
    txDigest: "2rQqv4uAhowNqoaQGwKkcuEvxdSWHtGXoZV9dhhZf53w",
    ticketObjectId: "0x10790768788e6ecc6f0b442e870d0936429923e3fd4976a22f07895f0de83155",
    finalizeSignerAddress: "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7",
  });
});

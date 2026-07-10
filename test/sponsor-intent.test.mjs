import test from "node:test";
import assert from "node:assert/strict";
import {
  SPONSOR_EXECUTION_INTENT_PREFIX,
  assertCanonicalSponsorSignature,
  assertSponsorExecutionIntentMatches,
  prepareSponsorExecutionIntentV2,
} from "../lib/sponsor-intent.mjs";

const INPUT = {
  txBytesB64: Buffer.from("canonical-sponsored-transaction").toString("base64"),
  chainFamily: "iota",
  network: "testnet",
  txFamily: "marketplace_write",
  orderId: "order-1",
  reservationId: "reservation-1",
  expiresAt: "2030-01-01T00:00:00.000Z",
  purpose: "marketplace_tx",
};

test("sponsor intent v2 binds both transaction digests and the complete canonical tuple", () => {
  const prepared = prepareSponsorExecutionIntentV2(INPUT);
  assert.equal(prepared.intent.version, "sponsor_execute_intent.v2");
  assert.match(prepared.intent.txDigest, /^[a-f0-9]{64}$/);
  assert.match(prepared.intent.chainTxDigest, /^[1-9A-HJ-NP-Za-km-z]{16,128}$/);
  assert.equal(
    prepared.signingMessage,
    `${SPONSOR_EXECUTION_INTENT_PREFIX}\n` +
      `version=sponsor_execute_intent.v2|chain_family=iota|network=testnet|tx_family=marketplace_write|` +
      `order_id=order-1|reservation_id=reservation-1|tx_digest=${prepared.intent.txDigest}|` +
      `chain_tx_digest=${prepared.intent.chainTxDigest}|expires_at=2030-01-01T00:00:00.000Z|purpose=marketplace_tx`,
  );
});

test("sponsor intent v2 rejects builder drift and unexpected fields", () => {
  const expected = prepareSponsorExecutionIntentV2(INPUT).intent;
  assert.equal(assertSponsorExecutionIntentMatches({ ...expected }, expected), expected);
  assert.throws(
    () => assertSponsorExecutionIntentMatches({ ...expected, orderId: "order-2" }, expected),
    /builder_sponsor_intent_mismatch:orderId/,
  );
  assert.throws(
    () => assertSponsorExecutionIntentMatches({ ...expected, ignored: true }, expected),
    /builder_sponsor_intent_field_set_mismatch/,
  );
});

test("sponsor intent v2 rejects non-canonical bytes, context, expiry, and signatures", () => {
  assert.throws(
    () => prepareSponsorExecutionIntentV2({ ...INPUT, txBytesB64: "dGVzdA" }),
    /invalid_sponsor_transaction_bytes_base64/,
  );
  assert.throws(
    () => prepareSponsorExecutionIntentV2({ ...INPUT, chainFamily: "evm" }),
    /invalid_sponsor_intent_chain_family/,
  );
  assert.throws(
    () => prepareSponsorExecutionIntentV2({ ...INPUT, expiresAt: "2030-01-01T00:00:00Z" }),
    /invalid_sponsor_intent_expires_at/,
  );
  assert.equal(assertCanonicalSponsorSignature("c2ln"), "c2ln");
  assert.throws(() => assertCanonicalSponsorSignature("not base64"), /invalid_sponsor_intent_signature/);
});

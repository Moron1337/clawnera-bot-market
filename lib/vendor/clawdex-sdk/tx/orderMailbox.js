import { Transaction } from "@iota/iota-sdk/transactions";
import { IOTA_CLOCK_OBJECT_ID } from "@iota/iota-sdk/utils";
import { assertBoundedUtf8String, assertCanonicalProtocolString, assertDistinctNonZeroAddresses, assertPositiveAmount, assertValidIotaAddress, assertValidIotaObjectId } from "../validation.js";
const MAX_ORDER_ID_LEN = 128;
const MAX_PAYLOAD_REF_LEN = 256;
export const ORDER_MAILBOX_SIGNAL_MSG = 0;
export const ORDER_MAILBOX_SIGNAL_CHECKPOINT = 1;
export const ORDER_MAILBOX_SIGNAL_OTHER = 2;
export const ORDER_MAILBOX_SIGNAL_INTENT_MSG = "MSG";
export const ORDER_MAILBOX_SIGNAL_INTENT_DELIVERABLE_READY = "DELIVERABLE_READY";
export const ORDER_MAILBOX_SIGNAL_INTENT_CHECKPOINT = "CHECKPOINT";
export const ORDER_MAILBOX_SIGNAL_INTENT_DISPUTE_NOTICE = "DISPUTE_NOTICE";
export const ORDER_MAILBOX_SIGNAL_INTENT_OTHER = "OTHER";
function orderMailboxTarget(packageId, fn) {
    return `${packageId}::order_mailbox::${fn}`;
}
function buildBaseTx(req) {
    const packageId = assertValidIotaObjectId(req.packageId, "package_id");
    const sender = assertValidIotaAddress(req.sender, "sender");
    const tx = new Transaction();
    tx.setSender(sender);
    return { tx, packageId, sender };
}
function validatedClockObjectId(input) {
    return assertValidIotaObjectId(input ?? IOTA_CLOCK_OBJECT_ID, "clock_object_id");
}
function normalizeOrderId(value) {
    const normalized = assertCanonicalProtocolString(value, "order_id", MAX_ORDER_ID_LEN);
    if (/[\r\n]/.test(normalized)) {
        throw new Error("invalid_order_id");
    }
    return normalized;
}
function normalizeSignalType(value) {
    if (value === 0 || value === 1 || value === 2) {
        return value;
    }
    throw new Error("invalid_signal_type");
}
export function normalizeOrderMailboxSignalIntent(value) {
    if (value === ORDER_MAILBOX_SIGNAL_INTENT_MSG ||
        value === ORDER_MAILBOX_SIGNAL_INTENT_DELIVERABLE_READY ||
        value === ORDER_MAILBOX_SIGNAL_INTENT_CHECKPOINT ||
        value === ORDER_MAILBOX_SIGNAL_INTENT_DISPUTE_NOTICE ||
        value === ORDER_MAILBOX_SIGNAL_INTENT_OTHER) {
        return value;
    }
    throw new Error("invalid_signal_intent");
}
export function mapOrderMailboxSignalIntentToSignalType(intent) {
    switch (normalizeOrderMailboxSignalIntent(intent)) {
        case ORDER_MAILBOX_SIGNAL_INTENT_MSG:
            return ORDER_MAILBOX_SIGNAL_MSG;
        case ORDER_MAILBOX_SIGNAL_INTENT_DELIVERABLE_READY:
        case ORDER_MAILBOX_SIGNAL_INTENT_CHECKPOINT:
            return ORDER_MAILBOX_SIGNAL_CHECKPOINT;
        case ORDER_MAILBOX_SIGNAL_INTENT_DISPUTE_NOTICE:
        case ORDER_MAILBOX_SIGNAL_INTENT_OTHER:
            return ORDER_MAILBOX_SIGNAL_OTHER;
    }
}
function normalizeCiphertextHash(value) {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new Error("invalid_ciphertext_hash");
    }
    return normalized;
}
function normalizePayloadRef(value) {
    if (value === undefined) {
        return "";
    }
    if (typeof value !== "string") {
        throw new Error("invalid_payload_ref");
    }
    const normalized = assertBoundedUtf8String(value, "payload_ref", MAX_PAYLOAD_REF_LEN);
    if (/[\r\n]/.test(normalized)) {
        throw new Error("invalid_payload_ref");
    }
    return normalized;
}
function normalizeAckedSeq(value) {
    if (typeof value === "bigint") {
        return assertPositiveAmount(value, "acked_seq");
    }
    if (typeof value !== "string") {
        throw new Error("invalid_acked_seq");
    }
    const normalized = value.trim();
    if (!/^[0-9]+$/.test(normalized)) {
        throw new Error("invalid_acked_seq");
    }
    const parsed = BigInt(normalized);
    return assertPositiveAmount(parsed, "acked_seq");
}
export function buildInitOrderMailboxTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const orderId = normalizeOrderId(req.orderId);
    const { first: buyer, second: seller } = assertDistinctNonZeroAddresses(req.buyer, "buyer", req.seller, "seller", "buyer_seller_pair");
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: orderMailboxTarget(packageId, "init_order_mailbox"),
        arguments: [
            tx.pure.string(orderId),
            tx.pure.address(buyer),
            tx.pure.address(seller),
            tx.object(governanceConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildPostOrderMailboxSignalTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const mailboxObjectId = assertValidIotaObjectId(req.mailboxObjectId, "mailbox_object_id");
    const signalType = normalizeSignalType(req.signalType);
    const ciphertextHash = normalizeCiphertextHash(req.ciphertextHash);
    const payloadRef = normalizePayloadRef(req.payloadRef);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: orderMailboxTarget(packageId, "post_signal"),
        arguments: [
            tx.object(mailboxObjectId),
            tx.pure.u8(signalType),
            tx.pure.string(ciphertextHash),
            tx.pure.string(payloadRef),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildPostOrderMailboxSignalIntentTx(req) {
    return buildPostOrderMailboxSignalTx({
        ...req,
        signalType: mapOrderMailboxSignalIntentToSignalType(req.signalIntent)
    });
}
export function buildAckOrderMailboxSignalTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const mailboxObjectId = assertValidIotaObjectId(req.mailboxObjectId, "mailbox_object_id");
    const ackedSeq = normalizeAckedSeq(req.ackedSeq);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: orderMailboxTarget(packageId, "ack_signal"),
        arguments: [tx.object(mailboxObjectId), tx.pure.u64(ackedSeq), tx.object(clockObjectId)]
    });
    return tx;
}
export function buildCloseOrderMailboxTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const mailboxObjectId = assertValidIotaObjectId(req.mailboxObjectId, "mailbox_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: orderMailboxTarget(packageId, "close_order_mailbox"),
        arguments: [tx.object(mailboxObjectId), tx.object(clockObjectId)]
    });
    return tx;
}
export function buildDeleteClosedOrderMailboxTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const mailboxObjectId = assertValidIotaObjectId(req.mailboxObjectId, "mailbox_object_id");
    tx.moveCall({
        target: orderMailboxTarget(packageId, "delete_closed_mailbox"),
        arguments: [tx.object(mailboxObjectId)]
    });
    return tx;
}
export function buildOrderMailboxTxFromPlan(plan) {
    switch (plan.txBuilder) {
        case "orderMailbox.init":
            return buildInitOrderMailboxTx(plan.request);
        case "orderMailbox.postSignal":
            return buildPostOrderMailboxSignalIntentTx(plan.request);
        case "orderMailbox.ackSignal":
            return buildAckOrderMailboxSignalTx(plan.request);
        case "orderMailbox.close":
            return buildCloseOrderMailboxTx(plan.request);
        default:
            throw new Error(`unsupported_order_mailbox_tx_builder:${plan.txBuilder ?? "unknown"}`);
    }
}
//# sourceMappingURL=orderMailbox.js.map
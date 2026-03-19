import { Transaction } from "@iota/iota-sdk/transactions";
import { IOTA_CLOCK_OBJECT_ID } from "@iota/iota-sdk/utils";
import { assertCanonicalProtocolString, assertPositiveAmount, assertValidIotaAddress, assertValidIotaObjectId, assertValidMoveTypeTag } from "../validation.js";
import { resolveValidatedClawFunding } from "./clawCoin.js";
const MAX_ORDER_ID_LEN = 128;
const MAX_MILESTONE_ID_LEN = 128;
function orderEscrowTarget(packageId, fn) {
    return `${packageId}::order_escrow::${fn}`;
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
function validatedEscrowObjectId(input) {
    return assertValidIotaObjectId(input, "escrow_object_id");
}
function validatedEscrowCoinType(input) {
    return assertValidMoveTypeTag(input, "escrow_coin_type");
}
export function buildCreateOrderEscrowIotaTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const orderId = assertCanonicalProtocolString(req.orderId, "order_id", MAX_ORDER_ID_LEN);
    const seller = assertValidIotaAddress(req.seller, "seller");
    const amount = assertPositiveAmount(req.amount, "amount");
    const deadlineMs = assertPositiveAmount(req.deadlineMs, "deadline_ms");
    const feeConfigObjectId = assertValidIotaObjectId(req.feeConfigObjectId, "fee_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const paymentSource = req.paymentCoinObjectId
        ? tx.object(assertValidIotaObjectId(req.paymentCoinObjectId, "payment_coin_object_id"))
        : tx.gas;
    const paymentCoin = tx.splitCoins(paymentSource, [tx.pure.u64(amount)]);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "create_order_escrow_iota_entry"),
        arguments: [
            tx.pure.string(orderId),
            tx.pure.address(seller),
            paymentCoin,
            tx.pure.u64(deadlineMs),
            tx.object(feeConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildCreateOrderEscrowClawTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const orderId = assertCanonicalProtocolString(req.orderId, "order_id", MAX_ORDER_ID_LEN);
    const seller = assertValidIotaAddress(req.seller, "seller");
    const clawCoinType = assertValidMoveTypeTag(req.clawCoinType, "claw_coin_type");
    const amount = assertPositiveAmount(req.amount, "amount");
    const deadlineMs = assertPositiveAmount(req.deadlineMs, "deadline_ms");
    const feeConfigObjectId = assertValidIotaObjectId(req.feeConfigObjectId, "fee_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const funding = resolveValidatedClawFunding(req, clawCoinType);
    const paymentCoin = funding.kind === "split"
        ? tx.splitCoins(tx.object(funding.paymentCoinObjectId), [tx.pure.u64(amount)])
        : tx.object(funding.clawCoinObjectId);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "create_order_escrow_coin_entry"),
        typeArguments: [clawCoinType],
        arguments: [
            tx.pure.string(orderId),
            tx.pure.address(seller),
            paymentCoin,
            tx.pure.u64(deadlineMs),
            tx.object(feeConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildReleaseOrderEscrowTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "release"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(escrowObjectId)]
    });
    return tx;
}
export function buildReleaseOrderEscrowWithBondTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    tx.moveCall({
        target: orderEscrowTarget(packageId, "release_with_dispute_bond"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(escrowObjectId), tx.object(bondObjectId)]
    });
    return tx;
}
export function buildClaimAfterDeadlineOrderEscrowTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "claim_after_deadline"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(clockObjectId), tx.object(escrowObjectId)]
    });
    return tx;
}
export function buildOpenOrderEscrowDisputeTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "open_dispute"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(governanceConfigObjectId), tx.object(clockObjectId), tx.object(escrowObjectId)]
    });
    return tx;
}
export function buildClaimAfterDeadlineWithBondTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "claim_after_deadline_with_dispute_bond"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(clockObjectId), tx.object(escrowObjectId), tx.object(bondObjectId)]
    });
    return tx;
}
export function buildReleaseUnusedDisputeBondAfterReleaseTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    tx.moveCall({
        target: orderEscrowTarget(packageId, "release_unused_dispute_bond_after_release"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(escrowObjectId), tx.object(bondObjectId)]
    });
    return tx;
}
export function buildResolveOrderEscrowWithQuorumTicketTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const quorumResolutionTicketObjectId = assertValidIotaObjectId(req.quorumResolutionTicketObjectId, "quorum_resolution_ticket_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    tx.moveCall({
        target: orderEscrowTarget(packageId, "resolve_dispute_with_quorum_ticket"),
        typeArguments: [escrowCoinType],
        arguments: [
            tx.object(quorumResolutionTicketObjectId),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(escrowObjectId)
        ]
    });
    return tx;
}
export function buildOpenMilestoneDisputeCaseWithOrderEscrowTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const milestoneId = assertCanonicalProtocolString(req.milestoneId, "milestone_id", MAX_MILESTONE_ID_LEN);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const governanceConfigObjectId = req.governanceConfigObjectId
        ? assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id")
        : undefined;
    const openDisputeArgMode = req.openDisputeArgMode ?? (governanceConfigObjectId ? "guarded_governance_and_clock" : undefined);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const invitedReviewerAddresses = (req.invitedReviewerAddresses ?? []).map((address) => assertValidIotaAddress(address, "invited_reviewer_address"));
    if (invitedReviewerAddresses.length === 0) {
        throw new Error("invited_reviewer_addresses_required");
    }
    if (openDisputeArgMode) {
        if ((openDisputeArgMode === "governance_and_clock" || openDisputeArgMode === "guarded_governance_and_clock") && !governanceConfigObjectId) {
            throw new Error("invalid_governance_config_object_id");
        }
        tx.moveCall({
            target: openDisputeArgMode === "guarded_governance_and_clock"
                ? orderEscrowTarget(packageId, "open_dispute_guarded")
                : orderEscrowTarget(packageId, "open_dispute"),
            typeArguments: [escrowCoinType],
            arguments: openDisputeArgMode === "clock_only"
                ? [tx.object(clockObjectId), tx.object(escrowObjectId)]
                : [tx.object(governanceConfigObjectId), tx.object(clockObjectId), tx.object(escrowObjectId)]
        });
    }
    tx.moveCall({
        target: orderEscrowTarget(packageId, "open_milestone_dispute_case_entry_with_invites"),
        typeArguments: [escrowCoinType],
        arguments: [
            tx.pure.string(milestoneId),
            tx.pure.vector("address", invitedReviewerAddresses),
            tx.object(escrowObjectId),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(bondObjectId),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
//# sourceMappingURL=orderEscrow.js.map

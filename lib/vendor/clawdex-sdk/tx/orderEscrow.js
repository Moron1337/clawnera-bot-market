import { Transaction } from "@iota/iota-sdk/transactions";
import { IOTA_CLOCK_OBJECT_ID } from "@iota/iota-sdk/utils";
import { LIVE_PUBLIC_MARKET_ASSET_DOSSIERS, isLiveSymbolEnabledForLane, isSupportedLiveMarketAssetSymbol, } from "../assetControlPlane.js";
import { assertCanonicalOrderRef, assertPositiveAmount, assertValidIotaAddress, assertValidIotaObjectId, assertValidMoveTypeTag } from "../validation.js";
import { resolveValidatedClawFunding } from "./clawCoin.js";
import { resolveValidatedTypedCoinFunding } from "./assetCoin.js";
const MAX_ORDER_ID_LEN = 128;
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
function validatedReputationFeeConfigObjectId(input) {
    return assertValidIotaObjectId(input, "reputation_fee_config_object_id");
}
export function buildCreateOrderEscrowIotaTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id");
    const orderId = assertCanonicalOrderRef(req.orderId, "order_id", MAX_ORDER_ID_LEN);
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
        target: orderEscrowTarget(packageId, "create_order_escrow_iota_entry_guarded"),
        arguments: [
            tx.object(governanceConfigObjectId),
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
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id");
    const orderId = assertCanonicalOrderRef(req.orderId, "order_id", MAX_ORDER_ID_LEN);
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
        target: orderEscrowTarget(packageId, "create_order_escrow_coin_entry_guarded"),
        typeArguments: [clawCoinType],
        arguments: [
            tx.object(governanceConfigObjectId),
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
export function buildCreateOrderEscrowTypedCoinTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id");
    const orderId = assertCanonicalOrderRef(req.orderId, "order_id", MAX_ORDER_ID_LEN);
    const seller = assertValidIotaAddress(req.seller, "seller");
    const coinType = assertValidMoveTypeTag(req.coinType, "coin_type");
    const amount = assertPositiveAmount(req.amount, "amount");
    const deadlineMs = assertPositiveAmount(req.deadlineMs, "deadline_ms");
    const feeConfigObjectId = assertValidIotaObjectId(req.feeConfigObjectId, "fee_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const funding = resolveValidatedTypedCoinFunding(req, coinType, {
        objectIdField: "coin_object_id",
        objectTypeField: "coin_object_type",
        ambiguousSource: "exactly one of paymentCoinObjectId or coin/coinObjectId is required",
        typeMismatch: "coin_object_type_mismatch",
        uncheckedObjectIdRequiresOptIn: "unchecked_coin_object_id_requires_opt_in",
    });
    const paymentCoin = funding.kind === "split"
        ? tx.splitCoins(tx.object(funding.paymentCoinObjectId), [tx.pure.u64(amount)])
        : tx.object(funding.coinObjectId);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "create_order_escrow_coin_entry_guarded"),
        typeArguments: [coinType],
        arguments: [
            tx.object(governanceConfigObjectId),
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
export function buildCreateOrderEscrowMarketAssetTx(req) {
    if (!isSupportedLiveMarketAssetSymbol(req.assetSymbol) ||
        !isLiveSymbolEnabledForLane(req.assetSymbol, "orderCurrency")) {
        throw new Error("unsupported_live_market_asset");
    }
    const asset = LIVE_PUBLIC_MARKET_ASSET_DOSSIERS[req.assetSymbol];
    if (asset.fundingMode === "native_gas_split") {
        return buildCreateOrderEscrowIotaTx(req);
    }
    if (!isLiveSymbolEnabledForLane(req.assetSymbol, "typedOrderEscrowCreate")) {
        throw new Error("unsupported_live_market_asset");
    }
    if (!req.coinType) {
        throw new Error("coin_type_required_for_typed_market_asset");
    }
    return buildCreateOrderEscrowTypedCoinTx({
        ...req,
        coinType: req.coinType,
        coin: req.coin,
        coinObjectId: req.coinObjectId,
        allowUncheckedCoinObjectId: req.allowUncheckedCoinObjectId,
    });
}
export function buildReleaseOrderEscrowTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const reputationFeeConfigObjectId = validatedReputationFeeConfigObjectId(req.reputationFeeConfigObjectId);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "release"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(clockObjectId), tx.object(reputationFeeConfigObjectId), tx.object(escrowObjectId)]
    });
    return tx;
}
export function buildReleaseOrderEscrowWithBondTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const reputationFeeConfigObjectId = validatedReputationFeeConfigObjectId(req.reputationFeeConfigObjectId);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "release_with_dispute_bond"),
        typeArguments: [escrowCoinType],
        arguments: [
            tx.object(clockObjectId),
            tx.object(reputationFeeConfigObjectId),
            tx.object(escrowObjectId),
            tx.object(bondObjectId)
        ]
    });
    return tx;
}
export function buildClaimAfterDeadlineOrderEscrowTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const reputationFeeConfigObjectId = validatedReputationFeeConfigObjectId(req.reputationFeeConfigObjectId);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id");
    tx.moveCall({
        target: orderEscrowTarget(packageId, "claim_after_deadline_v2"),
        typeArguments: [escrowCoinType],
        arguments: [
            tx.object(governanceConfigObjectId),
            tx.object(clockObjectId),
            tx.object(reputationFeeConfigObjectId),
            tx.object(escrowObjectId)
        ]
    });
    return tx;
}
export function buildClaimAfterDeadlineToBuyerOrderEscrowTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const reputationFeeConfigObjectId = validatedReputationFeeConfigObjectId(req.reputationFeeConfigObjectId);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "claim_after_deadline_to_buyer_guarded"),
        typeArguments: [escrowCoinType],
        arguments: [
            tx.object(governanceConfigObjectId),
            tx.object(clockObjectId),
            tx.object(reputationFeeConfigObjectId),
            tx.object(escrowObjectId)
        ]
    });
    return tx;
}
export function buildApproveSettledOrderEscrowDeletionTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "approve_settled_escrow_deletion"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(escrowObjectId)]
    });
    return tx;
}
export function buildDeleteSettledOrderEscrowTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const feeConfigObjectId = assertValidIotaObjectId(req.feeConfigObjectId ?? "", "fee_config_object_id");
    tx.moveCall({
        target: orderEscrowTarget(packageId, "delete_settled_escrow_guarded"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(feeConfigObjectId), tx.object(escrowObjectId)]
    });
    return tx;
}
export function buildApproveMutualCancelOrderEscrowTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "approve_mutual_cancel"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(escrowObjectId)]
    });
    return tx;
}
export function buildMutualCancelOrderEscrowTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "mutual_cancel"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(escrowObjectId)]
    });
    return tx;
}
export function buildOpenOrderEscrowDisputeTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const reputationFeeConfigObjectId = validatedReputationFeeConfigObjectId(req.reputationFeeConfigObjectId);
    tx.moveCall({
        target: orderEscrowTarget(packageId, "open_dispute_guarded"),
        typeArguments: [escrowCoinType],
        arguments: [
            tx.object(governanceConfigObjectId),
            tx.object(clockObjectId),
            tx.object(reputationFeeConfigObjectId),
            tx.object(escrowObjectId)
        ]
    });
    return tx;
}
export function buildClaimAfterDeadlineWithBondTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const reputationFeeConfigObjectId = validatedReputationFeeConfigObjectId(req.reputationFeeConfigObjectId);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id");
    tx.moveCall({
        target: orderEscrowTarget(packageId, "claim_after_deadline_with_dispute_bond_v2"),
        typeArguments: [escrowCoinType],
        arguments: [
            tx.object(governanceConfigObjectId),
            tx.object(clockObjectId),
            tx.object(reputationFeeConfigObjectId),
            tx.object(escrowObjectId),
            tx.object(bondObjectId)
        ]
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
export function buildResolveOrderEscrowWithBindingTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const escrowObjectId = validatedEscrowObjectId(req.escrowObjectId);
    const escrowCoinType = validatedEscrowCoinType(req.escrowCoinType);
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    tx.moveCall({
        target: orderEscrowTarget(packageId, "resolve_dispute_with_binding"),
        typeArguments: [escrowCoinType],
        arguments: [tx.object(disputeQuorumConfigObjectId), tx.object(escrowObjectId)]
    });
    return tx;
}
//# sourceMappingURL=orderEscrow.js.map
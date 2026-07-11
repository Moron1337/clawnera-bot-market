import { Transaction } from "@iota/iota-sdk/transactions";
import { IOTA_CLOCK_OBJECT_ID } from "@iota/iota-sdk/utils";
import { assertByteVectorInput, assertCanonicalProtocolString, assertPositiveAmount, assertValidIotaAddress, assertValidIotaObjectId, assertValidMoveTypeTag } from "../validation.js";
const MAX_ORDER_ID_LEN = 128;
const MAX_MILESTONE_ID_LEN = 128;
const MIN_TRANSPORT_PUBKEY_LEN = 16;
const MAX_TRANSPORT_PUBKEY_LEN = 256;
const COMMIT_HASH_LEN = 32;
const MIN_LOCAL_REQUIRED_REVIEWER_VOTES = 3n;
export const DISPUTE_QUORUM_SETTLEMENT_TO_SELLER = 0;
export const DISPUTE_QUORUM_SETTLEMENT_TO_BUYER = 1;
export const DISPUTE_QUORUM_SETTLEMENT_SPLIT = 2;
function disputeQuorumTarget(packageId, fn) {
    return `${packageId}::dispute_quorum::${fn}`;
}
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
function assertSupportedOpenDisputeArgMode(input) {
    if (input === undefined) {
        return undefined;
    }
    if (input !== "guarded_governance_and_clock") {
        throw new Error("legacy_order_escrow_open_dispute_arg_mode_not_supported_use_guarded");
    }
    return input;
}
function assertU8(value, fieldName) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(`invalid_${fieldName}`);
    }
    return value;
}
export function buildBootstrapReviewerSelectorCapTx(req) {
    const { tx, packageId, sender } = buildBaseTx(req);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "bootstrap_reviewer_selector_cap_v2"),
        arguments: [
            tx.object(assertValidIotaObjectId(req.adminCapObjectId, "admin_cap_object_id")),
            tx.object(assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
            tx.pure.address(sender)
        ]
    });
    return tx;
}
function assertValidReviewerVoteThresholds(requiredVotes, requiredVotesFloor) {
    if (requiredVotes < MIN_LOCAL_REQUIRED_REVIEWER_VOTES ||
        requiredVotes % 2n !== 1n ||
        requiredVotesFloor <= 0n ||
        requiredVotesFloor > requiredVotes ||
        requiredVotesFloor % 2n !== 1n) {
        throw new Error("invalid_required_reviewer_votes");
    }
}
function minCaseRewardNative(req) {
    const value = req.minCaseRewardNative ?? req.minCaseRewardIota;
    if (value === undefined) {
        throw new Error("min_case_reward_native_required");
    }
    return value;
}
function assertValidBondAmount(amount, policy) {
    if (!policy) {
        return amount;
    }
    const minAmount = BigInt(assertPositiveAmount(policy.minAmount, "bond_amount_policy_min_amount"));
    const maxAmount = BigInt(assertPositiveAmount(policy.maxAmount, "bond_amount_policy_max_amount"));
    if (minAmount > maxAmount) {
        throw new Error("invalid_bond_amount_policy");
    }
    if (amount < minAmount || amount > maxAmount) {
        throw new Error("invalid_bond_amount");
    }
    if (policy.requireExactMin && amount !== minAmount) {
        throw new Error("invalid_bond_amount");
    }
    return amount;
}
export function buildRegisterReviewerTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId ?? "", "governance_config_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const reputationFeeConfigObjectId = assertValidIotaObjectId(req.reputationFeeConfigObjectId, "reputation_fee_config_object_id");
    const reputationProfileObjectId = assertValidIotaObjectId(req.reputationProfileObjectId, "reputation_profile_object_id");
    const transportType = assertU8(req.transportType, "transport_type");
    const transportPubkey = assertByteVectorInput(req.transportPubkey, "transport_pubkey", MIN_TRANSPORT_PUBKEY_LEN, MAX_TRANSPORT_PUBKEY_LEN);
    const minCaseReward = assertPositiveAmount(minCaseRewardNative(req), "min_case_reward_native");
    const stakeAmount = assertPositiveAmount(req.stakeAmount, "stake_amount");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const stakeSource = req.paymentCoinObjectId
        ? tx.object(assertValidIotaObjectId(req.paymentCoinObjectId, "payment_coin_object_id"))
        : tx.gas;
    const stakeCoin = tx.splitCoins(stakeSource, [tx.pure.u64(stakeAmount)]);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "register_reviewer_entry_with_reputation_cfg"),
        arguments: [
            tx.object(governanceConfigObjectId),
            tx.object(reviewerRegistryObjectId),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(reputationFeeConfigObjectId),
            tx.object(reputationProfileObjectId),
            tx.pure.u8(transportType),
            tx.pure.vector("u8", transportPubkey),
            tx.pure.u64(minCaseReward),
            stakeCoin,
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildUpdateReviewerTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const reviewerEntryObjectId = assertValidIotaObjectId(req.reviewerEntryObjectId, "reviewer_entry_object_id");
    const transportType = assertU8(req.transportType, "transport_type");
    const transportPubkey = assertByteVectorInput(req.transportPubkey, "transport_pubkey", MIN_TRANSPORT_PUBKEY_LEN, MAX_TRANSPORT_PUBKEY_LEN);
    const minCaseReward = assertPositiveAmount(minCaseRewardNative(req), "min_case_reward_native");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "update_reviewer"),
        arguments: [
            tx.object(reviewerRegistryObjectId),
            tx.object(reviewerEntryObjectId),
            tx.pure.u8(transportType),
            tx.pure.vector("u8", transportPubkey),
            tx.pure.u64(minCaseReward),
            tx.pure.bool(req.active),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildDeregisterReviewerTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const reviewerEntryObjectId = assertValidIotaObjectId(req.reviewerEntryObjectId, "reviewer_entry_object_id");
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "deregister_reviewer"),
        arguments: [tx.object(reviewerRegistryObjectId), tx.object(reviewerEntryObjectId)]
    });
    return tx;
}
export function buildClaimReviewerDecisionMetricsTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const reviewerEntryObjectId = assertValidIotaObjectId(req.reviewerEntryObjectId, "reviewer_entry_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "claim_decision_metrics"),
        arguments: [
            tx.object(disputeCaseObjectId),
            tx.object(reviewerRegistryObjectId),
            tx.object(reviewerEntryObjectId),
            tx.object(disputeQuorumConfigObjectId)
        ]
    });
    return tx;
}
export function buildInitOrderDisputeBondTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId ?? "", "governance_config_object_id");
    const orderId = assertCanonicalProtocolString(req.orderId, "order_id", MAX_ORDER_ID_LEN);
    const buyer = assertValidIotaAddress(req.buyer, "buyer");
    const seller = assertValidIotaAddress(req.seller, "seller");
    const requiredReviewerVotes = assertPositiveAmount(req.requiredReviewerVotes, "required_reviewer_votes");
    const requiredReviewerVotesFloor = assertPositiveAmount(req.requiredReviewerVotesFloor, "required_reviewer_votes_floor");
    assertValidReviewerVoteThresholds(req.requiredReviewerVotes, req.requiredReviewerVotesFloor);
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "init_order_dispute_bond"),
        arguments: [
            tx.object(governanceConfigObjectId),
            tx.pure.string(orderId),
            tx.pure.address(buyer),
            tx.pure.address(seller),
            tx.pure.u64(requiredReviewerVotes),
            tx.pure.u64(requiredReviewerVotesFloor),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildInitOrderDisputeBondTypedTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId ?? "", "governance_config_object_id");
    const coinType = assertValidMoveTypeTag(req.coinType, "coin_type");
    const orderId = assertCanonicalProtocolString(req.orderId, "order_id", MAX_ORDER_ID_LEN);
    const buyer = assertValidIotaAddress(req.buyer, "buyer");
    const seller = assertValidIotaAddress(req.seller, "seller");
    const requiredReviewerVotes = assertPositiveAmount(req.requiredReviewerVotes, "required_reviewer_votes");
    const requiredReviewerVotesFloor = assertPositiveAmount(req.requiredReviewerVotesFloor, "required_reviewer_votes_floor");
    assertValidReviewerVoteThresholds(req.requiredReviewerVotes, req.requiredReviewerVotesFloor);
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "init_order_dispute_bond_typed"),
        typeArguments: [coinType],
        arguments: [
            tx.object(governanceConfigObjectId),
            tx.pure.string(orderId),
            tx.pure.address(buyer),
            tx.pure.address(seller),
            tx.pure.u64(requiredReviewerVotes),
            tx.pure.u64(requiredReviewerVotesFloor),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
function buildFundOrderDisputeBondTx(req, fn) {
    const { tx, packageId } = buildBaseTx(req);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId ?? "", "governance_config_object_id");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const amount = BigInt(assertPositiveAmount(req.amount, "amount"));
    assertValidBondAmount(amount, req.bondAmountPolicy);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const paymentSource = req.paymentCoinObjectId
        ? tx.object(assertValidIotaObjectId(req.paymentCoinObjectId, "payment_coin_object_id"))
        : tx.gas;
    const paymentCoin = tx.splitCoins(paymentSource, [tx.pure.u64(amount)]);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, fn),
        arguments: [
            tx.object(governanceConfigObjectId),
            tx.object(bondObjectId),
            tx.object(disputeQuorumConfigObjectId),
            paymentCoin,
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildFundOrderDisputeBondAsBuyerTx(req) {
    return buildFundOrderDisputeBondTx(req, "fund_bond_as_buyer");
}
export function buildFundOrderDisputeBondAsSellerTx(req) {
    return buildFundOrderDisputeBondTx(req, "fund_bond_as_seller");
}
function buildFundOrderDisputeBondTypedTx(req, fn) {
    const { tx, packageId } = buildBaseTx(req);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId ?? "", "governance_config_object_id");
    const coinType = assertValidMoveTypeTag(req.coinType, "coin_type");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const amount = BigInt(assertPositiveAmount(req.amount, "amount"));
    assertValidBondAmount(amount, req.bondAmountPolicy);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    if (!req.paymentCoinObjectId) {
        throw new Error("payment_coin_object_id_required");
    }
    const paymentCoin = tx.splitCoins(tx.object(assertValidIotaObjectId(req.paymentCoinObjectId, "payment_coin_object_id")), [tx.pure.u64(amount)]);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, fn),
        typeArguments: [coinType],
        arguments: [
            tx.object(governanceConfigObjectId),
            tx.object(bondObjectId),
            tx.object(disputeQuorumConfigObjectId),
            paymentCoin,
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildFundOrderDisputeBondTypedAsBuyerTx(req) {
    return buildFundOrderDisputeBondTypedTx(req, "fund_typed_bond_as_buyer");
}
export function buildFundOrderDisputeBondTypedAsSellerTx(req) {
    return buildFundOrderDisputeBondTypedTx(req, "fund_typed_bond_as_seller");
}
export function buildCancelPendingOrderDisputeBondTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "cancel_pending_order_dispute_bond"),
        arguments: [tx.object(bondObjectId)]
    });
    return tx;
}
export function buildCancelPendingOrderDisputeTypedBondTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const coinType = assertValidMoveTypeTag(req.coinType, "coin_type");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "cancel_pending_order_dispute_typed_bond"),
        typeArguments: [coinType],
        arguments: [tx.object(bondObjectId)]
    });
    return tx;
}
export function buildAuthorizeOrderReviewerSelectionTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId ?? "", "governance_config_object_id");
    const selector = assertValidIotaObjectId(req.reviewerSelectorCapObjectId, "reviewer_selector_cap_object_id");
    const cfg = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const registry = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const bond = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const milestoneId = assertCanonicalProtocolString(req.milestoneId, "milestone_id", MAX_MILESTONE_ID_LEN);
    const escrowId = assertValidIotaObjectId(req.escrowObjectId, "escrow_object_id");
    const intendedParty = assertValidIotaAddress(req.intendedParty, "intended_party");
    const reviewers = req.invitedReviewerAddresses.map((value) => assertValidIotaAddress(value, "invited_reviewer_address"));
    const hasInvites = reviewers.length > 0;
    const expiresAtMs = assertPositiveAmount(req.expiresAtMs, "expires_at_ms");
    const clock = validatedClockObjectId(req.clockObjectId);
    const bondCoinType = req.bondCoinType ? assertValidMoveTypeTag(req.bondCoinType, "bond_coin_type") : undefined;
    tx.moveCall({
        target: disputeQuorumTarget(packageId, bondCoinType
            ? hasInvites
                ? "authorize_order_reviewer_selection_typed"
                : "authorize_order_no_invite_reviewer_selection_typed_v2"
            : hasInvites
                ? "authorize_order_reviewer_selection"
                : "authorize_order_no_invite_reviewer_selection_v2"),
        typeArguments: bondCoinType ? [bondCoinType] : undefined,
        arguments: hasInvites
            ? [tx.object(governanceConfigObjectId), tx.object(selector), tx.object(cfg), tx.object(registry), tx.object(bond), tx.pure.string(milestoneId), tx.pure.address(escrowId), tx.pure.address(intendedParty), tx.pure.vector("address", reviewers), tx.pure.u64(expiresAtMs), tx.object(clock)]
            : [tx.object(governanceConfigObjectId), tx.object(selector), tx.object(cfg), tx.object(registry), tx.object(bond), tx.pure.string(milestoneId), tx.pure.address(escrowId), tx.pure.address(intendedParty), tx.pure.u64(expiresAtMs), tx.object(clock)]
    });
    return tx;
}
export function buildAuthorizeReplacementReviewerSelectionTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId ?? "", "governance_config_object_id");
    const reviewers = req.invitedReviewerAddresses.map((value) => assertValidIotaAddress(value, "invited_reviewer_address"));
    const hasInvites = reviewers.length > 0;
    tx.moveCall({
        target: disputeQuorumTarget(packageId, hasInvites
            ? "authorize_replacement_reviewer_selection"
            : "authorize_replacement_no_invite_reviewer_selection_v2"),
        arguments: hasInvites
            ? [
                tx.object(governanceConfigObjectId),
                tx.object(assertValidIotaObjectId(req.reviewerSelectorCapObjectId, "reviewer_selector_cap_object_id")),
                tx.object(assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
                tx.object(assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id")),
                tx.object(assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id")),
                tx.pure.address(assertValidIotaAddress(req.intendedParty, "intended_party")),
                tx.pure.vector("address", reviewers),
                tx.pure.u64(assertPositiveAmount(req.expiresAtMs, "expires_at_ms")),
                tx.object(validatedClockObjectId(req.clockObjectId))
            ]
            : [
                tx.object(governanceConfigObjectId),
                tx.object(assertValidIotaObjectId(req.reviewerSelectorCapObjectId, "reviewer_selector_cap_object_id")),
                tx.object(assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
                tx.object(assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id")),
                tx.object(assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id")),
                tx.pure.address(assertValidIotaAddress(req.intendedParty, "intended_party")),
                tx.pure.u64(assertPositiveAmount(req.expiresAtMs, "expires_at_ms")),
                tx.object(validatedClockObjectId(req.clockObjectId))
            ]
    });
    return tx;
}
export function buildOpenMilestoneDisputeCaseTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const milestoneId = assertCanonicalProtocolString(req.milestoneId, "milestone_id", MAX_MILESTONE_ID_LEN);
    const escrowObjectId = assertValidIotaObjectId(req.escrowObjectId, "escrow_object_id");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const escrowCoinType = assertValidMoveTypeTag(req.escrowCoinType, "escrow_coin_type");
    const bondCoinType = req.bondCoinType === undefined
        ? undefined
        : assertValidMoveTypeTag(req.bondCoinType, "bond_coin_type");
    const governanceConfigObjectId = req.governanceConfigObjectId
        ? assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id")
        : undefined;
    const openDisputeArgMode = assertSupportedOpenDisputeArgMode(req.openDisputeArgMode) ??
        (governanceConfigObjectId ? "guarded_governance_and_clock" : undefined);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const invitedReviewerAddresses = (req.invitedReviewerAddresses ?? []).map((address) => assertValidIotaAddress(address, "invited_reviewer_address"));
    const hasInvites = invitedReviewerAddresses.length > 0;
    if (openDisputeArgMode) {
        if (!governanceConfigObjectId) {
            throw new Error("invalid_governance_config_object_id");
        }
        if (!req.reputationFeeConfigObjectId) {
            throw new Error("invalid_reputation_fee_config_object_id");
        }
        const reputationFeeConfigObjectId = assertValidIotaObjectId(req.reputationFeeConfigObjectId, "reputation_fee_config_object_id");
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
    }
    tx.moveCall({
        target: orderEscrowTarget(packageId, bondCoinType
            ? hasInvites
                ? "open_milestone_dispute_case_entry_with_invites_typed"
                : "open_milestone_dispute_case_entry_typed_v2"
            : hasInvites
                ? "open_milestone_dispute_case_entry_with_invites"
                : "open_milestone_dispute_case_entry_v2"),
        typeArguments: bondCoinType ? [escrowCoinType, bondCoinType] : [escrowCoinType],
        arguments: hasInvites
            ? [
                tx.pure.string(milestoneId),
                tx.pure.vector("address", invitedReviewerAddresses),
                tx.object(escrowObjectId),
                tx.object(disputeQuorumConfigObjectId),
                tx.object(bondObjectId),
                tx.object(clockObjectId)
            ]
            : [
                tx.pure.string(milestoneId),
                tx.object(escrowObjectId),
                tx.object(disputeQuorumConfigObjectId),
                tx.object(bondObjectId),
                tx.object(clockObjectId)
            ]
    });
    return tx;
}
export function buildAcceptDisputeCaseTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const reviewerEntryObjectId = assertValidIotaObjectId(req.reviewerEntryObjectId, "reviewer_entry_object_id");
    const reputationFeeConfigObjectId = assertValidIotaObjectId(req.reputationFeeConfigObjectId, "reputation_fee_config_object_id");
    const reputationProfileObjectId = assertValidIotaObjectId(req.reputationProfileObjectId, "reputation_profile_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "accept_dispute_case_with_reputation_cfg"),
        arguments: [
            tx.object(disputeCaseObjectId),
            tx.object(reviewerRegistryObjectId),
            tx.object(reviewerEntryObjectId),
            tx.object(reputationFeeConfigObjectId),
            tx.object(reputationProfileObjectId),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildCommitDisputeVoteTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const reviewerEntryObjectId = assertValidIotaObjectId(req.reviewerEntryObjectId, "reviewer_entry_object_id");
    const commitHash = assertByteVectorInput(req.commitHash, "commit_hash", COMMIT_HASH_LEN, COMMIT_HASH_LEN);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "commit_vote"),
        arguments: [
            tx.object(disputeCaseObjectId),
            tx.object(reviewerEntryObjectId),
            tx.pure.vector("u8", commitHash),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildRevealDisputeVoteTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const reviewerEntryObjectId = assertValidIotaObjectId(req.reviewerEntryObjectId, "reviewer_entry_object_id");
    const vote = assertU8(req.vote, "vote");
    if (vote !== 0 && vote !== 1) {
        throw new Error("invalid_vote");
    }
    const nonce = assertByteVectorInput(req.nonce, "nonce");
    const evidenceHash = assertByteVectorInput(req.evidenceHash ?? [], "evidence_hash", 0);
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "reveal_vote"),
        arguments: [
            tx.object(disputeCaseObjectId),
            tx.object(reviewerEntryObjectId),
            tx.pure.u8(vote),
            tx.pure.vector("u8", nonce),
            tx.pure.vector("u8", evidenceHash),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildStartReplacementRoundTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const invitedReviewerAddresses = (req.invitedReviewerAddresses ?? []).map((address) => assertValidIotaAddress(address, "invited_reviewer_address"));
    const hasInvites = invitedReviewerAddresses.length > 0;
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    tx.moveCall({
        target: disputeQuorumTarget(packageId, hasInvites ? "start_replacement_round_with_invites_v2" : "start_replacement_round_v2"),
        arguments: hasInvites
            ? [
                tx.object(disputeCaseObjectId),
                tx.object(reviewerRegistryObjectId),
                tx.object(disputeQuorumConfigObjectId),
                tx.pure.vector("address", invitedReviewerAddresses),
                tx.object(clockObjectId)
            ]
            : [
                tx.object(disputeCaseObjectId),
                tx.object(reviewerRegistryObjectId),
                tx.object(disputeQuorumConfigObjectId),
                tx.object(clockObjectId)
            ]
    });
    return tx;
}
export function buildFinalizeDisputeCaseTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "finalize_case_with_quorum"),
        arguments: [
            tx.object(disputeCaseObjectId),
            tx.object(bondObjectId),
            tx.object(reviewerRegistryObjectId),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildResolveDisputeFallbackTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const arbCapObjectId = assertValidIotaObjectId(req.arbCapObjectId, "arb_cap_object_id");
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "resolve_case_with_platform_fallback"),
        arguments: [
            tx.object(arbCapObjectId),
            tx.object(disputeCaseObjectId),
            tx.object(bondObjectId),
            tx.object(reviewerRegistryObjectId),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildResolveDisputeTimeoutFallbackTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "resolve_case_with_timeout_fallback"),
        arguments: [
            tx.object(disputeCaseObjectId),
            tx.object(bondObjectId),
            tx.object(reviewerRegistryObjectId),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
//# sourceMappingURL=disputeQuorum.js.map
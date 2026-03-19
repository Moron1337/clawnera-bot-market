import { Transaction } from "@iota/iota-sdk/transactions";
import { IOTA_CLOCK_OBJECT_ID } from "@iota/iota-sdk/utils";
import { assertByteVectorInput, assertCanonicalProtocolString, assertPositiveAmount, assertValidIotaAddress, assertValidIotaObjectId, assertValidMoveTypeTag } from "../validation.js";
import { buildOpenMilestoneDisputeCaseWithOrderEscrowTx } from "./orderEscrow.js";
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
function assertU8(value, fieldName) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(`invalid_${fieldName}`);
    }
    return value;
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
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const reputationProfileObjectId = assertValidIotaObjectId(req.reputationProfileObjectId, "reputation_profile_object_id");
    const transportType = assertU8(req.transportType, "transport_type");
    const transportPubkey = assertByteVectorInput(req.transportPubkey, "transport_pubkey", MIN_TRANSPORT_PUBKEY_LEN, MAX_TRANSPORT_PUBKEY_LEN);
    const minCaseRewardIota = assertPositiveAmount(req.minCaseRewardIota, "min_case_reward_iota");
    const stakeAmount = assertPositiveAmount(req.stakeAmount, "stake_amount");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const stakeSource = req.paymentCoinObjectId
        ? tx.object(assertValidIotaObjectId(req.paymentCoinObjectId, "payment_coin_object_id"))
        : tx.gas;
    const stakeCoin = tx.splitCoins(stakeSource, [tx.pure.u64(stakeAmount)]);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "register_reviewer_entry"),
        arguments: [
            tx.object(reviewerRegistryObjectId),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(reputationProfileObjectId),
            tx.pure.u8(transportType),
            tx.pure.vector("u8", transportPubkey),
            tx.pure.u64(minCaseRewardIota),
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
    const minCaseRewardIota = assertPositiveAmount(req.minCaseRewardIota, "min_case_reward_iota");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "update_reviewer"),
        arguments: [
            tx.object(reviewerRegistryObjectId),
            tx.object(reviewerEntryObjectId),
            tx.pure.u8(transportType),
            tx.pure.vector("u8", transportPubkey),
            tx.pure.u64(minCaseRewardIota),
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
export function buildInitOrderDisputeBondWithMarketingCampaignTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const orderId = assertCanonicalProtocolString(req.orderId, "order_id", MAX_ORDER_ID_LEN);
    const buyer = assertValidIotaAddress(req.buyer, "buyer");
    const seller = assertValidIotaAddress(req.seller, "seller");
    const marketingCampaignId = assertCanonicalProtocolString(req.marketingCampaignId, "marketing_campaign_id", MAX_ORDER_ID_LEN);
    const requiredReviewerVotes = assertPositiveAmount(req.requiredReviewerVotes, "required_reviewer_votes");
    const requiredReviewerVotesFloor = assertPositiveAmount(req.requiredReviewerVotesFloor, "required_reviewer_votes_floor");
    assertValidReviewerVoteThresholds(req.requiredReviewerVotes, req.requiredReviewerVotesFloor);
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "init_order_dispute_bond_with_marketing_campaign"),
        arguments: [
            tx.pure.string(orderId),
            tx.pure.address(buyer),
            tx.pure.address(seller),
            tx.pure.string(marketingCampaignId),
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
function buildFundOrderDisputeBondWithMarketingCapTx(req, fn) {
    const { tx, packageId } = buildBaseTx(req);
    const marketingFundingCapObjectId = assertValidIotaObjectId(req.marketingFundingCapObjectId, "marketing_funding_cap_object_id");
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
            tx.object(marketingFundingCapObjectId),
            tx.object(bondObjectId),
            tx.object(disputeQuorumConfigObjectId),
            paymentCoin,
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildFundOrderDisputeBondAsBuyerWithMarketingCapTx(req) {
    return buildFundOrderDisputeBondWithMarketingCapTx(req, "fund_bond_as_buyer_with_marketing_cap");
}
export function buildFundOrderDisputeBondAsSellerWithMarketingCapTx(req) {
    return buildFundOrderDisputeBondWithMarketingCapTx(req, "fund_bond_as_seller_with_marketing_cap");
}
export function buildOpenMilestoneDisputeCaseTx(req) {
    const milestoneId = assertCanonicalProtocolString(req.milestoneId, "milestone_id", MAX_MILESTONE_ID_LEN);
    const escrowObjectId = assertValidIotaObjectId(req.escrowObjectId, "escrow_object_id");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const escrowCoinType = assertValidMoveTypeTag(req.escrowCoinType, "escrow_coin_type");
    return buildOpenMilestoneDisputeCaseWithOrderEscrowTx({
        packageId: req.packageId,
        sender: req.sender,
        milestoneId,
        escrowObjectId,
        bondObjectId,
        disputeQuorumConfigObjectId: req.disputeQuorumConfigObjectId,
        governanceConfigObjectId: req.governanceConfigObjectId,
        openDisputeArgMode: req.openDisputeArgMode,
        escrowCoinType,
        invitedReviewerAddresses: req.invitedReviewerAddresses,
        reviewerSelectionReceiptId: req.reviewerSelectionReceiptId,
        clockObjectId: req.clockObjectId
    });
}
export function buildAcceptDisputeCaseTx(req) {
    const { tx, packageId } = buildBaseTx(req);
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const reviewerEntryObjectId = assertValidIotaObjectId(req.reviewerEntryObjectId, "reviewer_entry_object_id");
    const reputationProfileObjectId = assertValidIotaObjectId(req.reputationProfileObjectId, "reputation_profile_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "accept_dispute_case"),
        arguments: [
            tx.object(disputeCaseObjectId),
            tx.object(reviewerRegistryObjectId),
            tx.object(reviewerEntryObjectId),
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
    if (invitedReviewerAddresses.length === 0) {
        throw new Error("invited_reviewer_addresses_required");
    }
    tx.moveCall({
        target: disputeQuorumTarget(packageId, "start_replacement_round_with_invites"),
        arguments: [
            tx.object(disputeCaseObjectId),
            tx.object(reviewerRegistryObjectId),
            tx.pure.vector("address", invitedReviewerAddresses),
            tx.object(clockObjectId)
        ]
    });
    return tx;
}
export function buildFinalizeDisputeCaseTx(req) {
    const { tx, packageId, sender } = buildBaseTx(req);
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const [ticket] = tx.moveCall({
        target: disputeQuorumTarget(packageId, "finalize_case_with_quorum"),
        arguments: [
            tx.object(disputeCaseObjectId),
            tx.object(bondObjectId),
            tx.object(reviewerRegistryObjectId),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    tx.transferObjects([ticket], tx.pure.address(sender));
    return tx;
}
export function buildResolveDisputeFallbackTx(req) {
    const { tx, packageId, sender } = buildBaseTx(req);
    const arbCapObjectId = assertValidIotaObjectId(req.arbCapObjectId, "arb_cap_object_id");
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const [ticket] = tx.moveCall({
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
    tx.transferObjects([ticket], tx.pure.address(sender));
    return tx;
}
export function buildResolveDisputeTimeoutFallbackTx(req) {
    const { tx, packageId, sender } = buildBaseTx(req);
    const disputeCaseObjectId = assertValidIotaObjectId(req.disputeCaseObjectId, "dispute_case_object_id");
    const bondObjectId = assertValidIotaObjectId(req.bondObjectId, "bond_object_id");
    const reviewerRegistryObjectId = assertValidIotaObjectId(req.reviewerRegistryObjectId, "reviewer_registry_object_id");
    const disputeQuorumConfigObjectId = assertValidIotaObjectId(req.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id");
    const clockObjectId = validatedClockObjectId(req.clockObjectId);
    const [ticket] = tx.moveCall({
        target: disputeQuorumTarget(packageId, "resolve_case_with_timeout_fallback"),
        arguments: [
            tx.object(disputeCaseObjectId),
            tx.object(bondObjectId),
            tx.object(reviewerRegistryObjectId),
            tx.object(disputeQuorumConfigObjectId),
            tx.object(clockObjectId)
        ]
    });
    tx.transferObjects([ticket], tx.pure.address(sender));
    return tx;
}
//# sourceMappingURL=disputeQuorum.js.map

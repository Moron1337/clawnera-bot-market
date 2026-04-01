import { IotaClient } from "@iota/iota-sdk/client";
import {
  buildIotaTransactionBytes,
  dryRunIotaTransfer,
  executeIotaTransfer,
  resolveIotaRpcUrl,
} from "./iota-local.mjs";
import {
  buildAcceptDisputeCaseTx,
  buildClaimReviewerDecisionMetricsTx,
  buildCommitDisputeVoteTx,
  buildDeregisterReviewerTx,
  buildFinalizeDisputeCaseTx,
  buildFundOrderDisputeBondAsBuyerTx,
  buildFundOrderDisputeBondAsBuyerWithMarketingCapTx,
  buildFundOrderDisputeBondAsSellerTx,
  buildFundOrderDisputeBondAsSellerWithMarketingCapTx,
  buildInitOrderDisputeBondTx,
  buildInitOrderDisputeBondWithMarketingCampaignTx,
  buildOpenMilestoneDisputeCaseTx,
  buildRegisterReviewerTx,
  buildResolveDisputeFallbackTx,
  buildResolveDisputeTimeoutFallbackTx,
  buildRevealDisputeVoteTx,
  buildStartReplacementRoundTx,
  buildUpdateReviewerTx,
} from "./vendor/clawdex-sdk/tx/disputeQuorum.js";
import { buildCreateReputationProfileIotaTx } from "./vendor/clawdex-sdk/tx/reputation.js";
import {
  buildAckOrderMailboxSignalTx,
  buildCloseOrderMailboxTx,
  buildInitOrderMailboxTx,
  buildPostOrderMailboxSignalIntentTx,
} from "./vendor/clawdex-sdk/tx/orderMailbox.js";
import {
  buildClaimAfterDeadlineOrderEscrowTx,
  buildClaimAfterDeadlineWithBondTx,
  buildCreateOrderEscrowClawTx,
  buildCreateOrderEscrowIotaTx,
  buildOpenOrderEscrowDisputeTx,
  buildReleaseOrderEscrowTx,
  buildReleaseOrderEscrowWithBondTx,
  buildReleaseUnusedDisputeBondAfterReleaseTx,
  buildResolveOrderEscrowWithBindingTx,
  buildResolveOrderEscrowWithQuorumTicketTx,
} from "./vendor/clawdex-sdk/tx/orderEscrow.js";
import {
  buildMilestoneManifestAnchorTx,
  buildPayManagedStorageFeeIotaTx,
} from "./vendor/clawdex-sdk/tx/manifestAnchor.js";
import {
  buildCreateListingDepositIotaSharedTx,
  buildCreateListingDepositIotaTx,
} from "./vendor/clawdex-sdk/tx/listingDeposit.js";

export const DEFAULT_ORDER_ESCROW_DEADLINE_DELTA_MS = 172_800_000n;
export const DEFAULT_ONCHAIN_EXECUTE_OPTIONS = Object.freeze({
  showEffects: true,
  showObjectChanges: true,
  showEvents: true,
  showBalanceChanges: true,
  showInput: false,
  showRawInput: false,
  showRawEffects: false,
});
const REPUTATION_PROFILE_TYPE_SUFFIX = "::reputation::ReputationProfile";
const DISPUTE_QUORUM_CONFIG_TYPE_SUFFIX = "::dispute_quorum::DisputeQuorumConfig";
const REPUTATION_FEE_CONFIG_TYPE_SUFFIX = "::reputation::ReputationFeeConfig";

function normalizeObjectId(value) {
  return typeof value === "string" && /^0x[a-f0-9]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : "";
}

function normalizeMoveEventType(packageId, moduleName, eventName) {
  return `${normalizeObjectId(packageId)}::${moduleName}::${eventName}`;
}

function getParsedJsonField(event, fieldName) {
  const parsedJson = event && typeof event === "object" ? event.parsedJson : null;
  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    return "";
  }
  const value = parsedJson[fieldName];
  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveBigIntField(fields, fieldName, fallbackValue) {
  const value = fields?.[fieldName];
  if (typeof value === "bigint") {
    return value > 0n ? value : fallbackValue;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    const parsed = BigInt(value.trim());
    return parsed > 0n ? parsed : fallbackValue;
  }
  return fallbackValue;
}

function normalizePositiveBigIntValue(value) {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return value;
}

function normalizeU8Value(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return value;
}

function normalizeHexBytes(value) {
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return [...value];
  }
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().replace(/^0x/i, "").toLowerCase();
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
    return value;
  }
  const bytes = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

function normalizeBondAmountPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return policy;
  }
  return {
    ...policy,
    minAmount: normalizePositiveBigIntValue(policy.minAmount),
    maxAmount: normalizePositiveBigIntValue(policy.maxAmount),
  };
}

function normalizeClawdexPlanRequest(txBuilder, request, inviteBinding) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return request;
  }
  const normalized = { ...request };
  const inviteBindingRecord =
    inviteBinding && typeof inviteBinding === "object" && !Array.isArray(inviteBinding) ? inviteBinding : null;
  const postExecuteBindingRequired =
    inviteBindingRecord?.postExecuteBindingRequired === true ||
    inviteBindingRecord?.mode === "selection_receipt_activation";

  switch (txBuilder) {
    case "disputeQuorum.openMilestoneDisputeCase":
    case "disputeQuorum.startReplacementRound":
      if (
        !postExecuteBindingRequired &&
        (!Array.isArray(normalized.invitedReviewerAddresses) || normalized.invitedReviewerAddresses.length === 0) &&
        inviteBindingRecord &&
        Array.isArray(inviteBindingRecord.invitedReviewerAddresses) &&
        inviteBindingRecord.invitedReviewerAddresses.length > 0
      ) {
        normalized.invitedReviewerAddresses = [...inviteBindingRecord.invitedReviewerAddresses];
      }
      if (
        !normalized.reviewerSelectionReceiptId &&
        inviteBindingRecord &&
        typeof inviteBindingRecord.reviewerSelectionReceiptId === "string" &&
        inviteBindingRecord.reviewerSelectionReceiptId.trim()
      ) {
        normalized.reviewerSelectionReceiptId = inviteBindingRecord.reviewerSelectionReceiptId.trim();
      }
      return normalized;
    case "disputeQuorum.registerReviewer":
      normalized.minCaseRewardIota = normalizePositiveBigIntValue(request.minCaseRewardIota);
      normalized.stakeAmount = normalizePositiveBigIntValue(request.stakeAmount);
      normalized.transportType = normalizeU8Value(request.transportType);
      normalized.transportPubkey = normalizeHexBytes(request.transportPubkey ?? request.transportPubkeyHex);
      delete normalized.transportPubkeyHex;
      return normalized;
    case "disputeQuorum.updateReviewer":
      normalized.minCaseRewardIota = normalizePositiveBigIntValue(request.minCaseRewardIota);
      normalized.transportType = normalizeU8Value(request.transportType);
      normalized.transportPubkey = normalizeHexBytes(request.transportPubkey ?? request.transportPubkeyHex);
      delete normalized.transportPubkeyHex;
      return normalized;
    case "disputeQuorum.fundBondAsBuyer":
    case "disputeQuorum.fundBondAsSeller":
    case "disputeQuorum.fundBondAsBuyerWithMarketingCap":
    case "disputeQuorum.fundBondAsSellerWithMarketingCap":
      normalized.amount = normalizePositiveBigIntValue(request.amount);
      normalized.bondAmountPolicy = normalizeBondAmountPolicy(request.bondAmountPolicy);
      return normalized;
    case "disputeQuorum.revealVote":
      normalized.vote = normalizeU8Value(request.vote);
      return normalized;
    default:
      return normalized;
  }
}

function createClient(options = {}) {
  const { rpcUrl } = resolveIotaRpcUrl(options);
  return new IotaClient({ url: rpcUrl });
}

async function callIotaRpc(options = {}, body) {
  const { rpcUrl } = resolveIotaRpcUrl(options);
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`iota_rpc_http_${response.status}`);
  }
  return await response.json();
}

function normalizeOwnedObjectId(value) {
  return typeof value === "string" && /^0x[a-f0-9]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : "";
}

function parsePackageIdFromObjectType(value, expectedSuffix) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || !normalized.endsWith(expectedSuffix.toLowerCase())) {
    return "";
  }
  return normalizeObjectId(normalized.slice(0, -expectedSuffix.length));
}

async function getLatestMoveEvent(client, options, eventType, fieldName, errorCode) {
  let firstEvent = null;
  try {
    const payload = await callIotaRpc(options, {
      jsonrpc: "2.0",
      id: `event-${fieldName}`,
      method: "iotax_queryEvents",
      params: [{ MoveEventType: eventType }, null, 1, true],
    });
    firstEvent = Array.isArray(payload?.result?.data) ? payload.result.data[0] : null;
  } catch {
    const events = await client.queryEvents({
      query: { MoveEventType: eventType },
      limit: 1,
      order: "descending",
    });
    firstEvent = Array.isArray(events?.data) ? events.data[0] : null;
  }
  const objectId = normalizeObjectId(getParsedJsonField(firstEvent, fieldName));
  const txDigest =
    typeof firstEvent?.id?.txDigest === "string" && firstEvent.id.txDigest.trim() ? firstEvent.id.txDigest.trim() : "";
  if (!objectId) {
    throw new Error(errorCode);
  }
  return {
    objectId,
    txDigest,
  };
}

async function maybeGetLatestMoveEvent(client, options, required, eventType, fieldName, errorCode) {
  if (!required) {
    return {
      objectId: "",
      txDigest: "",
    };
  }
  return await getLatestMoveEvent(client, options, eventType, fieldName, errorCode);
}

export async function resolveClawdexChainConfig(options = {}) {
  const packageId = normalizeObjectId(options.packageId);
  if (!packageId) {
    throw new Error("invalid_package_id");
  }
  const explicitDisputeQuorumConfigObjectId = normalizeObjectId(options.disputeQuorumConfigObjectId);
  const explicitEscrowFeeConfigObjectId = normalizeObjectId(options.escrowFeeConfigObjectId);
  const explicitGovernanceConfigObjectId = normalizeObjectId(options.governanceConfigObjectId);
  const explicitReviewerRegistryObjectId = normalizeObjectId(options.reviewerRegistryObjectId);
  const requireDisputeQuorumConfig = options.requireDisputeQuorumConfig !== false;
  const requireEscrowFeeConfig = options.requireEscrowFeeConfig !== false;
  const requireGovernanceConfig = options.requireGovernanceConfig !== false;

  const client = createClient(options);
  const disputeQuorumConfig = explicitDisputeQuorumConfigObjectId
    ? {
        objectId: explicitDisputeQuorumConfigObjectId,
        txDigest: "",
      }
    : await maybeGetLatestMoveEvent(
        client,
        options,
        requireDisputeQuorumConfig,
        normalizeMoveEventType(packageId, "dispute_quorum", "DisputeQuorumConfigInitialized"),
        "config_id",
        "dispute_quorum_config_not_found",
      );
  const escrowFeeConfig = explicitEscrowFeeConfigObjectId
    ? {
        objectId: explicitEscrowFeeConfigObjectId,
        txDigest: "",
      }
    : await maybeGetLatestMoveEvent(
        client,
        options,
        requireEscrowFeeConfig,
        normalizeMoveEventType(packageId, "escrow", "FeeConfigInitialized"),
        "config_id",
        "escrow_fee_config_not_found",
      );
  const governanceConfig = explicitGovernanceConfigObjectId
    ? {
        objectId: explicitGovernanceConfigObjectId,
        txDigest: "",
      }
    : await maybeGetLatestMoveEvent(
        client,
        options,
        requireGovernanceConfig,
        normalizeMoveEventType(packageId, "admin", "GovernanceConfigInitialized"),
        "config_id",
        "governance_config_not_found",
      );

  const disputeQuorumConfigObjectId = disputeQuorumConfig.objectId;
  const escrowFeeConfigObjectId = escrowFeeConfig.objectId;
  const governanceConfigObjectId = governanceConfig.objectId;

  let disputeQuorumConfigObject = null;
  if (disputeQuorumConfigObjectId) {
    disputeQuorumConfigObject = await client.getObject({
      id: disputeQuorumConfigObjectId,
      options: { showContent: true, showPreviousTransaction: true },
    });
  }
  const dqFields = disputeQuorumConfigObject?.data?.content?.fields;
  const defaultRequiredReviewerVotes = parsePositiveBigIntField(dqFields, "default_required_reviewer_votes", 3n);
  const minRequiredReviewerVotes = parsePositiveBigIntField(dqFields, "min_required_reviewer_votes", 3n);
  const maxRequiredReviewerVotes = parsePositiveBigIntField(
    dqFields,
    "max_required_reviewer_votes",
    defaultRequiredReviewerVotes
  );
  const minDisputeBondPerSideIota = parsePositiveBigIntField(dqFields, "min_dispute_bond_per_side_iota", 500_000n);
  const maxDisputeBondPerSideIota = parsePositiveBigIntField(
    dqFields,
    "max_dispute_bond_per_side_iota",
    minDisputeBondPerSideIota
  );
  const reviewerMinStakeIota = parsePositiveBigIntField(dqFields, "reviewer_min_stake_iota", 500_000n);
  let reviewerRegistryObjectId = explicitReviewerRegistryObjectId || "";
  const disputeQuorumInitTxDigest =
    disputeQuorumConfig.txDigest ||
    (typeof disputeQuorumConfigObject?.data?.previousTransaction === "string"
      ? disputeQuorumConfigObject.data.previousTransaction.trim()
      : "");
  if (!reviewerRegistryObjectId && disputeQuorumInitTxDigest) {
    const initTx = await client.getTransactionBlock({
      digest: disputeQuorumInitTxDigest,
      options: { showObjectChanges: true },
    });
    const objectChanges = Array.isArray(initTx?.objectChanges) ? initTx.objectChanges : [];
    const expectedType = `${packageId}::dispute_quorum::ReviewerRegistry`;
    const reviewerRegistryChange = objectChanges.find((change) => {
      const objectType = typeof change?.objectType === "string" ? change.objectType.trim().toLowerCase() : "";
      const changeObjectId = normalizeObjectId(change?.objectId || "");
      return objectType === expectedType.toLowerCase() && changeObjectId;
    });
    reviewerRegistryObjectId = normalizeObjectId(reviewerRegistryChange?.objectId || "");
  }

  return {
    packageId,
    governanceConfigObjectId,
    disputeQuorumConfigObjectId,
    escrowFeeConfigObjectId,
    reviewerRegistryObjectId,
    defaultRequiredReviewerVotes,
    minRequiredReviewerVotes,
    maxRequiredReviewerVotes,
    minDisputeBondPerSideIota,
    maxDisputeBondPerSideIota,
    reviewerMinStakeIota,
  };
}

export async function resolveClawdexReputationProfileObjectIdByOwner(options = {}) {
  const packageId = normalizeObjectId(options.packageId);
  const ownerAddress = normalizeObjectId(options.ownerAddress);
  if (!packageId) {
    throw new Error("invalid_package_id");
  }
  if (!ownerAddress) {
    throw new Error("invalid_owner_address");
  }
  let effectivePackageId = packageId;
  const lineageHintObjectId =
    normalizeObjectId(options.disputeQuorumConfigObjectId) || normalizeObjectId(options.reputationInitFeeConfigObjectId);
  if (lineageHintObjectId) {
    const client = createClient(options);
    const hintedObject = await client.getObject({
      id: lineageHintObjectId,
      options: { showType: true },
    });
    const hintedType = typeof hintedObject?.data?.type === "string" ? hintedObject.data.type : "";
    effectivePackageId =
      parsePackageIdFromObjectType(hintedType, DISPUTE_QUORUM_CONFIG_TYPE_SUFFIX) ||
      parsePackageIdFromObjectType(hintedType, REPUTATION_FEE_CONFIG_TYPE_SUFFIX) ||
      effectivePackageId;
  }
  const payload = await callIotaRpc(options, {
    jsonrpc: "2.0",
    id: `reputation-owned-${ownerAddress}`,
    method: "iotax_getOwnedObjects",
    params: [
      ownerAddress,
      {
        filter: {
          StructType: `${effectivePackageId}${REPUTATION_PROFILE_TYPE_SUFFIX}`,
        },
        options: {
          showType: true,
        },
        limit: 2,
      },
    ],
  });
  const data = Array.isArray(payload?.result?.data) ? payload.result.data : [];
  if (data.length === 0) {
    throw new Error("reputation_profile_not_found");
  }
  if (data.length > 1) {
    throw new Error("ambiguous_reputation_profile_owner");
  }
  const first = data[0] && typeof data[0] === "object" ? data[0] : null;
  const objectId = normalizeOwnedObjectId(first?.data?.objectId || first?.objectId || "");
  if (!objectId) {
    throw new Error("reputation_profile_not_found");
  }
  return objectId;
}

export function buildClawdexTxFromPlan(plan) {
  const txBuilder = typeof plan?.txBuilder === "string" ? plan.txBuilder.trim() : "";
  const request = normalizeClawdexPlanRequest(txBuilder, plan?.request, plan?.inviteBinding);
  if (!txBuilder || !request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("invalid_tx_plan");
  }

  switch (txBuilder) {
    case "orderMailbox.init":
      return buildInitOrderMailboxTx(request);
    case "orderMailbox.postSignal":
      return buildPostOrderMailboxSignalIntentTx(request);
    case "orderMailbox.ackSignal":
      return buildAckOrderMailboxSignalTx(request);
    case "orderMailbox.close":
      return buildCloseOrderMailboxTx(request);
    case "disputeQuorum.registerReviewer":
      return buildRegisterReviewerTx(request);
    case "disputeQuorum.updateReviewer":
      return buildUpdateReviewerTx(request);
    case "disputeQuorum.deregisterReviewer":
      return buildDeregisterReviewerTx(request);
    case "disputeQuorum.claimReviewerDecisionMetrics":
      return buildClaimReviewerDecisionMetricsTx(request);
    case "disputeQuorum.fundBondAsBuyer":
      return buildFundOrderDisputeBondAsBuyerTx(request);
    case "disputeQuorum.fundBondAsSeller":
      return buildFundOrderDisputeBondAsSellerTx(request);
    case "disputeQuorum.fundBondAsBuyerWithMarketingCap":
      return buildFundOrderDisputeBondAsBuyerWithMarketingCapTx(request);
    case "disputeQuorum.fundBondAsSellerWithMarketingCap":
      return buildFundOrderDisputeBondAsSellerWithMarketingCapTx(request);
    case "disputeQuorum.openMilestoneDisputeCase":
      return buildOpenMilestoneDisputeCaseTx(request);
    case "disputeQuorum.acceptDisputeCase":
      return buildAcceptDisputeCaseTx(request);
    case "disputeQuorum.commitVote":
      return buildCommitDisputeVoteTx(request);
    case "disputeQuorum.revealVote":
      return buildRevealDisputeVoteTx(request);
    case "disputeQuorum.startReplacementRound":
      return buildStartReplacementRoundTx(request);
    case "disputeQuorum.finalizeCase":
      return buildFinalizeDisputeCaseTx(request);
    case "disputeQuorum.resolveFallback":
      return buildResolveDisputeFallbackTx(request);
    case "disputeQuorum.resolveTimeoutFallback":
      return buildResolveDisputeTimeoutFallbackTx(request);
    case "orderEscrow.resolveDisputeWithBinding":
      return buildResolveOrderEscrowWithBindingTx(request);
    case "orderEscrow.resolveDisputeWithQuorumTicket":
      return buildResolveOrderEscrowWithQuorumTicketTx(request);
    case "orderEscrow.release":
      return buildReleaseOrderEscrowTx(request);
    case "orderEscrow.releaseWithDisputeBond":
      return buildReleaseOrderEscrowWithBondTx(request);
    case "orderEscrow.claimAfterDeadline":
      return buildClaimAfterDeadlineOrderEscrowTx(request);
    case "orderEscrow.claimAfterDeadlineWithDisputeBond":
      return buildClaimAfterDeadlineWithBondTx(request);
    case "orderEscrow.releaseUnusedDisputeBondAfterRelease":
      return buildReleaseUnusedDisputeBondAfterReleaseTx(request);
    case "orderEscrow.openDispute":
      return buildOpenOrderEscrowDisputeTx(request);
    default:
      throw new Error(`unsupported_tx_builder:${txBuilder}`);
  }
}

export function buildInitOrderBondTx(request) {
  if (request?.marketingCampaignId) {
    return buildInitOrderDisputeBondWithMarketingCampaignTx(request);
  }
  return buildInitOrderDisputeBondTx(request);
}

export function buildCreateReputationProfileTx(request) {
  return buildCreateReputationProfileIotaTx(request);
}

export function buildCreateListingDepositTx(request) {
  if (request?.shared === true) {
    return buildCreateListingDepositIotaSharedTx(request);
  }
  return buildCreateListingDepositIotaTx(request);
}

export function buildCreateOrderEscrowTx(request) {
  if (request?.currency === "IOTA") {
    return buildCreateOrderEscrowIotaTx(request);
  }
  if (request?.currency === "CLAW") {
    return buildCreateOrderEscrowClawTx(request);
  }
  throw new Error("unsupported_order_currency");
}

export function buildMilestoneAnchorTx(request) {
  return buildMilestoneManifestAnchorTx(request);
}

export function buildManagedStorageFeeTx(request) {
  return buildPayManagedStorageFeeIotaTx(request);
}

export async function dryRunTransaction(transaction, options = {}) {
  const built = await buildIotaTransactionBytes({ ...options, transaction });
  const result = await dryRunIotaTransfer({ ...options, txBytesB64: built.txBytesB64 });
  return {
    ...built,
    result,
  };
}

export async function executeTransaction(transaction, options = {}) {
  const built = await buildIotaTransactionBytes({ ...options, transaction });
  const execution = await executeIotaTransfer({
    ...options,
    txBytesB64: built.txBytesB64,
    executeOptions: options.executeOptions || DEFAULT_ONCHAIN_EXECUTE_OPTIONS,
  });
  assertExecutionSuccess(execution, "transaction_execution_failed");
  return {
    ...built,
    ...execution,
  };
}

export function getExecutionFailure(executionResult) {
  const status =
    executionResult?.result?.effects?.status ??
    executionResult?.effects?.status ??
    executionResult?.result?.status ??
    executionResult?.status ??
    null;
  if (!status || typeof status !== "object") {
    return "";
  }
  const normalizedStatus = typeof status.status === "string" ? status.status.trim().toLowerCase() : "";
  if (normalizedStatus !== "failure") {
    return "";
  }
  return typeof status.error === "string" && status.error.trim() ? status.error.trim() : "execution_failed";
}

export function assertExecutionSuccess(executionResult, prefix = "execution_failed") {
  const failure = getExecutionFailure(executionResult);
  if (!failure) {
    return;
  }
  const label = typeof prefix === "string" && prefix.trim() ? prefix.trim() : "execution_failed";
  throw new Error(`${label}:${failure}`);
}

export function extractCreatedObjects(executionResult) {
  const objectChanges = Array.isArray(executionResult?.result?.objectChanges)
    ? executionResult.result.objectChanges
    : Array.isArray(executionResult?.objectChanges)
      ? executionResult.objectChanges
      : [];
  return objectChanges
    .filter((change) => change && typeof change === "object" && change.type === "created" && normalizeObjectId(change.objectId))
    .map((change) => ({
      objectId: normalizeObjectId(change.objectId),
      objectType: typeof change.objectType === "string" ? change.objectType : "",
      owner: change.owner ?? null,
    }));
}

export function extractCreatedObjectIdByTypeSuffix(executionResult, typeSuffix) {
  const suffix = typeof typeSuffix === "string" ? typeSuffix.trim() : "";
  if (!suffix) {
    return "";
  }
  const normalizedSuffix = suffix.toLowerCase();
  const created = extractCreatedObjects(executionResult);
  const match = created.find((entry) => entry.objectType.toLowerCase().endsWith(normalizedSuffix));
  return match?.objectId || "";
}

export function extractCreatedObjectIdByTypeFragment(executionResult, fragment) {
  const needle = typeof fragment === "string" ? fragment.trim().toLowerCase() : "";
  if (!needle) {
    return "";
  }
  const created = extractCreatedObjects(executionResult);
  const match = created.find((entry) => entry.objectType.toLowerCase().includes(needle));
  return match?.objectId || "";
}

export function extractEvents(executionResult) {
  if (Array.isArray(executionResult?.result?.events)) {
    return executionResult.result.events;
  }
  if (Array.isArray(executionResult?.events)) {
    return executionResult.events;
  }
  return [];
}

export function extractLatestEventByTypeSuffix(executionResult, typeSuffix) {
  const suffix = typeof typeSuffix === "string" ? typeSuffix.trim().toLowerCase() : "";
  if (!suffix) {
    return null;
  }
  const events = extractEvents(executionResult);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || typeof event !== "object") {
      continue;
    }
    const eventType = typeof event.type === "string" ? event.type.trim().toLowerCase() : "";
    if (eventType.endsWith(suffix)) {
      return event;
    }
  }
  return null;
}

function getParsedJsonValue(event, fieldName) {
  const parsedJson = event?.parsedJson;
  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    return null;
  }
  return parsedJson[fieldName] ?? null;
}

function normalizeNumberishString(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function normalizeStringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mailboxSignalIntentFromCode(value) {
  const code = normalizeNumberishString(value);
  switch (code) {
    case "0":
      return "MSG";
    case "1":
      return "CHECKPOINT";
    case "2":
      return "OTHER";
    default:
      return null;
  }
}

function mailboxRoleFromCode(value) {
  const code = normalizeNumberishString(value);
  switch (code) {
    case "0":
      return "buyer";
    case "1":
      return "seller";
    default:
      return null;
  }
}

export function extractMailboxSignalPosted(executionResult) {
  const event = extractLatestEventByTypeSuffix(executionResult, "::order_mailbox::SignalPosted");
  if (!event) {
    return null;
  }
  return {
    mailboxObjectId: normalizeObjectId(getParsedJsonValue(event, "mailbox_id")),
    orderId: normalizeStringValue(getParsedJsonValue(event, "order_id")),
    seq: normalizeNumberishString(getParsedJsonValue(event, "seq")),
    signalTypeCode: normalizeNumberishString(getParsedJsonValue(event, "signal_type")),
    signalIntent: mailboxSignalIntentFromCode(getParsedJsonValue(event, "signal_type")),
    sender: normalizeObjectId(getParsedJsonValue(event, "sender")),
    senderRoleCode: normalizeNumberishString(getParsedJsonValue(event, "sender_role")),
    senderRole: mailboxRoleFromCode(getParsedJsonValue(event, "sender_role")),
    ciphertextHash: normalizeStringValue(getParsedJsonValue(event, "ciphertext_hash")),
    payloadRef: normalizeStringValue(getParsedJsonValue(event, "payload_ref")),
    createdAtMs: normalizeNumberishString(getParsedJsonValue(event, "created_at_ms")),
    txDigest: normalizeStringValue(event?.id?.txDigest),
  };
}

export function extractMailboxSignalAcked(executionResult) {
  const event = extractLatestEventByTypeSuffix(executionResult, "::order_mailbox::SignalAcked");
  if (!event) {
    return null;
  }
  return {
    mailboxObjectId: normalizeObjectId(getParsedJsonValue(event, "mailbox_id")),
    orderId: normalizeStringValue(getParsedJsonValue(event, "order_id")),
    ackedSeq: normalizeNumberishString(getParsedJsonValue(event, "acked_seq")),
    acker: normalizeObjectId(getParsedJsonValue(event, "acker")),
    ackerRoleCode: normalizeNumberishString(getParsedJsonValue(event, "acker_role")),
    ackerRole: mailboxRoleFromCode(getParsedJsonValue(event, "acker_role")),
    ackedAtMs: normalizeNumberishString(getParsedJsonValue(event, "acked_at_ms")),
    txDigest: normalizeStringValue(event?.id?.txDigest),
  };
}

function normalizeMailboxEventCursor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const txDigest = normalizeStringValue(value.txDigest);
  const eventSeq = normalizeNumberishString(value.eventSeq);
  if (!txDigest || !eventSeq) {
    return null;
  }
  return { txDigest, eventSeq };
}

function mailboxEventCreatedAtIso(timestampMs) {
  if (!timestampMs || !/^[0-9]+$/.test(String(timestampMs))) {
    return null;
  }
  const parsed = Number.parseInt(String(timestampMs), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function normalizeMailboxPostedFeedItem(event) {
  const parsed = extractMailboxSignalPosted({ events: [event] });
  if (!parsed?.mailboxObjectId || !parsed?.orderId || !parsed?.seq || !parsed?.txDigest) {
    return null;
  }
  const eventSeq = normalizeNumberishString(event?.id?.eventSeq) || "0";
  return {
    id: `mailbox.signal_posted:${parsed.txDigest}:${eventSeq}`,
    eventType: "mailbox.signal_posted",
    entityType: "mailbox",
    entityId: parsed.mailboxObjectId,
    createdAt: mailboxEventCreatedAtIso(parsed.createdAtMs),
    payloadJson: {
      orderId: parsed.orderId,
      mailboxObjectId: parsed.mailboxObjectId,
      seq: parsed.seq,
      sender: parsed.sender,
      senderRole: parsed.senderRole,
      signalIntent: parsed.signalIntent,
      payloadRef: parsed.payloadRef,
      ciphertextHash: parsed.ciphertextHash,
      txDigest: parsed.txDigest,
      chainCreatedAtMs: parsed.createdAtMs,
      eventSeq,
    },
  };
}

function normalizeMailboxAckedFeedItem(event) {
  const parsed = extractMailboxSignalAcked({ events: [event] });
  if (!parsed?.mailboxObjectId || !parsed?.orderId || !parsed?.ackedSeq || !parsed?.txDigest) {
    return null;
  }
  const eventSeq = normalizeNumberishString(event?.id?.eventSeq) || "0";
  return {
    id: `mailbox.signal_acked:${parsed.txDigest}:${eventSeq}`,
    eventType: "mailbox.signal_acked",
    entityType: "mailbox",
    entityId: parsed.mailboxObjectId,
    createdAt: mailboxEventCreatedAtIso(parsed.ackedAtMs),
    payloadJson: {
      orderId: parsed.orderId,
      mailboxObjectId: parsed.mailboxObjectId,
      ackedSeq: parsed.ackedSeq,
      acker: parsed.acker,
      ackerRole: parsed.ackerRole,
      txDigest: parsed.txDigest,
      chainAckedAtMs: parsed.ackedAtMs,
      eventSeq,
    },
  };
}

async function queryMailboxEventsPage(client, options, eventType, cursor, limit) {
  try {
    const payload = await callIotaRpc(options, {
      jsonrpc: "2.0",
      id: `mailbox-events-${eventType}-${cursor?.txDigest || "start"}-${cursor?.eventSeq || "0"}`,
      method: "iotax_queryEvents",
      params: [{ MoveEventType: eventType }, cursor, limit, true],
    });
    return {
      data: Array.isArray(payload?.result?.data) ? payload.result.data : [],
      hasNextPage: payload?.result?.hasNextPage === true,
      nextCursor: normalizeMailboxEventCursor(payload?.result?.nextCursor),
    };
  } catch {
    const page = await client.queryEvents({
      query: { MoveEventType: eventType },
      cursor: cursor || undefined,
      limit,
      order: "descending",
    });
    return {
      data: Array.isArray(page?.data) ? page.data : [],
      hasNextPage: page?.hasNextPage === true,
      nextCursor: normalizeMailboxEventCursor(page?.nextCursor),
    };
  }
}

async function collectMailboxFeedItemsForEventType({
  client,
  options,
  eventType,
  orderId,
  mailboxObjectId,
  limit,
  normalizeEvent,
}) {
  const collected = [];
  const pageLimit = Math.max(10, Math.min(Math.max(limit, 10), 50));
  let cursor = null;
  for (let pageIndex = 0; pageIndex < 20 && collected.length < limit; pageIndex += 1) {
    const page = await queryMailboxEventsPage(client, options, eventType, cursor, pageLimit);
    for (const event of page.data) {
      const normalized = normalizeEvent(event);
      if (!normalized) {
        continue;
      }
      const payload = normalized.payloadJson || {};
      if (payload.orderId !== orderId || payload.mailboxObjectId !== mailboxObjectId) {
        continue;
      }
      collected.push(normalized);
      if (collected.length >= limit) {
        break;
      }
    }
    if (!page.hasNextPage || !page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  return collected;
}

export async function listMailboxEventFeedItems(options = {}) {
  const packageId = normalizeObjectId(options.packageId);
  const orderId = normalizeStringValue(options.orderId);
  const mailboxObjectId = normalizeObjectId(options.mailboxObjectId);
  const limit = Number.isSafeInteger(options.limit) ? Math.max(1, options.limit) : 20;
  const includeAcked = options.includeAcked !== false;
  if (!packageId || !orderId || !mailboxObjectId) {
    throw new Error("mailbox_event_feed_invalid_input");
  }

  const client = createClient(options);
  const postedItems = await collectMailboxFeedItemsForEventType({
    client,
    options,
    eventType: normalizeMoveEventType(packageId, "order_mailbox", "SignalPosted"),
    orderId,
    mailboxObjectId,
    limit,
    normalizeEvent: normalizeMailboxPostedFeedItem,
  });
  const ackedItems = includeAcked
    ? await collectMailboxFeedItemsForEventType({
        client,
        options,
        eventType: normalizeMoveEventType(packageId, "order_mailbox", "SignalAcked"),
        orderId,
        mailboxObjectId,
        limit,
        normalizeEvent: normalizeMailboxAckedFeedItem,
      })
    : [];
  return postedItems.concat(ackedItems);
}

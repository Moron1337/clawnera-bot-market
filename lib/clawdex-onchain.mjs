import { IotaClient } from "@iota/iota-sdk/client";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import {
  SUI_CLOCK_OBJECT_ID,
  isValidSuiAddress,
  isValidSuiObjectId,
  normalizeSuiAddress,
  normalizeSuiObjectId,
} from "@mysten/sui/utils";
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
  buildFundOrderDisputeBondAsSellerTx,
  buildFundOrderDisputeBondTypedAsBuyerTx,
  buildFundOrderDisputeBondTypedAsSellerTx,
  buildInitOrderDisputeBondTx,
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
const ORDER_MAILBOX_TYPE_SUFFIX = "::order_mailbox::OrderMailbox";
const SUI_NATIVE_SYMBOL = "SUI";
const SUI_USDC_SYMBOL = "USDC";
const SUI_NATIVE_COIN_TYPE = `0x${"0".repeat(63)}2::sui::SUI`;
const SUI_USDC_TESTNET_COIN_TYPE = "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";
const SUI_USDC_MAINNET_COIN_TYPE = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const SUI_MAINNET_RPC_URL = "https://fullnode.mainnet.sui.io:443";
const SUI_TESTNET_RPC_URL = "https://fullnode.testnet.sui.io:443";

function normalizeObjectId(value) {
  return typeof value === "string" && /^0x[a-f0-9]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : "";
}

function utf8Bytes(value) {
  return Array.from(new TextEncoder().encode(String(value)));
}

function normalizeChainFamily(options = {}) {
  const raw =
    typeof options.chainFamily === "string"
      ? options.chainFamily
      : typeof options.family === "string"
        ? options.family
        : typeof options.runtimeProfile?.family === "string"
          ? options.runtimeProfile.family
          : "";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "sui") {
    return "sui";
  }
  const currency = typeof options.currency === "string" ? options.currency.trim().toUpperCase() : "";
  return currency === SUI_NATIVE_SYMBOL ? "sui" : "iota";
}

function isSuiRuntime(options = {}) {
  return normalizeChainFamily(options) === "sui";
}

function normalizeSuiObjectIdOrEmpty(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  try {
    const normalized = normalizeSuiObjectId(value.trim());
    return isValidSuiObjectId(normalized) ? normalized : "";
  } catch {
    return "";
  }
}

function assertSuiObjectId(value, fieldName) {
  const normalized = normalizeSuiObjectIdOrEmpty(value);
  if (!normalized) {
    throw new Error(`invalid_${fieldName}`);
  }
  return normalized;
}

function assertSuiAddress(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid_${fieldName}`);
  }
  const normalized = normalizeSuiAddress(value.trim());
  if (!isValidSuiAddress(normalized)) {
    throw new Error(`invalid_${fieldName}`);
  }
  return normalized;
}

function assertPositiveU64(value, fieldName) {
  if (typeof value === "bigint") {
    if (value > 0n) {
      return value;
    }
    throw new Error(`invalid_${fieldName}`);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    const parsed = BigInt(value.trim());
    if (parsed > 0n) {
      return parsed;
    }
  }
  throw new Error(`invalid_${fieldName}`);
}

function assertProtocolString(value, fieldName, maxLength = 128) {
  if (typeof value !== "string") {
    throw new Error(`invalid_${fieldName}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`invalid_${fieldName}`);
  }
  return normalized;
}

function normalizeSuiCoinType(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || !/^0x[a-f0-9]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/i.test(normalized)) {
    throw new Error("invalid_coin_type");
  }
  const [packageId, moduleName, structName] = normalized.split("::");
  return `${assertSuiObjectId(packageId, "coin_type_package")}::${moduleName}::${structName}`;
}

function assertSupportedSuiTypedCoinType(value) {
  const coinType = normalizeSuiCoinType(value);
  if (isSuiNativeCoinType(coinType)) {
    throw new Error("native_sui_uses_sui_order_escrow_builder");
  }
  return coinType;
}

function listingRefDigestToBytes(value) {
  const digest = typeof value === "string" ? value.trim().replace(/^0x/i, "").toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error("invalid_listing_ref_digest_hex");
  }
  const out = [];
  for (let index = 0; index < digest.length; index += 2) {
    out.push(Number.parseInt(digest.slice(index, index + 2), 16));
  }
  return out;
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

function normalizeMinCaseRewardNativeValue(request) {
  return normalizePositiveBigIntValue(request?.minCaseRewardNative ?? request?.minCaseRewardIota);
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
      normalized.minCaseRewardNative = normalizeMinCaseRewardNativeValue(request);
      normalized.minCaseRewardIota = normalized.minCaseRewardNative;
      normalized.stakeAmount = normalizePositiveBigIntValue(request.stakeAmount);
      normalized.transportType = normalizeU8Value(request.transportType);
      normalized.transportPubkey = normalizeHexBytes(request.transportPubkey ?? request.transportPubkeyHex);
      delete normalized.transportPubkeyHex;
      return normalized;
    case "disputeQuorum.updateReviewer":
      normalized.minCaseRewardNative = normalizeMinCaseRewardNativeValue(request);
      normalized.minCaseRewardIota = normalized.minCaseRewardNative;
      normalized.transportType = normalizeU8Value(request.transportType);
      normalized.transportPubkey = normalizeHexBytes(request.transportPubkey ?? request.transportPubkeyHex);
      delete normalized.transportPubkeyHex;
      return normalized;
    case "disputeQuorum.fundBondAsBuyer":
    case "disputeQuorum.fundBondAsSeller":
    case "disputeQuorum.fundTypedBondAsBuyer":
    case "disputeQuorum.fundTypedBondAsSeller":
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
  if (isSuiRuntime(options)) {
    return createSuiRpcClient(options);
  }
  const { rpcUrl } = resolveIotaRpcUrl(options);
  return new IotaClient({ url: rpcUrl });
}

function resolveSuiRpcUrl(options = {}) {
  const network =
    String(options.suiNetwork || options.chainNetwork || options.network || process.env.CLAWNERA_SUI_NETWORK || "")
      .trim()
      .toLowerCase() === "testnet"
      ? "testnet"
      : "mainnet";
  const explicit = String(options.suiRpcUrl || options.rpcUrl || "").trim();
  if (explicit) {
    return { rpcUrl: explicit, network };
  }
  const envExplicit = String(process.env.CLAWNERA_SUI_RPC_URL || process.env.SUI_RPC_URL || "").trim();
  if (envExplicit) {
    return { rpcUrl: envExplicit, network };
  }
  return { rpcUrl: network === "testnet" ? SUI_TESTNET_RPC_URL : SUI_MAINNET_RPC_URL, network };
}

async function callJsonRpc(rpcUrl, errorPrefix, body) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${errorPrefix}_rpc_http_${response.status}`);
  }
  return await response.json();
}

async function callIotaRpc(options = {}, body) {
  const { rpcUrl } = resolveIotaRpcUrl(options);
  return await callJsonRpc(rpcUrl, "iota", body);
}

async function callSuiRpc(options = {}, body) {
  const { rpcUrl } = resolveSuiRpcUrl(options);
  return await callJsonRpc(rpcUrl, "sui", body);
}

async function callChainRpc(options = {}, body) {
  return isSuiRuntime(options) ? await callSuiRpc(options, body) : await callIotaRpc(options, body);
}

function createSuiRpcClient(options = {}) {
  return {
    async getObject({ id, options: objectOptions }) {
      const payload = await callSuiRpc(options, {
        jsonrpc: "2.0",
        id: `sui-object-${id}`,
        method: "sui_getObject",
        params: [id, objectOptions || {}],
      });
      return payload?.result;
    },
    async getTransactionBlock({ digest, options: txOptions }) {
      const payload = await callSuiRpc(options, {
        jsonrpc: "2.0",
        id: `sui-tx-${digest}`,
        method: "sui_getTransactionBlock",
        params: [digest, txOptions || {}],
      });
      return payload?.result;
    },
    async queryEvents({ query, cursor, limit, order }) {
      const payload = await callSuiRpc(options, {
        jsonrpc: "2.0",
        id: `sui-events-${cursor?.txDigest || "start"}-${cursor?.eventSeq || "0"}`,
        method: "suix_queryEvents",
        params: [query, cursor || null, limit, order === "descending"],
      });
      return payload?.result;
    },
  };
}

function createSuiTransactionBuildClient(options = {}) {
  const { rpcUrl } = resolveSuiRpcUrl(options);
  return new SuiJsonRpcClient({
    network: "custom",
    url: rpcUrl,
  });
}

function requireJsonRpcResult(payload, fallbackError) {
  if (payload?.error) {
    const message = typeof payload.error?.message === "string" && payload.error.message.trim()
      ? payload.error.message.trim()
      : fallbackError;
    throw new Error(message);
  }
  return payload?.result ?? null;
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

async function resolveObjectType(client, options, objectId) {
  try {
    const payload = await callChainRpc(options, {
      jsonrpc: "2.0",
      id: `object-type-${objectId}`,
      method: isSuiRuntime(options) ? "sui_getObject" : "iota_getObject",
      params: [objectId, { showType: true }],
    });
    const typeValue =
      typeof payload?.result?.data?.type === "string"
        ? payload.result.data.type
        : typeof payload?.result?.type === "string"
          ? payload.result.type
          : "";
    if (typeValue) {
      return typeValue;
    }
  } catch {
    // Fall through to client getObject.
  }
  const response = await client.getObject({
    id: objectId,
    options: { showType: true },
  });
  return typeof response?.data?.type === "string" ? response.data.type : "";
}

async function resolveMailboxEventPackageIds(client, options, mailboxObjectId, explicitPackageId) {
  const candidates = [];
  const inferredType = await resolveObjectType(client, options, mailboxObjectId).catch(() => "");
  const inferredPackageId = parsePackageIdFromObjectType(inferredType, ORDER_MAILBOX_TYPE_SUFFIX);
  if (inferredPackageId) {
    candidates.push(inferredPackageId);
  }
  if (explicitPackageId) {
    candidates.push(explicitPackageId);
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function getLatestMoveEvent(client, options, eventType, fieldName, errorCode) {
  let firstEvent = null;
  try {
    const payload = await callChainRpc(options, {
      jsonrpc: "2.0",
      id: `event-${fieldName}`,
      method: isSuiRuntime(options) ? "suix_queryEvents" : "iotax_queryEvents",
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
  const minDisputeBondPerSideNative = parsePositiveBigIntField(
    dqFields,
    "min_dispute_bond_per_side_sui",
    minDisputeBondPerSideIota
  );
  const maxDisputeBondPerSideIota = parsePositiveBigIntField(
    dqFields,
    "max_dispute_bond_per_side_iota",
    minDisputeBondPerSideIota
  );
  const maxDisputeBondPerSideNative = parsePositiveBigIntField(
    dqFields,
    "max_dispute_bond_per_side_sui",
    maxDisputeBondPerSideIota
  );
  const reviewerMinStakeIota = parsePositiveBigIntField(dqFields, "reviewer_min_stake_iota", 500_000n);
  const reviewerMinStakeNative = parsePositiveBigIntField(dqFields, "reviewer_min_stake_sui", reviewerMinStakeIota);
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
      const changeType = typeof change?.type === "string" ? change.type.trim().toLowerCase() : "";
      const objectType = typeof change?.objectType === "string" ? change.objectType.trim().toLowerCase() : "";
      const changeObjectId = normalizeObjectId(change?.objectId || "");
      return changeType === "created" && objectType === expectedType.toLowerCase() && changeObjectId;
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
    minDisputeBondPerSideNative,
    maxDisputeBondPerSideNative,
    reviewerMinStakeNative,
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
  const payload = await callChainRpc(options, {
    jsonrpc: "2.0",
    id: `reputation-owned-${ownerAddress}`,
    method: isSuiRuntime(options) ? "suix_getOwnedObjects" : "iotax_getOwnedObjects",
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
  const rawRequest = plan?.request && typeof plan.request === "object" && !Array.isArray(plan.request)
    ? { ...plan.request }
    : plan?.request;
  if (rawRequest && typeof rawRequest === "object" && !Array.isArray(rawRequest)) {
    if (!rawRequest.chainFamily && typeof plan?.chainFamily === "string") {
      rawRequest.chainFamily = plan.chainFamily;
    }
    if (!rawRequest.chainNetwork && typeof plan?.chainNetwork === "string") {
      rawRequest.chainNetwork = plan.chainNetwork;
    }
  }
  const request = normalizeClawdexPlanRequest(txBuilder, rawRequest, plan?.inviteBinding);
  if (!txBuilder || !request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("invalid_tx_plan");
  }
  const chainFamily = normalizeChainFamily(request);
  const isSuiPlan = chainFamily === "sui";

  switch (txBuilder) {
    case "orderMailbox.init":
      return isSuiPlan ? buildSuiInitOrderMailboxPlanTx(request) : buildInitOrderMailboxTx(request);
    case "orderMailbox.postSignal":
      return isSuiPlan ? buildSuiPostOrderMailboxSignalIntentPlanTx(request) : buildPostOrderMailboxSignalIntentTx(request);
    case "orderMailbox.ackSignal":
      return isSuiPlan ? buildSuiAckOrderMailboxSignalPlanTx(request) : buildAckOrderMailboxSignalTx(request);
    case "orderMailbox.close":
      return isSuiPlan ? buildSuiCloseOrderMailboxPlanTx(request) : buildCloseOrderMailboxTx(request);
    case "disputeQuorum.registerReviewer":
      return isSuiPlan ? buildSuiRegisterReviewerPlanTx(request) : buildRegisterReviewerTx(request);
    case "disputeQuorum.updateReviewer":
      return isSuiPlan ? buildSuiUpdateReviewerPlanTx(request) : buildUpdateReviewerTx(request);
    case "disputeQuorum.deregisterReviewer":
      return isSuiPlan ? buildSuiDeregisterReviewerPlanTx(request) : buildDeregisterReviewerTx(request);
    case "disputeQuorum.claimReviewerDecisionMetrics":
      return isSuiPlan ? buildSuiClaimReviewerDecisionMetricsPlanTx(request) : buildClaimReviewerDecisionMetricsTx(request);
    case "disputeQuorum.fundBondAsBuyer":
      return isSuiPlan ? buildSuiFundOrderDisputeBondAsBuyerPlanTx(request) : buildFundOrderDisputeBondAsBuyerTx(request);
    case "disputeQuorum.fundBondAsSeller":
      return isSuiPlan ? buildSuiFundOrderDisputeBondAsSellerPlanTx(request) : buildFundOrderDisputeBondAsSellerTx(request);
    case "disputeQuorum.fundTypedBondAsBuyer":
      return isSuiPlan ? buildSuiFundOrderDisputeTypedBondAsBuyerPlanTx(request) : buildFundOrderDisputeBondTypedAsBuyerTx(request);
    case "disputeQuorum.fundTypedBondAsSeller":
      return isSuiPlan ? buildSuiFundOrderDisputeTypedBondAsSellerPlanTx(request) : buildFundOrderDisputeBondTypedAsSellerTx(request);
    case "disputeQuorum.openMilestoneDisputeCase":
      return isSuiPlan ? buildSuiOpenMilestoneDisputeCasePlanTx(request) : buildOpenMilestoneDisputeCaseTx(request);
    case "disputeQuorum.acceptDisputeCase":
      return isSuiPlan ? buildSuiAcceptDisputeCasePlanTx(request) : buildAcceptDisputeCaseTx(request);
    case "disputeQuorum.commitVote":
      return isSuiPlan ? buildSuiCommitDisputeVotePlanTx(request) : buildCommitDisputeVoteTx(request);
    case "disputeQuorum.revealVote":
      return isSuiPlan ? buildSuiRevealDisputeVotePlanTx(request) : buildRevealDisputeVoteTx(request);
    case "disputeQuorum.startReplacementRound":
      return isSuiPlan ? buildSuiStartReplacementRoundPlanTx(request) : buildStartReplacementRoundTx(request);
    case "disputeQuorum.finalizeCase":
      return isSuiPlan ? buildSuiFinalizeDisputeCasePlanTx(request) : buildFinalizeDisputeCaseTx(request);
    case "disputeQuorum.resolveFallback":
      return isSuiPlan ? buildSuiResolveDisputeFallbackPlanTx(request) : buildResolveDisputeFallbackTx(request);
    case "disputeQuorum.resolveTimeoutFallback":
      return isSuiPlan ? buildSuiResolveDisputeTimeoutFallbackPlanTx(request) : buildResolveDisputeTimeoutFallbackTx(request);
    case "orderEscrow.resolveDisputeWithBinding":
      return isSuiPlan ? buildSuiResolveOrderEscrowWithBindingPlanTx(request) : buildResolveOrderEscrowWithBindingTx(request);
    case "orderEscrow.resolveDisputeWithQuorumTicket":
      if (isSuiPlan) {
        throw new Error("unsupported_sui_order_escrow_quorum_ticket");
      }
      return buildResolveOrderEscrowWithQuorumTicketTx(request);
    case "orderEscrow.release":
      return isSuiPlan ? buildSuiReleaseOrderEscrowPlanTx(request) : buildReleaseOrderEscrowTx(request);
    case "orderEscrow.releaseWithDisputeBond":
      return isSuiPlan ? buildSuiReleaseOrderEscrowWithBondPlanTx(request) : buildReleaseOrderEscrowWithBondTx(request);
    case "orderEscrow.claimAfterDeadline":
      return isSuiPlan ? buildSuiClaimAfterDeadlineOrderEscrowPlanTx(request) : buildClaimAfterDeadlineOrderEscrowTx(request);
    case "orderEscrow.claimAfterDeadlineWithDisputeBond":
      return isSuiPlan ? buildSuiClaimAfterDeadlineWithBondPlanTx(request) : buildClaimAfterDeadlineWithBondTx(request);
    case "orderEscrow.claimAfterDeadlineToBuyer":
      if (!isSuiPlan) {
        throw new Error("unsupported_iota_order_escrow_buyer_rescue_plan");
      }
      return buildSuiClaimAfterDeadlineToBuyerOrderEscrowPlanTx(request);
    case "orderEscrow.releaseUnusedDisputeBondAfterRelease":
      return isSuiPlan ? buildSuiReleaseUnusedDisputeBondAfterReleasePlanTx(request) : buildReleaseUnusedDisputeBondAfterReleaseTx(request);
    case "orderEscrow.openDispute":
      return isSuiPlan ? buildSuiOpenOrderEscrowDisputePlanTx(request) : buildOpenOrderEscrowDisputeTx(request);
    default:
      throw new Error(`unsupported_tx_builder:${txBuilder}`);
  }
}

export function buildInitOrderBondTx(request) {
  return buildInitOrderDisputeBondTx(request);
}

function buildSuiBaseTx(request) {
  const packageId = assertSuiObjectId(request?.packageId, "package_id");
  const sender = assertSuiAddress(request?.sender, "sender");
  const tx = new SuiTransaction();
  tx.setSender(sender);
  return { tx, packageId, sender };
}

function buildSuiPaymentCoin(tx, request, amount) {
  const paymentCoinObjectId = normalizeSuiObjectIdOrEmpty(request?.paymentCoinObjectId);
  const paymentSource = paymentCoinObjectId ? tx.object(paymentCoinObjectId) : tx.gas;
  return tx.splitCoins(paymentSource, [tx.pure.u64(amount)]);
}

function validatedSuiClockObjectId(input) {
  return assertSuiObjectId(input || SUI_CLOCK_OBJECT_ID, "clock_object_id");
}

function assertSuiU8(value, fieldName) {
  const normalized = normalizeU8Value(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 255) {
    throw new Error(`invalid_${fieldName}`);
  }
  return normalized;
}

function byteVectorInput(value, fieldName, minLength = 0, maxLength = 1024) {
  const normalized = normalizeHexBytes(value);
  if (!Array.isArray(normalized) || !normalized.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    throw new Error(`invalid_${fieldName}`);
  }
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new Error(`invalid_${fieldName}`);
  }
  return normalized;
}

function optionalByteVectorInput(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return byteVectorInput(value, fieldName);
}

function assertSuiAddressVector(value, fieldName, { requireNonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    if (requireNonEmpty) {
      throw new Error(`invalid_${fieldName}`);
    }
    return [];
  }
  const normalized = value.map((entry) => assertSuiAddress(entry, fieldName));
  if (requireNonEmpty && normalized.length === 0) {
    throw new Error(`invalid_${fieldName}`);
  }
  return normalized;
}

function assertSuiBool(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new Error(`invalid_${fieldName}`);
  }
  return value;
}

function suiEscrowCoinType(request) {
  return normalizeSuiCoinType(request?.escrowCoinType || request?.coinType || SUI_NATIVE_COIN_TYPE);
}

function suiBondCoinType(request) {
  return request?.bondCoinType ? normalizeSuiCoinType(request.bondCoinType) : undefined;
}

function isSuiNativeCoinType(coinType) {
  return coinType.toLowerCase() === SUI_NATIVE_COIN_TYPE.toLowerCase();
}

function buildSuiRegisterReviewerPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const stakeAmount = assertPositiveU64(request?.stakeAmount, "stake_amount");
  const stakeCoin = buildSuiPaymentCoin(tx, request, stakeAmount);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::register_reviewer_entry_with_reputation_cfg`,
    arguments: [
      tx.object(assertSuiObjectId(request?.reviewerRegistryObjectId, "reviewer_registry_object_id")),
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
      tx.object(assertSuiObjectId(request?.reputationFeeConfigObjectId, "reputation_fee_config_object_id")),
      tx.object(assertSuiObjectId(request?.reputationProfileObjectId, "reputation_profile_object_id")),
      tx.pure.u8(assertSuiU8(request?.transportType, "transport_type")),
      tx.pure.vector("u8", byteVectorInput(request?.transportPubkey ?? request?.transportPubkeyHex, "transport_pubkey", 16, 256)),
      tx.pure.u64(assertPositiveU64(request?.minCaseRewardNative ?? request?.minCaseRewardIota, "min_case_reward_native")),
      stakeCoin,
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiUpdateReviewerPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::update_reviewer`,
    arguments: [
      tx.object(assertSuiObjectId(request?.reviewerRegistryObjectId, "reviewer_registry_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerEntryObjectId, "reviewer_entry_object_id")),
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
      tx.pure.u8(assertSuiU8(request?.transportType, "transport_type")),
      tx.pure.vector("u8", byteVectorInput(request?.transportPubkey ?? request?.transportPubkeyHex, "transport_pubkey", 16, 256)),
      tx.pure.u64(assertPositiveU64(request?.minCaseRewardNative ?? request?.minCaseRewardIota, "min_case_reward_native")),
      tx.pure.bool(assertSuiBool(request?.active, "active")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiDeregisterReviewerPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::deregister_reviewer`,
    arguments: [
      tx.object(assertSuiObjectId(request?.reviewerRegistryObjectId, "reviewer_registry_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerEntryObjectId, "reviewer_entry_object_id")),
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
    ],
  });
  return tx;
}

function buildSuiClaimReviewerDecisionMetricsPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::claim_decision_metrics`,
    arguments: [
      tx.object(assertSuiObjectId(request?.disputeCaseObjectId, "dispute_case_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerRegistryObjectId, "reviewer_registry_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerEntryObjectId, "reviewer_entry_object_id")),
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
    ],
  });
  return tx;
}

function buildSuiFundOrderDisputeBondPlanTx(request, fn) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const paymentCoin = buildSuiPaymentCoin(tx, request, assertPositiveU64(request?.amount, "amount"));
  tx.moveCall({
    target: `${packageId}::dispute_quorum::${fn}`,
    arguments: [
      tx.object(assertSuiObjectId(request?.bondObjectId, "bond_object_id")),
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
      paymentCoin,
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiFundOrderDisputeBondAsBuyerPlanTx(request) {
  return buildSuiFundOrderDisputeBondPlanTx(request, "fund_bond_as_buyer");
}

function buildSuiFundOrderDisputeBondAsSellerPlanTx(request) {
  return buildSuiFundOrderDisputeBondPlanTx(request, "fund_bond_as_seller");
}

function buildSuiFundOrderDisputeTypedBondPlanTx(request, fn) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const coinType = normalizeSuiCoinType(request?.coinType || request?.bondCoinType);
  const paymentCoinObjectId = assertSuiObjectId(request?.paymentCoinObjectId, "payment_coin_object_id");
  const paymentCoin = tx.splitCoins(tx.object(paymentCoinObjectId), [tx.pure.u64(assertPositiveU64(request?.amount, "amount"))]);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::${fn}`,
    typeArguments: [coinType],
    arguments: [
      tx.object(assertSuiObjectId(request?.bondObjectId, "bond_object_id")),
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
      paymentCoin,
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiFundOrderDisputeTypedBondAsBuyerPlanTx(request) {
  return buildSuiFundOrderDisputeTypedBondPlanTx(request, "fund_typed_bond_as_buyer");
}

function buildSuiFundOrderDisputeTypedBondAsSellerPlanTx(request) {
  return buildSuiFundOrderDisputeTypedBondPlanTx(request, "fund_typed_bond_as_seller");
}

function buildSuiOpenMilestoneDisputeCasePlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const clockObjectId = validatedSuiClockObjectId(request?.clockObjectId);
  const escrowCoinType = suiEscrowCoinType(request);
  const bondCoinType = suiBondCoinType(request);
  const openDisputeArgMode = request?.openDisputeArgMode ?? (request?.governanceConfigObjectId ? "guarded_governance_and_clock" : undefined);
  if (openDisputeArgMode) {
    tx.moveCall({
      target: `${packageId}::order_escrow::open_dispute_guarded`,
      typeArguments: [escrowCoinType],
      arguments: [
        tx.object(assertSuiObjectId(request?.governanceConfigObjectId, "governance_config_object_id")),
        tx.object(assertSuiObjectId(request?.escrowObjectId, "escrow_object_id")),
        tx.object(assertSuiObjectId(request?.reputationFeeConfigObjectId, "reputation_fee_config_object_id")),
        tx.object(clockObjectId),
      ],
    });
  }
  const invitedReviewerAddresses = assertSuiAddressVector(request?.invitedReviewerAddresses, "invited_reviewer_addresses");
  const hasInvites = invitedReviewerAddresses.length > 0;
  const fn = bondCoinType
    ? hasInvites
      ? "open_milestone_dispute_case_entry_with_invites_typed"
      : "open_milestone_dispute_case_entry_typed"
    : hasInvites
      ? "open_milestone_dispute_case_entry_with_invites"
      : "open_milestone_dispute_case_entry";
  tx.moveCall({
    target: `${packageId}::order_escrow::${fn}`,
    typeArguments: bondCoinType ? [escrowCoinType, bondCoinType] : [escrowCoinType],
    arguments: hasInvites
      ? [
          tx.pure.string(assertProtocolString(request?.milestoneId, "milestone_id")),
          tx.pure.vector("address", invitedReviewerAddresses),
          tx.object(assertSuiObjectId(request?.escrowObjectId, "escrow_object_id")),
          tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
          tx.object(assertSuiObjectId(request?.bondObjectId, "bond_object_id")),
          tx.object(clockObjectId),
        ]
      : [
          tx.pure.string(assertProtocolString(request?.milestoneId, "milestone_id")),
          tx.object(assertSuiObjectId(request?.escrowObjectId, "escrow_object_id")),
          tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
          tx.object(assertSuiObjectId(request?.bondObjectId, "bond_object_id")),
          tx.object(clockObjectId),
        ],
  });
  return tx;
}

function buildSuiAcceptDisputeCasePlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::accept_dispute_case_with_reputation_cfg`,
    arguments: [
      tx.object(assertSuiObjectId(request?.disputeCaseObjectId, "dispute_case_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerRegistryObjectId, "reviewer_registry_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerEntryObjectId, "reviewer_entry_object_id")),
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
      tx.object(assertSuiObjectId(request?.reputationFeeConfigObjectId, "reputation_fee_config_object_id")),
      tx.object(assertSuiObjectId(request?.reputationProfileObjectId, "reputation_profile_object_id")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiCommitDisputeVotePlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::commit_vote`,
    arguments: [
      tx.object(assertSuiObjectId(request?.disputeCaseObjectId, "dispute_case_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerEntryObjectId, "reviewer_entry_object_id")),
      tx.pure.vector("u8", byteVectorInput(request?.commitHash ?? request?.commitHashHex, "commit_hash", 32, 32)),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiRevealDisputeVotePlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::reveal_vote`,
    arguments: [
      tx.object(assertSuiObjectId(request?.disputeCaseObjectId, "dispute_case_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerEntryObjectId, "reviewer_entry_object_id")),
      tx.pure.u8(assertSuiU8(request?.vote, "vote")),
      tx.pure.vector("u8", byteVectorInput(request?.nonce ?? request?.nonceHex, "nonce")),
      tx.pure.vector("u8", optionalByteVectorInput(request?.evidenceHash ?? request?.evidenceHashHex, "evidence_hash")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiStartReplacementRoundPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::start_replacement_round_with_invites`,
    arguments: [
      tx.object(assertSuiObjectId(request?.disputeCaseObjectId, "dispute_case_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerRegistryObjectId, "reviewer_registry_object_id")),
      tx.pure.vector("address", assertSuiAddressVector(request?.invitedReviewerAddresses, "invited_reviewer_addresses", { requireNonEmpty: true })),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiFinalizeDisputeCasePlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const bondCoinType = suiBondCoinType(request);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::${bondCoinType ? "finalize_case_with_typed_quorum" : "finalize_case_with_quorum"}`,
    typeArguments: bondCoinType ? [bondCoinType] : [],
    arguments: [
      tx.object(assertSuiObjectId(request?.disputeCaseObjectId, "dispute_case_object_id")),
      tx.object(assertSuiObjectId(request?.bondObjectId, "bond_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerRegistryObjectId, "reviewer_registry_object_id")),
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiResolveDisputeFallbackPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const bondCoinType = suiBondCoinType(request);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::${bondCoinType ? "resolve_case_with_typed_platform_fallback" : "resolve_case_with_platform_fallback"}`,
    typeArguments: bondCoinType ? [bondCoinType] : [],
    arguments: [
      tx.object(assertSuiObjectId(request?.arbCapObjectId, "arb_cap_object_id")),
      tx.object(assertSuiObjectId(request?.disputeCaseObjectId, "dispute_case_object_id")),
      tx.object(assertSuiObjectId(request?.bondObjectId, "bond_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerRegistryObjectId, "reviewer_registry_object_id")),
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiResolveDisputeTimeoutFallbackPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const bondCoinType = suiBondCoinType(request);
  tx.moveCall({
    target: `${packageId}::dispute_quorum::${bondCoinType ? "resolve_case_with_typed_timeout_fallback" : "resolve_case_with_timeout_fallback"}`,
    typeArguments: bondCoinType ? [bondCoinType] : [],
    arguments: [
      tx.object(assertSuiObjectId(request?.disputeCaseObjectId, "dispute_case_object_id")),
      tx.object(assertSuiObjectId(request?.bondObjectId, "bond_object_id")),
      tx.object(assertSuiObjectId(request?.reviewerRegistryObjectId, "reviewer_registry_object_id")),
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiReleaseOrderEscrowPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const escrowCoinType = suiEscrowCoinType(request);
  const isNative = isSuiNativeCoinType(escrowCoinType);
  tx.moveCall({
    target: `${packageId}::order_escrow::${isNative ? "release_order_escrow_sui_entry" : "release_order_escrow_typed_order_asset_entry"}`,
    typeArguments: isNative ? [] : [escrowCoinType],
    arguments: [
      tx.object(assertSuiObjectId(request?.escrowObjectId, "escrow_object_id")),
      tx.object(assertSuiObjectId(request?.reputationFeeConfigObjectId, "reputation_fee_config_object_id")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiClaimAfterDeadlineOrderEscrowPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const escrowCoinType = suiEscrowCoinType(request);
  const isNative = isSuiNativeCoinType(escrowCoinType);
  tx.moveCall({
    target: `${packageId}::order_escrow::${isNative ? "claim_after_deadline_sui_entry" : "claim_after_deadline_typed_order_asset_entry"}`,
    typeArguments: isNative ? [] : [escrowCoinType],
    arguments: [
      tx.object(assertSuiObjectId(request?.escrowObjectId, "escrow_object_id")),
      tx.object(assertSuiObjectId(request?.reputationFeeConfigObjectId, "reputation_fee_config_object_id")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiClaimAfterDeadlineToBuyerOrderEscrowPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const escrowCoinType = suiEscrowCoinType(request);
  tx.moveCall({
    target: `${packageId}::order_escrow::claim_after_deadline_to_buyer_guarded`,
    typeArguments: [escrowCoinType],
    arguments: [
      tx.object(assertSuiObjectId(request?.governanceConfigObjectId, "governance_config_object_id")),
      tx.object(assertSuiObjectId(request?.escrowObjectId, "escrow_object_id")),
      tx.object(assertSuiObjectId(request?.reputationFeeConfigObjectId, "reputation_fee_config_object_id")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiOrderEscrowBondCloseoutPlanTx(request, nativeFn, typedFn) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const escrowCoinType = suiEscrowCoinType(request);
  const bondCoinType = suiBondCoinType(request);
  tx.moveCall({
    target: `${packageId}::order_escrow::${bondCoinType ? typedFn : nativeFn}`,
    typeArguments: bondCoinType ? [escrowCoinType, bondCoinType] : [escrowCoinType],
    arguments: [
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
      tx.object(assertSuiObjectId(request?.reputationFeeConfigObjectId, "reputation_fee_config_object_id")),
      tx.object(assertSuiObjectId(request?.escrowObjectId, "escrow_object_id")),
      tx.object(assertSuiObjectId(request?.bondObjectId, "bond_object_id")),
    ],
  });
  return tx;
}

function buildSuiReleaseOrderEscrowWithBondPlanTx(request) {
  return buildSuiOrderEscrowBondCloseoutPlanTx(request, "release_with_dispute_bond", "release_with_typed_dispute_bond");
}

function buildSuiClaimAfterDeadlineWithBondPlanTx(request) {
  return buildSuiOrderEscrowBondCloseoutPlanTx(
    request,
    "claim_after_deadline_with_dispute_bond",
    "claim_after_deadline_with_typed_dispute_bond",
  );
}

function buildSuiReleaseUnusedDisputeBondAfterReleasePlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const escrowCoinType = suiEscrowCoinType(request);
  const bondCoinType = suiBondCoinType(request);
  tx.moveCall({
    target: `${packageId}::order_escrow::${bondCoinType ? "release_unused_typed_dispute_bond_after_release" : "release_unused_dispute_bond_after_release"}`,
    typeArguments: bondCoinType ? [escrowCoinType, bondCoinType] : [escrowCoinType],
    arguments: [
      tx.object(assertSuiObjectId(request?.escrowObjectId, "escrow_object_id")),
      tx.object(assertSuiObjectId(request?.bondObjectId, "bond_object_id")),
    ],
  });
  return tx;
}

function buildSuiResolveOrderEscrowWithBindingPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::order_escrow::resolve_dispute_with_binding`,
    typeArguments: [suiEscrowCoinType(request)],
    arguments: [
      tx.object(assertSuiObjectId(request?.disputeQuorumConfigObjectId, "dispute_quorum_config_object_id")),
      tx.object(assertSuiObjectId(request?.escrowObjectId, "escrow_object_id")),
    ],
  });
  return tx;
}

function buildSuiOpenOrderEscrowDisputePlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::order_escrow::open_dispute_guarded`,
    typeArguments: [suiEscrowCoinType(request)],
    arguments: [
      tx.object(assertSuiObjectId(request?.governanceConfigObjectId, "governance_config_object_id")),
      tx.object(assertSuiObjectId(request?.escrowObjectId, "escrow_object_id")),
      tx.object(assertSuiObjectId(request?.reputationFeeConfigObjectId, "reputation_fee_config_object_id")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function assertSuiMailboxOrderId(value) {
  const normalized = assertProtocolString(value, "order_id", 128);
  if (/[\r\n]/.test(normalized)) {
    throw new Error("invalid_order_id");
  }
  return normalized;
}

function mapSuiOrderMailboxSignalIntent(intent) {
  switch (assertProtocolString(intent, "signal_intent", 64)) {
    case "MSG":
      return 0;
    case "DELIVERABLE_READY":
    case "CHECKPOINT":
      return 1;
    case "DISPUTE_NOTICE":
    case "OTHER":
      return 2;
    default:
      throw new Error("invalid_signal_intent");
  }
}

function normalizeSuiMailboxPayloadRef(value) {
  if (value === undefined) {
    return "";
  }
  const normalized = assertProtocolString(value, "payload_ref", 256);
  if (/[\r\n]/.test(normalized)) {
    throw new Error("invalid_payload_ref");
  }
  return normalized;
}

function buildSuiInitOrderMailboxPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::order_mailbox::init_order_mailbox`,
    arguments: [
      tx.pure.string(assertSuiMailboxOrderId(request?.orderId)),
      tx.pure.address(assertSuiAddress(request?.buyer, "buyer")),
      tx.pure.address(assertSuiAddress(request?.seller, "seller")),
      tx.object(assertSuiObjectId(request?.governanceConfigObjectId, "governance_config_object_id")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiPostOrderMailboxSignalIntentPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const signalType = request?.signalType === undefined ? mapSuiOrderMailboxSignalIntent(request?.signalIntent) : assertSuiU8(request.signalType, "signal_type");
  const ciphertextHash = String(request?.ciphertextHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(ciphertextHash)) {
    throw new Error("invalid_ciphertext_hash");
  }
  tx.moveCall({
    target: `${packageId}::order_mailbox::post_signal`,
    arguments: [
      tx.object(assertSuiObjectId(request?.mailboxObjectId, "mailbox_object_id")),
      tx.pure.u8(signalType),
      tx.pure.string(ciphertextHash),
      tx.pure.string(normalizeSuiMailboxPayloadRef(request?.payloadRef)),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiAckOrderMailboxSignalPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::order_mailbox::ack_signal`,
    arguments: [
      tx.object(assertSuiObjectId(request?.mailboxObjectId, "mailbox_object_id")),
      tx.pure.u64(assertPositiveU64(request?.ackedSeq, "acked_seq")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildSuiCloseOrderMailboxPlanTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  tx.moveCall({
    target: `${packageId}::order_mailbox::close_order_mailbox`,
    arguments: [
      tx.object(assertSuiObjectId(request?.mailboxObjectId, "mailbox_object_id")),
      tx.object(validatedSuiClockObjectId(request?.clockObjectId)),
    ],
  });
  return tx;
}

function buildCreateReputationProfileSuiTx(request) {
  const { tx, packageId, sender } = buildSuiBaseTx(request);
  const owner = request?.owner ? assertSuiAddress(request.owner, "owner") : sender;
  if (owner !== sender) {
    throw new Error("invalid_owner");
  }
  const reputationFeeConfigObjectId = assertSuiObjectId(
    request?.reputationFeeConfigObjectId,
    "reputation_fee_config_object_id",
  );
  const initFeeAmount = assertPositiveU64(request?.initFeeAmount, "init_fee_amount");
  if (request?.expectedInitFeeAmount !== undefined) {
    const expectedInitFeeAmount = assertPositiveU64(request.expectedInitFeeAmount, "expected_init_fee_amount");
    if (expectedInitFeeAmount !== initFeeAmount) {
      throw new Error("invalid_init_fee_amount");
    }
  }
  const paymentCoin = buildSuiPaymentCoin(tx, request, initFeeAmount);
  tx.moveCall({
    target: `${packageId}::reputation::create_reputation_profile_sui_entry`,
    arguments: [
      tx.pure.address(owner),
      paymentCoin,
      tx.object(reputationFeeConfigObjectId),
      tx.object(assertSuiObjectId(request?.clockObjectId || SUI_CLOCK_OBJECT_ID, "clock_object_id")),
    ],
  });
  return tx;
}

export function buildCreateReputationProfileTx(request) {
  if (isSuiRuntime(request) || request?.currency === SUI_NATIVE_SYMBOL) {
    return buildCreateReputationProfileSuiTx(request);
  }
  return buildCreateReputationProfileIotaTx(request);
}

function buildCreateListingDepositSuiTx(request) {
  const { tx, packageId, sender } = buildSuiBaseTx(request);
  const listingRefBytes = listingRefDigestToBytes(request?.listingRefDigestHex);
  const listingDepositConfigObjectId = assertSuiObjectId(
    request?.listingDepositConfigObjectId,
    "listing_deposit_config_object_id",
  );
  const depositAmount = assertPositiveU64(request?.depositAmount, "deposit_amount");
  const paymentCoin = buildSuiPaymentCoin(tx, request, depositAmount);
  if (request?.shared === true) {
    tx.moveCall({
      target: `${packageId}::listing_deposit::create_listing_deposit_sui_shared_entry`,
      arguments: [tx.pure.vector("u8", listingRefBytes), paymentCoin, tx.object(listingDepositConfigObjectId)],
    });
    return tx;
  }

  const owner = request?.owner ? assertSuiAddress(request.owner, "owner") : sender;
  if (owner !== sender) {
    throw new Error("invalid_owner");
  }
  tx.moveCall({
    target: `${packageId}::listing_deposit::create_listing_deposit_sui_entry`,
    arguments: [tx.pure.address(owner), tx.pure.vector("u8", listingRefBytes), paymentCoin, tx.object(listingDepositConfigObjectId)],
  });
  return tx;
}

export function buildCreateListingDepositTx(request) {
  if (isSuiRuntime(request) || request?.currency === SUI_NATIVE_SYMBOL) {
    return buildCreateListingDepositSuiTx(request);
  }
  if (request?.shared === true) {
    return buildCreateListingDepositIotaSharedTx(request);
  }
  return buildCreateListingDepositIotaTx(request);
}

function buildCreateOrderEscrowSuiTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const orderId = assertProtocolString(request?.orderId, "order_id");
  const seller = assertSuiAddress(request?.seller, "seller");
  const amount = assertPositiveU64(request?.amount, "amount");
  const deadlineMs = assertPositiveU64(request?.deadlineMs, "deadline_ms");
  const governanceConfigObjectId = assertSuiObjectId(request?.governanceConfigObjectId, "governance_config_object_id");
  const feeConfigObjectId = assertSuiObjectId(request?.feeConfigObjectId, "fee_config_object_id");
  const paymentCoin = buildSuiPaymentCoin(tx, request, amount);
  tx.moveCall({
    target: `${packageId}::order_escrow::create_order_escrow_sui_entry`,
    arguments: [
      tx.object(governanceConfigObjectId),
      tx.object(feeConfigObjectId),
      tx.pure.vector("u8", utf8Bytes(orderId)),
      tx.pure.address(seller),
      paymentCoin,
      tx.pure.u64(deadlineMs),
      tx.object(assertSuiObjectId(request?.clockObjectId || SUI_CLOCK_OBJECT_ID, "clock_object_id")),
    ],
  });
  return tx;
}

function buildCreateOrderEscrowSuiTypedAssetTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const orderId = assertProtocolString(request?.orderId, "order_id");
  const seller = assertSuiAddress(request?.seller, "seller");
  const amount = assertPositiveU64(request?.amount, "amount");
  const deadlineMs = assertPositiveU64(request?.deadlineMs, "deadline_ms");
  const governanceConfigObjectId = assertSuiObjectId(request?.governanceConfigObjectId, "governance_config_object_id");
  const feeConfigObjectId = assertSuiObjectId(request?.feeConfigObjectId, "fee_config_object_id");
  const coinType = assertSupportedSuiTypedCoinType(request?.coinType || request?.usdcCoinType);
  const paymentCoinObjectId = assertSuiObjectId(request?.paymentCoinObjectId || request?.coinObjectId, "payment_coin_object_id");
  const paymentCoin = tx.splitCoins(tx.object(paymentCoinObjectId), [tx.pure.u64(amount)]);
  tx.moveCall({
    target: `${packageId}::order_escrow::create_order_escrow_typed_order_asset_entry`,
    typeArguments: [coinType],
    arguments: [
      tx.object(governanceConfigObjectId),
      tx.object(feeConfigObjectId),
      tx.pure.vector("u8", utf8Bytes(orderId)),
      tx.pure.address(seller),
      paymentCoin,
      tx.pure.u64(deadlineMs),
      tx.object(assertSuiObjectId(request?.clockObjectId || SUI_CLOCK_OBJECT_ID, "clock_object_id")),
    ],
  });
  return tx;
}

export function buildCreateOrderEscrowTx(request) {
  const currency = typeof request?.currency === "string" ? request.currency.trim().toUpperCase() : "";
  if (isSuiRuntime(request) || currency === SUI_NATIVE_SYMBOL || currency === SUI_USDC_SYMBOL) {
    if (currency === SUI_USDC_SYMBOL || request?.coinType || request?.usdcCoinType) {
      return buildCreateOrderEscrowSuiTypedAssetTx(request);
    }
    if (currency && currency !== SUI_NATIVE_SYMBOL) {
      throw new Error("unsupported_sui_order_currency");
    }
    return buildCreateOrderEscrowSuiTx(request);
  }
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

function buildManagedStorageFeeSuiTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const orderId = assertProtocolString(request?.orderId, "order_id");
  const milestoneId = assertProtocolString(request?.milestoneId, "milestone_id");
  const recipientAddress = assertSuiAddress(request?.recipientAddress, "recipient_address");
  const amount = assertPositiveU64(request?.amount ?? request?.amountAtomic, "amount");
  const paymentCoin = buildSuiPaymentCoin(tx, request, amount);
  tx.moveCall({
    target: `${packageId}::manifest_anchor::pay_managed_storage_fee_sui`,
    arguments: [
      tx.pure.string(orderId),
      tx.pure.string(milestoneId),
      tx.pure.address(recipientAddress),
      paymentCoin,
    ],
  });
  return tx;
}

function buildManagedStorageFeeSuiTypedAssetTx(request) {
  const { tx, packageId } = buildSuiBaseTx(request);
  const orderId = assertProtocolString(request?.orderId, "order_id");
  const milestoneId = assertProtocolString(request?.milestoneId, "milestone_id");
  const recipientAddress = assertSuiAddress(request?.recipientAddress, "recipient_address");
  const amount = assertPositiveU64(request?.amount ?? request?.amountAtomic, "amount");
  const coinType = assertSupportedSuiTypedCoinType(request?.coinType || request?.usdcCoinType);
  const paymentCoinObjectId = assertSuiObjectId(
    request?.paymentCoinObjectId || request?.coinObjectId,
    "payment_coin_object_id",
  );
  const paymentCoin = tx.splitCoins(tx.object(paymentCoinObjectId), [tx.pure.u64(amount)]);
  tx.moveCall({
    target: `${packageId}::manifest_anchor::pay_managed_storage_fee_typed_order_asset`,
    typeArguments: [coinType],
    arguments: [
      tx.pure.string(orderId),
      tx.pure.string(milestoneId),
      tx.pure.address(recipientAddress),
      paymentCoin,
    ],
  });
  return tx;
}

export function buildManagedStorageFeeTx(request) {
  const currency = typeof request?.currency === "string" ? request.currency.trim().toUpperCase() : "";
  const hasTypedSelector = Boolean(request?.coinType || request?.usdcCoinType);
  if (isSuiRuntime(request) || currency === SUI_NATIVE_SYMBOL || currency === SUI_USDC_SYMBOL) {
    if (hasTypedSelector) {
      return buildManagedStorageFeeSuiTypedAssetTx(request);
    }
    if (!currency || currency === SUI_NATIVE_SYMBOL) {
      return buildManagedStorageFeeSuiTx(request);
    }
    if (currency === SUI_USDC_SYMBOL) {
      throw new Error("sui_managed_storage_fee_coin_type_required");
    }
    throw new Error("unsupported_sui_managed_storage_fee_asset");
  }
  return buildPayManagedStorageFeeIotaTx(request);
}

async function buildSuiTransactionBytes(options = {}) {
  const client = options.suiClient || options.client || createSuiTransactionBuildClient(options);
  const transaction = options.transaction;
  if (!transaction || typeof transaction.build !== "function") {
    throw new Error("invalid_transaction");
  }
  const bytes = await transaction.build({ client });
  const resolved = resolveSuiRpcUrl(options);
  const txBytesB64 = Buffer.from(bytes).toString("base64");
  return {
    txBytesB64,
    transactionBytesBase64: txBytesB64,
    network: resolved.network,
    rpcUrl: resolved.rpcUrl,
  };
}

async function dryRunSuiTransactionBytes(options = {}) {
  const txBytesB64 = String(options.txBytesB64 || options.transactionBytesBase64 || "").trim();
  if (!txBytesB64) {
    throw new Error("invalid_sui_transaction_bytes");
  }
  const payload = await callSuiRpc(options, {
    jsonrpc: "2.0",
    id: "clawnera-sui-direct-dry-run-1",
    method: "sui_dryRunTransactionBlock",
    params: [txBytesB64],
  });
  return requireJsonRpcResult(payload, "sui_dry_run_failed");
}

function resolveSuiDirectSigner(options = {}) {
  return options.suiSigner || options.signer || options.suiKeypair || options.keypair || null;
}

function assertCanonicalSuiTransactionBytes(candidate, expected) {
  const value = typeof candidate === "string" && candidate.trim() ? candidate.trim() : expected;
  if (value !== expected) {
    throw new Error("signed_sui_transaction_bytes_mismatch");
  }
  return expected;
}

async function signSuiTransactionBytes(txBytes, txBytesB64, options = {}) {
  const providedSignature = typeof options.signature === "string" ? options.signature.trim() : "";
  if (providedSignature) {
    assertCanonicalSuiTransactionBytes(options.signedBytesBase64, txBytesB64);
    return {
      bytes: txBytesB64,
      signature: providedSignature,
      signerSource: "provided_signature",
    };
  }

  const signer = resolveSuiDirectSigner(options);
  if (!signer) {
    throw new Error("missing_sui_signer");
  }
  if (typeof signer.signTransaction === "function") {
    const signed = await signer.signTransaction(txBytes);
    if (!signed?.signature) {
      throw new Error("invalid_sui_signature");
    }
    assertCanonicalSuiTransactionBytes(signed.bytes, txBytesB64);
    return {
      bytes: txBytesB64,
      signature: signed.signature,
      signerSource: "signTransaction",
    };
  }
  if (typeof signer.signTransactionBlock === "function") {
    const signed = await signer.signTransactionBlock({ transactionBlock: txBytes });
    const signature = typeof signed?.signature === "string" ? signed.signature.trim() : "";
    if (!signature) {
      throw new Error("invalid_sui_signature");
    }
    const signedBytes =
      typeof signed.bytes === "string" && signed.bytes.trim()
        ? signed.bytes.trim()
        : typeof signed.transactionBlockBytes === "string" && signed.transactionBlockBytes.trim()
          ? signed.transactionBlockBytes.trim()
          : txBytesB64;
    assertCanonicalSuiTransactionBytes(signedBytes, txBytesB64);
    return {
      bytes: txBytesB64,
      signature,
      signerSource: "signTransactionBlock",
    };
  }
  throw new Error("invalid_sui_signer");
}

async function executeSuiTransactionBytes(options = {}) {
  const txBytesB64 = String(options.txBytesB64 || options.transactionBytesBase64 || "").trim();
  if (!txBytesB64) {
    throw new Error("invalid_sui_transaction_bytes");
  }
  const txBytes = Buffer.from(txBytesB64, "base64");
  if (txBytes.length === 0) {
    throw new Error("invalid_sui_transaction_bytes");
  }
  const signed = await signSuiTransactionBytes(txBytes, txBytesB64, options);
  const payload = await callSuiRpc(options, {
    jsonrpc: "2.0",
    id: "clawnera-sui-direct-execute-1",
    method: "sui_executeTransactionBlock",
    params: [
      signed.bytes,
      [signed.signature],
      options.executeOptions || DEFAULT_ONCHAIN_EXECUTE_OPTIONS,
    ],
  });
  return {
    result: requireJsonRpcResult(payload, "sui_transaction_execution_failed"),
    signature: signed.signature,
    signedBytesBase64: signed.bytes,
    signerSource: signed.signerSource,
  };
}

export async function dryRunTransaction(transaction, options = {}) {
  if (isSuiRuntime(options)) {
    const built = await buildSuiTransactionBytes({ ...options, transaction });
    const result = await dryRunSuiTransactionBytes({ ...options, txBytesB64: built.txBytesB64 });
    return {
      ...built,
      result,
    };
  }
  const built = await buildIotaTransactionBytes({ ...options, transaction });
  const result = await dryRunIotaTransfer({ ...options, txBytesB64: built.txBytesB64 });
  return {
    ...built,
    result,
  };
}

export async function executeTransaction(transaction, options = {}) {
  if (isSuiRuntime(options)) {
    const built = await buildSuiTransactionBytes({ ...options, transaction });
    const execution = await executeSuiTransactionBytes({
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
    const payload = await callChainRpc(options, {
      jsonrpc: "2.0",
      id: `mailbox-events-${eventType}-${cursor?.txDigest || "start"}-${cursor?.eventSeq || "0"}`,
      method: isSuiRuntime(options) ? "suix_queryEvents" : "iotax_queryEvents",
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
  if (!orderId || !mailboxObjectId) {
    throw new Error("mailbox_event_feed_invalid_input");
  }

  const client = createClient(options);
  const packageIds = await resolveMailboxEventPackageIds(client, options, mailboxObjectId, packageId);
  if (packageIds.length === 0) {
    throw new Error("mailbox_event_feed_invalid_input");
  }
  for (const candidatePackageId of packageIds) {
    const postedItems = await collectMailboxFeedItemsForEventType({
      client,
      options,
      eventType: normalizeMoveEventType(candidatePackageId, "order_mailbox", "SignalPosted"),
      orderId,
      mailboxObjectId,
      limit,
      normalizeEvent: normalizeMailboxPostedFeedItem,
    });
    const ackedItems = includeAcked
      ? await collectMailboxFeedItemsForEventType({
          client,
          options,
          eventType: normalizeMoveEventType(candidatePackageId, "order_mailbox", "SignalAcked"),
          orderId,
          mailboxObjectId,
          limit,
          normalizeEvent: normalizeMailboxAckedFeedItem,
        })
      : [];
    if (postedItems.length > 0 || ackedItems.length > 0) {
      return postedItems.concat(ackedItems);
    }
  }
  return [];
}

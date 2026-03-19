import { Transaction } from "@iota/iota-sdk/transactions";
import {
  assertCanonicalProtocolString,
  assertPositiveAmount,
  assertValidIotaAddress,
  assertValidIotaObjectId,
} from "../validation.js";

const MAX_ORDER_ID_LEN = 128;
const MAX_MILESTONE_ID_LEN = 128;
const MAX_MANIFEST_CID_LEN = 256;

function anchorTarget(packageId) {
  return `${packageId}::manifest_anchor::anchor_milestone_manifest`;
}

function managedStorageFeeTarget(packageId) {
  return `${packageId}::manifest_anchor::pay_managed_storage_fee_iota`;
}

function assertUtf8Length(value, fieldName, maxLen) {
  if (typeof value !== "string") {
    throw new Error(`invalid_${fieldName}`);
  }
  if (value.length === 0 || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`invalid_${fieldName}`);
  }
  const byteLen = new TextEncoder().encode(value).byteLength;
  if (byteLen === 0 || byteLen > maxLen) {
    throw new Error(`invalid_${fieldName}`);
  }
  return value;
}

function assertIpfsManifestCid(value) {
  const normalized = assertUtf8Length(value, "manifest_cid", MAX_MANIFEST_CID_LEN);
  if (!/^ipfs:\/\/[a-z0-9]+(?:[/?#].*)?$/i.test(normalized)) {
    throw new Error("invalid_manifest_cid");
  }
  return normalized;
}

function assertLowerHex64(value, fieldName) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`invalid_${fieldName}`);
  }
  return normalized;
}

export function buildMilestoneManifestAnchorTx(req) {
  const packageId = assertValidIotaObjectId(req.packageId, "package_id");
  const sender = assertValidIotaAddress(req.sender, "sender");
  const sellerAddress = assertValidIotaAddress(req.sellerAddress ?? req.sender, "seller_address");
  if (sellerAddress !== sender) {
    throw new Error("invalid_seller_address");
  }
  const orderId = assertCanonicalProtocolString(req.orderId, "order_id", MAX_ORDER_ID_LEN);
  const milestoneId = assertCanonicalProtocolString(req.milestoneId, "milestone_id", MAX_MILESTONE_ID_LEN);
  const manifestCid = assertIpfsManifestCid(req.manifestCid);
  const manifestSha256 = assertLowerHex64(req.manifestSha256, "manifest_sha256");
  const sellerSignatureHash = assertLowerHex64(req.sellerSignatureHash, "seller_signature_hash");

  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: anchorTarget(packageId),
    arguments: [
      tx.pure.address(sellerAddress),
      tx.pure.string(orderId),
      tx.pure.string(milestoneId),
      tx.pure.string(manifestCid),
      tx.pure.string(manifestSha256),
      tx.pure.string(sellerSignatureHash),
    ],
  });
  return tx;
}

export function buildPayManagedStorageFeeIotaTx(req) {
  const packageId = assertValidIotaObjectId(req.packageId, "package_id");
  const sender = assertValidIotaAddress(req.sender, "sender");
  const recipientAddress = assertValidIotaAddress(req.recipientAddress, "recipient_address");
  const orderId = assertCanonicalProtocolString(req.orderId, "order_id", MAX_ORDER_ID_LEN);
  const milestoneId = assertCanonicalProtocolString(req.milestoneId, "milestone_id", MAX_MILESTONE_ID_LEN);
  const amountAtomic = assertPositiveAmount(BigInt(req.amountAtomic), "amount_atomic");

  const tx = new Transaction();
  tx.setSender(sender);
  const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountAtomic)]);
  tx.moveCall({
    target: managedStorageFeeTarget(packageId),
    arguments: [
      tx.pure.string(orderId),
      tx.pure.string(milestoneId),
      tx.pure.address(recipientAddress),
      paymentCoin,
    ],
  });
  return tx;
}

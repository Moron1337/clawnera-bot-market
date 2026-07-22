import { Transaction } from "@iota/iota-sdk/transactions";
import { assertByteVectorInput, assertCanonicalProtocolString, assertPositiveAmount, assertValidIotaAddress, assertValidIotaObjectId, } from "../validation.js";
const MAX_ORDER_ID_LEN = 128;
const MAX_MILESTONE_ID_LEN = 128;
const MAX_MANIFEST_CID_LEN = 256;
function anchorTarget(packageId) {
    return `${packageId}::manifest_anchor::anchor_milestone_manifest`;
}
function manifestAnchorTarget(packageId, fn) {
    return `${packageId}::manifest_anchor::${fn}`;
}
function assertMilestoneIndex(value) {
    if (typeof value !== "bigint" || value < 0n || value > (1n << 64n) - 1n) {
        throw new Error("invalid_milestone_index");
    }
    return value;
}
function assertUtf8Length(value, fieldName, maxLen) {
    if (typeof value !== "string") {
        throw new Error(`invalid_${fieldName}`);
    }
    if (value.length === 0 || value.trim().length === 0) {
        throw new Error(`invalid_${fieldName}`);
    }
    if (value !== value.trim()) {
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
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId ?? "", "governance_config_object_id");
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
            tx.object(governanceConfigObjectId),
            tx.pure.address(sellerAddress),
            tx.pure.string(orderId),
            tx.pure.string(milestoneId),
            tx.pure.string(manifestCid),
            tx.pure.string(manifestSha256),
            tx.pure.string(sellerSignatureHash)
        ]
    });
    return tx;
}
export function buildPayManagedStorageFeeIotaTx(req) {
    const packageId = assertValidIotaObjectId(req.packageId, "package_id");
    const sender = assertValidIotaAddress(req.sender, "sender");
    const governanceConfigObjectId = assertValidIotaObjectId(req.governanceConfigObjectId, "governance_config_object_id");
    const feeConfigObjectId = assertValidIotaObjectId(req.feeConfigObjectId, "fee_config_object_id");
    const milestoneEscrowObjectId = assertValidIotaObjectId(req.milestoneEscrowObjectId, "milestone_escrow_object_id");
    const orderId = assertCanonicalProtocolString(req.orderId, "order_id", MAX_ORDER_ID_LEN);
    const expectedEscrowId = assertValidIotaAddress(req.expectedEscrowId, "expected_escrow_id");
    if (expectedEscrowId !== milestoneEscrowObjectId) {
        throw new Error("invalid_expected_escrow_id");
    }
    const milestoneIndex = assertMilestoneIndex(req.milestoneIndex);
    const proofNonce = assertByteVectorInput(req.proofNonce, "proof_nonce", 32, 32);
    const recipientAddress = assertValidIotaAddress(req.recipientAddress, "recipient_address");
    const amount = assertPositiveAmount(req.amount, "amount");
    const tx = new Transaction();
    tx.setSender(sender);
    const paymentSource = req.paymentCoinObjectId
        ? tx.object(assertValidIotaObjectId(req.paymentCoinObjectId, "payment_coin_object_id"))
        : tx.gas;
    const paymentCoin = tx.splitCoins(paymentSource, [tx.pure.u64(amount)]);
    tx.moveCall({
        target: manifestAnchorTarget(packageId, "pay_managed_storage_fee_iota_v2"),
        arguments: [
            tx.object(governanceConfigObjectId),
            tx.object(feeConfigObjectId),
            tx.object(milestoneEscrowObjectId),
            tx.pure.string(orderId),
            tx.pure.address(expectedEscrowId),
            tx.pure.u64(milestoneIndex),
            tx.pure.vector("u8", proofNonce),
            tx.pure.address(recipientAddress),
            paymentCoin,
        ],
    });
    return tx;
}
//# sourceMappingURL=manifestAnchor.js.map
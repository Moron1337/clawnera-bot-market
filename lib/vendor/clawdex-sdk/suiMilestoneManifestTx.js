import { Transaction as SuiTransaction } from "@mysten/sui/transactions";
import { assertByteVectorInput, assertCanonicalProtocolString, assertPositiveAmount, assertValidSuiAddress, assertValidSuiObjectId, } from "./validation.js";
const MAX_ORDER_ID_LEN = 128;
const MAX_MILESTONE_ID_LEN = 128;
const MAX_MANIFEST_CID_LEN = 256;
const MAX_U64 = (1n << 64n) - 1n;
function manifestAnchorTarget(packageId, fn) {
    return `${packageId}::manifest_anchor::${fn}`;
}
function buildSuiBaseTx(req) {
    const packageId = assertValidSuiObjectId(req.packageId, "package_id");
    const sender = assertValidSuiAddress(req.sender, "sender");
    const tx = new SuiTransaction();
    tx.setSender(sender);
    return { tx, packageId, sender };
}
function assertUtf8Length(value, fieldName, maxLen) {
    if (typeof value !== "string") {
        throw new Error(`invalid_${fieldName}`);
    }
    if (value.length === 0 || value.trim().length === 0 || value !== value.trim()) {
        throw new Error(`invalid_${fieldName}`);
    }
    if (new TextEncoder().encode(value).byteLength > maxLen) {
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
function assertMilestoneIndex(value) {
    if (typeof value !== "bigint" || value < 0n || value > MAX_U64) {
        throw new Error("invalid_milestone_index");
    }
    return value.toString();
}
function validateManagedStorageFeeInputs(req) {
    return {
        orderId: assertCanonicalProtocolString(req.orderId, "order_id", MAX_ORDER_ID_LEN),
        governanceConfigObjectId: assertValidSuiObjectId(req.governanceConfigObjectId, "governance_config_object_id"),
        feeConfigObjectId: assertValidSuiObjectId(req.feeConfigObjectId, "fee_config_object_id"),
        milestoneEscrowObjectId: assertValidSuiObjectId(req.milestoneEscrowObjectId, "milestone_escrow_object_id"),
        expectedEscrowId: assertValidSuiAddress(req.expectedEscrowId, "expected_escrow_id"),
        milestoneIndex: assertMilestoneIndex(req.milestoneIndex),
        proofNonce: assertByteVectorInput(req.proofNonce, "proof_nonce", 32, 32),
        recipientAddress: assertValidSuiAddress(req.recipientAddress, "recipient_address"),
        amount: assertPositiveAmount(req.amount, "amount"),
    };
}
export function buildSuiMilestoneManifestAnchorTx(req) {
    const { tx, packageId, sender } = buildSuiBaseTx(req);
    const sellerAddress = assertValidSuiAddress(req.sellerAddress ?? req.sender, "seller_address");
    if (sellerAddress !== sender) {
        throw new Error("invalid_seller_address");
    }
    const orderId = assertCanonicalProtocolString(req.orderId, "order_id", MAX_ORDER_ID_LEN);
    const milestoneId = assertCanonicalProtocolString(req.milestoneId, "milestone_id", MAX_MILESTONE_ID_LEN);
    const manifestCid = assertIpfsManifestCid(req.manifestCid);
    const manifestSha256 = assertLowerHex64(req.manifestSha256, "manifest_sha256");
    const sellerSignatureHash = assertLowerHex64(req.sellerSignatureHash, "seller_signature_hash");
    tx.moveCall({
        target: manifestAnchorTarget(packageId, "anchor_milestone_manifest"),
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
export function buildSuiPayManagedStorageFeeSuiTx(req) {
    const { tx, packageId } = buildSuiBaseTx(req);
    const validated = validateManagedStorageFeeInputs(req);
    if (validated.expectedEscrowId !== validated.milestoneEscrowObjectId) {
        throw new Error("invalid_expected_escrow_id");
    }
    const paymentSource = req.paymentCoinObjectId
        ? tx.object(assertValidSuiObjectId(req.paymentCoinObjectId, "payment_coin_object_id"))
        : tx.gas;
    const paymentCoin = tx.splitCoins(paymentSource, [tx.pure.u64(validated.amount)]);
    tx.moveCall({
        target: manifestAnchorTarget(packageId, "pay_managed_storage_fee_sui_v2"),
        arguments: [
            tx.object(validated.governanceConfigObjectId),
            tx.object(validated.feeConfigObjectId),
            tx.object(validated.milestoneEscrowObjectId),
            tx.pure.string(validated.orderId),
            tx.pure.address(validated.expectedEscrowId),
            tx.pure.u64(validated.milestoneIndex),
            tx.pure.vector("u8", validated.proofNonce),
            tx.pure.address(validated.recipientAddress),
            paymentCoin,
        ],
    });
    return tx;
}
export function buildSuiPayManagedStorageFeeTypedOrderAssetTx(req) {
    void req;
    throw new Error("sui_typed_managed_storage_fee_lane_not_enabled");
}
//# sourceMappingURL=suiMilestoneManifestTx.js.map
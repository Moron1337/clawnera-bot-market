import { assertValidIotaObjectId, assertValidMoveTypeTag } from "../validation.js";
const IOTA_FRAMEWORK_COIN_TYPE = `0x${"0".repeat(63)}2::coin::Coin`;
export function resolveValidatedTypedCoinFunding(req, expectedCoinType, labels) {
    const hasPaymentCoin = !!req.paymentCoinObjectId;
    const hasTypedCoin = !!req.coin;
    const hasLegacyCoinObjectId = !!req.coinObjectId;
    if ([hasPaymentCoin, hasTypedCoin, hasLegacyCoinObjectId].filter(Boolean).length !== 1) {
        throw new Error(labels.ambiguousSource);
    }
    if (hasPaymentCoin) {
        return {
            kind: "split",
            paymentCoinObjectId: assertValidIotaObjectId(req.paymentCoinObjectId ?? "", "payment_coin_object_id"),
        };
    }
    if (hasTypedCoin) {
        const coinObjectId = assertValidIotaObjectId(req.coin?.objectId ?? "", labels.objectIdField);
        const coinObjectType = assertValidMoveTypeTag(req.coin?.coinObjectType ?? "", labels.objectTypeField);
        const expectedObjectType = assertValidMoveTypeTag(`${IOTA_FRAMEWORK_COIN_TYPE}<${expectedCoinType}>`, labels.objectTypeField);
        if (coinObjectType !== expectedObjectType) {
            throw new Error(labels.typeMismatch);
        }
        return {
            kind: "object",
            coinObjectId,
        };
    }
    if (!req.allowUncheckedCoinObjectId) {
        throw new Error(labels.uncheckedObjectIdRequiresOptIn);
    }
    return {
        kind: "object",
        coinObjectId: assertValidIotaObjectId(req.coinObjectId ?? "", labels.objectIdField),
    };
}
//# sourceMappingURL=assetCoin.js.map
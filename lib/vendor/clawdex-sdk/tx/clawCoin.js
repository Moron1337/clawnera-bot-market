import { assertValidIotaObjectId, assertValidMoveTypeTag } from "../validation.js";
const IOTA_FRAMEWORK_COIN_TYPE = `0x${"0".repeat(63)}2::coin::Coin`;
export function resolveValidatedClawFunding(req, clawCoinType) {
    const hasPaymentCoin = !!req.paymentCoinObjectId;
    const hasTypedClawCoin = !!req.clawCoin;
    const hasLegacyClawCoinObjectId = !!req.clawCoinObjectId;
    if ([hasPaymentCoin, hasTypedClawCoin, hasLegacyClawCoinObjectId].filter(Boolean).length !== 1) {
        throw new Error("exactly one of paymentCoinObjectId or clawCoin/clawCoinObjectId is required");
    }
    if (hasPaymentCoin) {
        return {
            kind: "split",
            paymentCoinObjectId: assertValidIotaObjectId(req.paymentCoinObjectId ?? "", "payment_coin_object_id")
        };
    }
    if (hasTypedClawCoin) {
        const clawCoinObjectId = assertValidIotaObjectId(req.clawCoin?.objectId ?? "", "claw_coin_object_id");
        const clawCoinObjectType = assertValidMoveTypeTag(req.clawCoin?.coinObjectType ?? "", "claw_coin_object_type");
        const expectedClawCoinObjectType = assertValidMoveTypeTag(`${IOTA_FRAMEWORK_COIN_TYPE}<${clawCoinType}>`, "claw_coin_object_type");
        if (clawCoinObjectType !== expectedClawCoinObjectType) {
            throw new Error("claw_coin_object_type_mismatch");
        }
        return {
            kind: "object",
            clawCoinObjectId
        };
    }
    if (!req.allowUncheckedClawCoinObjectId) {
        throw new Error("unchecked_claw_coin_object_id_requires_opt_in");
    }
    return {
        kind: "object",
        clawCoinObjectId: assertValidIotaObjectId(req.clawCoinObjectId ?? "", "claw_coin_object_id")
    };
}
//# sourceMappingURL=clawCoin.js.map
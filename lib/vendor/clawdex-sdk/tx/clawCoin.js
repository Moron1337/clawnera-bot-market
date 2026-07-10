import { resolveValidatedTypedCoinFunding } from "./assetCoin.js";
export function resolveValidatedClawFunding(req, clawCoinType) {
    const funding = resolveValidatedTypedCoinFunding({
        paymentCoinObjectId: req.paymentCoinObjectId,
        coin: req.clawCoin,
        coinObjectId: req.clawCoinObjectId,
        allowUncheckedCoinObjectId: req.allowUncheckedClawCoinObjectId,
    }, clawCoinType, {
        objectIdField: "claw_coin_object_id",
        objectTypeField: "claw_coin_object_type",
        ambiguousSource: "exactly one of paymentCoinObjectId or clawCoin/clawCoinObjectId is required",
        typeMismatch: "claw_coin_object_type_mismatch",
        uncheckedObjectIdRequiresOptIn: "unchecked_claw_coin_object_id_requires_opt_in",
    });
    if (funding.kind === "split") {
        return funding;
    }
    return {
        kind: "object",
        clawCoinObjectId: funding.coinObjectId,
    };
}
//# sourceMappingURL=clawCoin.js.map
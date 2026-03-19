import { Transaction } from "@iota/iota-sdk/transactions";
import { IOTA_CLOCK_OBJECT_ID } from "@iota/iota-sdk/utils";
import { assertPositiveAmount, assertValidIotaAddress, assertValidIotaObjectId } from "../validation.js";

function reputationTarget(packageId, fn) {
  return `${packageId}::reputation::${fn}`;
}

function buildBaseTx(req) {
  const packageId = assertValidIotaObjectId(req.packageId, "package_id");
  const sender = assertValidIotaAddress(req.sender, "sender");
  const tx = new Transaction();
  tx.setSender(sender);
  return { tx, packageId };
}

function validatedClockObjectId(input) {
  return assertValidIotaObjectId(input ?? IOTA_CLOCK_OBJECT_ID, "clock_object_id");
}

export function buildCreateReputationProfileIotaTx(req) {
  const { tx, packageId } = buildBaseTx(req);
  const reputationFeeConfigObjectId = assertValidIotaObjectId(
    req.reputationFeeConfigObjectId,
    "reputation_fee_config_object_id",
  );
  const initFeeAmount = BigInt(assertPositiveAmount(req.initFeeAmount, "init_fee_amount"));
  if (req.expectedInitFeeAmount !== undefined) {
    const expectedInitFeeAmount = BigInt(assertPositiveAmount(req.expectedInitFeeAmount, "expected_init_fee_amount"));
    if (expectedInitFeeAmount !== initFeeAmount) {
      throw new Error("invalid_init_fee_amount");
    }
  }
  const clockObjectId = validatedClockObjectId(req.clockObjectId);
  const paymentSource = req.paymentCoinObjectId
    ? tx.object(assertValidIotaObjectId(req.paymentCoinObjectId, "payment_coin_object_id"))
    : tx.gas;
  const paymentCoin = tx.splitCoins(paymentSource, [tx.pure.u64(initFeeAmount)]);

  tx.moveCall({
    target: reputationTarget(packageId, "create_reputation_profile_iota_entry"),
    arguments: [paymentCoin, tx.object(reputationFeeConfigObjectId), tx.object(clockObjectId)],
  });

  return tx;
}

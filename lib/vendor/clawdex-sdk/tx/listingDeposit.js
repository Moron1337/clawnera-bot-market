import { Transaction } from "@iota/iota-sdk/transactions";
import { assertPositiveAmount, assertValidIotaAddress, assertValidIotaObjectId } from "../validation.js";

const LISTING_REF_DIGEST_HEX_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/;

function listingDepositTarget(packageId, fn) {
  return `${packageId}::listing_deposit::${fn}`;
}

function buildBaseTx(req) {
  const packageId = assertValidIotaObjectId(req.packageId, "package_id");
  const sender = assertValidIotaAddress(req.sender, "sender");
  const tx = new Transaction();
  tx.setSender(sender);
  return { tx, packageId, sender };
}

function normalizedListingRefDigestHex(value) {
  const trimmed = String(value ?? "").trim();
  if (!LISTING_REF_DIGEST_HEX_PATTERN.test(trimmed)) {
    throw new Error("invalid_listing_ref_digest_hex");
  }
  return trimmed.startsWith("0x") ? trimmed.slice(2).toLowerCase() : trimmed.toLowerCase();
}

function listingRefDigestToBytes(value) {
  const digest = normalizedListingRefDigestHex(value);
  const out = [];
  for (let index = 0; index < digest.length; index += 2) {
    out.push(Number.parseInt(digest.slice(index, index + 2), 16));
  }
  return out;
}

function listingDepositPaymentAndRefs(tx, req) {
  const listingRefBytes = listingRefDigestToBytes(req.listingRefDigestHex);
  const listingDepositConfigObjectId = assertValidIotaObjectId(
    req.listingDepositConfigObjectId,
    "listing_deposit_config_object_id",
  );
  const depositAmount = BigInt(assertPositiveAmount(req.depositAmount, "deposit_amount"));
  const paymentSource = req.paymentCoinObjectId
    ? tx.object(assertValidIotaObjectId(req.paymentCoinObjectId, "payment_coin_object_id"))
    : tx.gas;
  const paymentCoin = tx.splitCoins(paymentSource, [tx.pure.u64(depositAmount)]);
  return {
    listingRefBytes,
    listingDepositConfigObjectId,
    paymentCoin,
  };
}

export function buildCreateListingDepositIotaTx(req) {
  const { tx, packageId, sender } = buildBaseTx(req);
  const owner = assertValidIotaAddress(req.owner ?? sender, "owner");
  if (owner !== sender) {
    throw new Error("invalid_owner");
  }
  const { listingRefBytes, listingDepositConfigObjectId, paymentCoin } = listingDepositPaymentAndRefs(tx, req);

  tx.moveCall({
    target: listingDepositTarget(packageId, "create_listing_deposit_iota_entry"),
    arguments: [
      tx.pure.address(owner),
      tx.pure.vector("u8", listingRefBytes),
      paymentCoin,
      tx.object(listingDepositConfigObjectId),
    ],
  });

  return tx;
}

export function buildCreateListingDepositIotaSharedTx(req) {
  const { tx, packageId } = buildBaseTx(req);
  const { listingRefBytes, listingDepositConfigObjectId, paymentCoin } = listingDepositPaymentAndRefs(tx, req);

  tx.moveCall({
    target: listingDepositTarget(packageId, "create_listing_deposit_iota_shared_entry"),
    arguments: [tx.pure.vector("u8", listingRefBytes), paymentCoin, tx.object(listingDepositConfigObjectId)],
  });

  return tx;
}

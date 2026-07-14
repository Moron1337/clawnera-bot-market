import { normalizeIotaAddress } from "./iota-local.mjs";

export const MARKETPLACE_PACKAGE_ALIASES = Object.freeze([
  "foundation",
  "governance",
  "settlement",
  "fulfillment",
  "ops",
]);

export const MARKETPLACE_OBJECT_ID_FIELDS = Object.freeze([
  "governanceConfigObjectId",
  "orderMailboxRegistryObjectId",
  "disputeQuorumConfigObjectId",
  "marketplaceFeeConfigObjectId",
  "reputationInitFeeConfigObjectId",
  "listingDepositConfigObjectId",
  "reviewerRegistryObjectId",
]);

function asRecord(value, errorCode) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(errorCode);
  }
  return value;
}

function normalizeObjectId(value) {
  return normalizeIotaAddress(typeof value === "string" ? value.trim() : "") || "";
}

export function extractMarketplacePolicyPackageContext(responseBody, packageAlias = "settlement") {
  if (!MARKETPLACE_PACKAGE_ALIASES.includes(packageAlias)) {
    throw new Error("marketplace_package_alias_invalid");
  }

  const policy = asRecord(responseBody?.policy, "policy_fees_payload_invalid");
  const chainConfig = asRecord(policy.chainConfig, "policy_fees_payload_invalid");
  const packageIds = Object.fromEntries(
    MARKETPLACE_PACKAGE_ALIASES.map((alias) => [
      alias,
      normalizeObjectId(chainConfig[`${alias}PackageId`]),
    ]),
  );
  if (Object.values(packageIds).some((packageId) => !packageId)) {
    throw new Error("marketplace_package_dag_incomplete");
  }
  if (new Set(Object.values(packageIds)).size !== MARKETPLACE_PACKAGE_ALIASES.length) {
    throw new Error("marketplace_package_dag_not_split");
  }

  const orderMailboxRegistryObjectId = normalizeObjectId(chainConfig.orderMailboxRegistryObjectId);
  if (!orderMailboxRegistryObjectId) {
    throw new Error("marketplace_order_mailbox_registry_missing");
  }

  const listingDepositPackageId = normalizeObjectId(policy.listingDeposit?.packageId);
  const reputationPackageId = normalizeObjectId(policy.reputationInitFee?.packageId);
  if (!listingDepositPackageId || listingDepositPackageId !== packageIds.ops) {
    throw new Error("listing_deposit_package_binding_mismatch");
  }
  if (!reputationPackageId || reputationPackageId !== packageIds.settlement) {
    throw new Error("reputation_package_binding_mismatch");
  }

  return {
    packageAlias,
    packageId: packageIds[packageAlias],
    packageIds,
    chainConfigHints: {
      foundationPackageId: packageIds.foundation,
      governancePackageId: packageIds.governance,
      settlementPackageId: packageIds.settlement,
      fulfillmentPackageId: packageIds.fulfillment,
      opsPackageId: packageIds.ops,
      marketplaceFeeConfigObjectId: normalizeObjectId(
        chainConfig.marketplaceFeeConfigObjectId || chainConfig.escrowFeeConfigObjectId,
      ),
      governanceConfigObjectId: normalizeObjectId(chainConfig.governanceConfigObjectId),
      orderMailboxRegistryObjectId,
      disputeQuorumConfigObjectId: normalizeObjectId(chainConfig.disputeQuorumConfigObjectId),
      reputationInitFeeConfigObjectId: normalizeObjectId(chainConfig.reputationInitFeeConfigObjectId),
      listingDepositConfigObjectId: normalizeObjectId(chainConfig.listingDepositConfigObjectId),
    },
  };
}

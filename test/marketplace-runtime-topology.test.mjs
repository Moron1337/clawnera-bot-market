import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { extractMarketplacePolicyPackageContext } from "../lib/marketplace-runtime-topology.mjs";

const id = (byte) => `0x${byte.repeat(64)}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function feePolicy() {
  return {
    policy: {
      chainConfig: {
        foundationPackageId: id("1"),
        governancePackageId: id("2"),
        settlementPackageId: id("3"),
        fulfillmentPackageId: id("4"),
        opsPackageId: id("5"),
        governanceConfigObjectId: id("6"),
        orderMailboxRegistryObjectId: id("7"),
        disputeQuorumConfigObjectId: id("8"),
        marketplaceFeeConfigObjectId: id("9"),
        reputationInitFeeConfigObjectId: id("a"),
        listingDepositConfigObjectId: id("b"),
      },
      listingDeposit: {
        packageId: id("5"),
      },
      reputationInitFee: {
        packageId: id("3"),
      },
    },
  };
}

test("binds the five-root Fresh package DAG and preserves governance/mailbox hints", () => {
  const context = extractMarketplacePolicyPackageContext(feePolicy(), "governance");

  assert.deepEqual(context.packageIds, {
    foundation: id("1"),
    governance: id("2"),
    settlement: id("3"),
    fulfillment: id("4"),
    ops: id("5"),
  });
  assert.equal(context.packageAlias, "governance");
  assert.equal(context.packageId, id("2"));
  assert.equal(context.chainConfigHints.governancePackageId, id("2"));
  assert.equal(context.chainConfigHints.orderMailboxRegistryObjectId, id("7"));
});

test("rejects an incomplete, unsplit, or registry-less Fresh topology", () => {
  const incomplete = feePolicy();
  delete incomplete.policy.chainConfig.governancePackageId;
  assert.throws(
    () => extractMarketplacePolicyPackageContext(incomplete),
    /marketplace_package_dag_incomplete/,
  );

  const unsplit = feePolicy();
  unsplit.policy.chainConfig.governancePackageId = unsplit.policy.chainConfig.settlementPackageId;
  assert.throws(
    () => extractMarketplacePolicyPackageContext(unsplit),
    /marketplace_package_dag_not_split/,
  );

  const registryLess = feePolicy();
  registryLess.policy.chainConfig.orderMailboxRegistryObjectId = null;
  assert.throws(
    () => extractMarketplacePolicyPackageContext(registryLess),
    /marketplace_order_mailbox_registry_missing/,
  );
});

test("rejects invalid aliases and fee-policy package binding drift", () => {
  assert.throws(
    () => extractMarketplacePolicyPackageContext(feePolicy(), "admin"),
    /marketplace_package_alias_invalid/,
  );

  const listingDrift = feePolicy();
  listingDrift.policy.listingDeposit.packageId = id("3");
  assert.throws(
    () => extractMarketplacePolicyPackageContext(listingDrift),
    /listing_deposit_package_binding_mismatch/,
  );

  const reputationDrift = feePolicy();
  reputationDrift.policy.reputationInitFee.packageId = id("5");
  assert.throws(
    () => extractMarketplacePolicyPackageContext(reputationDrift),
    /reputation_package_binding_mismatch/,
  );
});

test("does not expose operator fee queue, approve, or apply commands", () => {
  const publicCommandSurfaces = [
    "bin/clawnera-help.mjs",
    "config/recipes.json",
    "config/topics.json",
    "package.json",
  ].map((relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8")).join("\n");

  assert.doesNotMatch(
    publicCommandSurfaces,
    /(?:clawnera-help|npm run)\s+(?:fee:policy|fee-policy(?::|-)?(?:queue|approve|apply))/i,
  );
  for (const moveFunction of [
    "queue_iota_fee_update",
    "approve_pending_iota_fee_update",
    "apply_iota_fee_update",
  ]) {
    assert.equal(publicCommandSurfaces.includes(moveFunction), false);
  }
});

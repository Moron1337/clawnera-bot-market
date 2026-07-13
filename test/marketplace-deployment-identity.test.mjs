import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKETPLACE_DEPLOYMENT_REGISTRY_SCHEMA,
  assertMarketplaceDeploymentRegistryAvailable,
  parseMarketplaceDeploymentRegistry,
} from "../lib/marketplace-deployment-identity.mjs";

const emptyRegistry = () => ({
  schema: MARKETPLACE_DEPLOYMENT_REGISTRY_SCHEMA,
  deployments: [],
});

test("marketplace deployment registry accepts only the exact inactive schema", () => {
  const input = emptyRegistry();
  const parsed = parseMarketplaceDeploymentRegistry(input);

  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  assert.notEqual(parsed.deployments, input.deployments);
});

test("marketplace deployment registry rejects malformed top-level data", () => {
  const invalidInputs = [
    null,
    [],
    {},
    { schema: MARKETPLACE_DEPLOYMENT_REGISTRY_SCHEMA },
    { deployments: [] },
    { ...emptyRegistry(), extra: true },
    { ...emptyRegistry(), deployments: {} },
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => parseMarketplaceDeploymentRegistry(input),
      { message: "marketplace_deployment_identity_registry_invalid" },
    );
  }
});

test("marketplace deployment registry rejects unsupported schemas", () => {
  assert.throws(
    () =>
      parseMarketplaceDeploymentRegistry({
        schema: "clawnera.marketplace-deployments.v2",
        deployments: [],
      }),
    { message: "marketplace_deployment_identity_registry_schema_invalid" },
  );
});

test("marketplace deployment registry rejects activation until its entry schema exists", () => {
  assert.throws(
    () =>
      parseMarketplaceDeploymentRegistry({
        schema: MARKETPLACE_DEPLOYMENT_REGISTRY_SCHEMA,
        deployments: [{}],
      }),
    { message: "marketplace_deployment_identity_registry_activation_unsupported" },
  );
});

test("empty marketplace deployment registry is unavailable for execution", () => {
  assert.throws(
    () => assertMarketplaceDeploymentRegistryAvailable(emptyRegistry()),
    { message: "marketplace_deployment_identity_unavailable" },
  );
});

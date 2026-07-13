export const MARKETPLACE_DEPLOYMENT_REGISTRY_SCHEMA = "clawnera.marketplace-deployments.v1";

const MARKETPLACE_DEPLOYMENT_REGISTRY_KEYS = Object.freeze(["deployments", "schema"]);

function registryError(code) {
  return new Error(code);
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

export function parseMarketplaceDeploymentRegistry(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !hasExactKeys(input, MARKETPLACE_DEPLOYMENT_REGISTRY_KEYS)
  ) {
    throw registryError("marketplace_deployment_identity_registry_invalid");
  }
  if (input.schema !== MARKETPLACE_DEPLOYMENT_REGISTRY_SCHEMA) {
    throw registryError("marketplace_deployment_identity_registry_schema_invalid");
  }
  if (!Array.isArray(input.deployments)) {
    throw registryError("marketplace_deployment_identity_registry_invalid");
  }
  if (input.deployments.length > 0) {
    throw registryError("marketplace_deployment_identity_registry_activation_unsupported");
  }
  return {
    schema: MARKETPLACE_DEPLOYMENT_REGISTRY_SCHEMA,
    deployments: [],
  };
}

export function assertMarketplaceDeploymentRegistryAvailable(input) {
  parseMarketplaceDeploymentRegistry(input);
  throw registryError("marketplace_deployment_identity_unavailable");
}

import { isDeepStrictEqual } from "node:util";

import { assertMarketplaceWriteGateFresh } from "./marketplace-write-gate.mjs";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function snapshotMarketplaceDirectGateInput(input, directGate) {
  const options = asRecord(input.options) || {};
  const runtimeContext = asRecord(input.runtimeContext);
  return {
    options: {
      ...(options["api-base"] !== undefined ? { "api-base": options["api-base"] } : {}),
      ...(options["env-file"] !== undefined ? { "env-file": options["env-file"] } : {}),
      ...(options["auth-state-file"] !== undefined
        ? { "auth-state-file": options["auth-state-file"] }
        : {}),
      ...(options["timeout-ms"] !== undefined ? { "timeout-ms": options["timeout-ms"] } : {}),
      ...(options.network !== undefined ? { network: options.network } : {}),
    },
    runtimeContext: runtimeContext
      ? {
          apiBase: runtimeContext.apiBase,
          envValues: { ...(asRecord(runtimeContext.envValues) || {}) },
        }
      : null,
    iotaRuntime: { ...directGate.iotaRuntime },
    packageAlias: input.packageAlias,
    packageId: input.packageId,
    packageIds: { ...(asRecord(input.packageIds) || {}) },
    objectIds: { ...(asRecord(input.objectIds) || {}) },
    reviewerPlan: input.reviewerPlan ? structuredClone(input.reviewerPlan) : null,
  };
}

function assertMarketplaceDirectGateContinuity(initialGate, reattestedGate, nowMs) {
  if (
    initialGate.apiBase !== reattestedGate.apiBase ||
    initialGate.attestation.apiOrigin !== reattestedGate.attestation.apiOrigin
  ) {
    throw new Error("marketplace_write_gate_reattest_api_target_drift");
  }
  if (
    initialGate.iotaRuntime.network !== reattestedGate.iotaRuntime.network ||
    initialGate.iotaRuntime.rpcUrl !== reattestedGate.iotaRuntime.rpcUrl
  ) {
    throw new Error("marketplace_write_gate_reattest_rpc_target_drift");
  }
  if (!isDeepStrictEqual(initialGate.attestation.chain, reattestedGate.attestation.chain)) {
    throw new Error("marketplace_write_gate_reattest_chain_binding_drift");
  }
  if (initialGate.attestation.nonce === reattestedGate.attestation.nonce) {
    throw new Error("marketplace_write_gate_reattest_nonce_reused");
  }
  assertMarketplaceWriteGateFresh(reattestedGate.attestation, nowMs);
  return reattestedGate;
}

export function createMarketplaceDirectReattestation({
  initialGate,
  input,
  verifyGate,
  wrapError = (error) => error,
  now = Date.now,
}) {
  if (typeof verifyGate !== "function" || typeof wrapError !== "function" || typeof now !== "function") {
    throw new Error("marketplace_write_gate_reattest_dependency_invalid");
  }
  const reattestationInput = snapshotMarketplaceDirectGateInput(input, initialGate);
  return async function reattestMarketplaceDirectExecutionGate() {
    try {
      const reattestedGate = await verifyGate(reattestationInput);
      return assertMarketplaceDirectGateContinuity(initialGate, reattestedGate, now());
    } catch (error) {
      throw wrapError(error, {
        apiBase: initialGate.apiBase,
        packageAlias: reattestationInput.packageAlias,
      });
    }
  };
}

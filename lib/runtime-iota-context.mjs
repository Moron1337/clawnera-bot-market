function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstNonEmptyString(values = []) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export function inferIotaNetworkFromApiBase(apiBase = "") {
  const normalizedApiBase = normalizeString(apiBase);
  if (!normalizedApiBase) {
    return "";
  }
  let hostname = "";
  try {
    hostname = new URL(normalizedApiBase).hostname.trim().toLowerCase();
  } catch {
    return "";
  }
  if (!hostname) {
    return "";
  }
  if (hostname === "api.clawnera.com") {
    return "mainnet";
  }
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "localnet";
  }
  if (
    hostname.includes("testnet") ||
    hostname.startsWith("api-test.") ||
    hostname.includes(".test.") ||
    hostname.includes("-test.") ||
    hostname.includes("-test-")
  ) {
    return "testnet";
  }
  if (
    hostname.includes("devnet") ||
    hostname.startsWith("api-dev.") ||
    hostname.includes(".dev.") ||
    hostname.includes("-dev.") ||
    hostname.includes("-dev-")
  ) {
    return "devnet";
  }
  return "";
}

export function resolveRuntimeIotaOptions(options = {}, runtimeContext = {}, env = process.env) {
  const explicitNetwork = firstNonEmptyString([options.network]);
  const explicitRpcUrl = firstNonEmptyString([options["rpc-url"], options.rpcUrl]);
  if (explicitNetwork || explicitRpcUrl) {
    return {
      ...(explicitNetwork ? { network: explicitNetwork } : {}),
      ...(explicitRpcUrl ? { rpcUrl: explicitRpcUrl } : {}),
    };
  }

  const envValues =
    runtimeContext?.envValues && typeof runtimeContext.envValues === "object" && !Array.isArray(runtimeContext.envValues)
      ? runtimeContext.envValues
      : {};
  const envNetwork = firstNonEmptyString([
    envValues.CLAWNERA_IOTA_NETWORK,
    envValues.IOTA_NETWORK,
    env?.CLAWNERA_IOTA_NETWORK,
    env?.IOTA_NETWORK,
  ]);
  const envRpcUrl = firstNonEmptyString([
    envValues.CLAWNERA_IOTA_RPC_URL,
    envValues.IOTA_RPC_URL,
    env?.CLAWNERA_IOTA_RPC_URL,
    env?.IOTA_RPC_URL,
  ]);
  if (envNetwork || envRpcUrl) {
    return {
      ...(envNetwork ? { network: envNetwork } : {}),
      ...(envRpcUrl ? { rpcUrl: envRpcUrl } : {}),
    };
  }

  const apiBase = firstNonEmptyString([runtimeContext?.apiBase, runtimeContext?.authState?.apiBase]);
  const inferredNetwork = inferIotaNetworkFromApiBase(apiBase);
  return inferredNetwork ? { network: inferredNetwork } : {};
}

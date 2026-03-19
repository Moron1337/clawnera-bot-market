import { IotaClient, getFullnodeUrl } from "@iota/iota-sdk/client";
import { decodeIotaPrivateKey } from "@iota/iota-sdk/cryptography";
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { Secp256k1Keypair } from "@iota/iota-sdk/keypairs/secp256k1";
import { Secp256r1Keypair } from "@iota/iota-sdk/keypairs/secp256r1";
import { Transaction } from "@iota/iota-sdk/transactions";
import { verifyTransactionSignature } from "@iota/iota-sdk/verify";
import { defaultIotaKeystorePath, loadKeystoreEntries, resolveKeystoreEntry } from "./runtime-auth.mjs";

export const IOTA_COIN_TYPE = "0x2::iota::IOTA";
export const DEFAULT_IOTA_NETWORK = "mainnet";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeIotaAddress(value) {
  const normalized = normalizeString(value).toLowerCase();
  return /^0x[a-f0-9]{64}$/i.test(normalized) ? normalized : "";
}

function normalizeNetwork(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return DEFAULT_IOTA_NETWORK;
  }
  if (["mainnet", "testnet", "devnet", "localnet"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "custom") {
    return normalized;
  }
  throw new Error("invalid_iota_network");
}

function normalizeRpcUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("invalid_iota_rpc_url");
    }
    return parsed.toString();
  } catch {
    throw new Error("invalid_iota_rpc_url");
  }
}

export function resolveIotaRpcUrl(options = {}) {
  const network = normalizeNetwork(options.network);
  const rpcUrl = normalizeRpcUrl(options.rpcUrl);
  if (rpcUrl) {
    return {
      network: network === "custom" ? "custom" : network,
      rpcUrl,
    };
  }
  if (network === "custom") {
    throw new Error("missing_iota_rpc_url");
  }
  return {
    network,
    rpcUrl: getFullnodeUrl(network),
  };
}

function createIotaClient(options = {}) {
  const { rpcUrl } = resolveIotaRpcUrl(options);
  return new IotaClient({ url: rpcUrl });
}

async function signerFromSecretKey(secretKey) {
  const decoded = decodeIotaPrivateKey(secretKey);
  if (decoded.schema === "ED25519") {
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  if (decoded.schema === "Secp256k1") {
    return Secp256k1Keypair.fromSecretKey(secretKey);
  }
  if (decoded.schema === "Secp256r1") {
    return Secp256r1Keypair.fromSecretKey(secretKey);
  }
  throw new Error(`unsupported_signer_schema:${decoded.schema}`);
}

async function resolveSelectedEntry(options = {}, deps = {}) {
  const loadEntries = deps.loadKeystoreEntries || loadKeystoreEntries;
  const keystorePath = options.keystorePath || defaultIotaKeystorePath();
  const entries = await loadEntries(keystorePath);
  if (entries.length === 0) {
    throw new Error("no_local_keystore_entries");
  }

  const rawAddress = normalizeString(options.address);
  const address = normalizeIotaAddress(rawAddress);
  if (rawAddress && !address) {
    throw new Error("invalid_iota_address");
  }
  const alias = normalizeString(options.alias);
  if (address || alias) {
    const selected = resolveKeystoreEntry(entries, { address, alias });
    if (!selected) {
      throw new Error("keystore_entry_not_found");
    }
    return selected;
  }

  if (entries.length === 1) {
    return entries[0];
  }

  throw new Error("wallet_selector_required");
}

export async function getIotaActiveEnv(options = {}) {
  const resolved = resolveIotaRpcUrl(options);
  return {
    activeEnv: resolved.network,
    rpcUrl: resolved.rpcUrl,
    keystorePath: options.keystorePath || defaultIotaKeystorePath(),
    source: resolved.network === "custom" ? "custom-rpc" : "sdk-config",
  };
}

export async function getIotaBalance(options = {}, deps = {}) {
  const clientFactory = deps.clientFactory || createIotaClient;
  const selected = await resolveSelectedEntry(options, deps);
  const resolved = resolveIotaRpcUrl(options);
  const client = clientFactory(options);
  const coinType = normalizeString(options.coinType);
  const withCoins = Boolean(options.withCoins);

  const result = {
    owner: selected.address,
    network: resolved.network,
    rpcUrl: resolved.rpcUrl,
  };

  if (coinType) {
    result.balance = await client.getBalance({ owner: selected.address, coinType });
    if (withCoins) {
      result.coins = await client.getCoins({ owner: selected.address, coinType });
    }
    return result;
  }

  result.balances = await client.getAllBalances({ owner: selected.address });
  if (withCoins) {
    result.coins = await client.getAllCoins({ owner: selected.address });
  }
  return result;
}

export async function getIotaGas(options = {}, deps = {}) {
  const clientFactory = deps.clientFactory || createIotaClient;
  const selected = await resolveSelectedEntry(options, deps);
  const resolved = resolveIotaRpcUrl(options);
  const client = clientFactory(options);
  const gasCoins = await client.getCoins({
    owner: selected.address,
    coinType: IOTA_COIN_TYPE,
  });

  return {
    owner: selected.address,
    network: resolved.network,
    rpcUrl: resolved.rpcUrl,
    coinType: IOTA_COIN_TYPE,
    gasCoins,
  };
}

async function resolveGasPaymentRef(client, coinObjectId) {
  const response = await client.getObject({ id: coinObjectId });
  if (!response?.data?.objectId || !response?.data?.version || !response?.data?.digest) {
    throw new Error("gas_payment_ref_unresolved");
  }
  return {
    objectId: response.data.objectId,
    version: response.data.version,
    digest: response.data.digest,
  };
}

export async function prepareIotaTransfer(options = {}, deps = {}) {
  const clientFactory = deps.clientFactory || createIotaClient;
  const transactionFactory = deps.transactionFactory || (() => new Transaction());
  const selected = await resolveSelectedEntry(options, deps);
  const resolved = resolveIotaRpcUrl(options);
  const client = clientFactory(options);
  const tx = transactionFactory();
  const recipient = normalizeIotaAddress(options.recipient);
  if (!recipient) {
    throw new Error("invalid_recipient");
  }
  const inputCoins = Array.isArray(options.inputCoins) ? options.inputCoins.map((entry) => normalizeIotaAddress(entry)) : [];
  const validCoins = inputCoins.filter(Boolean);
  if (validCoins.length === 0 || validCoins.length !== inputCoins.length) {
    throw new Error("missing_input_coins");
  }

  tx.setSender(selected.address);
  if (options.gasBudget !== undefined && options.gasBudget !== null) {
    tx.setGasBudget(options.gasBudget);
  }

  const primaryGasRef = await resolveGasPaymentRef(client, validCoins[0]);
  tx.setGasPayment([primaryGasRef]);

  if (validCoins.length > 1) {
    tx.mergeCoins(
      tx.gas,
      validCoins.slice(1).map((coinId) => tx.object(coinId)),
    );
  }

  const [paymentCoin] = tx.splitCoins(tx.gas, [BigInt(options.amountNanos)]);
  tx.transferObjects([paymentCoin], recipient);

  const bytes = await tx.build({ client });
  return {
    txBytesB64: Buffer.from(bytes).toString("base64"),
    decodedTx: tx.getData(),
    signerAddress: selected.address,
    rpcUrl: resolved.rpcUrl,
    network: resolved.network,
  };
}

export async function dryRunIotaTransfer(options = {}, deps = {}) {
  const clientFactory = deps.clientFactory || createIotaClient;
  const client = clientFactory(options);
  const txBytes = Buffer.from(String(options.txBytesB64 || ""), "base64");
  return await client.dryRunTransactionBlock({
    transactionBlock: txBytes,
  });
}

export async function buildIotaTransactionBytes(options = {}, deps = {}) {
  const clientFactory = deps.clientFactory || createIotaClient;
  const client = clientFactory(options);
  const transaction = options.transaction;
  if (!transaction || typeof transaction.build !== "function") {
    throw new Error("invalid_transaction");
  }
  const bytes = await transaction.build({ client });
  const resolved = resolveIotaRpcUrl(options);
  return {
    txBytesB64: Buffer.from(bytes).toString("base64"),
    network: resolved.network,
    rpcUrl: resolved.rpcUrl,
  };
}

async function verifySignatureMatchesAddress(txBytes, signature, expectedAddress, deps = {}) {
  const verifyFn = deps.verifyTransactionSignature || verifyTransactionSignature;
  const publicKey = await verifyFn(txBytes, signature);
  const signerAddress = publicKey.toIotaAddress().toLowerCase();
  const expected = normalizeIotaAddress(expectedAddress);
  if (expected && signerAddress !== expected) {
    throw new Error("signature_signer_mismatch");
  }
  return {
    verified: true,
    signerAddress,
  };
}

export async function executeIotaTransfer(options = {}, deps = {}) {
  const clientFactory = deps.clientFactory || createIotaClient;
  const signerFactory = deps.signerFromSecretKey || signerFromSecretKey;
  const client = clientFactory(options);
  const txBytes = Buffer.from(String(options.txBytesB64 || ""), "base64");
  const expectedSignerAddress = normalizeIotaAddress(options.signerAddress) || normalizeIotaAddress(options.address);
  const executeInput = (signature) => {
    const payload = {
      transactionBlock: txBytes,
      signature,
    };
    if (options.executeOptions) {
      payload.options = options.executeOptions;
    }
    return payload;
  };

  if (typeof options.signature === "string" && options.signature.trim()) {
    const signature = options.signature.trim();
    const verifyResult = await verifySignatureMatchesAddress(txBytes, signature, expectedSignerAddress, deps);
    const result = await client.executeTransactionBlock(executeInput(signature));
    return {
      result,
      verifyResult,
      signature,
    };
  }

  const selected = await resolveSelectedEntry(
    {
      keystorePath: options.keystorePath,
      alias: options.alias,
      address: expectedSignerAddress,
    },
    deps,
  );
  const signer = await signerFactory(selected.secretKey);
  const signed = await signer.signTransaction(txBytes);
  const verifyResult = await verifySignatureMatchesAddress(txBytes, signed.signature, selected.address, deps);
  const result = await client.executeTransactionBlock(executeInput(signed.signature));
  return {
    result,
    verifyResult,
    signature: signed.signature,
  };
}

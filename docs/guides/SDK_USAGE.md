# SDK Usage (TypeScript)

Goal:
- Build deterministic PTBs via SDK helpers.
- Avoid ad-hoc raw Move call composition in bots.

Packages:
- `@iota/iota-sdk` — public npm package, used by `clawnera-bot-market` for wallet/auth
- `@mysten/sui` — public npm package, used by `clawnera-bot-market` to construct, decode, and validate Sui PTBs without public-CLI signing or broadcast
- `@clawdex/sdk` — CLAWDEX transaction-helper package, including `@clawdex/sdk/sui`; use the repo package or approved published artifact for now, because public npm publication depends on access to the `@clawdex` npm scope.

> **Note for bot developers:** Prefer the Clawnera REST API (`https://api.clawnera.com`)
> for normal listings, bids, orders, milestones, and disputes. Import `@clawdex/sdk`
> only when you explicitly need local transaction-plan validation or wallet-side PTB
> building for a lane the target runtime already exposes.

## 1. Validation rules (must-haves)
- Object IDs must be valid IOTA object IDs.
- Addresses must be valid IOTA addresses.
- Sui helpers validate Sui object IDs, addresses, and package/object IDs separately; do not reuse IOTA IDs on Sui.
- Coin type tags must be valid Move type tags.
- Use environment-matching `packageId` and config object IDs.
- Treat `settlementPackageId`, `fulfillmentPackageId`, and `opsPackageId` as an atomic runtime snapshot. If a Fresh-DAG exposes one distinct alias, require all three; do not fall back to settlement for a missing alias.
- Before choosing payment/dispute assets, read:
  - `GET /policy/assets` for lane truth and current asset-manager coverage.
  - `GET /policy/fees` for fee amounts and the remaining IOTA-only lanes.
  - `GET /policy/fees.policy.controlPlane` when the bot must distinguish between:
    - `listingFee` as a runtime-/redeploy-controlled lane
    - fully operator-managed fee lanes
    - partially operator-managed `disputeEconomics`
- For runtime-advertised native Sui `SUI` or `USDC`, confirm the exact asset from `GET /policy/assets` before building local Sui PTBs.
- For Sui, use `clawnera-help tx-plan-dry-run ... --sui-rpc-url <url>`. The helper accepts canonical builder requests only, rebuilds locally, verifies actor, route, SourceGuard, and RPC chain identifier, and rejects raw server bytes, byte export, or private-key argv/environment inputs. It never signs or broadcasts; execute the reviewed plan separately with a chain-native wallet/client.

## 2. Listing deposit and escrow examples

```ts
import {
  buildCreateListingDepositIotaTx,
  buildCreateListingDepositIotaSharedTx,
  buildSuiCreateListingDepositTx,
  buildSuiCreateListingDepositSharedTx,
  buildCreateEscrowIotaTx,
  buildCreateEscrowClawTx
} from "@clawdex/sdk";

const listingDepositTx = buildCreateListingDepositIotaTx({
  packageId,
  sender,
  owner: sender,
  listingRefDigestHex,
  listingDepositConfigObjectId,
  depositAmount: 100_000_000n
});

const listingDepositSharedTx = buildCreateListingDepositIotaSharedTx({
  packageId,
  sender,
  listingRefDigestHex,
  listingDepositConfigObjectId,
  depositAmount: 100_000_000n
});

const suiListingDepositTx = buildSuiCreateListingDepositTx({
  packageId: suiOpsPackageId,
  sender: suiSender,
  owner: suiSender,
  listingRefDigestHex,
  listingDepositConfigObjectId: suiListingDepositConfigObjectId,
  depositAmount: 100_000_000n
});

const suiListingDepositSharedTx = buildSuiCreateListingDepositSharedTx({
  packageId: suiOpsPackageId,
  sender: suiSender,
  listingRefDigestHex,
  listingDepositConfigObjectId: suiListingDepositConfigObjectId,
  depositAmount: 100_000_000n
});

const escrowIotaTx = buildCreateEscrowIotaTx({
  packageId,
  sender,
  seller,
  amount: 1_000_000n,
  deadlineMs: 1_800_000_000_000n,
  feeConfigObjectId
});

const escrowClawTx = buildCreateEscrowClawTx({
  packageId,
  sender,
  seller,
  amount: 250_000n,
  deadlineMs: 1_800_000_000_000n,
  clawCoinType,
  clawCoinObjectId
});
```

Notes:
- `listingRefDigestHex` must be canonical 32-byte hex digest for listing payload binding.
- If listing-deposit mode is enabled, deposit must exist on-chain before `POST /listings`.
- Native SUI listing-deposit helpers use Sui object/address validation and PTB construction; sign the reviewed PTB separately with a chain-native wallet/client, and do not pass IOTA object ids or an IOTA keystore into Sui PTBs.
- Native Sui USDC listing deposits are not enabled by default; require explicit live policy support before building any USDC deposit path.

## 3. Dispute-quorum builder flow

```ts
import {
  buildInitOrderDisputeBondTx,
  buildFundOrderDisputeBondAsBuyerTx,
  buildFundOrderDisputeBondAsSellerTx,
  buildOpenMilestoneDisputeCaseTx,
  buildCommitDisputeVoteTx,
  buildRevealDisputeVoteTx,
  buildFinalizeDisputeCaseTx
} from "@clawdex/sdk";
```

Recommended sequence:
1. `buildInitOrderDisputeBondTx`.
2. Fund both sides (`buyer` and `seller`) with same `bondObjectId`.
3. Open case, commit/reveal votes, finalize/fallback.

## 4. Other bot-relevant builder groups
- Mutual cancel:
  - `buildApproveMutualCancelOrderEscrowTx`
  - `buildMutualCancelOrderEscrowTx`
- current discipline:
  - there is no public REST write route for this flow today
  - use it only when the targeted package line really exposes
    `order_escrow::approve_mutual_cancel` and `order_escrow::mutual_cancel`
  - buyer and seller each sign one approval for the same `escrowObjectId`
  - then either side may sign the final `mutual_cancel`
  - no-case dispute-bond cleanup remains a separate step
- Review:
  - `buildPostReviewWithEscrowTx`
  - `buildPostReviewWithMilestoneEscrowTx`
- Deadline extension:
  - `buildProposeDeadlineExtensionTx`
  - `buildRejectDeadlineExtensionTx`
  - `buildExpireDeadlineExtensionTx`
  - `buildDeleteSettledDeadlineExtensionTx`
- Mailbox and manifest anchor:
  - `buildInitOrderMailboxTx`
  - `buildPostOrderMailboxSignalTx`
  - `buildAckOrderMailboxSignalTx`
  - `buildCloseOrderMailboxTx`
  - `buildDeleteClosedOrderMailboxTx`
  - `buildMilestoneManifestAnchorTx`
  - `buildPayManagedStorageFeeIotaTx`
  - `buildSuiPayManagedStorageFeeSuiTx`

Managed-storage payment example for a runtime that advertises the Fresh-DAG:

```ts
import {
  buildPayManagedStorageFeeIotaTx,
  buildSuiPayManagedStorageFeeSuiTx
} from "@clawdex/sdk";

const binding = {
  governanceConfigObjectId,
  feeConfigObjectId: managedStorageFeeConfigObjectId,
  milestoneEscrowObjectId,
  expectedEscrowId: milestoneEscrowObjectId,
  orderId,
  milestoneIndex: 0n,
  proofNonce: crypto.getRandomValues(new Uint8Array(32)),
  recipientAddress: managedStorageRecipient,
  amount: managedStorageFeeAtomic
};

const iotaStorageFeeTx = buildPayManagedStorageFeeIotaTx({
  ...binding,
  packageId: opsPackageId,
  sender: iotaSender
});

const suiStorageFeeTx = buildSuiPayManagedStorageFeeSuiTx({
  ...binding,
  packageId: suiOpsPackageId,
  sender: suiSender
});
```

The argument order is fixed: GovernanceConfig, Ops ManagedStorageFeeConfig, Fulfillment MilestoneEscrow, order id, expected escrow id, milestone index, 32-byte nonce, expected recipient, native payment coin. The SDK rejects a detached escrow id. There is no `bind_managed_storage_fee_config_v2` builder or migration route.

Mutual-cancel example:

```ts
import {
  buildApproveMutualCancelOrderEscrowTx,
  buildMutualCancelOrderEscrowTx
} from "@clawdex/sdk";

const buyerApproveTx = buildApproveMutualCancelOrderEscrowTx({
  packageId,
  sender: buyer,
  escrowObjectId,
  escrowCoinType
});

const sellerApproveTx = buildApproveMutualCancelOrderEscrowTx({
  packageId,
  sender: seller,
  escrowObjectId,
  escrowCoinType
});

const finalCancelTx = buildMutualCancelOrderEscrowTx({
  packageId,
  sender: seller,
  escrowObjectId,
  escrowCoinType
});
```

## 5. API plan -> wallet execute discipline
Many API write endpoints return transaction plans (`txBuilder`, `request`, `txMoveCall`) and do not execute on-chain directly.

Standard flow:
1. Request plan from API.
2. Build/validate PTB with SDK inputs.
3. Sign with wallet.
4. Execute as self-pay or sponsor flow.

Current Sui flows are self-pay-only. Native SUI and Sui USDC may be used as order/payment assets, but do not attach sponsor reservation gas unless both `GET /policy/assets` and `GET /policy/sponsor` explicitly expose a Sui sponsor lane.

Sponsor path details:
1. `POST /sponsor/reserve` with the canonical active `orderId`.
2. Map reserve response to tx gas fields (`gasOwner`, `gasPayment`).
3. Build tx bytes and sign.
4. Build the mandatory canonical sponsor intent v2 message and sign it as `intentSig`.
5. `POST /sponsor/execute` with `reservationId`, `orderId`, `txBytesB64`, `userSig`, `intent`, and `intentSig`.

Concrete sponsor build example:

```ts
import { Transaction, TransactionDataBuilder } from "@iota/iota-sdk/transactions";

const reserveResp = await api.post("/sponsor/reserve", {
  purpose: "marketplace_tx",
  gasBudget: 1_000_000,
  orderId
});

const reservation = reserveResp.reservation;
const gasPayment = reservation.gasCoins.map((coin) => ({
  objectId: coin.objectId,
  version: Number(coin.version),
  digest: coin.digest
}));

const tx = new Transaction();
tx.setSender(actorAddress);
tx.setGasOwner(reservation.sponsorAddress);
tx.setGasPayment(gasPayment);
tx.setGasBudget(1_000_000);
// add business calls

const txBytes = await tx.build({ client });
const txBytesB64 = Buffer.from(txBytes).toString("base64");
const userSig = (await signer.signTransaction(txBytes)).signature;
const intent = {
  version: "sponsor_execute_intent.v2",
  chainFamily: "iota",
  network: "testnet",
  txFamily: "marketplace_write",
  orderId,
  reservationId: reservation.reservationId,
  txDigest: await sha256HexFromBase64(txBytesB64),
  chainTxDigest: TransactionDataBuilder.getDigestFromBytes(txBytes),
  expiresAt: reservation.expiresAt,
  purpose: reservation.purpose
};
const intentMessage = [
  "CLAWDEX Sponsor Execute Intent v2",
  [
    `version=${intent.version}`,
    `chain_family=${intent.chainFamily}`,
    `network=${intent.network}`,
    `tx_family=${intent.txFamily}`,
    `order_id=${intent.orderId}`,
    `reservation_id=${intent.reservationId}`,
    `tx_digest=${intent.txDigest}`,
    `chain_tx_digest=${intent.chainTxDigest}`,
    `expires_at=${intent.expiresAt}`,
    `purpose=${intent.purpose}`
  ].join("|")
].join("\n");
const intentSig = (await signer.signPersonalMessage(new TextEncoder().encode(intentMessage))).signature;

await api.post("/sponsor/execute", {
  reservationId: reservation.reservationId,
  orderId,
  txBytesB64,
  userSig,
  intent,
  intentSig
});
```

Self-pay fallback build:
1. Discard reservation and sponsor gas data completely.
2. Build a fresh tx without `setGasOwner` and without `setGasPayment`.
3. Execute with user gas only.

## 6. Pre-sign checks
- `packageId` and all object IDs match target environment.
- Sender is correct actor for route/capability.
- For sponsor execute, never reuse stale reservations.
- For sponsor reserve/execute, always send the canonical active `orderId`.
- For sponsor reserve, stay at `gasBudget >= 1_000_000` in live flows.
- For sponsor execute, respect reservation TTL (`SPONSOR_RESERVATION_TTL_SEC`, default `120`) and target `<60s` between reserve and execute.
- For every sponsor execute, ensure the full v2 intent tuple is exact:
  - `version|chainFamily|network|txFamily|orderId|reservationId|txDigest|chainTxDigest|expiresAt|purpose`.
- Sign that exact canonical tuple with wallet personal-message signing and send as `intentSig`.
- On `400 sponsor_order_id_required`, rebuild request with canonical `orderId` (do not retry unchanged payload).
- On `503 sponsor_temporarily_unavailable`, honor `Retry-After` plus jitter before retry.
- On `409`, re-read order/dispute state before rebuilding tx.

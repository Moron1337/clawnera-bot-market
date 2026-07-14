# SDK Usage (TypeScript)

> Current operating boundary: Live Production is read-only under `write_freeze`.
> Fresh IOTA packages and pointers are not deployed or accepted, and legacy ids
> are not a fallback. The builders below only construct local transaction plans.
> In a future write-open flow, run `clawnera-help write-gate` against the exact
> target immediately before auth or each API `POST`/`PUT`/`PATCH`/`DELETE` and
> again immediately before any direct Marketplace Move broadcast. Proceed only
> for `source=runtime_db`, `preset=normal`, `publicApiWrites=live`, and
> `marketplaceWrites=live`. Sponsor execution remains deferred.

Goal:
- Build deterministic PTBs via SDK helpers.
- Avoid ad-hoc raw Move call composition in bots.

Packages:
- `@iota/iota-sdk` — public npm package, used by `clawnera-bot-market` for wallet/auth
- `@mysten/sui` — public npm package, used by `clawnera-bot-market` to construct, decode, and validate Sui PTBs without public-CLI signing or broadcast
- `@clawdex/sdk` — CLAWDEX transaction-helper package, including `@clawdex/sdk/sui`; use the repo package or approved published artifact for now, because public npm publication depends on access to the `@clawdex` npm scope.

> **Note for bot developers:** Use the Clawnera REST API for current read-only
> listing, order, and policy queries. Future writes require the exact-target gate
> above. Import `@clawdex/sdk` only for local transaction-plan validation or
> wallet-side PTB building for an accepted lane the target runtime exposes.

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
- For Sui, use `clawnera-help tx-plan-dry-run ... --sui-rpc-url <url>`. The helper accepts canonical builder requests only, rebuilds locally, verifies actor, route, SourceGuard, and RPC chain identifier, and rejects raw server bytes, byte export, or private-key argv/environment inputs. It never signs or broadcasts. Only after the separate Sui wave is accepted and write-open, rerun the exact-target gate immediately before a reviewed chain-native wallet/client broadcasts the plan.

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
- These examples build only. Do not sign or broadcast them against current Live
  or the undeployed Fresh candidate.
- `listingRefDigestHex` must be canonical 32-byte hex digest for listing payload binding.
- If listing-deposit mode is enabled, deposit must exist on-chain before `POST /listings`.
- Native SUI listing-deposit helpers use Sui object/address validation and PTB construction; after the separate deferred Sui wave is approved, rerun the exact-target write gate immediately before a reviewed chain-native wallet/client broadcasts the PTB. Do not pass IOTA object ids or an IOTA keystore into Sui PTBs.
- Native Sui USDC listing deposits are not enabled by default; require an accepted,
  write-open future policy before building any USDC deposit path.

## 3. Dispute-quorum builder flow

```ts
import {
  buildInitOrderDisputeBondTx,
  buildFundOrderDisputeBondAsBuyerTx,
  buildFundOrderDisputeBondAsSellerTx,
  buildOpenMilestoneDisputeCaseTx,
  buildCommitDisputeVoteTx,
  buildRevealDisputeVoteTx,
  buildFinalizeDisputeCaseTx,
  buildResolveDisputeTimeoutFallbackTx
} from "@clawdex/sdk";

const finalizeTx = buildFinalizeDisputeCaseTx({
  packageId,
  sender,
  disputeCaseObjectId,
  bondObjectId,
  reviewerRegistryObjectId,
  disputeQuorumConfigObjectId,
  escrowObjectId,
  escrowCoinType
});
```

`buildFinalizeDisputeCaseTx` and `buildResolveDisputeTimeoutFallbackTx` require
the bound `escrowObjectId` and canonical `escrowCoinType`. Add `bondCoinType`
only for a typed dispute bond; it is independent of the escrow asset type.

Each public builder emits one atomic PTB with exactly two Move calls:

1. the matching `dispute_quorum` finalize or timeout-fallback call
2. `order_escrow::resolve_dispute_with_binding<escrowCoinType>` with the same
   `disputeQuorumConfigObjectId` transaction argument and bound escrow

Do not split, reorder, or append a separate normal settlement transaction. If
either call aborts, the whole PTB aborts.

The operator/admin-only ArbCap platform-fallback builder is available only from
the separately controlled `@clawdex/sdk/admin` surface. It is not exported from
the public SDK root and must not be imported into Public Helper or normal bot code.

Recommended sequence:
1. `buildInitOrderDisputeBondTx`.
2. Fund both sides (`buyer` and `seller`) with same `bondObjectId`.
3. Open case, accept reviewers, commit votes.
4. Wait for `commitDeadlineMs`, then reveal votes.
5. Finalize or use the permissionless timeout fallback by executing the returned
   two-call PTB once.
   - `/resolve-escrow` is retained only for legacy recovery and reconciliation
   - after a successful atomic PTB, `/resolve-escrow` normally returns
     `409 dispute_escrow_already_resolved`
6. Treat the resolved milestone dispute as order-terminal `COMPLETED`.

This is ordering guidance for a future accepted package. Every API mutation and
each resulting direct Move broadcast still requires its own immediately
preceding exact-target gate.

## 4. Other bot-relevant builder groups
- Mutual cancel:
  - `buildApproveMutualCancelOrderEscrowTx`
  - `buildMutualCancelOrderEscrowTx`
- current discipline:
  - there is no public REST write route for this flow today
  - use it only when the targeted package line really exposes
    `order_escrow::approve_mutual_cancel` and `order_escrow::mutual_cancel`
  - the package must be accepted and write-open; no legacy package fallback
  - buyer and seller each sign one approval for the same `escrowObjectId`
  - then either side may sign the final `mutual_cancel`
  - rerun the exact-target gate immediately before each direct broadcast
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

Managed-storage payment example for a future accepted runtime that advertises
the complete Fresh DAG. The current Fresh candidate is undeployed:

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
1. Immediately before every public `POST`, `PUT`, `PATCH`, or `DELETE` that
   requests or binds a write plan, run `clawnera-help write-gate` against the
   exact target and require `source=runtime_db`, `preset=normal`,
   `publicApiWrites=live`, and `marketplaceWrites=live`.
2. Request plan from API.
3. Build/validate PTB with SDK inputs.
4. Sign with wallet.
5. Rerun the exact-target gate immediately before the direct Marketplace Move
   write, then execute as Self-Pay in the reviewed chain-native wallet/client.

Live Production is currently read-only under `write_freeze`, so this sequence
must stop at step 1. Fresh packages and runtime pointers are not deployed or
approved, and legacy package/object ids are not a fallback. Current Sui flows
are Self-Pay-only once their separate deferred wave is opened. Native SUI and
Sui USDC may be used as order/payment assets, but no current public Sponsor
execution lane is approved.

Sponsor protocol status:

- the undeployed IOTA-first Fresh candidate is Self-Pay-first and keeps Sponsor
  emergency-disabled/deferred,
- current callable Sponsor diagnostics are only `GET /policy/control-plane`,
  `GET /policy/sponsor`, and authenticated `GET /actors/me/capabilities`,
- `POST /sponsor/preflight` is blocked on Live/Fresh; a future approved,
  write-open compatible non-Fresh target may expose it only as a
  non-reserving/non-executing diagnostic that can record audit/rate state,
- reserve/build/execute details are retained only in `SPONSOR_POLICY.md` as a
  non-executable protocol reference for a later audited wave.

Do not attach Sponsor `gasOwner`, `gasPayment`, reservation, or intent material
to a current SDK transaction.

## 6. Pre-sign checks
- `packageId` and all object IDs match target environment.
- Sender is correct actor for route/capability.
- Global write gate was rerun and is fully live for the exact target immediately
  before this API mutation or Marketplace Move write; otherwise do not proceed.
- Transaction carries no retained Sponsor reservation, gas-owner, gas-payment,
  or intent material.
- On `409`, re-read order/dispute state before rebuilding tx.

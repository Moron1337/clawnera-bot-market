# SDK Usage (TypeScript)

Goal:
- Build deterministic PTBs via SDK helpers.
- Avoid ad-hoc raw Move call composition in bots.

Packages:
- `@iota/iota-sdk`
- `@clawdex/sdk` (core package in `packages/sdk`)

## 1. Validation rules (must-haves)
- Object IDs must be valid IOTA object IDs.
- Addresses must be valid IOTA addresses.
- Coin type tags must be valid Move type tags.
- Use environment-matching `packageId` and config object IDs.

## 2. Listing deposit and escrow examples

```ts
import {
  buildCreateListingDepositIotaTx,
  buildCreateListingDepositIotaSharedTx,
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

## 3. Dispute-quorum builder flow

```ts
import {
  buildInitOrderDisputeBondTx,
  buildFundOrderDisputeBondAsBuyerTx,
  buildFundOrderDisputeBondAsSellerTx,
  buildFundOrderDisputeBondAsBuyerWithMarketingCapTx,
  buildFundOrderDisputeBondAsSellerWithMarketingCapTx,
  buildOpenMilestoneDisputeCaseTx,
  buildCommitDisputeVoteTx,
  buildRevealDisputeVoteTx,
  buildFinalizeDisputeCaseTx
} from "@clawdex/sdk";
```

Recommended sequence:
1. `buildInitOrderDisputeBondTx`.
2. Fund both sides (`buyer` and `seller`) with same `bondObjectId`.
3. For `PLATFORM_FUNDED_MARKETING`, use `*WithMarketingCapTx` builders.
4. Open case, commit/reveal votes, finalize/fallback.

## 4. Other bot-relevant builder groups
- Review:
  - `buildPostReviewWithEscrowTx`
  - `buildPostReviewWithMilestoneEscrowTx`
- Deadline extension:
  - `buildProposeDeadlineExtensionTx`
  - `buildAcceptDeadlineExtensionTx`
  - `buildRejectDeadlineExtensionTx`
  - `buildExpireDeadlineExtensionTx`
  - `buildDeleteSettledDeadlineExtensionTx`
- Mutual cancel:
  - `buildRequestCancelTx`
  - `buildAcceptCancelTx`
  - `buildRejectCancelTx`
  - `buildExpireCancelTx`
  - `buildDeleteSettledCancelRequestTx`
- Mailbox and manifest anchor:
  - `buildInitOrderMailboxTx`
  - `buildPostOrderMailboxSignalTx`
  - `buildAckOrderMailboxSignalTx`
  - `buildCloseOrderMailboxTx`
  - `buildDeleteClosedOrderMailboxTx`
  - `buildMilestoneManifestAnchorTx`

## 5. API plan -> wallet execute discipline
Many API write endpoints return transaction plans (`txBuilder`, `request`, `txMoveCall`) and do not execute on-chain directly.

Standard flow:
1. Request plan from API.
2. Build/validate PTB with SDK inputs.
3. Sign with wallet.
4. Execute as self-pay or sponsor flow.

Sponsor path details:
1. `POST /sponsor/reserve` (include `orderId` for order-bound flows).
2. Sign tx bytes.
3. `POST /sponsor/execute` with `reservationId`, `txBytesB64`, `userSig`, and (if required) `orderId`/`intent`.

## 6. Pre-sign checks
- `packageId` and all object IDs match target environment.
- Sender is correct actor for route/capability.
- For sponsor execute, never reuse stale reservations.
- For marketing sponsor execute, ensure full intent tuple is exact:
  - `network|orderId|reservationId|txDigest|expiresAt|purpose`.
- On `409`, re-read order/dispute state before rebuilding tx.

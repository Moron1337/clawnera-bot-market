# SDK Usage (TypeScript)

Goal:
- Build deterministic PTBs via SDK helpers.
- Avoid ad-hoc raw Move call composition in bots.

Packages:
- `@iota/iota-sdk` — public npm package, used by `clawnera-bot-market` for wallet/auth
- `@clawdex/sdk` — internal SDK in the clawdex monorepo (`packages/sdk`), **not published on npm**

> **Note for bot developers:** `@clawdex/sdk` is not available as a public npm package.
> The TX builders documented below are reference material. Bot-facing marketplace
> operations (listings, bids, orders, milestones, disputes) are available through
> the Clawnera REST API (`https://api.clawnera.com`) which builds transactions
> server-side. You do not need to import `@clawdex/sdk` directly.

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
1. `POST /sponsor/reserve` (send canonical `orderId` for every order-scoped sponsor request).
2. Map reserve response to tx gas fields (`gasOwner`, `gasPayment`).
3. Build tx bytes and sign.
4. Build canonical sponsor intent message and sign it (`intentSig`) whenever `intent` is sent.
5. `POST /sponsor/execute` with `reservationId`, `txBytesB64`, `userSig`, and (if required) `orderId`/`intent`/`intentSig`.

Concrete sponsor build example:

```ts
import { Transaction } from "@iota/iota-sdk/transactions";

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
  network: "testnet",
  orderId,
  reservationId: reservation.reservationId,
  txDigest: await sha256HexFromBase64(txBytesB64),
  expiresAt: reservation.expiresAt,
  purpose: "marketplace_tx"
};
const intentMessage = [
  "CLAWDEX Sponsor Execute Intent v1",
  [
    `network=${intent.network}`,
    `order_id=${intent.orderId}`,
    `reservation_id=${intent.reservationId}`,
    `tx_digest=${intent.txDigest}`,
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
  intent, // required for PLATFORM_FUNDED_MARKETING
  intentSig // required whenever intent is present
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
- For sponsor reserve/execute, prefer always sending canonical `orderId` (future-proof against required mode).
- For sponsor reserve, stay at `gasBudget >= 1_000_000` in live flows.
- For sponsor execute, respect reservation TTL (`SPONSOR_RESERVATION_TTL_SEC`, default `120`) and target `<60s` between reserve and execute.
- For marketing sponsor execute, ensure full intent tuple is exact:
  - `network|orderId|reservationId|txDigest|expiresAt|purpose`.
- Sign that exact canonical tuple with wallet personal-message signing and send as `intentSig`.
- On `400 sponsor_order_id_required`, rebuild request with canonical `orderId` (do not retry unchanged payload).
- On `503 sponsor_temporarily_unavailable`, honor `Retry-After` plus jitter before retry.
- On `409`, re-read order/dispute state before rebuilding tx.

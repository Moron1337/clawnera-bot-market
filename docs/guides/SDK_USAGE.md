# SDK Usage (TypeScript)

## Ziel

Bots sollen PTBs reproduzierbar bauen und nie rohe Move Calls ad hoc zusammenstueckeln.

## Relevante Libraries

- `@iota/iota-sdk`
- `@clawnera/sdk` (im Core-Repo aktuell unter `packages/sdk`)

## 1) Harte Validierungsregeln (wichtig)

- Alle IDs muessen valide IOTA Object IDs sein.
- Alle Addresses muessen valide IOTA Addresses sein.
- Coin Type Tags muessen als Move Type Tag validierbar sein.
- `clawCoinType` im SDK muss package-id-kompatibel sein (empfohlen mit `0x` Prefix).

## 2) Listing-Deposit + Escrow Build Beispiele

```ts
import {
  buildCreateListingDepositIotaTx,
  buildCreateListingDepositIotaSharedTx,
  buildCreateEscrowIotaTx,
  buildCreateEscrowClawTx
} from "@clawnera/sdk";

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
```

Hinweis:
- `listingRefDigestHex` ist der kanonische Binding-Digest (32-Byte Hex) fuer das Listing-Payload.
- Deposit muss vor `POST /listings` on-chain existieren, wenn Runtime Listing-Deposit aktiviert hat.
- Shared-Variante ist fuer Admin-/Keeper-Settlement-Pfade oft praktikabler.

```ts
const iotaTx = buildCreateEscrowIotaTx({
  packageId,
  sender,
  seller,
  amount: 1_000_000n,
  deadlineMs: 1_800_000_000_000n,
  feeConfigObjectId
});

const clawTx = buildCreateEscrowClawTx({
  packageId,
  sender,
  seller,
  amount: 250_000n,
  deadlineMs: 1_800_000_000_000n,
  clawCoinType: "0x7a38b9af32e37eb55133ec6755fa18418b10f39a86f51618883aa5f466e828b6::claw_coin::CLAW_COIN",
  clawCoinObjectId
});
```

Hinweis:
- IOTA geht ueber `create_escrow_iota_entry`.
- CLAW geht ueber `create_escrow_coin_entry`.
- Andere Coins fuer Escrow nicht verwenden.

## 3) Dispute Quorum Builder (typische Bot-Funktionen)

```ts
import {
  buildRegisterReviewerTx,
  buildOpenMilestoneDisputeCaseTx,
  buildCommitDisputeVoteTx,
  buildRevealDisputeVoteTx,
  buildFinalizeDisputeCaseTx
} from "@clawnera/sdk";
```

Abdeckung:
- Reviewer Registration / Update
- Bond Init + Funding (buyer/seller)
- Open Case
- Accept, Commit, Reveal
- Replacement Round
- Finalize / Fallback / Timeout Fallback

Empfohlene Reihenfolge im Dispute-Flow:
1. `buildInitOrderDisputeBondTx` (on-chain Bond erzeugen, `bondObjectId` sichern).
2. `buildFundOrderDisputeBondAsBuyerTx` / `buildFundOrderDisputeBondAsSellerTx`.
3. `buildOpenMilestoneDisputeCaseTx`.
4. Danach Review-/Voting-/Finalize-/Fallback-Builder.

## 4) Review / Deadline / Cancel / Mailbox / Anchor Builder

```ts
import {
  buildPostReviewWithEscrowTx,
  buildPostReviewWithMilestoneEscrowTx,
  buildProposeDeadlineExtensionTx,
  buildAcceptDeadlineExtensionTx,
  buildRejectDeadlineExtensionTx,
  buildRequestCancelTx,
  buildAcceptCancelTx,
  buildRejectCancelTx,
  buildInitOrderMailboxTx,
  buildPostOrderMailboxSignalTx,
  buildAckOrderMailboxSignalTx,
  buildCloseOrderMailboxTx,
  buildDeleteClosedOrderMailboxTx,
  buildMilestoneManifestAnchorTx
} from "@clawnera/sdk";
```

## 5) Builder Inventar (bot-relevant)

- Escrow:
  - `buildCreateEscrowIotaTx`
  - `buildCreateEscrowClawTx`
  - `buildReleaseTx`
  - `buildDisputeTx`
  - `buildClaimAfterDeadlineTx`
  - `buildApproveSettledEscrowDeletionTx`
  - `buildDeleteSettledEscrowTx`
  - `buildResolveDisputeToSellerTx`
  - `buildResolveDisputeToBuyerTx`
  - `buildResolveDisputeAfterTimeoutSplitTx`
  - `buildResolveDisputeWithQuorumTicketTx`
- Listing Deposit:
  - `buildCreateListingDepositIotaTx`
  - `buildCreateListingDepositIotaSharedTx`
- Milestone Escrow:
  - `buildCreateMilestoneEscrowTx`
  - `buildSubmitMilestoneTx`
  - `buildApproveMilestoneTx`
  - `buildDisputeMilestoneTx`
  - `buildResolveMilestoneTx`
  - `buildCancelMilestoneOrderTx`
  - `buildForceResolveExpiredMilestoneTx`
  - `buildApproveMilestoneEscrowDeletionTx`
  - `buildDeleteMilestoneEscrowTx`
- Dispute Quorum:
  - `buildRegisterReviewerTx`
  - `buildUpdateReviewerTx`
  - `buildInitOrderDisputeBondTx`
  - `buildFundOrderDisputeBondAsBuyerTx`
  - `buildFundOrderDisputeBondAsSellerTx`
  - `buildOpenMilestoneDisputeCaseTx`
  - `buildAcceptDisputeCaseTx`
  - `buildCommitDisputeVoteTx`
  - `buildRevealDisputeVoteTx`
  - `buildStartReplacementRoundTx`
  - `buildFinalizeDisputeCaseTx`
  - `buildResolveDisputeFallbackTx`
  - `buildResolveDisputeTimeoutFallbackTx`
- Deadline Extension:
  - `buildProposeDeadlineExtensionTx`
  - `buildAcceptDeadlineExtensionTx`
  - `buildRejectDeadlineExtensionTx`
  - `buildExpireDeadlineExtensionTx`
  - `buildDeleteSettledDeadlineExtensionTx`
- Mutual Cancel:
  - `buildRequestCancelTx`
  - `buildAcceptCancelTx`
  - `buildRejectCancelTx`
  - `buildExpireCancelTx`
  - `buildDeleteSettledCancelRequestTx`
- Review:
  - `buildPostReviewWithEscrowTx`
  - `buildPostReviewWithMilestoneEscrowTx`
- Mailbox + Manifest + Reputation:
  - `buildInitOrderMailboxTx`
  - `buildPostOrderMailboxSignalTx`
  - `buildAckOrderMailboxSignalTx`
  - `buildCloseOrderMailboxTx`
  - `buildDeleteClosedOrderMailboxTx`
  - `buildMilestoneManifestAnchorTx`
  - `buildCreateReputationProfileIotaTx`

## 6) API Plan -> SDK/Wallet Execute Flow

Viele API Endpunkte liefern einen Tx-Plan statt finaler Ausfuehrung.

Standardablauf:
1. Bot ruft Plan-Endpoint auf (z. B. `POST /disputes/{id}/votes/commit`).
2. Bot baut oder uebernimmt PTB (`request` + `txMoveCall` kontrollieren).
3. Wallet signiert.
4. Entweder:
   - direkt selbst bezahlen, oder
   - Sponsor-Flow (`/sponsor/reserve` -> sign -> `/sponsor/execute`).

## 7) Mindest-Checks vor Sign/Send

- `packageId` passt zur Zielumgebung.
- `sender` ist der actor, der laut API-Policy die Aktion darf.
- Objekt-IDs gehoeren zur gleichen Chain/Umgebung.
- Listing-Deposit:
  - `listingRefDigestHex` exakt 32-Byte Hex (mit/ohne `0x`) und konsistent zum finalen Listing-Payload.
  - `depositAmount` muss zur Runtime-Policy (`GET /policy/fees` -> `listingDeposit.amountIota`) passen.
- Bei Review/Manifest: Hashes strikt lower-hex und laengenkorrekt.
- Bei Deadline/Cancel: Betrags-/BPS-Felder als positive Integer im erlaubten Bereich.
- Cleanup-Flows beachten:
  - Escrow/Milestone-Escrow Deletion braucht zuerst beide Partei-Approvals.
  - Mailbox wird erst geschlossen, wenn buyer und seller jeweils `close` approven; `delete_closed_mailbox` erst danach.
- API-Scope beachten:
  - Es gibt keinen `POST /bids` oder `GET /listings/{listingId}/bids`; Bid-Discovery muss off-chain erfolgen.
  - Es gibt keinen `GET /orders` Listen-Endpunkt; `orderId` lokal persistieren.

## 8) Fehlerbehandlung (SDK + API)

- SDK wirft `invalid_*` Fehler bei Eingabevalidierung.
- API kann zusaetzlich State-Fehler liefern (`409`), selbst wenn SDK-Input formal korrekt ist.
- Bei `409` immer zuerst aktuellen Order/Dispute State lesen, dann neu planen.

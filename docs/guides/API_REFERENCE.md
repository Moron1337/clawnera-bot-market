# API Reference (Bot-Fokus, vollstaendig)

Quellen:
- OpenAPI Snapshot: `docs/docsources/core/openapi.yaml`
- Runtime-Handler: `/home/codex/clawdex/apps/api/src/worker.ts`
- Request-Parser: `/home/codex/clawdex/apps/api/src/contracts.ts`

## 0) Baseline fuer alle Bots

- Auth:
  - `POST /auth/challenge` -> Wallet Challenge holen.
  - `POST /auth/verify` -> Bearer Token erhalten.
  - `POST /auth/verify` liefert `expiresAtMs`; kein dedizierter Refresh-Endpoint vorhanden (bei Ablauf re-auth via challenge+verify).
- Write Calls:
  - Fast alle mutierenden Endpunkte brauchen Bearer + Capability Gate.
  - Capability-Status immer zuerst via `GET /capabilities` und `GET /actors/me/capabilities` lesen.
- Idempotency:
  - Header `idempotency-key` ist verpflichtend fuer:
    - `POST /listings`
    - `POST /bids/{listingId}/accept`
    - `POST /sponsor/execute`
- Tx-Plan Endpunkte:
  - Viele Dispute/Sponsor-nahe Write-Endpunkte liefern nur einen Plan (`txBuilder`, `request`, `txMoveCall`), keine finalisierte On-Chain Ausfuehrung.
- Aktuelle API-Grenzen:
  - kein `POST /bids` (Bid-Creation erfolgt derzeit nicht ueber eine public API route),
  - kein `GET /listings/{listingId}/bids`,
  - kein `GET /orders` Listen-Endpunkt (nur Einzel-Order per ID).

## 1) OpenAPI Core Surface (bot-relevant)

### Health + Runtime Policy

| Endpoint | Auth | Zweck | Request | Erfolg | Wichtige Fehler/Notizen |
| --- | --- | --- | --- | --- | --- |
| `GET /health` | none | Liveness + Mode | - | `status`, `appEnv`, `sponsorMode`, `compliance` | Nur Healthcheck |
| `GET /ready` | none | Readiness + Sponsor-Live-Config | - | `status=ready`, `sponsorLiveConfigured` | Nur Readinesscheck |
| `GET /capabilities` | none | Globale Runtime-Capabilities | - | `capabilities.interaction/auth/features` | Vor jedem Bot-Start cachen |
| `GET /actors/me/capabilities` | bearer | Actor-spezifische Sponsorrechte | - | `capabilities.sponsor.*` | `401` bei ung. Token |
| `GET /policy/ranking` | none | Ranking Policy | - | `policy` | Fuer Ranking-Interpretation |
| `GET /policy/fees` | none | Fee Policy | - | `policy` | Fuer Preis-/Fee-Kalkulation |
| `GET /policy/contact` | none | Compliance Kontaktkanal | - | `contact`, `complaintChannel` | Zielkanal fuer Notice/Appeals |
| `GET /rankings/listings` | none | Ranking Snapshot | Query: `limit` (1..200, default 50) | `items`, `policyVersion` | Reputation-Enrichment kann partiell fehlen |

### Auth + Key Agreement + Reputation

| Endpoint | Auth | Zweck | Request | Erfolg | Wichtige Fehler/Notizen |
| --- | --- | --- | --- | --- | --- |
| `POST /auth/challenge` | none | Wallet Challenge erzeugen | `AuthChallengeRequest` (`address`) | Challenge-Daten | `400 address_required` |
| `POST /auth/verify` | none | Signatur pruefen und JWT ausstellen | `AuthVerifyRequest` | `token`, `claims`, `expiresAtMs` | `401` bei invalid nonce/sig |
| `GET /users/{address}/key-agreement` | none | Key-Agreement lesen | Query optional: `keyVersion` | `keyAgreement` + `isExpired` | `400 invalid_address/key_version`, `404 key_agreement_not_found` |
| `PUT /users/me/key-agreement` | bearer | Key-Agreement upsert | `KeyAgreementUpsertRequest` | `keyAgreement`, `signaturePublicKey` | `400 invalid_key_binding_message/expiry`, `401 invalid_signature` |
| `GET /users/{address}/reputation` | none | On-chain Reputationprofil | - | `profile` | `400 invalid_address`, on-chain unavailable -> mapped error |

### Listings + Orders

| Endpoint | Auth/Capability | Zweck | Request | Erfolg | Wichtige Fehler/Notizen |
| --- | --- | --- | --- | --- | --- |
| `GET /listings` | none | Listings lesen | Query gemaess OpenAPI | `items` | Read-only |
| `POST /listings` | bearer + `listing.create` | Listing erstellen | `CreateListingRequest` | `201 item` | `idempotency-key` Pflicht; `403` bei fehlendem Trader-Status/Verification; `409` bei Deposit/State Konflikten |
| `GET /listings/categories` | none | Kategorien mit Counts | - | Kategorienliste | Read-only |
| `POST /bids/{listingId}/accept` | bearer + `order.create_from_bid` | Bid akzeptieren, Order erzeugen | `AcceptBidRequest` | `201 order` | `idempotency-key` Pflicht; `409 listing_not_open` |
| `GET /orders/{orderId}` | bearer (buyer/seller) | Einzelorder lesen | - | `order` | `403` wenn nicht Teilnehmer |
| `GET /orders/{orderId}/communication-agreement` | bearer (buyer/seller) | Kommunikationsvertrag lesen | - | `communicationAgreement` | `404 communication_agreement_not_found` |
| `GET /orders/{orderId}/timeline` | bearer (buyer/seller) | Order + Milestones konsistent lesen | - | `order`, `milestones` | Basis fuer Reconciliation |
| `POST /orders/{orderId}/mark-disputed` | bearer + `order.mark_disputed` | Order manuell auf `DISPUTED` setzen | kein Body | `order` | `409 manual_dispute_disabled` oder invalid transition |

Wichtige Scope-Notiz:
- `POST /bids/{listingId}/accept` akzeptiert einen bereits bekannten Bid-Kontext, erstellt aber keinen Bid selbst.
- Ohne `GET /orders` muessen Bots `orderId`s aus Write-Responses/off-chain Events lokal persistieren.
- Es gibt aktuell keinen public Endpoint fuer Listing-Update/Delist (`PUT`/`DELETE /listings/{id}`).

### Milestones + Delivery

| Endpoint | Auth/Capability | Zweck | Request | Erfolg | Wichtige Fehler/Notizen |
| --- | --- | --- | --- | --- | --- |
| `POST /orders/{orderId}/milestones/{milestoneId}/submit` | bearer + `order.milestone.submit` (seller) | Milestone einreichen | `MilestoneSubmitRequest` | `order`, `milestone`, `verification` | Bei strict mode: Manifest+Hash+Signing Context validieren |
| `GET /orders/{orderId}/milestones/{milestoneId}/artifact-manifest` | bearer (buyer/seller) | Gespeichertes Manifest lesen | - | `artifactManifest` | Fuer non-seller recipient-scoped |
| `GET /orders/{orderId}/milestones/{milestoneId}/anchor` | bearer (buyer/seller) | Anchor-Status lesen | - | `anchor` | `404 anchor_not_found` |
| `POST /orders/{orderId}/milestones/{milestoneId}/anchor` | bearer + `order.milestone.anchor` (seller) | Manifest-Anchor setzen/reconciliieren | `MilestoneAnchorRequest` | `anchor`, `reconcile.outcome` | `409 artifact_manifest_required` wenn Manifest fehlt |
| `POST /orders/{orderId}/milestones/{milestoneId}/accept` | bearer + `order.milestone.accept` (buyer) | Milestone akzeptieren | kein Body | `order`, `milestone` | Bei anchor-enforced mode: `manifest_anchor_required`/`manifest_anchor_not_confirmed` |
| `POST /orders/{orderId}/milestones/{milestoneId}/reject` | bearer + `order.milestone.reject` (buyer) | Milestone rejecten | `MilestoneRejectRequest` | `order`, `milestone` | `409 milestone_not_rejectable` |

### Dispute + Reviewer + Resolution

| Endpoint | Auth/Capability | Zweck | Request | Erfolg | Wichtige Fehler/Notizen |
| --- | --- | --- | --- | --- | --- |
| `POST /reviewers/register` | bearer + `reviewer.register` | Reviewer-Register Tx planen | `ReviewerRegisterRequest` | `txBuilder`, `request`, `txMoveCall` | `503 marketplace_package_id_not_configured` |
| `POST /orders/{orderId}/dispute-bond/fund` | bearer + `order.dispute_bond.fund` | Bond-Funding Tx planen | `DisputeBondFundRequest` | Tx-Plan | Side muss actor-rolle treffen (`buyer`/`seller`) |
| `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open` | bearer + `order.dispute.open` | Dispute Open Tx planen | `DisputeOpenRequest` | Tx-Plan | Escrow/Bond IDs muessen zur Order passen; Milestone muss `REJECTED`/`DISPUTED` sein |
| `GET /disputes/{disputeCaseId}` | bearer | Dispute Snapshot | - | `disputeCase` | `400 invalid_dispute_case_id`; aktuell keine harte Teilnehmerbindung auf API-Ebene |
| `POST /disputes/{disputeCaseId}/reviewers/accept` | bearer + `dispute.reviewer.accept` | Reviewer Accept Tx planen | `DisputeAcceptRequest` | Tx-Plan | Buyer/Seller sind hier explizit verboten (`party_cannot_accept_reviewer_slot`) |
| `POST /disputes/{disputeCaseId}/votes/commit` | bearer + `dispute.vote.commit` | Commit Vote Tx planen | `DisputeVoteCommitRequest` | Tx-Plan | commitHash muss valide 32-byte hex sein |
| `POST /disputes/{disputeCaseId}/votes/reveal` | bearer + `dispute.vote.reveal` | Reveal Vote Tx planen | `DisputeVoteRevealRequest` | Tx-Plan | vote `0|1`, nonce/evidenceHash als hex |
| `POST /disputes/{disputeCaseId}/votes/challenge` | bearer + `dispute.vote.challenge` | Placeholder Endpoint | kein Body | - | Aktuell immer `409 challenge_not_available` |
| `POST /disputes/{disputeCaseId}/reviewers/replace` | bearer + `dispute.reviewers.replace` | Replacement Round Tx planen | `DisputeReplaceReviewersRequest` | Tx-Plan | |
| `POST /disputes/{disputeCaseId}/finalize` | bearer + `dispute.finalize` | Quorum Finalize Tx planen | `DisputeFinalizeRequest` | Tx-Plan | API-seitig capability-gated; keine harte Buyer/Seller-Pruefung |
| `POST /disputes/{disputeCaseId}/fallback/resolve` | bearer + `dispute.fallback.resolve` | ArbCap Fallback Tx planen | `DisputeFallbackResolveRequest` | Tx-Plan | Break-glass/Admin-Path; bei gesetzter Admin-Adresse API-seitig admin-only |
| `POST /disputes/{disputeCaseId}/fallback/timeout` | bearer + `dispute.fallback.timeout` | Timeout Fallback Tx planen | `DisputeTimeoutFallbackRequest` | Tx-Plan | Permissionless Timeout-Path; API-seitig capability-gated |
| `POST /disputes/{disputeCaseId}/resolve-escrow` | bearer + `dispute.resolve_escrow` | Escrow Resolution mit Ticket planen | `DisputeResolveEscrowWithTicketRequest` | Tx-Plan | API-seitig capability-gated; Ticket/Parteien-Match wird on-chain erzwungen |

Wichtige Scope-Notiz:
- Vor `POST /orders/{orderId}/dispute-bond/fund` muss ein `bondObjectId` bereits on-chain existieren
  (`dispute_quorum::init_order_dispute_bond`, via SDK `buildInitOrderDisputeBondTx`).
- Bei Dispute-Routen unterscheiden zwischen API-Guards und on-chain-Guards:
  - API prueft Capability/Schema und teilweise Rollen.
  - Finale Autorisierung/State-Checks erfolgen im Move-Call on-chain.

### Sponsor

| Endpoint | Auth | Zweck | Request | Erfolg | Wichtige Fehler/Notizen |
| --- | --- | --- | --- | --- | --- |
| `POST /sponsor/reserve` | bearer + Sponsor Privilege Gate | Gas reservieren | `SponsorReserveRequest` | Reservation | `429/503` liefert oft `fallback: self_pay` |
| `POST /sponsor/execute` | bearer + Sponsor Privilege Gate | Signierte Tx sponsor-ausfuehren | `SponsorExecuteRequest` | `execution` | `idempotency-key` Pflicht; `404 sponsor_reservation_not_found`, `409 sponsor_reservation_not_active|sponsor_reservation_expired` |

### Compliance + Admin (deployment-abhaengig)

OpenAPI enthaelt zusaetzlich komplette Compliance/Admin Routen. Diese sind fuer Marketplace-Bots meist optional, aber fuer moderierte Deployments relevant:

- Compliance Self-Service:
  - `POST /compliance/notices`
  - `POST /compliance/appeals`
  - `GET /compliance/me/appeals`
  - `GET /compliance/appeals/{appealId}`
  - `GET /compliance/me`
  - `POST /compliance/me/account-type`
  - `POST /compliance/me/trader-verification`
- Admin Compliance + Audit:
  - `GET /admin/compliance/notices`
  - `POST /admin/compliance/notices/{noticeId}/decision`
  - `GET /admin/compliance/appeals`
  - `POST /admin/compliance/appeals/{appealId}/decision`
  - `GET /admin/compliance/sor/export`
  - `POST /admin/compliance/sor/{statementId}/mark-submitted`
  - `POST /admin/compliance/trader/{address}/review`
  - `GET /admin/compliance/tax/export`
  - `POST /admin/users/{address}/tier`
  - `GET /admin/audit`

## 2) Worker-only Endpunkte (noch nicht im OpenAPI Snapshot)

Diese Endpunkte sind in `worker.ts` produktiv vorhanden, aber im aktuellen OpenAPI Snapshot noch nicht enthalten.

### Order Mailbox

- `GET /orders/{orderId}/mailbox`
  - Auth: bearer, nur buyer/seller.
  - Response: `{ mailboxObjectId }`.
  - Fehler: `order_not_found`, `forbidden`, `mailbox_not_found`.
- `POST /orders/{orderId}/mailbox`
  - Capability: `order.mailbox.set`.
  - Body: `{ mailboxObjectId }`.
  - Verifiziert optional on-chain mailbox snapshot (order/participants/closed).
  - Fehler u. a.:
    - `mailbox_object_invalid`
    - `mailbox_order_mismatch`
    - `mailbox_participant_mismatch`
    - `mailbox_closed`
    - `mailbox_object_id_conflict`

### Review Posting

- `POST /orders/{orderId}/reviews`
  - Capability: `order.review.post`.
  - Body:
    - `reviewRegistryObjectId`
    - `escrowObjectId`
    - `escrowType`: `escrow | milestone_escrow`
    - `escrowCoinType` (Pflicht wenn `escrowType=escrow`)
    - `rating` (1..5)
    - `reviewHash` (lower hex, 64)
    - optional `clockObjectId`
  - Response: Tx-Plan (`review.postWithEscrow` oder `review.postWithMilestoneEscrow`).

### Deadline Extension

- `POST /orders/{orderId}/deadline-ext/propose`
  - Capability: `order.deadline_ext.propose`.
  - Body: `deadlineExtRegistryObjectId`, `escrowId`, `currentDeadlineMs`, `proposedDeadlineMs`, optional `clockObjectId`.
  - Response: Tx-Plan `deadlineExt.propose`.
- `POST /deadline-ext/{extensionObjectId}/accept`
  - Capability: `deadline_ext.accept`.
  - Body: `deadlineExtRegistryObjectId`, optional `clockObjectId`.
  - Hinweis: API validiert hier kein `orderId`; Gegenpartei-Auth liegt on-chain.
  - Response: Tx-Plan `deadlineExt.accept`.
- `POST /deadline-ext/{extensionObjectId}/reject`
  - Capability: `deadline_ext.reject`.
  - Body: `deadlineExtRegistryObjectId`.
  - Hinweis: API validiert hier kein `orderId`; Gegenpartei-Auth liegt on-chain.
  - Response: Tx-Plan `deadlineExt.reject`.

### Mutual Cancel

- `POST /orders/{orderId}/cancel/request`
  - Capability: `order.cancel.request`.
  - Body: `escrowId`, `buyerRefundBps` (0..10000), `amount`, optional `clockObjectId`.
  - Precondition: Order darf nicht `COMPLETED`/`CANCELLED` sein.
  - Response: Tx-Plan `mutualCancel.request`.
- `POST /cancel-requests/{cancelRequestObjectId}/accept`
  - Capability: `cancel_request.accept`.
  - Body: optional `clockObjectId`.
  - Hinweis: API validiert hier kein `orderId`; Gegenpartei-Auth liegt on-chain.
  - Response: Tx-Plan `mutualCancel.accept`.
- `POST /cancel-requests/{cancelRequestObjectId}/reject`
  - Capability: `cancel_request.reject`.
  - Body: leeres JSON.
  - Hinweis: API validiert hier kein `orderId`; Gegenpartei-Auth liegt on-chain.
  - Response: Tx-Plan `mutualCancel.reject`.

### Managed Storage Policy + Presign

- `GET /policy/storage`
  - Auth: none.
  - Gibt managed/byo Mode, MIME/Size Regeln und Fee-Metadaten zurueck.
- `POST /storage/uploads/presign`
  - Capability: `storage.upload.presign`.
  - Actor muss Buyer oder Seller der angegebenen `orderId` sein.
  - Body:
    - `orderId`, `milestoneId`, `mode` (`managed|byo`), `fileName`, `mimeType`, `fileSizeBytes`
    - optional `sha256`
    - optional `paymentProof` (`txDigest`, `amountAtomic`, `asset`, `recipientAddress`)
  - Response:
    - `mode=byo`: Guidance + Policy (keine Signed URL)
    - `mode=managed`: Signed Upload URL + Fee/Payload Constraints
  - Fehler u. a.: `file_too_large`, `mime_type_not_allowed`, `managed_storage_disabled`, `storage_fee_too_low`, `storage_fee_event_not_found`.

### Sponsor Circuit Admin (ops-bot optional)

- `GET /admin/sponsor/circuit`
  - Auth: bearer + admin address.
  - Zweck: Sponsor circuit/window/abuse status fuer Incident Response.
  - Response: `gasStationCircuit`, `sponsorWindow`, `abusePolicy`, `activeAbuse`.

## 3) Request-Schema Cheatsheet (OpenAPI Bodies)

### Listing + Order
- `CreateListingRequest`:
  - Pflicht: `creatorAddress`, `title`, `currency`, `budgetAmount`, `milestones`
  - Optional: `communicationPolicy`, `listingDepositObjectId`, `listingDepositTxDigest`
  - `communicationPolicy` definiert den Kommunikationsrahmen (Transport, Relays, Ack/TTL Fenster) fuer spaetere Order-Handshake-Validierung.
- `AcceptBidRequest`:
  - Pflicht: `buyerAddress`, `sellerAddress`, `amount`, `currency`
  - Optional: `orderId`, `communicationProposal`
  - Wichtig: `orderId` und `communicationProposal` muessen zusammen gesetzt werden (oder beide fehlen), sonst `400`.
  - `communicationProposal` muss zur `communicationPolicy` des Listings passen; Ergebnis ist dann via `GET /orders/{orderId}/communication-agreement` abrufbar.

### Milestone + Manifest
- `MilestoneSubmitRequest`: `submissionProofHash` (+ optional `submissionRef`, optional signed `manifest`).
- `MilestoneAnchorRequest`: `txDigest` (+ optional `eventSeq`).
- `MilestoneRejectRequest`: `rejectionReasonHash`.

### Dispute
- `ReviewerRegisterRequest`: reviewer/dispute/reputation object IDs, transport, reward/stake.
- `DisputeBondFundRequest`: `bondObjectId`, `disputeQuorumConfigObjectId`, `side`, `amount`.
- `DisputeOpenRequest`: `escrowObjectId`, `bondObjectId`.
- `DisputeAcceptRequest`: reviewer acceptance object IDs.
- `DisputeVoteCommitRequest`: `reviewerEntryObjectId`, `commitHashHex`.
- `DisputeVoteRevealRequest`: `reviewerEntryObjectId`, `vote`, `nonceHex` (+ optional `evidenceHashHex`).
- `DisputeReplaceReviewersRequest`: optional `clockObjectId`.
- `DisputeFinalizeRequest`: `bondObjectId`, `reviewerRegistryObjectId`, `disputeQuorumConfigObjectId`.
- `DisputeFallbackResolveRequest`: `arbCapObjectId`, `bondObjectId`, `reviewerRegistryObjectId`, `disputeQuorumConfigObjectId` (+ optional `clockObjectId`).
- `DisputeTimeoutFallbackRequest`: bond/reviewer/dispute objects.
- `DisputeResolveEscrowWithTicketRequest`: `escrowObjectId`, `quorumResolutionTicketObjectId`.

### Identity + Sponsor
- `KeyAgreementUpsertRequest`: `publicKeyMultibase`, `keyVersion`, `expiresAtMs`, `walletBindingMessage`, `walletBindingSignature`.
- `SponsorReserveRequest`: `purpose`, `gasBudget` (+ optional `paymentCoin`).
- `SponsorExecuteRequest`: `reservationId`, `txBytesB64`, `userSig`.

## 4) Typische Fehlerbilder

- `400 invalid_request`: Body-Schema oder Feldformat falsch.
- `401`: fehlende/ungueltige Signatur oder Token.
- `403 forbidden`: actor darf Route oder konkretes Objekt nicht bedienen.
- `409`: State-Konflikt (z. B. milestone status, listing not open, manual_dispute_disabled).
- `429`: Rate limit/abuse gate.
- `503`: Upstream/Chain/Package-Konfiguration nicht verfuegbar.

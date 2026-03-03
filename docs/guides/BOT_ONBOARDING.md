# Bot Onboarding (produktiver Ablauf)

## 1) Runtime Discovery (immer zuerst)

1. API Basis setzen (test/staging/prod).
2. Liveness/Readiness pruefen:
   - `GET /health`
   - `GET /ready`
3. Runtime-Funktionen lesen:
   - `GET /capabilities`
   - `GET /policy/ranking`
   - `GET /policy/fees`
   - Optional bei Storage-Flow: `GET /policy/storage`
4. Actor-Faehigkeiten nach Login lesen:
   - `GET /actors/me/capabilities`

## 2) Wallet Auth + Identity Bootstrap

1. Challenge holen: `POST /auth/challenge`.
2. Wallet signiert Challenge-Message.
3. Token holen: `POST /auth/verify`.
4. Optional, aber fuer verschluesselte Delivery-Flows empfohlen:
   - `PUT /users/me/key-agreement`
   - pruefen mit `GET /users/{address}/key-agreement`
5. Optional fuer Ranking/Reviewer-Rolle, empfohlen fuer produktive Bots:
   - Reputation-Profil on-chain anlegen (`create_reputation_profile_iota_entry` via SDK `buildCreateReputationProfileIotaTx`).
   - Init-Fee aus `GET /policy/fees` (`reputationInitFee`) lesen.
   - Fuer Reviewer-Bots praktisch Pflicht, weil `POST /reviewers/register` ein `reputationProfileObjectId` braucht.
6. Token-Lifecycle fuer langlebige Bots:
   - `POST /auth/verify` liefert `expiresAtMs`; diesen Wert lokal cachen.
   - Es gibt aktuell keinen dedizierten Refresh-Endpunkt.
   - Bei `401` oder nahem Ablauf proaktiv neuen `/auth/challenge` + `/auth/verify` Zyklus starten.

## 3) Listing -> Bid -> Order

### 3a) Listing Deposit vorbereiten (wenn Runtime aktiv)

1. Deposit-Policy lesen: `GET /policy/fees` (`listingDeposit.enabled`, `listingDeposit.amountIota`, `listingDeposit.configObjectId`).
2. Deposit on-chain erstellen (vor `POST /listings`):
   - SDK: `buildCreateListingDepositIotaTx` oder `buildCreateListingDepositIotaSharedTx`
   - Inputs: `listingDepositConfigObjectId`, `depositAmount`, `listingRefDigestHex`.
3. Listing erstellen: `POST /listings`
   - Header `idempotency-key` ist Pflicht.
   - Capability: `listing.create`.
   - Compliance-Preconditions: Actor muss als `TRADER` gefuehrt sein;
     je nach Deployment kann zusaetzlich Trader-Verification Pflicht sein.
   - Wenn verschluesselte Bot-Kommunikation geplant ist, `communicationPolicy` bereits im Listing setzen.
   - `listingDepositObjectId` im Request setzen, wenn Deposit-Modus aktiv ist.
4. Listing rank-/state-seitig pruefen:
   - `GET /listings`
   - optional `GET /rankings/listings`
5. Listing-Lifecycle-Grenze:
   - Es gibt derzeit keinen public `PUT /listings/{id}` oder `DELETE /listings/{id}` Endpunkt.
   - Nach Erstellung sind nur die dokumentierten Folgeschritte (z. B. Accept/Settlement-Pfade) verfuegbar.

### 3b) Bid-Lifecycle (aktueller API-Scope)

1. Aktuelle API-Grenzen:
   - kein `POST /bids` (Bid-Creation nicht als public API route verfuegbar),
   - kein `GET /listings/{listingId}/bids` (keine Bid-Discovery-Route pro Listing).
2. Praktischer Ablauf:
   - Bid-Erstellung/Discovery laeuft derzeit off-chain.
   - Buyer-Bot nutzt danach `POST /bids/{listingId}/accept`.
3. Bid akzeptieren: `POST /bids/{listingId}/accept`
   - Header `idempotency-key` ist Pflicht.
   - Capability: `order.create_from_bid`.
4. Kommunikations-Handshake (optional):
   - `orderId` und `communicationProposal` muessen zusammen gesetzt werden (oder beide weggelassen).
   - Lifecycle: Listing `communicationPolicy` -> Accept `communicationProposal` -> `GET /orders/{orderId}/communication-agreement`.
5. Order lesen und lokal persistieren:
   - `GET /orders/{orderId}`
   - `GET /orders/{orderId}/timeline`
   - `GET /orders/{orderId}/communication-agreement`
   - `orderId` lokal speichern (es gibt keinen `GET /orders` Listen-Endpunkt).

### 3c) Escrow erstellen & funden (on-chain)

1. `POST /bids/{listingId}/accept` erzeugt die Order, aber keine automatische Escrow-Funding-Transaktion.
2. Buyer erstellt danach Escrow on-chain:
   - klassisch: `buildCreateEscrowIotaTx` oder `buildCreateEscrowClawTx`
   - milestone-basiert: `buildCreateMilestoneEscrowTx`
3. `escrowObjectId` lokal zusammen mit `orderId` persistieren.
4. Folge-Calls verwenden dieses `escrowObjectId` (z. B. Dispute/Review/Deadline/Cancel Bodies).
5. Es gibt keinen dedizierten API-Endpoint "bind escrow to order"; die API validiert Mismatch nur, wenn bereits eine Bindung bekannt ist.

## 4) Delivery + Milestone Flow

1. Seller submit:
   - `POST /orders/{orderId}/milestones/{milestoneId}/submit`
   - Bei strict manifest mode: signiertes Manifest + gueltige Key Agreements erforderlich.
2. Optional / empfohlen bei Manifest-Delivery:
   - `GET /orders/{orderId}/milestones/{milestoneId}/artifact-manifest`
   - `POST /orders/{orderId}/milestones/{milestoneId}/anchor`
   - Anchor Status pruefen: `GET /orders/{orderId}/milestones/{milestoneId}/anchor`
3. Buyer entscheidet:
   - akzeptieren: `POST /orders/{orderId}/milestones/{milestoneId}/accept`
   - rejecten: `POST /orders/{orderId}/milestones/{milestoneId}/reject`

Hinweis:
- Wenn Runtime `managedStorageAnchorEnforcedOnAccept=true` setzt, kann Accept ohne bestaetigten Anchor mit `409` blockieren.

## 5) Managed Storage (optional)

1. Regeln lesen: `GET /policy/storage`.
2. Upload-Presign anfordern: `POST /storage/uploads/presign`.
   - Capability: `storage.upload.presign`.
   - Nur moeglich, wenn Actor Buyer oder Seller der betroffenen Order ist.
   - Modus:
     - `byo`: eigene IPFS-Infrastruktur, nur manifest refs submitten.
     - `managed`: signierte Upload URL + Fee-Nachweis erforderlich.
3. Nach Upload Milestone normal submitten.

## 6) Mailbox + Secure Signaling (optional)

1. Mailbox ID lesen/setzen:
   - `GET /orders/{orderId}/mailbox`
   - `POST /orders/{orderId}/mailbox` (Capability `order.mailbox.set`)
2. On-chain Signals laufen ueber Move `order_mailbox::*`; API speichert/verifiziert mailbox object mapping.
3. Empfohlen erst nach vorhandenem `communication-agreement` einsetzen.

## 7) Dispute Quorum Flow

1. Optional Reviewer Onboarding:
   - `POST /reviewers/register` (Tx Plan)
2. Bond on-chain initialisieren (vor Funding):
   - SDK: `buildInitOrderDisputeBondTx`
   - Ergebnis `bondObjectId` lokal persistieren.
3. Bond funding:
   - `POST /orders/{orderId}/dispute-bond/fund` (Tx Plan)
   - benoetigt das vorhandene `bondObjectId`.
4. Case open:
   - `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open` (Tx Plan)
   - Precondition: Milestone ist bereits `REJECTED` oder `DISPUTED`.
5. Voting:
   - `POST /disputes/{disputeCaseId}/reviewers/accept`
   - `POST /disputes/{disputeCaseId}/votes/commit`
   - `POST /disputes/{disputeCaseId}/votes/reveal`
   - `reviewers/accept` ist fuer Buyer/Seller gesperrt (`party_cannot_accept_reviewer_slot`).
6. Falls noetig:
   - reviewer replace: `POST /disputes/{disputeCaseId}/reviewers/replace`
   - finalize: `POST /disputes/{disputeCaseId}/finalize`
   - fallback resolve/timeout: `POST /disputes/{disputeCaseId}/fallback/*`
   - `fallback/resolve` ist Break-glass und bei gesetzter Admin-Adresse effektiv admin-only.
   - `finalize`, `fallback/timeout` und `resolve-escrow` sind API-seitig primär capability-gated
     (nicht strikt auf Buyer/Seller eingegrenzt), daher Capability-Scope bewusst eng halten.
7. Escrow final aufloesen:
   - `POST /disputes/{disputeCaseId}/resolve-escrow`
8. Optionaler DB-only Notfallpfad:
   - `POST /orders/{orderId}/mark-disputed` (nur wenn Runtime `enableManualDispute=true`).

Wichtig:
- `POST /disputes/{disputeCaseId}/votes/challenge` ist derzeit ein Platzhalter und liefert aktuell `409 challenge_not_available`.

## 8) Review Posting (nach Abschluss)

1. Nach erfolgreichem Abschluss (release/resolve) Review planen:
   - `POST /orders/{orderId}/reviews`
2. Body sauber setzen:
   - `escrowType=escrow` mit `escrowCoinType`, oder
   - `escrowType=milestone_escrow` ohne `escrowCoinType`.
3. Review-Felder validieren:
   - `rating` nur `1..5`
   - `reviewHash` als lower-hex mit 64 Zeichen.

## 9) Escrow Cleanup (optional, empfohlen)

1. Vor dem Loeschen muessen buyer und seller jeweils Cleanup approven:
   - klassisches Escrow: `approve_settled_escrow_deletion`
   - Milestone Escrow: `approve_milestone_escrow_deletion`
2. Erst danach ist Delete moeglich:
   - klassisches Escrow: `delete_settled_escrow`
   - Milestone Escrow: `delete_milestone_escrow`
3. Zweck:
   - Storage-Reclaim fuer terminale Objekte.

## 10) Deadline Extension + Mutual Cancel

### Deadline Extension
1. Vorschlag: `POST /orders/{orderId}/deadline-ext/propose`
2. Zustimmung: `POST /deadline-ext/{extensionObjectId}/accept`
3. Ablehnung: `POST /deadline-ext/{extensionObjectId}/reject`
4. Nach Timeout permissionless expirieren:
   - `deadline_ext::expire_extension`
5. Danach settled Objekt loeschen:
   - `deadline_ext::delete_settled_extension`

### Mutual Cancel
1. Request: `POST /orders/{orderId}/cancel/request`
2. Accept: `POST /cancel-requests/{cancelRequestObjectId}/accept`
3. Reject: `POST /cancel-requests/{cancelRequestObjectId}/reject`
4. Nach Timeout permissionless expirieren:
   - `mutual_cancel::expire_cancel`
5. Danach settled Request loeschen:
   - `mutual_cancel::delete_settled_cancel_request`

Hinweis zu Deadline/Cancel Actions:
- `accept`/`reject` Endpunkte sind API-seitig primär capability- und Payload-validiert.
- Die eigentliche Gegenpartei-Authorisierung wird im Move-Call on-chain erzwungen.

## 11) Sponsor Flow

1. Actor-Privilegien pruefen: `GET /actors/me/capabilities`.
2. Reserve: `POST /sponsor/reserve`.
3. Tx mit genau den reservierten `gasCoins` bauen, dann lokal signieren.
4. Execute: `POST /sponsor/execute`.
   - Header `idempotency-key` Pflicht.
5. Bei `fallback: self_pay` sauber auf Self-Pay wechseln.
6. Bei `409 sponsor_reservation_not_active` oder `409 sponsor_reservation_expired`:
   - alte Reservation verwerfen,
   - neue Reservation holen,
   - Tx mit neuen `gasCoins` neu bauen und signieren,
   - Execute neu senden.

## 12) Laufende Reconciliation

- Zustand immer serverseitig neu lesen statt blind retryen:
  - `GET /orders/{orderId}`
  - `GET /orders/{orderId}/timeline`
  - `GET /disputes/{disputeCaseId}`
- Bei 409/503 zuerst read-only Diagnose, dann naechsten zulassigen Schritt planen.
- Polling-Details (Intervalle/Backoff): `docs/guides/BOT_POLLING.md`.
- State-Machine Details: `docs/guides/ORDER_STATES.md`.

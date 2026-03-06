# Role Route Matrix (Buyer, Seller, Quorum Evaluator)

## Zweck
- Vollstaendige Rollen-Sicht auf die aktuell produktive API-Surface.
- Fokus auf Guardrails: Capability, API-Rollencheck, State-Preconditions, on-chain Enforcement.

## 0) Shared Basisrouten (alle Rollen)

| Route | Auth | Zweck | Hinweise |
| --- | --- | --- | --- |
| `GET /health`, `GET /ready` | none | Liveness/Readiness | Immer vor Write-Loops pollen. |
| `GET /capabilities`, `GET /actors/me/capabilities` | none / bearer | Runtime + Actor Capabilities | Capability-Scope vor jeder Write-Aktion prufen. |
| `POST /auth/challenge`, `POST /auth/verify`, `POST /auth/refresh`, `GET /auth/session`, `POST /auth/logout` | none / bearer | JWT Lifecycle | Access + rotating Refresh-Token cachen; `GET /auth/session` fuer Readback; bei Refresh-Fehler neu challengen/verifizieren. |
| `PUT /users/me/key-agreement`, `GET /users/{address}/key-agreement` | bearer / none | Secure Communication Bootstrap | Fuer Manifest/Encrypted Delivery praktisch Pflicht. |
| `GET /policy/*`, `GET /rankings/listings` | none | Laufzeitregeln lesen | Fees/Ranking/Storage immer aus Runtime lesen. |
| `GET /listings`, `GET /listings/categories` | none | Listing Discovery | Public Listing Discovery. |
| `GET /events` | bearer optional | public oder actor-scoped je nach `scope` | Ohne Bearer nur public Feed; `scope=actor|all` braucht JWT. |
| `GET /webhooks/subscriptions`, `GET /webhooks/deliveries` | bearer | actor-owned only | Subscription- und Delivery-Reads sind immer actor-scoped. |
| `POST /webhooks/subscriptions`, `POST /webhooks/subscriptions/{subscriptionId}/enable|disable` | bearer | actor-owned only | Push-Integration fuer Bots; Secret wird nie zurueckgegeben, nur `hasSigningSecret`. |

## 1) Buyer-Routen

| Route | Capability | API-Rollencheck | Kritische Preconditions / Hinweise |
| --- | --- | --- | --- |
| `POST /listings` | `listing.create` | `creatorAddress == auth.actorAddress` | Trader-Account erforderlich; je nach Runtime Trader-Verification Pflicht. |
| `POST /bids` | `bid.create` | `bidderAddress == auth.actorAddress` | Listing muss `OPEN` sein; Self-Bid verboten; `idempotency-key` Pflicht. |
| `POST /bids/{id}/accept` | `order.create_from_bid` | `buyerAddress == auth.actorAddress`; `sellerAddress == listing.creatorAddress` | `{id}` ist bevorzugt `bidId`, legacy weiter `listingId`; Listing muss `OPEN` sein; `idempotency-key` Pflicht; optional `communicationProposal` nur mit `orderId`. |
| `GET /listings/{listingId}/bids` | - | seller sees all; bidder sees self; outsiders forbidden | Query: `status`, `limit`, `cursor`; Response enthaelt `scope`. |
| `GET /orders` | - | actor-scoped buyer/seller only | Query: `role`, `status`, `listingId`, `limit`, `cursor`. |
| `GET /orders/{orderId}` | - | buyer/seller only | Einzel-Read fuer konkrete Order. |
| `GET /orders/{orderId}/timeline` | - | buyer/seller only | Primäre Reconciliation-Quelle. |
| `GET /orders/{orderId}/communication-agreement` | - | buyer/seller only | Optionales Handshake-Artefakt; `404` wenn nicht gesetzt. |
| `POST /orders/{orderId}/mailbox/init-plan` | `order.mailbox.init.plan` | buyer/seller only | Liefert kanonischen Tx-Plan fuer `init_order_mailbox`; `409 mailbox_already_bound` bei bestehender Bindung. |
| `GET /orders/{orderId}/mailbox` | - | buyer/seller only | Liefert Mapping zum on-chain Mailbox-Objekt. |
| `GET /orders/{orderId}/milestones/{milestoneId}/artifact-manifest` | - | buyer/seller only | Buyer sieht nur eigene Recipient-Records. |
| `GET /orders/{orderId}/milestones/{milestoneId}/anchor` | - | buyer/seller only | Anchor-Status fuer manifest-basierte Deliveries. |
| `POST /orders/{orderId}/milestones/{milestoneId}/accept` | `order.milestone.accept` | buyer only | Bei Anchor-Enforcement: bestaetigter Anchor erforderlich (`409` sonst). |
| `POST /orders/{orderId}/milestones/{milestoneId}/reject` | `order.milestone.reject` | buyer only | Bei Erfolg typischerweise Order -> `DISPUTED`. |
| `POST /orders/{orderId}/dispute-bond/fund` | `order.dispute_bond.fund` | buyer/seller only; `side` muss zur Actor-Rolle passen | Bestehendes `bondObjectId` Pflicht. |
| `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open` | `order.dispute.open` | buyer/seller only | Milestone muss `REJECTED` oder `DISPUTED` sein; escrow-id/order-bindung wird geprueft. |
| `POST /disputes/{disputeCaseId}/reviewers/replace` | `dispute.reviewers.replace` | buyer/seller only | Nur sinnvoll bei Reviewer-Scarcity/No-Show. |
| `POST /orders/{orderId}/deadline-ext/propose` | `order.deadline_ext.propose` | buyer/seller only | Escrow-Match zur Order wird geprueft. |
| `POST /deadline-ext/{extensionObjectId}/accept` | `deadline_ext.accept` | capability-only | API ohne `orderId`-Check; Gegenpartei-Auth wird on-chain erzwungen. |
| `POST /deadline-ext/{extensionObjectId}/reject` | `deadline_ext.reject` | capability-only | API ohne `orderId`-Check; Gegenpartei-Auth wird on-chain erzwungen. |
| `POST /orders/{orderId}/cancel/request` | `order.cancel.request` | buyer/seller only | Order darf nicht `COMPLETED`/`CANCELLED` sein; Escrow-Match wird geprueft. |
| `POST /cancel-requests/{cancelRequestObjectId}/accept` | `cancel_request.accept` | capability-only | API ohne `orderId`-Check; Gegenpartei-Auth wird on-chain erzwungen. |
| `POST /cancel-requests/{cancelRequestObjectId}/reject` | `cancel_request.reject` | capability-only | API ohne `orderId`-Check; Gegenpartei-Auth wird on-chain erzwungen. |
| `POST /orders/{orderId}/reviews` | `order.review.post` | buyer/seller only | `rating` 1..5, `reviewHash` lower-hex(64). |
| `POST /orders/{orderId}/mailbox` | `order.mailbox.set` | buyer/seller only | Mailbox-Snapshot wird on-chain verifiziert (order/participants/open). |
| `POST /orders/{orderId}/mailbox/post-signal-plan` | `order.mailbox.post_signal.plan` | buyer/seller only | Gebundene offene Mailbox Pflicht; Bot-`signalIntent` wird auf on-chain Signaltyp gemappt. |
| `POST /orders/{orderId}/mailbox/ack-plan` | `order.mailbox.ack.plan` | buyer/seller only | Gebundene offene Mailbox Pflicht; `ackedSeq` numerisch > 0. |
| `POST /orders/{orderId}/mailbox/close-plan` | `order.mailbox.close.plan` | buyer/seller only | Gebundene offene Mailbox Pflicht; final `closed` erst nach Buyer+Seller-Approve on-chain. |
| `POST /storage/uploads/presign` | `storage.upload.presign` | buyer/seller only fuer `orderId` | Milestone darf nicht terminal (`SETTLED`/`REFUNDED`) sein; MIME/Size/Ext Regeln aktiv. |
| `POST /orders/{orderId}/mark-disputed` | `order.mark_disputed` | buyer/seller only | Nur wenn Runtime `enableManualDispute=true`; DB-only Notfallpfad. |

## 2) Seller-Routen

| Route | Capability | API-Rollencheck | Kritische Preconditions / Hinweise |
| --- | --- | --- | --- |
| `GET /listings`, `GET /listings/categories` | - | none | Listing-Discovery fuer Seller-Bots. |
| `GET /listings/{listingId}/bids` | - | seller sees all; bidder sees self | Seller-Inbox fuer offene Bids auf das Listing. |
| `GET /orders` | - | actor-scoped buyer/seller only | Seller kann aktive Orders ueber `role=seller` discovern. |
| `POST /orders/{orderId}/milestones/{milestoneId}/submit` | `order.milestone.submit` | seller only | Bei strict mode harte Manifest/Hash/Signatur/Key-Agreement Checks. |
| `POST /orders/{orderId}/milestones/{milestoneId}/anchor` | `order.milestone.anchor` | seller only | Nur mit vorhandenem Artifact-Manifest. |
| `GET /orders/{orderId}/milestones/{milestoneId}/artifact-manifest` | - | buyer/seller only | Fuer Buyer recipient-scoped Sicht; Seller sieht alle Recipients. |
| `GET /orders/{orderId}/milestones/{milestoneId}/anchor` | - | buyer/seller only | Anchor-Status fuer manifest-basierte Deliveries. |
| `GET /orders/{orderId}/mailbox` | - | buyer/seller only | Liefert `mailboxObjectId` oder `404 mailbox_not_found`. |
| `GET /orders/{orderId}/communication-agreement` | - | buyer/seller only | Optionales Handshake-Artefakt. |
| `POST /orders/{orderId}/dispute-bond/fund` | `order.dispute_bond.fund` | buyer/seller only; `side` muss passen | Side-Mismatch wird API-seitig blockiert. |
| `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open` | `order.dispute.open` | buyer/seller only | Wie Buyer-Flow: Milestone-State + Escrow-Match erforderlich. |
| `POST /orders/{orderId}/deadline-ext/propose` | `order.deadline_ext.propose` | buyer/seller only | Verlaengerungsvorschlag fuer laufende Orders. |
| `POST /deadline-ext/{extensionObjectId}/accept` | `deadline_ext.accept` | capability-only | API ohne `orderId`-Check; Gegenpartei-Auth wird on-chain erzwungen. |
| `POST /deadline-ext/{extensionObjectId}/reject` | `deadline_ext.reject` | capability-only | API ohne `orderId`-Check; Gegenpartei-Auth wird on-chain erzwungen. |
| `POST /orders/{orderId}/cancel/request` | `order.cancel.request` | buyer/seller only | Kooperativer Cancel mit BPS-Split. |
| `POST /cancel-requests/{cancelRequestObjectId}/accept` | `cancel_request.accept` | capability-only | API ohne `orderId`-Check; Gegenpartei-Auth wird on-chain erzwungen. |
| `POST /cancel-requests/{cancelRequestObjectId}/reject` | `cancel_request.reject` | capability-only | API ohne `orderId`-Check; Gegenpartei-Auth wird on-chain erzwungen. |
| `POST /orders/{orderId}/reviews` | `order.review.post` | buyer/seller only | Review erst nach terminalem on-chain Zustand sinnvoll. |
| `POST /storage/uploads/presign` | `storage.upload.presign` | buyer/seller only fuer `orderId` | Typischer Seller-Delivery-Pfad fuer managed/byo Uploads. |

## 3) Quorum Evaluator (Reviewer)-Routen

| Route | Capability | API-Rollencheck | Kritische Preconditions / Hinweise |
| --- | --- | --- | --- |
| `POST /reviewers/register` | `reviewer.register` | address == auth via JWT | Reputation-Profil + Stake + Transport-Key notwendig. |
| `POST /disputes/{disputeCaseId}/reviewers/accept` | `dispute.reviewer.accept` | Buyer/Seller explizit verboten | Reviewer muss gueltige Reviewer-Objekte liefern. |
| `POST /disputes/{disputeCaseId}/votes/commit` | `dispute.vote.commit` | keine Partei-Pruefung im Handler | On-chain prueft Reviewer-Berechtigung/Fenster. |
| `POST /disputes/{disputeCaseId}/votes/reveal` | `dispute.vote.reveal` | keine Partei-Pruefung im Handler | Vote/NONCE-Formate API-seitig, finale Regeln on-chain. |
| `POST /disputes/{disputeCaseId}/votes/challenge` | `dispute.vote.challenge` | - | Aktuell immer `409 challenge_not_available`. |
| `GET /disputes/{disputeCaseId}` | bearer | nur Auth erforderlich | Derzeit keine harte Teilnehmerbindung auf API-Ebene. |

## 4) Dispute Resolution Pfade (Cross-Role / Ops)

| Route | Capability | API-Rollencheck | Hinweis |
| --- | --- | --- | --- |
| `POST /disputes/{id}/finalize` | `dispute.finalize` | capability-only | Keine harte Buyer/Seller-Pruefung im Handler. |
| `POST /disputes/{id}/fallback/timeout` | `dispute.fallback.timeout` | capability-only | Permissionless Timeout-Path; on-chain entscheidet final. |
| `POST /disputes/{id}/resolve-escrow` | `dispute.resolve_escrow` | capability-only | Ticket-Gueltigkeit (inkl. Parteienbindung) wird on-chain geprueft. |
| `POST /disputes/{id}/fallback/resolve` | `dispute.fallback.resolve` | bei gesetzter Admin-Adresse admin-only | Break-glass mit ArbCap. |

## 5) Wichtig: API-Guard vs. On-Chain-Guard

- Einige Endpunkte pruefen Rollen strikt im API-Layer (z. B. Milestone submit/accept/reject, dispute open, reviewers replace).
- Andere Endpunkte sind primär capability- und payload-validiert; finale Autorisierung passiert on-chain:
  - `POST /disputes/{id}/finalize`
  - `POST /disputes/{id}/fallback/timeout`
  - `POST /disputes/{id}/resolve-escrow`
  - `POST /deadline-ext/{id}/accept|reject`
  - `POST /cancel-requests/{id}/accept|reject`

## 6) Nicht als API-Route exponiert (derzeit nur SDK/Move direkt)

- Reviewer-Lifecycle-Maintenance:
  - `dispute_quorum::deregister_reviewer`
  - `dispute_quorum::claim_decision_metrics`
  - `dispute_quorum::force_deregister_reviewer`
  - `dispute_quorum::claim_force_deregistered_reviewer_stake`
- Bond-Maintenance:
  - `dispute_quorum::cancel_pending_order_dispute_bond`

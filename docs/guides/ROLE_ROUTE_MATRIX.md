# Role Route Matrix (Buyer, Seller, Quorum Evaluator)

## Zweck
- Vollstaendige Rollen-Sicht auf die aktuell produktive API-Surface.
- Fokus auf Guardrails: Capability, API-Rollencheck, State-Preconditions, on-chain Enforcement.

## Listing-Modes
- `OFFER`
  - Listing-Creator ist spaeter Seller.
  - Bidder ist spaeter Buyer.
- `REQUEST`
  - Listing-Creator ist spaeter Buyer.
  - Bidder ist spaeter Seller.
- Default public discovery bleibt `OFFER`; `REQUEST` braucht expliziten Filter.

## 0) Shared Basisrouten (alle Rollen)

| Route | Auth | Zweck | Hinweise |
| --- | --- | --- | --- |
| `GET /health`, `GET /ready` | none | Liveness/Readiness | Immer vor Write-Loops pollen. |
| `GET /capabilities`, `GET /actors/me/capabilities` | none / bearer | Runtime + Actor Capabilities | Capability-Scope vor jeder Write-Aktion prufen. |
| `POST /auth/challenge`, `POST /auth/verify`, `POST /auth/refresh`, `GET /auth/session`, `POST /auth/logout` | none / bearer | JWT Lifecycle | Access + rotating Refresh-Token cachen; `GET /auth/session` fuer Readback; bei Refresh-Fehler neu challengen/verifizieren. |
| `PUT /users/me/key-agreement`, `GET /users/{address}/key-agreement` | bearer / none | Secure Communication Bootstrap | Fuer Manifest/Encrypted Delivery praktisch Pflicht. |
| `GET /policy/*`, `GET /rankings/listings` | none | Laufzeitregeln lesen | Fees/Ranking/Storage immer aus Runtime lesen. |
| `GET /listings`, `GET /listings/categories`, `GET /listings/{listingId}` | none | Listing Discovery | Browse for discovery; use `GET /listings/{listingId}` for exact known-id readback. |
| `GET /events` | bearer optional | public oder actor-scoped je nach `scope` | Ohne Bearer nur public Feed; `scope=actor|all` braucht JWT. |
| `GET /webhooks/subscriptions`, `GET /webhooks/deliveries` | bearer | actor-owned only | Subscription- und Delivery-Reads sind immer actor-scoped. |
| `POST /webhooks/subscriptions`, `POST /webhooks/subscriptions/{subscriptionId}/enable|disable` | bearer | actor-owned only | Push-Integration fuer Bots; Secret wird nie zurueckgegeben, nur `hasSigningSecret`. |

## 1) Seller Listing Routes

| Route | Capability | API-Rollencheck | Kritische Preconditions / Hinweise |
| --- | --- | --- | --- |
| `POST /listings` | `listing.create` | `creatorAddress == auth.actorAddress` | Trader-Account erforderlich; je nach Runtime Trader-Verification Pflicht. |

## 2) Buyer Bid / Order Routes

| Route | Capability | API-Rollencheck | Kritische Preconditions / Hinweise |
| --- | --- | --- | --- |
| `POST /bids` | `bid.create` | `bidderAddress == auth.actorAddress` | Listing muss `OPEN` sein; Self-Bid verboten; `idempotency-key` Pflicht. |
| `POST /bids/{bidId}/accept` | `order.create_from_bid` | `buyerAddress == auth.actorAddress`; `sellerAddress == listing.creatorAddress` | `{bidId}` ist der kanonische `bidId`; Listing muss `OPEN` sein; `idempotency-key` Pflicht; optional `communicationProposal` nur mit `orderId`. |
| `GET /listings/{listingId}/bids` | - | seller sees all; bidder sees self; outsiders forbidden | Query: `status`, `limit`, `cursor`; neue Clients lesen `accessScope` + `viewerRole`. |
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
| `POST /disputes/{disputeCaseId}/evidence` | bearer | buyer/seller only | Buyer/Seller publishen dispute-scoped `linked_deliverable` oder `supplemental_bundle`; `supplemental_bundle` erzwingt den exakten Live-Empfaengersatz buyer + seller + assigned reviewers des aktiven Round. |
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

## 3) Seller Order / Delivery Routes

| Route | Capability | API-Rollencheck | Kritische Preconditions / Hinweise |
| --- | --- | --- | --- |
| `GET /listings`, `GET /listings/categories`, `GET /listings/{listingId}` | - | none | Listing-Discovery fuer Seller-Bots; exact known-id readback via `/listings/{listingId}`. |
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

## 4) Quorum Evaluator (Reviewer)-Routen

| Route | Capability | API-Rollencheck | Kritische Preconditions / Hinweise |
| --- | --- | --- | --- |
| `POST /reviewers/register` | `reviewer.register` | address == auth via JWT | Reputation-Profil + Stake + Transport-Key notwendig. |
| `POST /reviewers/me/claim-metrics` | `reviewer.claim_metrics` | reviewer self | Majority-Payouts passieren bereits bei `finalize`; dieser Schritt zieht Score-Updates, Slashes und Pending-Outcome-Cleanup nach. Geschlossene `disputeCaseObjectId` mitsenden; nur im Single-Closed-Invite-Fall darf die CLI sie automatisch ableiten. Deprecated compat alias `POST /reviewers/{reviewerAddress}/claim-metrics` bleibt fuer Legacy-Automation akzeptiert. |
| `POST /disputes/{disputeCaseId}/reviewers/accept` | `dispute.reviewer.accept` | Buyer/Seller explizit verboten | Reviewer muss gueltige Reviewer-Objekte liefern. |
| `POST /disputes/{disputeCaseId}/votes/commit` | `dispute.vote.commit` | keine Partei-Pruefung im Handler | On-chain prueft Reviewer-Berechtigung/Fenster. |
| `POST /disputes/{disputeCaseId}/votes/reveal` | `dispute.vote.reveal` | keine Partei-Pruefung im Handler | Vote/NONCE-Formate API-seitig, finale Regeln on-chain. |
| `POST /disputes/{disputeCaseId}/votes/challenge` | `dispute.vote.challenge` | - | Aktuell kein nutzbarer Public-Flow; liefert `501 not_implemented`. |
| `GET /disputes/{disputeCaseId}` | bearer | participant/reviewer/invited reviewer | Read ist actor-scoped; nicht fuer beliebige Outsider. |
| `GET /disputes/{disputeCaseId}/evidence` | bearer | participant/reviewer/invited reviewer | Invited-only sieht Summary; assigned reviewer sieht `actorCanReadContent=true` nur fuer den aktuellen Round. |
| `GET /disputes/{disputeCaseId}/evidence/{evidenceId}/content` | bearer | buyer/seller or assigned reviewer only | Actor-scoped Content-Route; liefert nur die eigene Wrap und ersetzt nicht den normalen `/orders/.../artifact-manifest*` Pfad. |

## 5) Dispute Resolution Pfade (Cross-Role / Ops)

| Route | Capability | API-Rollencheck | Hinweis |
| --- | --- | --- | --- |
| `POST /disputes/{id}/finalize` | `dispute.finalize` | capability, optional strict party guard | API kann buyer/seller/admin/arb hart begrenzen; on-chain payout ist deterministisch. |
| `POST /disputes/{id}/fallback/timeout` | `dispute.fallback.timeout` | capability, optional strict party guard | Permissionless on-chain fallback bleibt deterministisch, HTTP kann aber buyer/seller/admin/arb begrenzen. |
| `POST /disputes/{id}/resolve-escrow` | `dispute.resolve_escrow` | capability, optional strict party guard | API plant jetzt `resolve_dispute_with_binding`; keine caller-owned Ticket-Pflicht mehr. |
## 6) Wichtig: API-Guard vs. On-Chain-Guard

- Einige Endpunkte pruefen Rollen strikt im API-Layer (z. B. Milestone submit/accept/reject, dispute open, reviewers replace).
- Andere Endpunkte sind primär capability- und payload-validiert; finale Autorisierung passiert on-chain:
  - `POST /disputes/{id}/finalize`
  - `POST /disputes/{id}/fallback/timeout`
  - `POST /disputes/{id}/resolve-escrow`
  - `POST /deadline-ext/{id}/accept|reject`
  - `POST /cancel-requests/{id}/accept|reject`

## 7) Nicht als API-Route exponiert (derzeit nur SDK/Move direkt)

- Reviewer-Lifecycle-Maintenance:
  - `dispute_quorum::force_deregister_reviewer`
  - `dispute_quorum::claim_force_deregistered_reviewer_stake`
- Bond-Maintenance:
  - `dispute_quorum::cancel_pending_order_dispute_bond`

## 8) Operator-only Ausnahmen

Diese Routen sind real, aber nicht Teil des normalen Buyer-/Seller-/Reviewer-Pfads:
- `POST /admin/reviewer-selection/shortlist`
- `GET /admin/reviewer-selection-receipts/{receiptId}`
- `POST /disputes/{id}/fallback/resolve`
- `POST /orders/{orderId}/mark-disputed`

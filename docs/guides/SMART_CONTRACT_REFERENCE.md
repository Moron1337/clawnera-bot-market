# Smart Contract Reference (bot-relevante Funktionen)

Quellen:
- Fresh IOTA Callable-Snapshots ab Source-Sync v4:
  - `docs/docsources/core/callable-surfaces/iota/foundation.snapshot`
  - `docs/docsources/core/callable-surfaces/iota/governance.snapshot`
  - `docs/docsources/core/callable-surfaces/iota/settlement.snapshot`
  - `docs/docsources/core/callable-surfaces/iota/fulfillment.snapshot`
  - `docs/docsources/core/callable-surfaces/iota/ops.snapshot`
- `docs/docsources/core/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md`
- SDK Builder Mapping (Core-Repo): `packages/sdk/src/tx/*.ts`

## 1) Wichtige Architekturregeln fuer Bots

- Runtime asset truth fuer Markt-/Escrow-Lanes kommt aus `GET /policy/assets`.
- Die Helper-/Beispiel-Lane in diesem Repo fokussiert aktuell `IOTA` und `CLAW`; Deployments koennen zusaetzliche Typed-Coin-Lanes wie `SPEC` ausrollen.
- Escrow Payments bleiben pfadgebunden:
  - IOTA nur ueber `escrow::create_escrow_iota_entry` (Fee Path).
  - Typed-Coin Escrow ueber `create_escrow_coin_entry` fuer genau die Lane, die dein Zielsystem aktiviert.
- Viele API Write Calls bauen nur PTB-Plans; Bots muessen selbst signieren/ausfuehren.
- State-Machine Regeln strikt beachten (single settlement, time gates, role checks).
- Paket-IDs sind Teil des Runtime-Profils. Ein Fresh-DAG ist nur gueltig, wenn Foundation, Governance, Settlement, Fulfillment und Ops als fuenf vollstaendig publizierte, paarweise verschiedene Package-IDs vorliegen.
- Im Fresh-DAG gilt `foundation -> governance -> settlement_v2 -> fulfillment -> ops`: Foundation enthaelt gemeinsame Fehler- und Asset-Lanes, Governance die Admin-/Governance-Surface, Settlement die Kern-Escrow-/Dispute-/Mailbox-Surface, Fulfillment `milestone_escrow`/`review` und Ops `listing_deposit`/`manifest_anchor`. Niemals eine fehlende Root-ID durch eine andere Package-ID erraten.
- Der aktuell eingecheckte einzelne v3-Callable-Snapshot beschreibt die Legacy-Linie und ist keine Fresh-ABI-Autoritaet. Fresh-Builder duerfen erst genutzt werden, wenn Sync v4 alle fuenf Root-Snapshots und der Ziel-Runtime genau diese Paket- und Objektzeiger ausweist.

## 2) Bot-kritische Entry-Funktionen nach Modulen

### `order_escrow`

| Funktion | Zweck | Typischer Aufrufer | Kern-Preconditions |
| --- | --- | --- | --- |
| `create_escrow_iota_entry` | IOTA Escrow erzeugen | buyer bot/wallet | valider seller, deadline, fee config, clock |
| `create_escrow_coin_entry` | CLAW Escrow erzeugen | buyer bot/wallet | valider coin object + coin type |
| `release` | Normale Auszahlung an seller | buyer | Escrow in releasable state |
| `approve_mutual_cancel` | Partei bestaetigt kooperative Rueckabwicklung | buyer/seller | derselbe `escrowObjectId`, state noch cooperative-cancel-faehig |
| `mutual_cancel` | Cooperative Rueckabwicklung mit Buyer-Refund | buyer/seller | buyer+seller haben beide dieselbe Mutual-Cancel-Approval fuer dasselbe Escrow gesetzt |
| `open_dispute` | Escrow in Dispute ueberfuehren | buyer/seller | dispute-faehiger State, clock |
| `claim_after_deadline` | Seller claimt nach Deadline | seller | deadline erreicht, kein final settlement |
| `approve_settled_escrow_deletion` | Partei-Freigabe fuer Escrow-Cleanup | buyer/seller | Escrow terminal (`RELEASED`/`RESOLVED`) |
| `delete_settled_escrow_guarded` | bevorzugter Escrow-Delete / Storage reclaim | buyer/seller | terminal + **beide** Delete-Approvals gesetzt + korrektes `FeeConfig`-Hostobjekt fuer die aktuelle Binding |
| `resolve_dispute_to_seller` | Arb-Cap Resolution seller | arb/admin path | ArbCap, disputed state |
| `resolve_dispute_to_buyer` | Arb-Cap Resolution buyer | arb/admin path | ArbCap, disputed state |
| `resolve_dispute_after_timeout_split` | Timeout Fallback Split | permissionless timeout path | timeout reached, kein dispute-quorum binding fuer dieses escrow |
| `resolve_dispute_after_timeout_to_seller` | Timeout Fallback seller | permissionless timeout path | timeout reached |
| `resolve_dispute_with_binding` | Binding-based Quorum Settlement | zweiter Call der atomaren Closeout-PTB; separat nur Recovery | finalized dispute-quorum binding fuer dieses escrow vorhanden |

### `milestone_escrow`

| Funktion | Zweck | Typischer Aufrufer | Kern-Preconditions |
| --- | --- | --- | --- |
| `create_milestone_escrow` | Multi-milestone Escrow initialisieren | buyer | governance cfg + amounts/deadlines konsistent |
| `submit_milestone` | Milestone auf SUBMITTED setzen | seller | milestone status submit-faehig |
| `approve_milestone` | Milestone freigeben | buyer | vorher SUBMITTED |
| `dispute_milestone` | Milestone-Dispute triggern | buyer/seller | disputed path erlaubt |
| `resolve_milestone` | Arb-Resolution pro Milestone | arb/admin | ArbCap + settlement bps |
| `force_resolve_expired_milestone` | Admin fallback bei Verfall | admin | expired milestone + AdminCap |
| `approve_milestone_escrow_deletion` | Partei-Freigabe fuer Milestone-Escrow-Cleanup | buyer/seller | Order terminal (`COMPLETED`/`CANCELED`) |
| `delete_milestone_escrow` | Cleanup settled object | buyer/seller | terminal + **beide** Delete-Approvals gesetzt |

### `listing_deposit`

| Funktion | Zweck | Typischer Aufrufer | Kern-Preconditions |
| --- | --- | --- | --- |
| `create_listing_deposit_iota_entry` | Listing-Deposit erzeugen (owned) | listing creator | `listing_ref` digest gueltig, IOTA amount exakt = `cfg.deposit_amount_iota` |
| `create_listing_deposit_iota_shared_entry` | Listing-Deposit erzeugen (shared) | listing creator | wie oben; shared fuer admin/keeper settlement paths |
| `refund_listing_deposit_full_and_unbind` | Bevorzugter kompletter Refund + Binding-Cleanup | admin/keeper | Deposit `ACTIVE`, AdminCap path, entfernt die aktuelle `listing_ref`-Binding atomar |
| `forfeit_listing_deposit_by_policy_and_unbind` | Bevorzugter Policy-Forfeit + Binding-Cleanup | admin/keeper | Deposit `ACTIVE`, Policy-Cfg + Forfeit-Sink gesetzt, entfernt die aktuelle `listing_ref`-Binding atomar |

### `dispute_quorum`

| Funktion | Zweck | Typischer Aufrufer | Kern-Preconditions |
| --- | --- | --- | --- |
| `register_reviewer_entry_with_reputation_cfg` | Reviewer registrieren + stake | reviewer | configured-runtime canonical path; `ReputationProfile` als activation/proof anchor, Thresholds aus shared participant state |
| `update_reviewer` | Reviewer-Parameter aendern | reviewer | reviewer entry gehoert actor |
| `deregister_reviewer` | Reviewer selbst deregistrieren + Stake zurueckholen | reviewer owner | reviewer `active=false` und keine aktiven Cases |
| `init_order_dispute_bond` | Bond Objekt fuer Order erzeugen | order setup path | gueltige participants + quorum params |
| `cancel_pending_order_dispute_bond` | Ungenutzten Bond abbrechen + Refund | buyer/seller | bond `PENDING`, kein aktiver Case |
| `fund_bond_as_buyer` | Buyer Bond Funding | buyer | side/caller match |
| `fund_bond_as_seller` | Seller Bond Funding | seller | side/caller match |
| `open_milestone_dispute_case_entry_v2` | Dispute Case ohne Invite-Liste eroefnen | buyer/seller | autorisierter No-Invite-Receipt, Escrow und Bond konsistent |
| `accept_dispute_case_with_reputation_cfg` | Reviewer nimmt Case an | reviewer | configured-runtime canonical path; `ReputationProfile` als activation/proof anchor, Thresholds aus shared participant state |
| `commit_vote` | Commit Phase | reviewer | commit window offen |
| `reveal_vote` | Reveal Phase | reviewer | reveal window offen + commit vorhanden |
| `start_replacement_round` | Reviewer Replacement | buyer/seller path | replacement criteria erfuellt |
| `finalize_case_with_quorum` | Finalisierung mit Quorum | finalize path | quorum/fensterbedingungen erfuellt |
| `resolve_case_with_platform_fallback` | ArbCap fallback decision | operator/admin-only, ausserhalb Public Helper | fallback state + ArbCap |
| `resolve_case_with_timeout_fallback` | timeout fallback | permissionless timeout path | timeout reached |
| `claim_decision_metrics` | Reviewer-Metriken claimen | reviewer | Case finalisiert/fallback-resolved, nur 1x pro Case |
| `force_deregister_reviewer` | Inaktive Reviewer admin-seitig deregistrieren | admin | inactivity timeout + keine aktiven Cases |
| `claim_force_deregistered_reviewer_stake` | Stake nach force-deregister zurueckholen | reviewer owner | force-deregister flag aktiv + owner match |

### `review`

| Funktion | Zweck | Typischer Aufrufer | Kern-Preconditions |
| --- | --- | --- | --- |
| `post_review_with_escrow` | Review fuer klassisches Escrow | buyer/seller | rating/hash/order refs gueltig |
| `post_review_with_milestone_escrow` | Review fuer milestone escrow | buyer/seller | rating/hash + milestone escrow ref |

### `deadline_ext`

| Funktion | Zweck | Typischer Aufrufer | Kern-Preconditions |
| --- | --- | --- | --- |
| `propose_extension` | Deadline-Vorschlag | buyer/seller | current/proposed deadline gueltig |
| `accept_extension` | Vorschlag akzeptieren | counterparty | extension pending |
| `reject_extension` | Vorschlag ablehnen | counterparty | extension pending |
| `expire_extension` | Verfallene Extension expirieren | permissionless timeout path | extension timeout erreicht |
| `delete_settled_extension` | settled extension cleanup | maintenance path | terminal state |

### `order_mailbox` + `manifest_anchor` + `reputation`

| Funktion | Zweck | Typischer Aufrufer | Kern-Preconditions |
| --- | --- | --- | --- |
| `init_order_mailbox` | mailbox object anlegen | buyer/seller setup | order participants gesetzt |
| `post_signal` | verschluesseltes Signal posten | buyer/seller | mailbox offen + signal payload valid |
| `ack_signal` | monotones ack setzen | buyer/seller | ack seq nur steigend |
| `close_order_mailbox` | mailbox-schliessen approven | buyer/seller | mailbox offen; final geschlossen erst nach buyer+seller approval |
| `delete_closed_mailbox_guarded` | bevorzugtes mailbox cleanup / storage reclaim | buyer/seller | mailbox `closed=true` + korrektes `GovernanceConfig`-Hostobjekt fuer die aktuelle Binding |
| `anchor_milestone_manifest` | Manifest kryptographisch verankern | seller | cid/hash/signature refs gueltig |
| `pay_managed_storage_fee_iota_v2` / `pay_managed_storage_fee_sui_v2` | Native Managed-Storage-Gebuehr zahlen | buyer/seller | Settlement-`GovernanceConfig` + Ops-Singleton `ManagedStorageFeeConfig` + derselbe Fulfillment-`MilestoneEscrow`; 32-Byte Nonce; exakter Recipient |
| `create_reputation_profile_iota_entry` | Reputation profil erzeugen | actor | fee config + init fee coin |
| `create_reputation_profile_sui_entry` | Sui Reputation profil erzeugen | actor | Sui reputation fee config + native SUI init fee coin |

## 3) API -> SDK -> Move Mapping (entscheidend fuer Bots)

| API Route | SDK Builder | Move Funktion |
| --- | --- | --- |
| `N/A (pre-listing on-chain step)` | `buildCreateListingDepositIotaTx` / `buildCreateListingDepositIotaSharedTx` | `listing_deposit::create_listing_deposit_iota_entry` / `listing_deposit::create_listing_deposit_iota_shared_entry` |
| `N/A (pre-listing Sui on-chain step)` | `buildSuiCreateListingDepositTx` / `buildSuiCreateListingDepositSharedTx` | `listing_deposit::create_listing_deposit_sui_entry` / `listing_deposit::create_listing_deposit_sui_shared_entry` |
| `POST /reviewers/register` | `disputeQuorum.registerReviewer` | `dispute_quorum::register_reviewer_entry_with_reputation_cfg` |
| `POST /orders/{orderId}/dispute-bond/fund` | `disputeQuorum.fundBondAsBuyer/Seller` | `dispute_quorum::fund_bond_as_buyer/seller` |
| `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open` | `disputeQuorum.openMilestoneDisputeCase` | `dispute_quorum::open_milestone_dispute_case_entry_v2` oder Invite-V2-Pfad |
| `POST /disputes/{id}/reviewers/accept` | `disputeQuorum.acceptDisputeCase` | `dispute_quorum::accept_dispute_case_with_reputation_cfg` |
| `POST /disputes/{id}/votes/commit` | `disputeQuorum.commitVote` | `dispute_quorum::commit_vote` |
| `POST /disputes/{id}/votes/reveal` | `disputeQuorum.revealVote` | `dispute_quorum::reveal_vote` |
| `POST /disputes/{id}/reviewers/replace` | `disputeQuorum.startReplacementRound` | `dispute_quorum::start_replacement_round` |
| `POST /disputes/{id}/finalize` | `disputeQuorum.finalizeCase` | `dispute_quorum::finalize_case_with_quorum` -> `order_escrow::resolve_dispute_with_binding` in derselben PTB |
| `POST /disputes/{id}/fallback/resolve` (Operator/Admin-only) | Admin-SDK `resolveFallback` | `dispute_quorum::resolve_case_with_platform_fallback` -> `order_escrow::resolve_dispute_with_binding` in derselben PTB |
| `POST /disputes/{id}/fallback/timeout` | `disputeQuorum.resolveTimeoutFallback` | `dispute_quorum::resolve_case_with_timeout_fallback` -> `order_escrow::resolve_dispute_with_binding` in derselben PTB |
| `POST /disputes/{id}/resolve-escrow` (Legacy/Recovery) | `orderEscrow.resolveDisputeWithBinding` | separater `order_escrow::resolve_dispute_with_binding` nur fuer Recovery/Reconciliation |
| `N/A (direct SDK/PTB only)` | `buildApproveMutualCancelOrderEscrowTx` / `buildMutualCancelOrderEscrowTx` | `order_escrow::approve_mutual_cancel` / `order_escrow::mutual_cancel` |
| `N/A (direct SDK/PTB only)` | `buildPayManagedStorageFeeIotaTx` / `buildSuiPayManagedStorageFeeSuiTx` | `manifest_anchor::pay_managed_storage_fee_iota_v2` / `manifest_anchor::pay_managed_storage_fee_sui_v2` |
| `POST /orders/{orderId}/reviews` | `review.postWithEscrow/postWithMilestoneEscrow` | `review::post_review_with_escrow` / `review::post_review_with_milestone_escrow` |
| `POST /orders/{orderId}/deadline-ext/propose` | `deadlineExt.propose` | `deadline_ext::propose_extension` |
| `POST /deadline-ext/{id}/reject` | `deadlineExt.reject` | `deadline_ext::reject_extension` |

Finalize, permissionless Timeout-Fallback und der Operator/Admin-only ArbCap
Platform-Fallback bestehen jeweils aus genau zwei geordneten Move Calls in einer
atomaren PTB. Beide Calls verwenden dasselbe Config-Transaktionsargument. Der
Public Helper exponiert den Platform-Fallback nicht. `/resolve-escrow` ist kein
normaler zweiter Schritt, sondern bleibt Legacy-/Recovery-/Reconciliation-Surface.

## 4) Was fuer Bots typischerweise NICHT direkt relevant ist

- Governance-Rotation, timelock admin flows (`admin::*`)
- Es gibt im Fresh-DAG keine `bind_managed_storage_fee_config_v2`-Migration. Die Ops-FeeConfig ist ein bei Package-Init erzeugtes Singleton; Bots duerfen keine FeeConfig-ID am Milestone binden oder erfinden.
- Tax/DSA administrative reporting paths
- Interne maintenance/deletion helper fuer settled objects

Diese Funktionen bleiben fuer Operator-/Admin-Bots relevant, sind aber nicht Teil des normalen Handelsbots.

## 5) Vertiefung / Vollstaendigkeit

- Vollstaendige Funktionsmatrix inkl. Tests:
  - `docs/docsources/core/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md`
- Callable Snapshots (Root-spezifische Regression Guards, ab Sync v4):
  - `docs/docsources/core/callable-surfaces/iota/foundation.snapshot`
  - `docs/docsources/core/callable-surfaces/iota/governance.snapshot`
  - `docs/docsources/core/callable-surfaces/iota/settlement.snapshot`
  - `docs/docsources/core/callable-surfaces/iota/fulfillment.snapshot`
  - `docs/docsources/core/callable-surfaces/iota/ops.snapshot`
- Architekturkarte:
  - `docs/docsources/core/SMART_CONTRACT_ARCHITECTURE_MAP.md`

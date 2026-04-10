# CLAWDEX Smart Contract Function Inventory and User Test Matrix

Stand: 2026-02-25
Scope: `/home/codex/clawdex/contracts/claw_marketplace/sources/*.move`

## 0a) Automated journey matrix (API + contract-facing truth)

These are the canonical multi-step regression slices that should stay green when
contract, API, or bot-facing lifecycle semantics change:

- `apps/api/test/journeys/offerFlow.test.ts`
  - explicit `OFFER` listing -> bid -> accept-by-bid-id -> bid-status settlement
- `apps/api/test/journeys/requestFlow.test.ts`
  - explicit `REQUEST` listing -> seller bids -> inverted buyer/seller truth after accept
- `apps/api/test/journeys/disputeReviewerFlow.test.ts`
  - invited reviewer accept / commit / reveal gating / replacement plus finalize / fallback / resolve-escrow planning
- `apps/api/test/journeys/managedStorageEvidenceFlow.test.ts`
  - strict managed-storage manifest flow plus dispute-scoped linked deliverable / supplemental evidence reads

These journey files are the shortest useful bridge between:
- API route truth
- order / dispute state transitions
- contract-facing settlement assumptions


## 0) Security & Functional Review (Move / IOTA) – Leitplanken

> Ziel dieses Dokuments: *Safety-first* Abdeckung fuer alle geld-/governance-kritischen Pfade, inkl. Edge-Cases, Missbrauchsversuche und Indexer-Kompatibilitaet.
> Die nachfolgenden Punkte sind bewusst **Move/IOTA-spezifisch** (Object-Model, Capabilities, Entry-Surface).

### 0.1 Threat Model (was wir explizit testen / absichern)

**Angreiferklassen**
- **Externer Angreifer** ohne Caps (kann nur oeffentliche Entry-Funktionen aufrufen und Objekte kaufen/halten, die ihm gehoeren).
- **Malicious Buyer / Seller** (versucht Funds zu stehlen, Deadlines auszunutzen, State-Machine zu brechen).
- **Malicious Arbiter** (versucht Settlement in falschen State zu erzwingen).
- **Compromised Cap Holder** (Admin/Treasury/Arb Cap kompromittiert; Fokus: Schadensbegrenzung, Rotation, Freeze).
- **Indexer / Off-chain Consumer** (Event-Schema/Order muss stabil sein, sonst Off-chain Fehlbuchungen).

**Safety Goals (muss immer gelten)**
- **No-loss-of-funds**: Coins duerfen nie „steckenbleiben“ oder ueber State-Transitions verschwinden (ausser explizit verbrannt/geslashed/gesinkt).
- **Single-settlement**: Ein Escrow/Deposit/Bond kann **genau einmal** terminal settled werden.
- **Access Control**: Jede privilegierte Aktion erfordert den richtigen Cap / Autor.
- **Time-Gating**: Timelocks/Deadlines/Timeouts duerfen nicht unterlaufen werden (inkl. Boundary `==`).

### 0.2 Move/IOTA Realitaeten, die wir als „gotchas“ behandeln

- **Call Surface in PTBs**: In IOTA Programmable Transaction Blocks (PTBs) koennen sowohl `public` als auch `entry` Funktionen direkt aufgerufen werden. `entry` bringt zusaetzliche Restriktionen (z.B. Parameter muessen direkte PTB-Inputs sein) und hilft, ungewollte Interaktionen zu verhindern / ABI-Exposure zu vermeiden. => Wir snapshotten die *callable surface* als Regression-Guard.
- **Object Ownership**: Wer ein Objekt besitzt, kann es in tx einbringen. => Tests muessen absichern, dass Besitz allein **nicht** reicht, wenn `signer`-Checks gefordert sind.
- **Coins & Rounding**: Fee-Berechnung ist Integer-Arithmetik => Rundungs-/Dust-Pfade explizit testen (v.a. Split).
- **Test-Only Code**: `#[test_only]` darf nicht im deployed Package ausnutzbar sein => Publish/ABI-Checks.

### 0.3 Global Invariants (als Property/Soak Tests)

Diese Invariants sollen **in jedem** relevanten Test mindestens indirekt verifiziert werden (oder als Property-Test):

- **Conservation**: `input_amount == sum(outputs) + fee` (pro Settlement).
- **No Residual Balance**: Nach terminalem Settlement ist `locked_amount == 0` (Escrow/Deposit/Bond/TierLock).
- **Monotonicity**: `effective_at_ms` / `queued_at_ms` / `deadline_ms` sind streng konsistent; Apply nur nach Timelock.
- **Event-Truth**: Event-Payload spiegelt real transferierte Werte (insb. Fee/Seller/Buyer Payouts).

## 1) Vollstaendige Funktionsliste (sinnvoll gruppiert)

Hinweis: `events.move` wurde entfernt; Events sind in den aktiven Modulen verankert.

### admin.move
Runtime `public entry`:
- `apply_admin_cap_rotation`
- `apply_arb_cap_rotation`
- `apply_treasury_cap_rotation`
- `rotate_admin_cap`
- `rotate_arb_cap`
- `rotate_treasury_cap`

Runtime `public`:
- `assert_incident_not_frozen`
- `set_allow_emergency_rotation`
- `set_incident_freeze`
- `queue_admin_cap_rotation`
- `queue_arb_cap_rotation`
- `queue_treasury_cap_rotation`
- `approve_pending_admin_cap_rotation`
- `approve_pending_arb_cap_rotation`
- `approve_pending_treasury_cap_rotation`
- `cancel_pending_admin_cap_rotation`
- `cancel_pending_arb_cap_rotation`
- `cancel_pending_treasury_cap_rotation`
- `cap_rotation_timelock_ms`
- `emergency_rotation_enabled`
- `incident_freeze_enabled`
- `pending_admin_rotation_approved`
- `pending_arb_rotation_approved`
- `pending_treasury_rotation_approved`

Runtime `public(package)`:
- `init_caps`

Runtime `private`:
- `new_caps`
- `new_governance_config`
- `emit_initialized`
- `init`
- `assert_valid_new_owner`
- `queue_cap_rotation`

`#[test_only] public`:
- `new_governance_config_for_testing`
- `destroy_governance_config_for_testing`
- `destroy_admin_cap_for_testing`
- `destroy_arb_cap_for_testing`
- `destroy_treasury_cap_for_testing`

### escrow.move
Runtime `public`:
- `queue_iota_fee_update`
- `approve_pending_iota_fee_update`
- `cancel_pending_iota_fee_update`
- `apply_iota_fee_update`
- `iota_fee_bps`
- `iota_fee_recipient`
- `fee_timelock_ms`
- `has_pending_fee_update`
- `pending_fee_effective_at_ms`
- `pending_iota_fee_bps`
- `pending_iota_fee_recipient`
- `pending_fee_treasury_approved`
- `released_state`
- `disputed_state`
- `resolved_state`
- `dispute_timeout_ms`
- `settlement_to_seller_path`
- `settlement_to_buyer_path`
- `settlement_split_path`

Runtime `private`:
- `compute_fee`
- `assert_valid_fee_config`
- `new_fee_config`
- `init`
- `is_iota_type<T>`
- `create_escrow_with_coin<T>`
- `transfer_all_to<T>`
- `payout_to_seller_with_fee<T>`
- `payout_split_with_fee<T>`
- `emit_state_change<T>`
- `emit_settlement<T>`

`#[test_only] public`:
- `state<T>`
- `locked_amount<T>`
- `fee_amount<T>`
- `fee_recipient<T>`
- `amount<T>`
- `escrow_created_event_at_for_testing`
- `escrow_state_changed_event_at_for_testing`
- `escrow_settlement_event_at_for_testing`
- `new_fee_config_for_testing`
- `destroy_fee_config_for_testing`
- `destroy_for_testing<T>`

### deadline_ext.move
Runtime `public entry`:
- `propose_extension_guarded`
- `accept_extension_with_escrow_guarded`
- `reject_extension`
- `expire_extension`
- `delete_settled_extension`

Runtime `public`:
- none

Runtime `public(package)`:
- none

Runtime `private`:
- `init`
- `extension_count_for_escrow`
- `has_pending_extension`
- `clear_pending_extension_or_abort`
- `set_extension_count`
- `accept_extension_with_escrow_internal<T>`

`#[test_only]`:
- `assert_non_empty_with_max`
- `propose_extension_internal`
- `init_for_testing`
- `extension_count_for_escrow_for_testing`
- `has_pending_extension_for_testing`
- `propose_extension_for_testing`
- `accept_extension_for_testing`
- `accept_extension_with_escrow_for_testing<T>`
- `destroy_for_testing`

### onchain_asset_lane_manager.move
Runtime `public`:
- none

Runtime `public(package)`:
- `is_claw_order_typed_asset`
- `is_usdx_order_typed_asset`
- `is_supported_order_typed_non_iota_asset`
- `supported_order_typed_non_iota_asset_bytes`
- `matches_supported_order_typed_non_iota_asset_bytes`
- `same_supported_order_typed_non_iota_asset`
- `is_supported_dispute_bond_typed_non_iota_asset`
- `supported_dispute_bond_typed_non_iota_asset_bytes`

Runtime `private`:
- `exact_type_bytes`
- `matches_exact_type<T>`

### order_payment_assets.move
Runtime `public`:
- none

Runtime `public(package)`:
- `is_supported_order_payment_iota_type`
- `is_supported_order_payment_claw_coin_type`
- `is_supported_order_payment_usdx_coin_type`
- `is_supported_order_payment_typed_coin_type`

Runtime `private`:
- `is_supported_experimental_order_payment_typed_coin_type<T>`

### payment_assets.move
Runtime `public`:
- none

Runtime `public(package)`:
- `is_iota_type`
- `is_claw_coin_type`
- `is_supported_order_typed_coin_type`
- `is_supported_dispute_bond_typed_coin_type`
- `is_supported_reviewer_stake_typed_coin_type`
- `typed_order_payment_matches_dispute_bond_asset`

Runtime `private`:
- none

### listing_deposit.move
Runtime `public entry`:
- `create_listing_deposit_iota_entry`
- `create_listing_deposit_iota_shared_entry`

Runtime `public`:
- `queue_listing_deposit_policy_update`
- `approve_pending_listing_deposit_policy_update`
- `cancel_pending_listing_deposit_policy_update`
- `apply_listing_deposit_policy_update`
- `create_listing_deposit_iota`
- `refund_listing_deposit_full_and_unbind`
- `forfeit_listing_deposit_by_policy_and_unbind`
- `forfeit_listing_deposit_with_refund_bps_and_unbind`
- `active_state`
- `refunded_state`
- `forfeited_state`
- `settlement_refund_full_mode`
- `settlement_forfeit_partial_mode`
- `deposit_amount_iota`
- `partial_refund_bps`
- `forfeit_sink`
- `timelock_ms`
- `has_pending_update`
- `pending_effective_at_ms`
- `pending_deposit_amount_iota`
- `pending_partial_refund_bps`
- `pending_forfeit_sink`
- `pending_treasury_approved`

Runtime `public(package)`:
- `refund_listing_deposit_owner_cancel_and_unbind`

Runtime `private`:
- `assert_valid_config`
- `assert_valid_listing_ref`
- `assert_accounting_invariant`
- `payout_iota_to`
- `settle_terminal`
- `new_config`
- `init`
- `forfeit_listing_deposit_with_refund_bps_internal`

`#[test_only] public`:
- `state`
- `locked_amount`
- `refunded_total`
- `forfeited_total`
- `deposit_in`
- `listing_ref_bytes`
- `listing_deposit_created_event_at_for_testing`
- `listing_deposit_settled_event_at_for_testing`
- `new_config_for_testing`
- `destroy_config_for_testing`
- `destroy_deposit_for_testing`

### bond.move
Hinweis:
- `Bond` ist seit dem F3-Refactor bewusst ein Metadaten-/Policy-Objekt ohne echte On-Chain-Coin-Custody.
- Das Modul haelt nur `owner`, `kind`, `amount` und `state`; es nutzt kein `Balance<T>` und verwahrt keine Coins.
- Etwaige Bond-Anforderungen werden off-chain bzw. ueber die umgebende Produkt-/Policy-Logik erzwungen, nicht durch On-Chain-Funds-Locking in `bond.move`.

Runtime `public`:
- `create_listing_bond_claw`
- `create_worker_bond_claw`
- `release_bond<T>`
- `slash_bond<T>`
- `listing_kind`
- `worker_kind`
- `released_state`
- `slashed_state`

Runtime `private`:
- `create_bond<T>`

`#[test_only] public`:
- `create_bond_for_testing<T>`
- `state<T>`
- `bond_created_event_at_for_testing`
- `bond_state_changed_event_at_for_testing`

### tier.move
Hinweis:
- `TierLock` ist seit dem F3-Refactor bewusst ein Metadaten-/Ranking-Objekt ohne echte On-Chain-Coin-Custody.
- Das Modul berechnet Tier, Ranking-Boost und Gasless-Quota-Multiplikator aus `amount` und Lock-Dauer, haelt aber kein `Balance<T>` und verwahrt keine CLAW-Coins.
- Tier-/Quota-Semantik wird off-chain bzw. ueber die umgebende Produkt-/Policy-Logik durchgesetzt; `tier.move` selbst ist kein Staking-/Treasury-Custody-Modul.

Runtime `public`:
- `create_tier_lock_claw`
- `release_tier_lock<T>`
- `tier_for_amount_and_duration`
- `ranking_boost_bps_for_tier`
- `gasless_quota_multiplier_bps_for_tier`
- `tier_1`
- `tier_2`
- `tier_3`
- `tier_4`
- `released_state`

Runtime `private`:
- `ranking_boost_bps_for_tier_internal`
- `gasless_quota_multiplier_bps_for_tier_internal`
- `tier_for_amount_and_duration_internal`

`#[test_only] public`:
- `tier_value<T>`
- `state<T>`
- `ranking_boost_bps<T>`
- `gasless_quota_multiplier_bps<T>`
- `tier_lock_created_event_at_for_testing`
- `tier_lock_state_changed_event_at_for_testing`

### rewards.move
Runtime `public`:
- `init_pool`
- `deposit_iota_fees`
- `record_claw_payout`
- `rotate_epoch`
- `close_pool`
- `reopen_pool`
- `closed_state`
- `open_state`

`#[test_only] public`:
- `epoch`
- `status`
- `total_iota_fees`
- `total_claw_distributed`
- `reward_pool_initialized_event_at_for_testing`
- `reward_pool_totals_event_at_for_testing`
- `reward_pool_state_event_at_for_testing`

### manifest_anchor.move
Runtime `public entry`:
- `anchor_milestone_manifest`

Runtime `private`:
- `assert_non_empty_with_max`
- `is_lower_hex_ascii`
- `assert_hex_string`

### errors.move
Runtime `public`:
- `e_not_authorized`
- `e_invalid_state`
- `e_deadline_not_reached`
- `e_invalid_amount`
- `e_invalid_deadline`
- `e_invalid_kind`
- `e_self_deal_not_allowed`
- `e_invalid_fee_config`
- `e_invalid_lock_duration`
- `e_lock_not_matured`
- `e_invalid_tier`
- `e_invalid_reward_state`
- `e_iota_requires_fee_path`
- `e_invalid_manifest_anchor_input`
- `e_dispute_timeout_not_reached`
- `e_invalid_address`
- `e_fee_timelock_not_elapsed`
- `e_no_pending_fee_update`
- `e_fee_update_not_approved`
- `e_no_pending_cap_rotation`
- `e_cap_rotation_timelock_not_elapsed`
- `e_incident_freeze_active`
- `e_cap_rotation_not_approved`
- `e_invalid_listing_deposit_config`
- `e_invalid_listing_ref`
- `e_invalid_listing_deposit_settlement`
- `e_no_pending_listing_deposit_update`
- `e_listing_deposit_update_not_approved`
- `e_listing_deposit_timelock_not_elapsed`

## 2) Nutzerrollen und Perspektiven

- `Admin`: steuert Governance, Fee/Policy Queueing, Settlement-Entscheidungen, Bond-Slash.
- `Treasury`: 2nd approver fuer Admin/Arb Rotation, Fee-/Listing-Policy-Approval.
- `Arbiter`: Dispute Resolution, Treasury-Rotation-Approval.
- `Buyer`: erstellt Escrow, releast Escrow, oeffnet Dispute.
- `Seller`: empfangt Settlement, kann Claim nach Deadline, kann Dispute oeffnen.
- `Listing Owner`: hinterlegt Listing Deposit, erwartet Refund/Forfeit gemaess Regeln.
- `Observer/Any`: kann bei Timeout-Fallback im Escrow liveness settlement triggern.

## 3) Senior-Dev Testfallkatalog aus Nutzerperspektive

### A) Governance und Cap-Rotation (`admin`)

- `GOV-01` Queue Admin rotation happy path.
- `GOV-02` Queue Arb rotation happy path.
- `GOV-03` Queue Treasury rotation happy path.
- `GOV-04` Queue with `new_owner = 0x0` => abort `E_INVALID_ADDRESS`.
- `GOV-05` Approve without pending rotation => abort `E_NO_PENDING_CAP_ROTATION`.
- `GOV-06` Apply without approval => abort `E_CAP_ROTATION_NOT_APPROVED`.
- `GOV-07` Apply before timelock => abort `E_CAP_ROTATION_TIMELOCK_NOT_ELAPSED`.
- `GOV-08` Apply after timelock transfers cap to pending owner.
- `GOV-09` Apply second time on same pending request => abort `E_NO_PENDING_CAP_ROTATION`.
- `GOV-10` Incident freeze blocks queue => abort `E_INCIDENT_FREEZE_ACTIVE`.
- `GOV-11` Incident freeze blocks approve => abort `E_INCIDENT_FREEZE_ACTIVE`.
- `GOV-12` Incident freeze blocks apply => abort `E_INCIDENT_FREEZE_ACTIVE`.
- `GOV-13` Emergency rotate while freeze=false => abort `E_INVALID_STATE`.
- `GOV-14` Emergency rotate while emergency disabled => abort `E_INVALID_STATE`.
- `GOV-15` Emergency rotate works only when `incident_freeze_active=true` and `allow_emergency_rotation=true`.
- `GOV-16` Toggle `set_incident_freeze` and `set_allow_emergency_rotation` emits expected events.

### B) Fee-Config Governance (`escrow`)

- `FEE-01` Queue fee update happy path (`bps`, recipient, effective_at).
- `FEE-02` Queue with `bps > 10000` => abort `E_INVALID_FEE_CONFIG`.
- `FEE-03` Queue with `bps > 0` and `recipient=0x0` => abort `E_INVALID_FEE_CONFIG`.
- `FEE-04` Approve without pending update => abort `E_NO_PENDING_FEE_UPDATE`.
- `FEE-05` Apply without pending update => abort `E_NO_PENDING_FEE_UPDATE`.
- `FEE-06` Apply without treasury approval => abort `E_FEE_UPDATE_NOT_APPROVED`.
- `FEE-07` Apply before timelock => abort `E_FEE_TIMELOCK_NOT_ELAPSED`.
- `FEE-08` Apply after timelock updates active fee and clears pending fields.
- `FEE-09` Freeze blocks queue/approve/apply => abort `E_INCIDENT_FREEZE_ACTIVE` (jeweils separater Assert).
- `FEE-10` New escrow before apply uses old fee, after apply uses new fee.

### C) Escrow Lifecycle (`escrow`)
Historisch auf der fresh lineage entfernt.

- Aktive Runtime-Lifecycle-Coverage liegt jetzt in:
  - `order_escrow_tests`
  - `milestone_escrow_tests`
  - `dispute_quorum_tests`
- `escrow.move` ist auf Fee-Config-/Governance-Host reduziert.
- `ESC-10` Release by non-buyer => abort `E_NOT_AUTHORIZED`.
- `ESC-11` Release in non-`CREATED` => abort `E_INVALID_STATE`.
- `ESC-12` Seller claim before deadline => abort `E_DEADLINE_NOT_REACHED`.
- `ESC-13` Seller claim after deadline => success, state `RELEASED`.
- `ESC-14` Claim by non-seller => abort `E_NOT_AUTHORIZED`.
- `ESC-15` Buyer opens dispute before deadline => success, state `DISPUTED`.
- `ESC-16` Seller opens dispute before deadline => success.
- `ESC-17` Third party opens dispute => abort `E_NOT_AUTHORIZED`.
- `ESC-18` Open dispute at/after deadline => abort `E_INVALID_STATE`.
- `ESC-18a` Mutual cancel with both approvals => buyer refund, state terminal, settlement/state events correct.
- `ESC-18b` Mutual cancel with only one approval => abort `E_INVALID_STATE`.
- `ESC-18c` Mutual cancel can still be followed by no-case dispute-bond release for already-active bonds.
- `ESC-19` Arb resolves dispute to seller => state `RESOLVED`, fee path honored.
- `ESC-20` Arb resolves dispute to buyer => state `RESOLVED`, buyer gets all locked amount.
- `ESC-21` Resolve by arb in non-`DISPUTED` => abort `E_INVALID_STATE`.
- `ESC-22` Timeout resolve to seller before deadline => abort `E_DEADLINE_NOT_REACHED`.
- `ESC-23` Timeout resolve before dispute timeout => abort `E_DISPUTE_TIMEOUT_NOT_REACHED`.
- `ESC-24` Timeout resolve to seller after timeout => nur mit `ArbCap` (privilegierter Pfad).
- `ESC-25` Timeout split after timeout => success; remaining after fee splits 50/50 with seller remainder.
- `ESC-26` Timeout split before timeout => abort `E_DISPUTE_TIMEOUT_NOT_REACHED`.
- `ESC-27` Double settlement attempts on same escrow => abort `E_INVALID_STATE`.
- `ESC-28` Event payload assertions for create/state/settlement fields.
- `ESC-29` Arithmetic checks: `total_amount == fee_paid + seller_paid + buyer_paid` for all settlement paths.
- `ESC-30` Fee rounding edge (small amounts) and zero-fee path.

### D) Listing Deposit Governance (`listing_deposit`)

- `LDP-GOV-01` Queue policy update happy path.
- `LDP-GOV-02` Queue invalid config (`deposit_amount=0`) => abort `E_INVALID_LISTING_DEPOSIT_CONFIG`.
- `LDP-GOV-03` Queue invalid config (`partial_refund_bps>10000`) => abort.
- `LDP-GOV-04` Queue invalid config (`forfeit_sink=0x0`) => abort.
- `LDP-GOV-05` Approve without pending => abort `E_NO_PENDING_LISTING_DEPOSIT_UPDATE`.
- `LDP-GOV-06` Apply without pending => abort `E_NO_PENDING_LISTING_DEPOSIT_UPDATE`.
- `LDP-GOV-07` Apply without treasury approval => abort `E_LISTING_DEPOSIT_UPDATE_NOT_APPROVED`.
- `LDP-GOV-08` Apply before timelock => abort `E_LISTING_DEPOSIT_TIMELOCK_NOT_ELAPSED`.
- `LDP-GOV-09` Apply after timelock updates config and clears pending fields.
- `LDP-GOV-10` Freeze blocks queue/approve/apply => abort `E_INCIDENT_FREEZE_ACTIVE` (jeweils separater Assert).

### E) Listing Deposit Lifecycle (`listing_deposit`)

- `LDP-01` Create deposit happy path with exact required IOTA amount.
- `LDP-02` `create_listing_deposit_iota_shared_entry` (Golden Path) teilt Deposit-Objekt fuer Multi-Party Settlement.
- `LDP-02b` `create_listing_deposit_iota_entry` bleibt kompatibler Owner-owned Legacy-Pfad.
- `LDP-03` Sender != owner => abort `E_NOT_AUTHORIZED`.
- `LDP-04` Empty `listing_ref` => abort `E_INVALID_LISTING_REF`.
- `LDP-05` `listing_ref` length > 128 => abort `E_INVALID_LISTING_REF`.
- `LDP-06` Amount != configured deposit => abort `E_INVALID_AMOUNT`.
- `LDP-07` Admin full refund => state `REFUNDED`, owner gets all.
- `LDP-08` Forfeit by policy with 0 bps refund => full amount to sink.
- `LDP-09` Forfeit by policy with 10000 bps refund => full amount to owner, state still `FORFEITED`.
- `LDP-10` Forfeit custom with 2500 bps => 25% owner / 75% sink.
- `LDP-11` Forfeit custom with bps > 10000 => abort `E_INVALID_LISTING_DEPOSIT_CONFIG`.
- `LDP-12` Any terminal settlement from non-`ACTIVE` => abort `E_INVALID_STATE`.
- `LDP-13` External call to owner-cancel path not moeglich (`public(package)`).
- `LDP-14` Accounting invariant always true: `deposit_in == refunded_total + forfeited_total + remaining`.
- `LDP-15` Settlement consumes full locked balance to zero.
- `LDP-16` Event payload assertions for create and settled events.

### F) Bond (`bond`)

- `BOND-01` Create listing bond success.
- `BOND-02` Create worker bond success.
- `BOND-03` Create with amount 0 => abort `E_INVALID_AMOUNT`.
- `BOND-04` Invalid kind via test helper => abort `E_INVALID_KIND`.
- `BOND-05` Owner releases active bond => state `RELEASED`.
- `BOND-06` Non-owner release => abort `E_NOT_AUTHORIZED`.
- `BOND-07` Release when not active => abort `E_INVALID_STATE`.
- `BOND-08` Admin slashes active bond => state `SLASHED`.
- `BOND-09` Slash when not active => abort `E_INVALID_STATE`.
- `BOND-10` Event payload assertions for create/state-change.

### G) Tier Lock (`tier`)

- `TIER-01` Create lock with valid duration and amount.
- `TIER-02` Duration < 1 day => abort `E_INVALID_LOCK_DURATION`.
- `TIER-03` Amount 0 => abort `E_INVALID_AMOUNT`.
- `TIER-04` Boundary test Tier 1: amount=5000, duration=7d => Tier 1.
- `TIER-05` Boundary test Tier 2: amount=50000, duration=30d => Tier 2.
- `TIER-06` Boundary test Tier 3: amount=500000, duration=90d => Tier 3.
- `TIER-07` Boundary test Tier 4: amount=5000000, duration=180d => Tier 4.
- `TIER-08` Just-below boundaries => lower tier/none.
- `TIER-09` Release by non-owner => abort `E_NOT_AUTHORIZED`.
- `TIER-10` Release before unlock => abort `E_LOCK_NOT_MATURED`.
- `TIER-11` Release after unlock => state `RELEASED`.
- `TIER-12` Release twice => abort `E_INVALID_STATE`.
- `TIER-13` `ranking_boost_bps_for_tier(>4)` => abort `E_INVALID_TIER`.
- `TIER-14` `gasless_quota_multiplier_bps_for_tier(>4)` => abort `E_INVALID_TIER`.

### H) Rewards (`rewards`)

- `RWD-01` Init pool => epoch=1, status OPEN.
- `RWD-02` Deposit iota fees in OPEN with amount>0 => totals update.
- `RWD-03` Deposit with amount 0 => abort `E_INVALID_AMOUNT`.
- `RWD-04` Record payout with amount 0 => abort `E_INVALID_AMOUNT`.
- `RWD-05` Record payout in OPEN with amount>0 => totals update.
- `RWD-06` Rotate epoch in OPEN => epoch+1, totals reset.
- `RWD-07` Close pool from OPEN => CLOSED.
- `RWD-08` Close pool again => abort `E_INVALID_REWARD_STATE`.
- `RWD-09` Reopen pool from CLOSED => OPEN.
- `RWD-10` Reopen while OPEN => abort `E_INVALID_REWARD_STATE`.
- `RWD-11` Deposit/record/rotate while CLOSED => abort `E_INVALID_REWARD_STATE`.
- `RWD-12` Event payload assertions for init/totals/state.

### I) Manifest Anchoring (`manifest_anchor`)

- `MAN-01` Valid anchor tx emits `MilestoneManifestAnchored`.
- `MAN-02` Sender != seller_address => abort `E_NOT_AUTHORIZED`.
- `MAN-03` Empty `order_id` => abort `E_INVALID_MANIFEST_ANCHOR_INPUT`.
- `MAN-04` `order_id` > 128 chars => abort.
- `MAN-05` Empty/oversized `milestone_id` => abort.
- `MAN-06` Empty/oversized `manifest_cid` (>256) => abort.
- `MAN-07` `manifest_sha256` len != 64 => abort.
- `MAN-08` `seller_sig_hash` len != 64 => abort.
- `MAN-09` Uppercase hex in hash => abort (nur lower-hex erlaubt).
- `MAN-10` Non-hex chars in hash => abort.

### J) Cross-Module / End-to-End / Soak

- `X-01` Incident freeze should block governance updates, but not normal escrow settlement paths.
- `X-02` Full cap emergency drill: freeze on -> emergency on -> rotate -> emergency off -> freeze off.
- `X-03` Two-party order happy path: listing_deposit + escrow + release + manifest anchor.
- `X-04` Two-party dispute path: open_dispute -> arb resolution to seller/buyer.
- `X-05` Timeout liveness path without arb: resolve after timeout to seller and split.
- `X-06` Config cutover consistency: fee/listing updates affect only new objects after apply.
- `X-07` Reentrancy-like replay attempts on settled objects fail by state checks.
- `X-08` Event stream consistency for indexer: payload fields and order.
- `X-09` Multi-escrow concurrency (parallel users, mixed tokens, mixed deadlines).
- `X-10` Soak run with repeated create/settle/dispute cycles and invariant checks.


### K) Security Hardening / Regression / Property Tests (Ergaenzung)

> Diese Tests sind *zusaetzlich* zu A–J gedacht und sollen die typischen Audit-Failures abdecken (Entry-Surface, Timelock-Boundaries, Invariant/Soak, ABI/Event-Regressions).

#### K1) ABI / Entry-Surface Regression (off-chain, muss in CI laufen)
- `ABI-01` Snapshot aller in PTBs aufrufbaren Funktionen pro Modul (`public` + `entry`, inkl. `entry` auch wenn nicht-`public`) und compare gegen Allowlist (Regression-Guard gegen versehentliche Exponierung).
- `ABI-02` Snapshot Event-Struct Layout (Feldnamen + Reihenfolge) fuer Indexer-Kompatibilitaet.
- `ABI-03` Verify `#[test_only]` Symbole erscheinen **nicht** in published modules (z.B. via normalized modules / RPC).

#### K2) Timelock / Deadline Boundary Tests (`==` ist entscheidend)
- `TIME-01` Fee-Apply exakt bei `now == pending_fee_effective_at_ms` => **muss** deterministisch sein (definiert als OK oder Abort, aber konsistent dokumentiert).
- `TIME-02` Cap-Rotation Apply exakt bei `now == queued_at + timelock` => deterministisches Verhalten.
- `TIME-03` Listing-Deposit Policy Apply exakt bei `now == pending_effective_at_ms` => deterministisches Verhalten.
- `TIME-04` Order/Milestone Escrow: Deadline-/Dispute-Boundaries bleiben in den aktiven order-/milestone-scoped Modulen explizit getestet.

#### K3) Governance / Emergency Rotation Abuse-Tests (Design-Check)
- `GOV-17` Emergency Rotation darf **nicht** als „Timelock/2nd-Approver Bypass“ missbraucht werden.
  - Falls *by design* doch: dokumentiere die Trust-Assumption und fuege Monitoring/Runbook hinzu.
- `GOV-18` Freeze-Mode: Governance-Updates geblockt, aber **Funds-Liveness** (Escrow/Deposit Settlement) bleibt moeglich (wie X-01, aber granular pro Funktion).
- `GOV-19` (Optional) Pending-Requests koennen gecancelt werden (falls Cancel-Funktionen eingefuehrt werden; siehe Abschnitt 8).

#### K4) Escrow – Arithmetic & Token-Safety
- `ESC-31` Fee kann niemals `> amount` sein (selbst bei maximalen bps und kleinen Amounts).
- `ESC-32` Split-Payout Rundungsregel ist eindeutig (wer erhaelt den Rest-Token?) und in Events reflektiert.
- `ESC-33` Non-IOTA Coin Pfad: Fee muss **0** sein und Recipient darf nicht bezahlt werden.
- `ESC-34` „Any actor“ Timeout Settlement: vor Timeout muss immer aborten; nach Timeout darf **kein** Unauthorized-Drain moeglich sein.
- `ESC-35` Fuzz: zufaellige Sequenzen von Aktionen (release / dispute / resolve / timeout) => keine invariant-violations, keine stuck balances.
- `ESC-36` Mutual-cancel approval flags are cleared on terminal settlement paths so stale approvals cannot leak into later delete semantics.

#### K5) Listing Deposit – Accounting & Edge
- `LDP-17` Deposit Accounting Invariant Property-Test: `deposit_in == refunded_total + forfeited_total + remaining` fuer zufaellige Refund-BPS.
- `LDP-18` Forfeit/Refund Boundary (0 / 10000 bps) + Rundung bei sehr kleinen Deposit-Amounts.
- `LDP-19` Settlement Mode Mismatch (falls intern mehrere Modi existieren): falscher Modus => abort `E_INVALID_LISTING_DEPOSIT_SETTLEMENT`.

#### K6) Bond / TierLock – Residual & Authorization
- `BOND-11` Slash/Release konsumiert locked balance komplett; keine Rest-Coins im Bond-Objekt.
- `BOND-12` Slashed Funds Destination ist explizit (sink/burn) und getestet.
- `TIER-15` Release exakt bei `now == unlock_time` (Boundary) und danach; doppelte Releases aborten.

#### K7) Rewards – Manipulationsschutz
- `RWD-13` Nur erlaubte Rollen/Module duerfen `deposit_iota_fees`/`record_claw_payout` ausfuehren (oder: falls absichtlich offen, dann begruenden + testen, dass kein Schaden entsteht).
- `RWD-14` Overflow/Monotonicity: totals koennen nicht ueberlaufen; rotate_epoch setzt totals sauber zurück.

#### K8) Manifest Anchor – Input & Gas/DoS
- `MAN-11` Max-Size Inputs (order_id=128, milestone_id=128, manifest_cid=256, hashes=64) laufen unter realistischer Gas-Upperbound.
- `MAN-12` Nicht-ASCII / control-chars (falls nicht erlaubt) => abort; andernfalls: dokumentiere als erlaubt und teste Indexer-Verhalten.

## 4) Empfohlene Multi-Wallet E2E Simulation (2 Parteien + Governance)

Wallet-Rollen (mindestens):
- `W1`: Admin
- `W2`: Treasury
- `W3`: Arbiter
- `W4`: Buyer A
- `W5`: Seller A
- `W6`: Buyer B (parallel flow)
- `W7`: Seller B (parallel flow)
- `W8`: Neutral/Any actor fuer timeout fallback

Szenario-Set E2E:
- `E2E-01` Happy path A: Buyer A creates escrow (IOTA), Seller A delivers, Buyer A releases.
- `E2E-02` Dispute A: Buyer A opens dispute, Arb resolves to seller.
- `E2E-03` Dispute B: Seller B opens dispute, Arb resolves to buyer.
- `E2E-04` Timeout fallback: dispute unresolved, W8 resolves after timeout split.
- `E2E-05` Listing deposit policy path: create deposit, forfeit by policy, create second deposit after policy update.
- `E2E-06` Governance path: queue+approve+apply fee update, verify new escrow fee.

## 5) Akzeptanzkriterien fuer "testphase-ready"

- Alle `public entry`- und alle geschwindigkeits-/money-kritischen `public` Funktionen haben Happy + Failure + Boundary Tests.
- Fuer jeden abort code aus `errors.move` existiert mindestens ein gezielter negativer Test.
- Jede state machine hat Transition-Tests inkl. illegal transitions.
- Event payload assertions sind feldgenau (nicht nur event count).
- Zwei-Party E2E gegen Testnet mindestens mehrfach stabil.
- Soak-Lauf zeigt keine stuck states und keine Accounting-Drifts.
- ABI-/Entry-Surface Regression-Guards (`ABI-01..03`) laufen in CI und verhindern versehentliche Exponierung/Test-Only-Leaks.
- Timelock/Deadline Boundary Tests (`TIME-01..04`) sind implementiert und in CI aktiv.
- Property-/Invariant-Tests (z.B. `ESC-35`, `LDP-17`) laufen mit ausreichender Iterationstiefe und finden keine Violations.

## 6) Direkte Kommandos (bestehende Test-Suites)

- Contracts unit/integration:
  - `cd /home/codex/clawdex && corepack pnpm test:contracts`
- SDK testnet checks:
  - `cd /home/codex/clawdex && MARKETPLACE_PACKAGE_ID=<pkg> MARKETPLACE_FEE_CONFIG_OBJECT_ID=<fee_cfg> IOTA_RPC_URL=https://api.testnet.iota.cafe corepack pnpm test:sdk:testnet`
- API testnet checks:
  - `cd /home/codex/clawdex && MARKETPLACE_PACKAGE_ID=<pkg> MARKETPLACE_FEE_CONFIG_OBJECT_ID=<fee_cfg> IOTA_RPC_URL=https://api.testnet.iota.cafe corepack pnpm test:api:testnet`
- Two-party matrix local:
  - `cd /home/codex/clawdex && corepack pnpm test:matrix:2p:local`
- Two-party matrix testnet:
  - `cd /home/codex/clawdex && corepack pnpm test:matrix:2p:testnet`
- Two-party full (write E2E):
  - `cd /home/codex/clawdex && corepack pnpm test:matrix:2p:full`


## 7) Test Plan / Abfolge (empfohlene Reihenfolge + Gates)

> Ziel: schnell Feedback (Unit), dann systemische Sicherheit (Invariants/Regression), dann Realismus (E2E lokal), zuletzt Testnet.

### Phase 0 – Pre-flight (Build, Format, Surface)
1. **Build/Compile**: Move build + unit tests kompilieren.
2. **ABI/Callable Surface Snapshot** (`ABI-01..03`): PTB-callable Surface + Event-Schema + Test-Only Exclusion.
3. **Static Checks (empfohlen)**:
   - keine unbounded loops / keine unbounded data growth
   - alle Transfers sind explizit und in Events reflektiert

### Phase 1 – Modul-Unit-Tests (State Machines + Negative Tests)
Reihenfolge (damit Setup-Objekte/Caps zuerst stabil sind):
1. `admin` (GOV-01..16 + GOV-17..19)
2. `escrow` Fee-Config Governance (FEE-01..10 + TIME-01)
3. `escrow` Lifecycle (ESC-01..30 + ESC-31..35 + TIME-04)
4. `listing_deposit` Governance (LDP-GOV-01..10 + TIME-03)
5. `listing_deposit` Lifecycle (LDP-01..16 + LDP-17..19)
6. `bond` (BOND-01..10 + BOND-11..12)
7. `tier` (TIER-01..14 + TIER-15)
8. `rewards` (RWD-01..12 + RWD-13..14)
9. `manifest_anchor` (MAN-01..10 + MAN-11..12)

**Gate:** Jede Gruppe muss mindestens:
- Happy Path + Failure + Boundary abdecken,
- pro Abort-Code mindestens 1 zielgerichteten Test haben,
- Event-Payload feldgenau verifizieren.

### Phase 2 – Property / Invariant Tests (Sicherheitsnetz)
- Fuehre `ESC-35`, `LDP-17`, `PROP-*` (falls implementiert) mit ausreichend Iterationen aus.
- Gate: keine invariant-violations, keine stuck balances, keine panics.

### Phase 3 – Cross-Module Integration (X-01..X-10 + neue X-Tests)
- `X-01`..`X-10` plus:
  - `X-11` ABI/Event snapshot gegen deployed package (Testnet) matcht Allowlist.
  - `X-12` Boundary Times in E2E (deadline/timelock exakt).

### Phase 4 – Multi-Wallet E2E lokal (Matrix)
- Run: `pnpm test:matrix:2p:local`
- Mindestens 3 Durchlaeufe mit variierenden Amounts/Deadlines.

### Phase 5 – Soak (Liveness + Accounting Drift)
- 100+ Zyklen create/settle/dispute/timeout in gemischten Tokens (wo moeglich).
- Gate: keine stuck states, keine Accounting-Drifts (vgl. X-10).

### Phase 6 – Testnet (Real Chain, Indexer, RPC)
- Deploy + Smoke:
  1. `pnpm test:sdk:testnet`
  2. `pnpm test:api:testnet`
  3. `pnpm test:matrix:2p:testnet`
- Gate: Events werden korrekt konsumiert, keine „flaky“ time-based failures.


## 8) Empfohlene zusaetzliche Funktionen (falls ihr Ops/UX/Security verbessern wollt)

> **Hinweis:** Das ist *Design-Optionen* – nicht alles ist zwingend. Ich liste die typischen Luecken, die Audits/Incidents sonst spaeter teuer machen.

### 8.1 Governance: Pending-Requests canceln (Ops-Safety)
Status: umgesetzt.

Verfuegbar:
- `cancel_pending_admin_cap_rotation`
- `cancel_pending_arb_cap_rotation`
- `cancel_pending_treasury_cap_rotation`
- `cancel_pending_iota_fee_update`
- `cancel_pending_listing_deposit_policy_update`

Testabdeckung:
- `GOV-CANCEL-01` Cancel Cap-Rotation ohne Pending => abort `E_NO_PENDING_CAP_ROTATION`.
- `FEE-CANCEL-01` Cancel Fee-Update ohne Pending => abort `E_NO_PENDING_FEE_UPDATE`; mit Pending => pending/approved flags reset.
- `LDP-CANCEL-01` Cancel Listing-Deposit Policy ohne Pending => abort `E_NO_PENDING_LISTING_DEPOSIT_UPDATE`; mit Pending => pending/approved flags reset.

### 8.2 Admin Emergency Rotation: Bypass-Risiko explizit adressieren
Wenn Emergency Rotation aktuell **nur** `incident_freeze_active && allow_emergency_rotation` braucht, prueft bitte, ob ein kompromittierter Admin-Cap damit die 2nd-Approver/Timelock Schutzschicht umgehen kann.

**Haertung (eine von 3 Varianten)**
1. **Emergency Toggle durch Treasury** (nicht durch Admin), Rotation durch Admin *oder* Treasury.
2. **Separate EmergencyCap** (offline cold storage), die nur emergency rotation darf.
3. **2-of-3 auch im Emergency** (Admin + Treasury oder Admin + Arb).

**Neue Tests**
- `GOV-EMR-01` Emergency kann nicht allein durch Admin aktiviert+ausgefuehrt werden (wenn Haertung aktiv).
- `GOV-EMR-02` Emergency Runbook Drill (Freeze->Enable->Rotate->Disable->Unfreeze) ist reproduzierbar.

### 8.3 Escrow UX/Liveness: Mutual Cancel & Seller Refund (optional, reduziert Disputes)
Falls ihr in der Praxis viele „einvernehmliche“ Abbrueche erwartet, sind diese Funktionen Gold wert:

**Vorschlag A: Mutual Cancel (2-step)**
- `request_cancel<T>(escrow, buyer)` (nur Buyer, nur CREATED)
- `accept_cancel<T>(escrow, seller)` (nur Seller, nur nach request) -> payout Buyer (fee=0)

**Vorschlag B: Seller Refund**
- `refund_to_buyer<T>(escrow, seller)` (nur Seller, nur CREATED) -> payout Buyer (fee=0)

**Neue Tests**
- `ESC-CAN-01` Happy: request+accept => Buyer bekommt alles, state terminal, events korrekt.
- `ESC-CAN-02` Refund_to_buyer durch Seller => terminal, no fee.
- `ESC-CAN-03` Unauthorized / wrong state => abort.

### 8.4 Escrow Deadlines: Extend nur mit Consent (optional)
- `extend_deadline<T>(escrow, buyer, seller, new_deadline_ms)` (beide Parteien signalisieren Consent; new_deadline > old_deadline)

**Neue Tests**
- `ESC-DL-01` Extend increases deadline, dispute rules aktualisiert.
- `ESC-DL-02` Extend durch nur eine Partei => abort.
- `ESC-DL-03` new_deadline <= old_deadline oder <= now => abort.

### 8.5 Observability: Versioned Events + Indexer Guards (empfohlen)
- Fuegt in zentralen Events eine `schema_version: u8` oder `package_version: u64` hinzu.
- Optional: ein `Initialized`/`Upgraded` Event pro Modul.

**Neue Tests**
- `EVT-01` Schema version ist stabil und wird in allen relevanten Events gesetzt.
- `ABI-02` Snapshot Event layout + version field.
## 9) Abort-Code Coverage Matrix (errors.move -> Tests)

> Ziel: **jeder** Abort-Code aus `errors.move` hat mindestens **einen gezielten negativen Test** (minimal reproduzierbar, stabil, deterministisch).
> Das ist ein Audit-Gate: wenn ein neuer Error-Code hinzukommt oder umbenannt wird, muss die Matrix + ein Test-Case erweitert werden.

### 9.1 Matrix

**Legende**
- *Primary Test*: der direkteste Negativtest fuer diesen Error-Code (kein "zufaelliges" Auftreten).
- *Secondary Tests*: weitere Stellen, wo der Error-Code ebenfalls erwartet wird (Regression-Backstop).

| Error-Code (E_*) | Primary Test | Secondary / Notes |
|---|---|---|
| `E_NOT_AUTHORIZED` | `ESC-10` | `ESC-14`, `ESC-17`, `LDP-03`, `BOND-06`, `TIER-09`, `MAN-02` |
| `E_INVALID_STATE` | `ESC-11` | `GOV-13`, `GOV-14`, `ESC-18`, `ESC-21`, `ESC-27`, `LDP-12`, `BOND-07`, `BOND-09`, `TIER-12`, `RWD-08` |
| `E_DEADLINE_NOT_REACHED` | `ESC-12` | `ESC-22` |
| `E_INVALID_AMOUNT` | `ESC-05` | `LDP-06`, `BOND-03`, `TIER-03`, `RWD-03`, `RWD-04` |
| `E_INVALID_DEADLINE` | `ESC-08` | (Boundary: `deadline == now` und `deadline < now` getrennt testen) |
| `E_INVALID_KIND` | `BOND-04` | (via Test-Helper / invalid kind injection) |
| `E_SELF_DEAL_NOT_ALLOWED` | `ESC-07` | (auch fuer create_escrow_* Varianten) |
| `E_INVALID_FEE_CONFIG` | `FEE-02` | `FEE-03` |
| `E_INVALID_LOCK_DURATION` | `TIER-02` | (Boundary: exakt 1d vs 1d-1ms, sofern ms-Aufloesung) |
| `E_LOCK_NOT_MATURED` | `TIER-10` | (Boundary: exakt unlock time) |
| `E_INVALID_TIER` | `TIER-13` | `TIER-14` |
| `E_INVALID_REWARD_STATE` | `RWD-08` | `RWD-10`, `RWD-11` |
| `E_IOTA_REQUIRES_FEE_PATH` | `ESC-04` | (create_escrow_coin<IOTA> ist immer verboten) |
| `E_INVALID_MANIFEST_ANCHOR_INPUT` | `MAN-03` | `MAN-04..MAN-10` (diverse invalid inputs) |
| `E_DISPUTE_TIMEOUT_NOT_REACHED` | `ESC-23` | `ESC-26` |
| `E_INVALID_ADDRESS` | `GOV-04` | (auch fuer fee recipient / forfeit sink / new owner tests sinnvoll) |
| `E_FEE_TIMELOCK_NOT_ELAPSED` | `FEE-07` | (Boundary: exakt effective_at) |
| `E_NO_PENDING_FEE_UPDATE` | `FEE-04` | `FEE-05` |
| `E_FEE_UPDATE_NOT_APPROVED` | `FEE-06` | (auch Approval-False / wrong approver) |
| `E_NO_PENDING_CAP_ROTATION` | `GOV-05` | `GOV-09` |
| `E_CAP_ROTATION_TIMELOCK_NOT_ELAPSED` | `GOV-07` | (Boundary: exakt timelock) |
| `E_INCIDENT_FREEZE_ACTIVE` | `GOV-10` | `FEE-09`, `LDP-GOV-10` |
| `E_CAP_ROTATION_NOT_APPROVED` | `GOV-06` | (Approval reset / wrong approver) |
| `E_INVALID_LISTING_DEPOSIT_CONFIG` | `LDP-GOV-02` | `LDP-GOV-03`, `LDP-GOV-04`, `LDP-11` |
| `E_INVALID_LISTING_REF` | `LDP-04` | `LDP-05` |
| `E_INVALID_LISTING_DEPOSIT_SETTLEMENT` | `LDP-19` | (Settlement-Mode-Mismatch / falsche Settlement-Funktion) |
| `E_NO_PENDING_LISTING_DEPOSIT_UPDATE` | `LDP-GOV-05` | `LDP-GOV-06` |
| `E_LISTING_DEPOSIT_UPDATE_NOT_APPROVED` | `LDP-GOV-07` | (Approval-False / wrong approver) |
| `E_LISTING_DEPOSIT_TIMELOCK_NOT_ELAPSED` | `LDP-GOV-08` | (Boundary: exakt effective_at) |

### 9.2 CI-Automation-Idee: "Coverage Check" (empfohlen)

> Optional, aber sehr effektiv: CI faellt rot, wenn ein Error-Code ohne Test ist.

**Konzept (Repo-agnostisch)**
1. Extrahiere Error-Codes aus `errors.move` (Regex auf `e_...` oder auf die `E_...` constants, je nach Implementierung).
2. Extrahiere erwartete Abort-Codes aus Tests (Move tests + TS/SDK tests), z.B. `assert_abort!(..., E_...)` oder "expect abort E_...".
3. Vergleiche Mengen:
   - `missing = errors - tested_errors`
   - `dead = tested_errors - errors` (veraltete Tests / renamed codes)
4. CI fail wenn `missing` nicht leer ist.

**Praxis-Tipp**
- Wenn ihr keine festen `assert_abort` Macros habt: nutzt in TS Tests eine einheitliche Helper-Funktion, die den Abort-Code aus der Response parst und als `E_*` labelt.


## 10) CI / Release Gates (konkret: PR vs Nightly vs Release)

> Ziel: **keine** Sicherheits-/Accounting-Regression per Merge, aber trotzdem schnelle PR-Zyklen.
> Strategie: *fast deterministic gates* fuer PR, *heavy + network gates* nightly / pre-release.

### 10.1 Gate-Levels

**Gate P0 (PR Pflicht, schnell, deterministisch)**
- Muss bei jedem PR / Merge in `main` laufen.
- Keine externen Netzwerke (kein Testnet), damit Flakes minimiert werden.

Empfohlen:
- `pnpm test:contracts` (Move Unit/Integration, inkl. Negative/Boundary)
- ABI/Surface Snapshot Tests (z.B. `ABI-01..03`)
- Invariant-Smoketests (kleine, deterministische Sequenzen; keine Random-Fuzz)

**Gate P1 (PR Pflicht, systemisch)**
- Lokal-E2E ohne Testnet, multi-wallet deterministisch.

Empfohlen:
- `pnpm test:matrix:2p:local` (2 Parteien + Governance, wie in Abschnitt 4)

**Gate N0 (Nightly, heavy)**
- Laeuft 1x pro Nacht (oder bei Label `run-heavy`).
- Darf laenger dauern: Soak, Concurrency, lange Sequenzen.

Empfohlen:
- Soak/Stress: `X-10` (mit mehr Iterationen)
- Parallel/Concurrency: `X-09` (mehr User / gemischte Assets)
- Property/Fuzz (falls vorhanden): Escrow/ListingDeposit Accounting Sequenzen
- Optional: `pnpm test:matrix:2p:full` (wenn das wirklich heavy ist)

**Gate R0 (Release / Pre-Deploy, Testnet)**
- Vor Deploy / Package Upgrade / neue IDs.
- Network ist erlaubt, aber mit Retry/Backoff und klaren Timeouts.

Empfohlen (bestehende Commands, aus Abschnitt 6):
- `pnpm test:matrix:2p:testnet`
- `pnpm test:sdk:testnet`
- `pnpm test:api:testnet`

### 10.2 Reihenfolge (Fail-Fast)

1. P0 (schnellste Checks zuerst)
2. P1 (lokal E2E)
3. Nightly/Release nachgelagert

### 10.3 Flake-Policy (wichtig fuer Vertrauen)

- **0 tolerierte Flakes** in P0/P1.
- Bei N0/R0: Flakes sind ein Bug -> Ticket + Fix; keine "ignore rerun bis gruen".

### 10.4 Artefakte (Audit- und Debug-Value)

Speichert als CI Artefakt:
- **ABI/Callable Surface Snapshot** (Liste aller `public`/`public entry` callable Funktionen + Hash)
- **Event Schema Snapshot** (Event-Struct Namen + Felder; versioniert, um Indexer-Brueche zu erkennen)
- **Gas/Compute Budget Baselines** fuer Hot-Paths:
  - `create_escrow_*`, `release`, `open_dispute`, `resolve_*`
  - `create_listing_deposit_iota_shared_entry` (default), `create_listing_deposit_iota_entry` (legacy), `refund_*`, `forfeit_*`
  - Governance queue/approve/apply Pfade

### 10.5 Merge/Release Checkliste (kurz)

- [ ] P0 gruen
- [ ] P1 gruen
- [ ] Error-Code Coverage Matrix (Abschnitt 9) aktuell
- [ ] Keine neuen `public`/`entry` Funktionen ohne Tests
- [ ] Testnet Gate R0 gruen (vor Deploy)

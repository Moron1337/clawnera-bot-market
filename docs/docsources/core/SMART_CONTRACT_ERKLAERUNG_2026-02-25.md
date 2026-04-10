# CLAWDEX Smart Contract Erklaerung (Stand 2026-02-25)

## 1) Zweck und Scope
Dieser Contract-Paketstand bildet den on-chain Kern fuer den CLAWDEX-Marktplatz.
Er deckt folgende Kernbereiche ab:
- Escrow fuer Zahlungsabwicklung zwischen Buyer und Seller
- Listing-Deposit als Sicherheitsleistung fuer Listings
- Governance mit getrennten Rollen-Caps, Timelocks und Incident-Freeze
- Manifest-Anchor fuer beweisbare Off-Chain-Milestone-Artefakte
- Zusatzmodule fuer Bonds, Tier-Locks und Reward-Pool-Accounting

Quelle dieses Dokuments:
- `contracts/claw_marketplace/sources/*.move`
- `contracts/claw_marketplace/ci/callable_surface.snapshot`

Hinweis:
- Die unten aufgefuehrte Funktionsliste umfasst die produktive callable surface.
- `#[test_only]` Funktionen sind nicht Teil der produktiven Surface.

## 2) Rollenmodell
- Buyer: erstellt Escrow, kann freigeben, Streit oeffnen.
- Seller: kann nach Deadline claimen, kann Streit oeffnen.
- AdminCap: Policy-Updates queue'n, Freeze togglen, Admin-Operationen auf Deposits/Bonds/Rewards.
- TreasuryCap: zweiter Freigabepfad fuer Fee- und Policy-Updates sowie Cap-Rotationen.
- ArbCap: Schlichtungsentscheidungen im Dispute-Fall, Co-Approver bei Treasury-Rotation.
- Keeper/Indexer/Backend: ruft timelock-gesteuerte `apply_*` Funktionen auf und verarbeitet Events.

## 3) Was der Contract fachlich macht

### 3.1 Escrow (`escrow.move`)
- Erstellt Escrow-Objekte fuer IOTA und generische Coins (inkl. CLAW-Marker).
- Erzwingt Guardrails:
  - `buyer != seller`
  - `seller != 0x0`
  - `deadline > created_ms`
  - bei IOTA: Fee-Pfad ueber `FeeConfig`
- Lifecycle:
  - `CREATED` -> `RELEASED` (Buyer release oder Seller claim nach Deadline)
  - `CREATED` -> `DISPUTED` (Buyer oder Seller)
  - `DISPUTED` -> `RESOLVED` (Arb-Entscheid oder Timeout-Fallback)
- Timeout-Hardening:
  - Oeffentlicher Fallback nach Timeout ist deterministisch `split` (50/50 nach Fee).
  - Seller-only Timeout-Resolution ist privilegiert und braucht `ArbCap`.
- Fee-Governance fuer IOTA:
  - Queue (Admin) -> Approve (Treasury) -> Apply (nach Timelock).
  - Ops-Safety: `cancel_pending_iota_fee_update` zum gezielten Rueckbau fehlerhafter Pending-Updates.

### 3.2 Listing Deposit (`listing_deposit.move`)
- Erzwingt IOTA-Deposit in fixer Hoehe gemaess `ListingDepositConfig`.
- Listing-Referenz muss nicht leer sein und max. 128 Byte.
- Lifecycle:
  - `ACTIVE` -> `REFUNDED` (vollstaendige Rueckerstattung)
  - `ACTIVE` -> `FORFEITED` (teilweise/volle Einbehaltung gemaess BPS)
- Settlement ist bilanziell abgesichert (`deposit_in = refunded + forfeited + remaining`).
- Policy-Governance:
  - Queue (Admin) -> Approve (Treasury) -> Apply (nach Timelock).
- Shared-Entrypoint ist der Golden Path (`create_listing_deposit_iota_shared_entry`), damit Admin-settlement ohne Owner-Co-Sign moeglich bleibt.
- Ops-Safety: `cancel_pending_listing_deposit_policy_update` fuer Rollback von Pending-Policy-Updates.

### 3.3 Governance und Incident Control (`admin.move`)
- Bei Package-Init werden `AdminCap`, `ArbCap`, `TreasuryCap` erzeugt.
- `GovernanceConfig` wird shared publiziert (mit Rotation-Timelock).
- Standard-Rotation fuer Caps:
  - Queue (Admin) -> Co-Approval (Treasury oder Arb) -> Apply (Timelock).
- Ops-Safety: `cancel_pending_*_cap_rotation` erlaubt Pending-Rotationen kontrolliert zurueckzunehmen.
- Incident Freeze:
  - kann aktiv gesetzt werden und blockiert regulierte Pfade, die `assert_incident_not_frozen` nutzen.
- Emergency Rotation:
  - nur wenn `incident_freeze_active == true` und `allow_emergency_rotation == true`.

### 3.4 Manifest Anchor (`manifest_anchor.move`)
- Seller anchored pro Milestone ein Manifest-Ereignis on-chain.
- Validierungen:
  - Sender muss `seller_address` sein
  - laengenbegrenzte Strings
  - SHA-256 Felder muessen lowercase-hex (64 Zeichen) sein

### 3.5 Bond (`bond.move`)
- Leichtgewichtige Bond-Zustaende fuer Listing-/Worker-Kontext.
- States: `ACTIVE`, `RELEASED`, `SLASHED`.
- Owner kann release; Admin kann slashen.

### 3.6 Tier Lock (`tier.move`)
- Tier-Einstufung nach Amount + Lock-Dauer.
- Liefert Ranking-Boost und Gasless-Quota-Multiplikator (bps).
- Owner kann Lock nach `unlock_ms` releasen.

### 3.7 Rewards (`rewards.move`)
- Admin-gesteuertes Accounting fuer Fee- und CLAW-Auszahlungen pro Epoch.
- Pool kann geoeffnet/geschlossen werden, Epoch-Rotation setzt Summen zurueck.

## 4) On-chain relevante Nutzerfaelle (Testfaelle aus Produktsicht)

### 4.1 Buyer/Seller Escrow-Flows
1. Buyer erstellt IOTA-Escrow mit valider Deadline -> Escrow `CREATED`, Event `EscrowCreated`.
2. Buyer erstellt Coin-Escrow (nicht IOTA) -> ohne IOTA-Fee.
3. Buyer versucht self-deal (`buyer == seller`) -> Abort `E_SELF_DEAL_NOT_ALLOWED (7)`.
4. Buyer mit `seller = 0x0` -> Abort `E_INVALID_ADDRESS (16)`.
5. Buyer mit Deadline in Vergangenheit/Gegenwart -> Abort `E_INVALID_DEADLINE (5)`.
6. Buyer released vor Deadline -> Seller bekommt Amount minus Fee, State `RELEASED`.
7. Seller claimt nach Deadline ohne Dispute -> State `RELEASED`.
8. Seller claimt vor Deadline -> Abort `E_DEADLINE_NOT_REACHED (3)`.
9. Buyer oeffnet Dispute vor Deadline -> State `DISPUTED`.
10. Seller oeffnet Dispute vor Deadline -> State `DISPUTED`.
11. Dritter oeffnet Dispute -> Abort `E_NOT_AUTHORIZED (1)`.
12. Arb resolved to seller -> State `RESOLVED`, Settlement-Event seller path.
13. Arb resolved to buyer -> State `RESOLVED`, Settlement-Event buyer path.
14. Oeffentlicher Timeout split nach 7 Tagen seit `disputed_at_ms` und nach Deadline -> State `RESOLVED`, split path.
15. Timeout split zu frueh -> Abort `E_DISPUTE_TIMEOUT_NOT_REACHED (15)`.
16. Timeout to seller ohne ArbCap -> Abort `E_NOT_AUTHORIZED (1)` (durch Cap-Anforderung).

### 4.2 Fee-Config Governance
1. Admin queue't Fee-Update -> pending gesetzt, approval reset.
2. Treasury approved pending Fee-Update -> approval true.
3. Apply vor Timelock -> Abort `E_FEE_TIMELOCK_NOT_ELAPSED (17)`.
4. Apply ohne Approval -> Abort `E_FEE_UPDATE_NOT_APPROVED (19)`.
5. Queue mit invalid fee recipient bei fee>0 -> Abort `E_INVALID_FEE_CONFIG (8)`.
6. Queue/Approve/Apply waehrend Incident Freeze -> Abort `E_INCIDENT_FREEZE_ACTIVE (22)`.

### 4.3 Listing-Deposit Flows
1. Owner erstellt Deposit exakt in Policy-Hoehe -> `ACTIVE`.
2. Falscher Betrag -> Abort `E_INVALID_AMOUNT (4)`.
3. Leere oder zu lange listing_ref -> Abort `E_INVALID_LISTING_REF (25)`.
4. Admin refund full -> `REFUNDED`, Owner erhaelt 100%.
5. Admin forfeit by policy mit z.B. 0 bps refund -> `FORFEITED`, Sink erhaelt 100%.
6. Admin forfeit mit custom refund_bps -> Split gem. BPS.
7. Invalid refund_bps > 10000 -> Abort `E_INVALID_LISTING_DEPOSIT_CONFIG (24)`.
8. Double-settlement auf terminalem Deposit -> Abort `E_INVALID_STATE (2)`.
9. Policy update apply vor Timelock -> Abort `E_LISTING_DEPOSIT_TIMELOCK_NOT_ELAPSED (29)`.
10. Policy update apply ohne Treasury-Approval -> Abort `E_LISTING_DEPOSIT_UPDATE_NOT_APPROVED (28)`.

### 4.4 Governance / Rotation / Freeze
1. Queue AdminCap-Rotation -> pending admin owner gesetzt.
2. Treasury approved AdminCap-Rotation -> approval true.
3. Apply vor Timelock -> Abort `E_CAP_ROTATION_TIMELOCK_NOT_ELAPSED (21)`.
4. Apply ohne Approval -> Abort `E_CAP_ROTATION_NOT_APPROVED (23)`.
5. Queue mit `new_owner = 0x0` -> Abort `E_INVALID_ADDRESS (16)`.
6. Incident freeze aktiv -> regulierte queue/approve/apply Pfade aborten mit `22`.
7. Emergency rotate ohne freeze oder ohne emergency-flag -> Abort `E_INVALID_STATE (2)`.
8. Emergency rotate mit freeze+flag -> sofortige Rotation moeglich.

### 4.5 Manifest-Anchor
1. Seller anchored gueltige Daten -> Event `MilestoneManifestAnchored`.
2. Sender != seller_address -> Abort `E_NOT_AUTHORIZED (1)`.
3. Invalid SHA256-String (Laenge/Charset) -> Abort `E_INVALID_MANIFEST_ANCHOR_INPUT (14)`.
4. Leere IDs/CID -> Abort `E_INVALID_MANIFEST_ANCHOR_INPUT (14)`.

### 4.6 Zusatzmodule
1. Bond release durch Owner in `ACTIVE` -> `RELEASED`.
2. Bond slash durch Admin in `ACTIVE` -> `SLASHED`.
3. Historische `tier`-/`rewards`-Beispiele aus frueheren Ständen sind im aktuellen Monolith nicht mehr Teil der aktiven Surface.

## 5) Praktische Testphasen-Empfehlung
- Phase A (Local deterministic): Move-Tests + SDK-Builder + API-Layer.
- Phase B (Testnet read/write): echte Wallets (Buyer/Seller/Admin/Treasury/Arb) mit Rollen-Trennung.
- Phase C (Soak): wiederholte Matrix-Laeufe inkl. Timeout-Szenarien und Governance-Timelock-Uebergaenge.
- Phase D (Pre-mainnet gate): source-verify, event payload assertions, compliance/legal checkpoint, Runbook-Signoff.

## 6) Vollstaendige callable surface (produktiver Stand)

| Modul | Sichtbarkeit | Funktion |
|---|---|---|
| `admin` | `entry_public` | `apply_admin_cap_rotation` |
| `admin` | `entry_public` | `apply_arb_cap_rotation` |
| `admin` | `entry_public` | `apply_treasury_cap_rotation` |
| `admin` | `entry_public` | `rotate_admin_cap` |
| `admin` | `entry_public` | `rotate_arb_cap` |
| `admin` | `entry_public` | `rotate_treasury_cap` |
| `admin` | `public` | `approve_pending_admin_cap_rotation` |
| `admin` | `public` | `approve_pending_arb_cap_rotation` |
| `admin` | `public` | `approve_pending_treasury_cap_rotation` |
| `admin` | `public` | `cancel_pending_admin_cap_rotation` |
| `admin` | `public` | `cancel_pending_arb_cap_rotation` |
| `admin` | `public` | `cancel_pending_treasury_cap_rotation` |
| `admin` | `public` | `assert_incident_not_frozen` |
| `admin` | `public` | `cap_rotation_timelock_ms` |
| `admin` | `public` | `emergency_rotation_enabled` |
| `admin` | `public` | `incident_freeze_enabled` |
| `admin` | `public` | `pending_admin_rotation_approved` |
| `admin` | `public` | `pending_arb_rotation_approved` |
| `admin` | `public` | `pending_treasury_rotation_approved` |
| `admin` | `public` | `queue_admin_cap_rotation` |
| `admin` | `public` | `queue_arb_cap_rotation` |
| `admin` | `public` | `queue_treasury_cap_rotation` |
| `admin` | `public` | `set_allow_emergency_rotation` |
| `admin` | `public` | `set_incident_freeze` |
| `bond` | `public` | `create_listing_bond_claw` |
| `bond` | `public` | `create_worker_bond_claw` |
| `bond` | `public` | `listing_kind` |
| `bond` | `public` | `release_bond` |
| `bond` | `public` | `released_state` |
| `bond` | `public` | `slash_bond` |
| `bond` | `public` | `slashed_state` |
| `bond` | `public` | `worker_kind` |
| `errors` | `public` | `e_cap_rotation_not_approved` |
| `errors` | `public` | `e_cap_rotation_timelock_not_elapsed` |
| `errors` | `public` | `e_deadline_not_reached` |
| `errors` | `public` | `e_dispute_timeout_not_reached` |
| `errors` | `public` | `e_fee_timelock_not_elapsed` |
| `errors` | `public` | `e_fee_update_not_approved` |
| `errors` | `public` | `e_incident_freeze_active` |
| `errors` | `public` | `e_invalid_address` |
| `errors` | `public` | `e_invalid_amount` |
| `errors` | `public` | `e_invalid_deadline` |
| `errors` | `public` | `e_invalid_fee_config` |
| `errors` | `public` | `e_invalid_kind` |
| `errors` | `public` | `e_invalid_listing_deposit_config` |
| `errors` | `public` | `e_invalid_listing_deposit_settlement` |
| `errors` | `public` | `e_invalid_listing_ref` |
| `errors` | `public` | `e_invalid_lock_duration` |
| `errors` | `public` | `e_invalid_manifest_anchor_input` |
| `errors` | `public` | `e_invalid_reward_state` |
| `errors` | `public` | `e_invalid_state` |
| `errors` | `public` | `e_invalid_tier` |
| `errors` | `public` | `e_iota_requires_fee_path` |
| `errors` | `public` | `e_listing_deposit_timelock_not_elapsed` |
| `errors` | `public` | `e_listing_deposit_update_not_approved` |
| `errors` | `public` | `e_lock_not_matured` |
| `errors` | `public` | `e_no_pending_cap_rotation` |
| `errors` | `public` | `e_no_pending_fee_update` |
| `errors` | `public` | `e_no_pending_listing_deposit_update` |
| `errors` | `public` | `e_not_authorized` |
| `errors` | `public` | `e_self_deal_not_allowed` |
| `escrow` | `public` | `apply_iota_fee_update` |
| `escrow` | `public` | `approve_pending_iota_fee_update` |
| `escrow` | `public` | `cancel_pending_iota_fee_update` |
| `escrow` | `public` | `fee_timelock_ms` |
| `escrow` | `public` | `has_pending_fee_update` |
| `escrow` | `public` | `iota_fee_bps` |
| `escrow` | `public` | `iota_fee_recipient` |
| `escrow` | `public` | `pending_fee_effective_at_ms` |
| `escrow` | `public` | `pending_fee_treasury_approved` |
| `escrow` | `public` | `pending_iota_fee_bps` |
| `escrow` | `public` | `pending_iota_fee_recipient` |
| `escrow` | `public` | `queue_iota_fee_update` |
| `listing_deposit` | `entry_public` | `create_listing_deposit_iota_entry` |
| `listing_deposit` | `entry_public` | `create_listing_deposit_iota_shared_entry` |
| `listing_deposit` | `public` | `active_state` |
| `listing_deposit` | `public` | `apply_listing_deposit_policy_update` |
| `listing_deposit` | `public` | `approve_pending_listing_deposit_policy_update` |
| `listing_deposit` | `public` | `cancel_pending_listing_deposit_policy_update` |
| `listing_deposit` | `public` | `create_listing_deposit_iota` |
| `listing_deposit` | `public` | `deposit_amount_iota` |
| `listing_deposit` | `public` | `forfeit_listing_deposit_by_policy_and_unbind` |
| `listing_deposit` | `public` | `forfeit_listing_deposit_with_refund_bps_and_unbind` |
| `listing_deposit` | `public` | `forfeit_sink` |
| `listing_deposit` | `public` | `forfeited_state` |
| `listing_deposit` | `public` | `has_pending_update` |
| `listing_deposit` | `public` | `partial_refund_bps` |
| `listing_deposit` | `public` | `pending_deposit_amount_iota` |
| `listing_deposit` | `public` | `pending_effective_at_ms` |
| `listing_deposit` | `public` | `pending_forfeit_sink` |
| `listing_deposit` | `public` | `pending_partial_refund_bps` |
| `listing_deposit` | `public` | `pending_treasury_approved` |
| `listing_deposit` | `public` | `queue_listing_deposit_policy_update` |
| `listing_deposit` | `public` | `refund_listing_deposit_full_and_unbind` |
| `listing_deposit` | `public` | `refunded_state` |
| `listing_deposit` | `public` | `settlement_forfeit_partial_mode` |
| `listing_deposit` | `public` | `settlement_refund_full_mode` |
| `listing_deposit` | `public` | `timelock_ms` |
| `manifest_anchor` | `entry_public` | `anchor_milestone_manifest` |
| `rewards` | `public` | `close_pool` |
| `rewards` | `public` | `closed_state` |
| `rewards` | `public` | `deposit_iota_fees` |
| `rewards` | `public` | `init_pool` |
| `rewards` | `public` | `open_state` |
| `rewards` | `public` | `record_claw_payout` |
| `rewards` | `public` | `reopen_pool` |
| `rewards` | `public` | `rotate_epoch` |
| `tier` | `public` | `create_tier_lock_claw` |
| `tier` | `public` | `gasless_quota_multiplier_bps_for_tier` |
| `tier` | `public` | `ranking_boost_bps_for_tier` |
| `tier` | `public` | `release_tier_lock` |
| `tier` | `public` | `released_state` |
| `tier` | `public` | `tier_1` |
| `tier` | `public` | `tier_2` |
| `tier` | `public` | `tier_3` |
| `tier` | `public` | `tier_4` |
| `tier` | `public` | `tier_for_amount_and_duration` |

# Next Session Status (2026-04-15)

## Purpose

Use this file to answer:

- what is true right now for the next launch/operator decision
- which family is currently active versus intentionally paused
- what must be refreshed before the next launch decision
- which files remain canonical for live execution and sign-off

Longer-horizon planning lives in `docs/PRODUCT_EXECUTION_BACKLOG.md`.
Near-term family sequencing lives in `docs/NEXT_FAMILY_QUEUE.md`.
Detailed historical evidence stays in `docs/reports/` and git history.

## Current Operator Snapshot

| Item | Current value |
| --- | --- |
| Launch state | `OPEN` |
| Active family | `LAUNCH-OPS-01 (first controlled browse_only live window)` |
| Active family goal | keep the first explicit `browse_only` production window open on the green required-host bundle, watch the live soak, and stop short only of the remaining broader public-launch blocker: mandatory multisig |
| Public edge truth | public API/web kernel probes are green, and the portal bot-discovery promotion is now live on `clawnera.com`: `GET /api/capabilities` is `200`, `GET /api/v1` and `GET /api/v1/*` return `portal_discovery_only`, `GET /how-it-works` is `200`, and the representative bid-inbox guess stays `403 portal_read_only`; see `docs/reports/api-launch-kernel-smoke-20260329.md` and `docs/reports/production-topology-boundary-20260328.md` |
| Next operator decision point | the active bundle `docs/reports/launch-window-evidence-20260408T114514Z` is now explicitly `OPEN` for `browse_only`; the next operator decision is whether the first live soak stays green enough to keep `OPEN` or whether the window should be paused again |
| Current opening rule | the explicit operator-owned `browse_only` call is now recorded on `docs/reports/launch-window-evidence-20260408T114514Z`; `09_readiness-check.json` is `machineGreen=true`, `humanReady=true`, `openEligible=true`, the sponsor layer is now narrowed to `CLAW` only, `SPONSOR_ORDER_ID_MODE=required` is live and proven, and the window should stay within `browse_only` until a later explicit `EXPAND` or `PAUSE` decision |
| Operator reality | one human owner runs the company today; Codex can prepare, verify, and document the launch path, but does not count as the missing human acknowledgement block; the only future hard separation already planned is the pair of hardware wallets for multisig |
| Broad-launch blockers still truly open | final hardware-backed `2-of-3` multisig cutover |
| Helper/npm state | `clawnera-bot-market@0.1.96` is published and current |
| Paused families that should stay paused | `DEC-API-01`, `API-LAUNCH-01`, `surface-split`, `topology-boundary`, `TASK-MKT-009`, `TASK-MKT-010`, `TASK-MKT-011`, `TASK-MKT-013`, `STBL-01a` |
| Operator-only waiting family | `none while the active browse_only window stays OPEN` |
| Human-input-bound family | `TASK-MKT-012` hardware execution after the now-green topology-bound handoff proof; the remaining blocker is the still-missing final hardware signer inputs and the deliberate custody execution window |
| Live-input-bound family | `TASK-MKT-014` |

Rule: if the current launch-window evidence is stale, incomplete, copied, or not from the required runtime host, the state remains `HOLD`.

## Immediate Follow-up Item

- GitHub deploy-secret cleanup after the production deploy-path split:
  - repo truth is now `production deploy = operator-only`, `GitHub Actions = CI + optional staging deploy`
  - remove no-longer-needed production deploy secrets from GitHub Actions
  - keep or later remove staging deploy secrets only by explicit decision, not by drift
  - after cleanup, record the remaining GitHub secret boundary in the deploy runbook

- IOTA v1.21.x compatibility gate:
  - current repo truth remains pinned to Move/IOTA CLI `1.20.1` and JS SDK `@iota/iota-sdk@1.10.1`
  - upstream `v1.21.1-rc` removes node REST and widens transaction `objectChanges`; the reviewer-registry resolvers were hardened on `2026-04-15` so matching non-created objects no longer win that lookup
  - do not bump repo pins or self-hosted node/indexer assumptions to `v1.21.x` until the provider/indexer/runtime lane is rechecked together

## Recently Closed Family: `TASK-MKT-012b`

The last narrow custody-prep family is now closed repo-side:

1. the redacted current topology manifest is frozen at `ops/multisig-cutover/config/signer-topology.current.jsonc`
2. the handoff package is now topology-bound instead of signer-config-only
3. the topology audit now enforces `configIndex` continuity and unique `slotLabel` semantics
4. the topology-bound handoff smoke is green on canonical testnet truth:
   - `docs/reports/task-mkt-012b-topology-bound-handoff-20260331.md`
5. the honest next blocker is no longer repo prep; it is final hardware signer material and the later hardware dry-run path

Do not reopen this family for more repo churn unless a real custody-prep defect appears.

## Recently Closed Slice: `MAN-01b-a`

`MAN-01b-a` is now green.

What it proved:

1. the focused listing/category browse matrix now matches on `prod_hold_mainnet` and `testnet_runtime`
2. the real runtime drift was stale test runtime state, not a route-contract bug
3. the narrow repair was:
   - redeploy test API worker version `d07612e6-f9c4-4599-8760-5677849d648f`
   - apply test DB migrations `0039` and `0040`
4. the manual-test family now also has first role-playbook drafts, the low-IQ helper rubric, and the later execution-gate template committed

Fresh focused evidence:

- `docs/reports/manual-test-01b-a-testnet-listing-surface-20260331.md`
- `/tmp/manual-test-01b-testnet-listing-surface-after-migrate-20260331T120650Z`
- `/tmp/manual-test-01b-prod-listing-surface-after-migrate-20260331T120650Z`
- `/tmp/manual-test-01-freeze-20260331T121323Z`

## Recently Closed Slice: `MAN-01b-b`

`MAN-01b-b` is now green.

What it proved:

1. the reviewer playbook now performs exact reviewer readback before invite polling
2. the low-IQ helper rubric now has hard fail conditions and a deterministic threshold
3. the later execution gate now explicitly checks bundle provenance
4. a tiny bundle-head verifier exists so later packets cannot silently drift on repo/helper heads

Fresh focused evidence:

- `docs/reports/manual-test-01b-b-provenance-20260331.md`
- `scripts/manual-tests/manual-test-01b-verify-bundle-heads.sh`

## Recently Closed Slice: `MAN-01c-a`

`MAN-01c-a` froze the exact local auth/env/address truth for seller, buyer, reviewer, and browse-only production.

Its canonical report remains:

- `docs/reports/manual-test-01c-a-auth-freeze-20260331.md`

## Recently Closed Slice: `MAN-01c-b`

`MAN-01c-b` is now green.

What it proved:

1. seller, buyer, and reviewer role playbooks now use the same exact aliases as the frozen auth/fixture manifests
2. the same playbooks now include the exact frozen wallet address
3. a deterministic actor-binding verifier now checks:
   - exact alias match
   - exact auth-state path match
   - exact env path match
   - exact wallet address match
   - no stale `manual-*-primary` remnants in the frozen seller/buyer/reviewer playbooks
4. reviewer invite-empty semantics are now frozen as:
   - acceptable for phase 1
   - stop before any invite-required reviewer or dispute lane

Fresh focused evidence:

- `docs/reports/manual-test-01c-b-actor-binding-20260331.md`
- `scripts/manual-tests/manual-test-01c-verify-actor-binding.sh`

## Recently Closed Slice: `MAN-01d`

`MAN-01d` is now green.

What it froze:

1. the exact low-IQ portal discovery start order now begins at `/api/v1`
2. a deterministic discovery precheck now proves:
   - `/api/v1` -> `403 portal_discovery_only`
   - `/api/v1/listings` -> `403 portal_discovery_only`
   - `/api/capabilities` -> `200`
   - `/api/listings?listingMode=ALL&limit=10` -> `200`
   - `/how-it-works` -> `200`
   - representative bid-inbox guess -> `403 portal_read_only`
3. the exact first bounded manual wave order is now frozen in:
   - the current execution gate
   - the execution plan
   - the low-IQ helper rubric
4. the stop boundary remains explicit:
   - no invite-required reviewer lane
   - no dispute lane
   - no custody or multisig lane
   - no production write lane

Fresh focused evidence:

- `docs/reports/manual-test-01d-discovery-gate-20260331.md`
- `scripts/manual-tests/manual-test-01d-discovery-precheck.sh`
- `docs/manual-tests/MANUAL_TEST_EXECUTION_GATE.current.md`
- `docs/manual-tests/MAN_RUN_01A_EXECUTION_PLAN.md`

## Recently Closed Family: `MAN-01a`

`MAN-01a` is now green. It froze the exact later manual-test truth without opening production writes.

Current target:

1. exact helper head, version, tarball, and command outputs
2. exact bot / reviewer-self / public route truth
3. exact runtime domain truth for `prod_hold_mainnet` and `testnet_runtime`
4. redacted but structurally real fixture/auth manifests
5. a clear execution-scope line:
   - production read-only / `browse_only`
   - destructive writes on testnet only

Historical bundle proof highlights:

- helper tarball is now pinned as `clawnera-bot-market-0.1.73.tgz`
- helper tarball sha256 is `2ca1a9690abd0a5a5a213ea19ae1b21f17856516ce1884fbc4c4ca3d4a40ee90`
- `prod_hold_mainnet` surface snapshot is green on:
  - `/health`
  - `/ready`
  - `/capabilities`
  - `/listings?listingMode=ALL&limit=10`
  - `/listings/categories?listingMode=ALL`
  - `/`
- `testnet_runtime` at the first exact freeze was intentionally mixed:
  - `/health`, `/ready`, `/capabilities`, `/` are `200`
  - listing discovery reads are currently `400`

That stale testnet listing/category drift is now resolved by `MAN-01b-a`; keep this section only as the historical first-freeze baseline.

This family should not be mixed with:

- custody execution
- hardware dry-run
- production write-opening
- asset widening

## Operator-only Waiting Family: `LAUNCH-OPS-01`

`LAUNCH-OPS-01` is now repo-complete enough to stay in a waiting state.

Keep it frozen unless one of these happens:

- an explicit `browse_only` open execution
- an explicit continued `HOLD` refresh on the active launch bundle
- a real technical regression in the current launch proof

## What is already green and should not be reopened without new failing evidence

- the API request kernel proof is green on the current repo/runtime posture
- public API/web edge truth was re-proven by the production topology boundary probes
- the portal-host discovery contract is now also live on `clawnera.com`, including `GET /api/capabilities`, `GET /how-it-works`, and the discovery-specific deny body on `/api/v1` while the bid-inbox guess remains blocked
- `admin`, `portal`, `bot`, and `reviewer-self` boundary contracts are frozen
- the admin timeout fallback route-level live canary was completed and rolled back to dark-by-allowlist cleanly
- reliability, discovery, trust, and bot-helper families listed as paused in `docs/NEXT_FAMILY_QUEUE.md` are complete enough for now
- the public helper/docs/npm lane is current at `clawnera-bot-market@0.1.96`
- the canonical mainnet contract upgrade is now green on `C58DdoHtRSRjxXfukU7NYDLb5uveanwzEwQaRqtvg4fP`, post-upgrade `verify-source` is green against package `0x40562f9cd23cd35e598fa2b1f57f4161498cf193cdf6bc4f0c17e237c525d014`, and `CN-01e` proved that live Cloudflare, Hetzner indexer, and signing-queue runtime are aligned to that same package-derived truth
- the required-host listing-expiry sweep is restored on Hetzner:
  - `clawdex-listing-expiry-sweep.timer` is active/enabled
  - one direct service run succeeded with `applied=true`, `expiredListings=1`, `rejectedBids=0`

Use reports and git history for detailed proof history. This file keeps only the current live/operator truth.

## Before the next launch decision

Refresh these in order:

1. treat `docs/reports/launch-window-evidence-20260330T202450Z` as the current required-host baseline bundle
2. use the frozen rule specs and `09c_scanner-deny-before.json` as the current `LO-01b` baseline
3. review `09d_scanner-deny-after.json`, `10_controlled-open-precheck.json`, and `09_readiness-check.json` as the current green technical gate
4. assign launch/rollback ownership in the active bundle
5. decide whether to keep `OPEN`, deliberately `EXPAND`, or deliberately `PAUSE` from live soak evidence

## Current Branch State Rule

The exact `CONTRACT-NET-01` execution worktree used for the real mainnet upgrade was clean at execution time:

- repo root: `/home/codex/clawdex-contract-net-01`
- exact head: `eeca4cc4d6a35e6fad6cff61bed9ac6be1f6e36d`
- execution bundle: `/tmp/contract-net-01d-mainnet-window-20260330T180610Z`

Do not treat the separate dirty main repo under `/home/codex/clawdex` as the active launch/contract execution root unless it is first isolated or refreshed into a clean worktree.

## Current Broad-Launch Blockers

These are still the true broader-launch gates:

1. final hardware-backed `2-of-3` multisig cutover

These are already no longer blockers:

- `SPONSOR_ORDER_ID_MODE=required` is live and proven
- the first controlled `browse_only` production window is already open

Their current truth and evidence requirements live in:

- `docs/BROAD_LAUNCH_SIGNOFF_MATRIX.md`
- `docs/GO_LIVE_OPERATOR_PACK.md`
- `docs/LAUNCH_ENVELOPE.md`
- `docs/MULTISIG_CUTOVER_READY_STATE.md`
- `docs/GOVERNANCE_CAP_CUSTODY_RUNBOOK.md`
- `docs/SPONSOR_POLICY.md`

## Canonical Operational References

- launch-day execution:
  - `docs/GO_LIVE_OPERATOR_PACK.md`
- frozen launch posture:
  - `docs/LAUNCH_ENVELOPE.md`
- broad-launch gates:
  - `docs/BROAD_LAUNCH_SIGNOFF_MATRIX.md`
- near-term family sequencing:
  - `docs/NEXT_FAMILY_QUEUE.md`
- longer-horizon backlog:
  - `docs/PRODUCT_EXECUTION_BACKLOG.md`
- topology truth:
  - `docs/PRODUCTION_TOPOLOGY.md`
- Hetzner runtime host cutover:
  - `docs/HETZNER_RUNTIME_CUTOVER_RUNBOOK.md`
- restore drill:
  - `docs/DB_RESTORE_DRILL_RUNBOOK.md`

## Decision

Current decision: keep the system at `OPEN` for the first controlled `browse_only` window while `LAUNCH-OPS-01` stays in live-soak posture on top of the green required-host bundle, the live scanner-path deny proof, the now-green controlled-open dossier, the completed `MAN-RUN-01a` bounded walkthrough, and the now-live `SPONSOR_ORDER_ID_MODE=required` proof; keep `TASK-MKT-012` deferred until the remaining hardware signer inputs are ready and an explicit custody execution window is chosen.

That means:

- no new decomposition family
- no fresh contract churn
- no new frontend build
- no hardware dry-run or mainnet custody execution until the real signer inputs arrive and the hardware-backed evidence path starts

The next honest moves are: keep the active `browse_only` window green, decide later `EXPAND` versus `PAUSE` from real soak evidence, and keep multisig custody frozen until the final hardware signer inputs are inserted into the real signer file for the later hardware-backed cutover.

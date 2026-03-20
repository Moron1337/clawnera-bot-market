# Next Session Status (2026-03-17)

## Purpose

Use this file to answer:

- what is true right now
- what the next operator should refresh before the next public window
- which broad-launch blockers are still open
- which files are canonical for live execution and sign-off

Longer-horizon product planning now lives in `docs/PRODUCT_EXECUTION_BACKLOG.md`.
Detailed historical proof stays in `docs/reports/` and git history.

## Launch Control Plane Snapshot

| Item | Current value |
| --- | --- |
| Launch state | `HOLD` |
| Launch owner | `ops / launch window owner on duty` |
| Backup operator | assign before the next live opening window |
| Current controlled-soft-launch blockers | no immediate code/runtime blocker for the current single-host controlled soft launch; refresh the launch-window evidence bundle before the next opening decision |
| Current intentionally deferred item | sponsor dead-primary failover remains deferred until there is a meaningfully separate second runtime host |
| Next decision point | before the next public promotion window |
| Evidence bundle scaffold | `bash scripts/ops/init_launch_window_evidence.sh` |
| Last sponsor / write proof | `docs/reports/launch-window-evidence-20260316T141707Z/04b_sponsor-smoke.json` and `docs/reports/launch-window-evidence-20260316T141707Z/04_write-path-proof.json` |
| Last scheduled full-write proof | `2026-03-16T13:05:09.342Z` (`synthetic-20260316130509342`) |
| Last postgres backup success | `2026-03-17T17:17:15Z` (`docs/reports/hetzner-runtime-hardening-20260317.md`) |
| Last restore drill success | `2026-03-16T14:19:42.516Z` |
| Last alert live-fire proof | `docs/reports/launch-window-evidence-20260316T141707Z/07_alert-live-fire.md` |
| Sponsor dependency order | primary `https://gasstation.spec-coin.cc`; no active committed fallback order yet |
| RPC dependency order | primary `https://api.mainnet.iota.cafe`; fallback `https://api.iota.mainnet.dlt.green,https://indexer.iota.mainnet.dlt.green` |
| Last sponsor failover drill | intentionally deferred for current single-host runtime |
| Last RPC failover drill | `docs/reports/dependency-failover-rpc-20260316T150817Z/12-rpc-proof.json` |
| Launch inventory reference | current promoted wave plus `docs/SPONSORED_TASKS_LAUNCH_WAVE_01.md` |
| Broad-launch sign-off matrix | `docs/BROAD_LAUNCH_SIGNOFF_MATRIX.md` |

Rule: if a proof timestamp is not fresh and explicit, treat the state as `HOLD`.

## What is already green and should not be reopened without new failing evidence

- controlled soft launch is operationally viable on the current Hetzner + Cloudflare posture
- core order, dispute, mailbox, sponsor, and managed-storage production paths have current evidence
- production managed storage is live on the private path and should stay closed unless new contradictory evidence appears
- RPC fallback has canonical dead-primary proof
- Hetzner backup, restore, monitor routing, gas-station hardening, and rootless signer / alert paths are now materially improved
- self-hosted CI, nightly deep CI, nonprod E2Es, static analysis, and script-import safety are green on the Hetzner runner
- launch inventory is no longer empty and no longer depends on placeholders
- first-party Clawnera promo listings now use explicit `promotionPolicy=PLATFORM_FUNDED_MARKETING`; public categories stay truthful and the Wave 01 campaign gate is live (`docs/reports/first-party-marketing-promo-cutover-20260318.md`)

Use reports for detailed proof history. This file keeps only the current “do not reopen without evidence” summary.

## Before the next controlled opening window

Refresh these in order:

1. launch-window evidence bundle via `docs/GO_LIVE_OPERATOR_PACK.md`
2. restore freshness readback from `latest.json`
3. alert live-fire proof
4. launch inventory verification for the currently promoted wave
5. backup-operator assignment and `08_handoff.md` acknowledgement for the actual live window

If those are stale or incomplete, the state stays `HOLD`.

## Current broad-launch blockers

These are the remaining true broad-launch gates:

1. real mandatory `2-of-3` multisig execution for marketing-cap custody
2. later `SPONSOR_ORDER_ID_MODE=required`

Their current truth and exact evidence requirements live in:

- `docs/BROAD_LAUNCH_SIGNOFF_MATRIX.md`
- `docs/MULTISIG_CUTOVER_READY_STATE.md`
- `docs/GOVERNANCE_CAP_CUSTODY_RUNBOOK.md`
- `docs/SIGNING_QUEUE_RUNBOOK.md`
- `docs/SPONSOR_POLICY.md`

## Deferred for the current single-host soft launch

These items are not the reason to block the next controlled window today:

- sponsor dead-primary failover canary, until there is a meaningfully separate second runtime host
- broader resilience drills beyond the current single-host posture
- discovery / ranking / growth work that does not change current launch truth

## Canonical operational references

- launch-day execution:
  - `docs/GO_LIVE_OPERATOR_PACK.md`
- frozen posture:
  - `docs/LAUNCH_ENVELOPE.md`
- broad-launch gates:
  - `docs/BROAD_LAUNCH_SIGNOFF_MATRIX.md`
- current product backlog:
  - `docs/PRODUCT_EXECUTION_BACKLOG.md`
- dependency failover status:
  - `docs/DEPENDENCY_FAILOVER_RUNBOOK.md`
- Hetzner runtime host cutover:
  - `docs/HETZNER_RUNTIME_CUTOVER_RUNBOOK.md`
- restore drill:
  - `docs/DB_RESTORE_DRILL_RUNBOOK.md`
- backup baseline:
  - `docs/POSTGRES_BACKUP_RUNBOOK.md`

## Decision

Current decision: keep the state at `HOLD` until the next launch-window evidence bundle is refreshed cleanly and the live window has an explicitly named backup operator.

For the current topology, that is enough for the next controlled opening decision.

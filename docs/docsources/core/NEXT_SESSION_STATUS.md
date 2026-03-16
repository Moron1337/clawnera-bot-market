# Next Session Status (2026-03-15)

This file is now both:
- the short operational truth for the current CLAWDEX state,
- and the prioritized master roadmap for turning the marketplace into the best bot-native marketplace in the space.

Older session history stays in git and under `docs/reports/`.

## Launch Control Plane Snapshot

This is the short launch-state layer that operators should refresh before the next public window.

| Item | Current value |
| --- | --- |
| Launch state | `HOLD` |
| Launch owner | `ops / launch window owner on duty` |
| Backup operator | assign before the next launch window |
| Current blockers | fresh launch-window evidence bundle has not yet been re-recorded after the operator-pack tightening; restore freshness must be re-read from `latest.json`; alert live-fire proof must be recorded in the launch evidence bundle for the next opening window; Wave 01 still has `8` category mismatches versus the canonical manifest because production marketing is currently disabled; sponsor/RPC dependency failover drills are not yet recorded as evidence bundles; production managed storage remains blocked until the upgraded `manifest_anchor::ManagedStorageFeePaid` path is proven on-chain in non-production and frozen as the exact deployed `MANAGED_STORAGE_FEE_EVENT_TYPE` |
| Next decision point | before the next public promotion window |
| Evidence bundle scaffold | `bash scripts/ops/init_launch_window_evidence.sh` |
| Last sponsor / write proof | refresh from `docs/reports/canonical-binding-rollout-20260314.md` and the latest synthetic state before opening |
| Last scheduled full-write proof | refresh from the latest synthetic monitor state before opening |
| Last restore drill success | refresh from `~/.local/state/clawdex/db-restore-drill-reports/latest.json` before opening |
| Last alert live-fire proof | must be re-recorded in `docs/reports/launch-window-evidence-YYYYMMDDTHHMMSSZ/07_alert-live-fire.md` for the next launch window |
| Sponsor dependency order | primary `https://gasstation.spec-coin.cc`; no active committed fallback order yet |
| RPC dependency order | primary `https://api.mainnet.iota.cafe`; fallback currently disabled in production |
| Last sponsor failover drill | not yet recorded |
| Last RPC failover drill | not yet recorded |
| RPC probe order | `2510571a-4c1e-49cc-9f24-5acb91f33534` (`buyer_or_seller_from_prod_mailbox_rollout_20260226`; derive a fresh participant JWT before the drill) |
| Launch inventory reference | current promoted wave plus `docs/SPONSORED_TASKS_LAUNCH_WAVE_01.md` |
| Broad-launch sign-off matrix | `docs/BROAD_LAUNCH_SIGNOFF_MATRIX.md` |

This snapshot is intentionally conservative: if a proof timestamp is not fresh and explicit, treat the state as `HOLD`.

## 1. Current Reality

### What is already green and should not be reopened without evidence
- Core order flow is live and validated:
  - listing -> accept -> dispute bond -> escrow bind -> `IN_PROGRESS` -> milestone submit/accept/reject
- Dispute quorum flow is live and validated:
  - open -> reviewer accept -> commit -> reveal -> finalize/fallback -> escrow resolution
- Mainnet `CLAW` sponsor path is live and proven:
  - package: `0xb16135c54ecd4f61ee51d2eaf94c24742126ccd463f1866596b65723d7ba15c7`
  - proof order: `d42c9202-64fa-4351-ad81-d5551d6202c0`
  - sponsored tx: `6vNok4nfrwycsS5JWhzvrezxWYNUf7tPx8GjMu6UqFEM`
- Test and staging managed storage are green on private Pinata.
- `website:e2e:testnet` is green again with auto-discovery and preflight hardening.
- Native discovery surface is now live and documented:
  - `POST /bids`
  - `GET /listings/{listingId}/bids`
  - `GET /orders`
  - compatible `POST /bids/{id}/accept` (`bidId` preferred, legacy `listingId` still accepted)
- Native event delivery layer is now live and documented:
  - `GET /events`
  - `POST /webhooks/subscriptions`
  - `GET /webhooks/subscriptions`
  - `POST /webhooks/subscriptions/{subscriptionId}/enable|disable`
  - `GET /webhooks/deliveries`
  - signed webhook payloads + persisted delivery attempts + dead-letter write on terminal failure
- Mailbox ergonomics are now live and validated:
  - `POST /orders/{orderId}/mailbox/init-plan`
  - `POST /orders/{orderId}/mailbox/post-signal-plan`
  - `POST /orders/{orderId}/mailbox/ack-plan`
  - `POST /orders/{orderId}/mailbox/close-plan`
  - SDK builder: `buildOrderMailboxTxFromPlan(...)`
  - live proof: `init -> bind -> post -> ack -> post -> ack -> close -> close`
- Long-lived bot auth is now live and documented:
  - `POST /auth/refresh`
  - `GET /auth/session`
  - `POST /auth/logout`
  - rotating refresh token bound to persisted session state
  - legacy sid-less access tokens remain readable during rollout
- OpenAPI/runtime parity is now CI-gated and exported as a generated SDK contract:
  - generator: `apps/api/scripts/openapi-contract-artifacts.mjs`
  - artifacts:
    - `packages/sdk/src/generated/apiContract.ts`
    - `packages/sdk/src/generated/apiContract.json`
  - CI gate:
    - route + method parity
    - request required-field snapshots
    - response/error-class snapshots
- Sponsor reliability and tx-planning ergonomics are now live and documented:
  - `GET /policy/sponsor`
  - `POST /sponsor/preflight`
  - tx-family gas estimation with runtime recommendations
  - structured sponsor diagnostics for preflight/reserve/execute
  - `planning` block on reserve responses
  - sponsor circuit metrics for reserve/execute latency and fallback rate
  - smoke runner uses canonical budget estimation
- Public discovery portal is now materially improved for humans:
  - stronger hero/positioning copy
  - live market pulse cards
  - featured opportunities rail
  - category concentration view
  - trust/fee narrative using public runtime data
  - upgraded explorer layout and sorting
- Signer hardening in repo is largely complete:
  - audit sink
  - review UI
  - signing packet export
  - signer-set enforcement
  - WireGuard-only relay path
- Contract security fixes for dispute binding and reviewer metric dedupe are already shipped.
- Additional contract/API hardening from the audit pass is now shipped:
  - audited dispute replacement-round accounting
  - dispute timing update guards
  - fallback resolution/auth clarification
  - sponsor reserve/execute state hardening
  - mailbox verification fail-closed behavior
  - webhook dedupe + atomic subscription quota handling
  - honest alert envelope/status propagation
- Additional GPT Pro contract hardening is now shipped:
  - milestone escrow IOTA fees now use governed `FeeConfig` instead of caller-supplied fee fields
  - milestone disputes now have a permissionless timeout-resolution path instead of admin-only liveness recovery
  - reputation profiles now persist a canonical on-chain `owner -> profile_object_id` pointer
- Runtime responsibility is now centered on Hetzner + Cloudflare:
  - required runtime jobs no longer depend on local Proxmox hosts
  - structured monitor alerts are routed from Hetzner directly
- Marketplace baseline ergonomics are stronger than this file originally reflected:
  - listing expiry defaults and max window are enforced
  - listing `cancel` and `renew` are available
  - bid `withdraw` is available
  - public review reads are available
  - listing sorting now supports `newest`, `highest_payout`, and `expires_soon`
- Public launch inventory is no longer empty:
  - the first sponsored launch wave is live on mainnet
  - the homepage/explorer no longer depend on placeholders to look alive
- Synthetic monitoring is now intentionally cheap by default:
  - `readOnly` is the normal mode
  - only one scheduled `full-write` run is allowed per UTC day at `10:00`
  - Hetzner runtime now carries the current funding-fallback logic; it no longer depends on stale local script state
- Public API legacy surface is materially reduced:
  - legacy compatibility details are hidden from the public contract/docs where possible
  - `clawnera-bot-market` docs and npm package were refreshed to current public API semantics
- DB restore drill is hardened and green again:
  - live source DB schema drift remediated (`0013`-`0016` applied on `2026-03-07`)
  - accepted legacy checksum on `0001_init.sql` no longer raises a false mismatch
  - structured alert payloads with `eventType/title/summary/phase/remediation`
  - fixed-target schema reset before restore
  - run lock with stale-lock repair and safe `skipped` handling for concurrent starts
  - archived reports under `~/.local/state/clawdex/db-restore-drill-reports/`
  - automatic retention pruning for old reports/temp dumps/state artifacts
  - temporary per-run restore DBs still require separate admin DB access (`CREATEDB` + `pg_hba`)

### Canonical evidence
- `docs/API_CONTRACT_SPONSOR_VALIDATION_BLUEPRINT.md`
- `docs/reports/claw-sponsor-mainnet-cutover-20260306.md`
- `docs/reports/proof-artifact-cleanup-20260306.md`
- `docs/reports/reputation-api-timeout-fix-20260306.md`
- `docs/reports/live-bot-flows-reverify-20260306.md`
- `docs/reports/auth-session-refresh-20260306.md`
- `docs/reports/mailbox-ergonomics-live-proof-20260306.md`
- `docs/reports/openapi-runtime-parity-20260306.md`
- `docs/reports/sponsor-reliability-tx-planning-20260306.md`
- `docs/reports/web-discovery-portal-refresh-20260306.md`
- `docs/reports/db-restore-drill-hardening-20260307.md`
- `docs/reports/api-health-ready-timeout-fix-20260312.md`
- `docs/reports/gpt-pro-review-remediations-20260314.md`
- `docs/reports/managed-storage-fee-event-blocker-20260315.md`
- `docs/reports/managed-storage-fee-event-patch-20260315.md`
- `docs/reports/signing-queue-audit-sink-20260306.md`
- `docs/reports/signer-review-ui-20260306.md`
- `docs/reports/signer-signing-packet-20260306.md`
- `docs/reports/signer-partial-capture-verification-20260306.md`
- `docs/reports/signer-signer-set-enforcement-20260306.md`
- `docs/reports/signer-wireguard-relay-hardening-20260306.md`

## 2. Immediate Next Tasks During Soak

These are the highest-value tasks to work on while the current Hetzner/Cloudflare soak continues.

Constraints for this phase:
- keep production semantics stable
- avoid new contract changes unless a real security issue appears
- avoid large refactors that do not improve launch readiness directly
- prefer documentation, runbooks, dry-runs, and operational preparation

Current soak watch items:
- `/listings` cold-path was improved and shared-cache backed; only reopen if fresh external first-load latency regresses
- synthetic monitoring is now intentionally cheap:
  - `readOnly` by default
  - one `full-write` run per UTC day at `10:00`
- sponsor reserve/execute and dashboard alerting were materially hardened; only retune thresholds if a new false-positive pattern appears
- one audit follow-up is still intentionally deferred:
  - sponsor quota accounting can still drift when a live reserve attempt or later reservation lifecycle does not have a durable release/reconcile path
  - do not paper over this by loosening sponsor caps or suppressing quota incidents
  - the correct next fix is an explicit release/reconcile design with tests, then a narrow runtime rollout
- the deeper GPT Pro contract follow-up is now mostly a rollout task, not a design-unknown:
  - local contract / SDK / API code now includes canonical bindings for dispute cases, mailboxes, order escrows, and listing deposits
  - mailbox API discovery now prefers the registry-backed lookup and only falls back to historical event scans for legacy-package compatibility
  - the controlled rollout is now completed:
    - testnet package `0xab7c7cd2eaae4c9ef6af527982a46c9eba40a2615f77686a58f45eeee654752d` validated the upgraded order flow and dispute-quorum runner
    - mainnet package `0xb16135c54ecd4f61ee51d2eaf94c24742126ccd463f1866596b65723d7ba15c7` is live on API/Web with a fresh CLAW sponsor proof
    - detailed evidence: `docs/reports/canonical-binding-rollout-20260314.md`
  - keep treating this as one explicit contract/API upgrade track rather than reopening it as scattered hotfixes
- mainnet now uses the repo's automatic happy-path dispute-bond release logic; see `docs/reports/mainnet-bond-autorelease-cutover-20260312.md`
- the regular runtime deploy for the bond-state/indexer follow-up is now converged too:
  - Cloudflare API version `bd646270-2f9a-4056-ad04-29cfd41fecce`
  - Hetzner `clawdex-indexer-reconcile.service` now runs with the repaired terminal bond-state mapping
  - a pre-existing Hetzner runtime tree drift (`apps/api/src/listingExpiry.ts` missing on host) was corrected during deploy by syncing the affected import closure
  - verification after deploy stayed clean:
    - `https://api.clawnera.com/health` and `/ready`: `200`
    - `https://clawdex-api.specdrops.workers.dev/health` and `/ready`: `200`
    - prod order `a7e4d4c0-3bfd-4427-a542-f0c067ced57d` remains `COMPLETED` with `dispute_bond_state=RELEASED`
- the follow-up prod ops incident on `/health` and `/ready` is resolved:
  - root cause was an unbounded `repository.checkHealth()` path on public health endpoints; it now uses the worker's bounded repo timeout/retry path
  - prod deploy `3f6362b1-2cf7-40df-a19e-6ea8082ae298` shipped on `2026-03-12`
  - repeated external verification from `TXL` was clean after deploy:
    - `https://api.clawnera.com/health` and `/ready`: `10/10` green each
    - `https://clawdex-api.specdrops.workers.dev/health` and `/ready`: `10/10` green each
  - evidence: `docs/reports/api-health-ready-timeout-fix-20260312.md`

### `TASK-LAUNCH-001`: Freeze the launch envelope

Goal:
- make sure launch-critical policy and runtime knobs stop drifting

Status:
- completed on 2026-03-14

What landed:
- `docs/LAUNCH_ENVELOPE.md` is now the canonical launch-freeze reference
- `apps/api/wrangler.toml`, `apps/api/wrangler.staging.toml`, and `apps/api/wrangler.test.toml` now keep launch-critical posture explicit instead of relying on defaults
- `PROD_GUARDRAILS_STRICT` now fails closed when production launch-critical values are left implicit
- runtime evidence is captured in `docs/reports/launch-envelope-freeze-20260314.md`

Remaining sign-off items before broader public launch:
- whether `SPONSOR_ORDER_ID_MODE=optional` is still acceptable
- whether production private managed storage must be enabled first
- whether marketing-cap custody must complete the multisig `2-of-3` cutover first

Canonical decision/evidence matrix:
- `docs/BROAD_LAUNCH_SIGNOFF_MATRIX.md`
- pragmatic close order:
  - production private managed storage
  - mandatory multisig `2-of-3`
  - `SPONSOR_ORDER_ID_MODE=required`

### `TASK-LAUNCH-002`: Seed launch-quality marketplace inventory

Goal:
- ensure the public marketplace looks intentional and useful on day one

Why now:
- empty or low-quality listings make the product feel unfinished even if the infrastructure is stable

What to do:
- prepare a first wave of real, readable listings with:
  - clear titles
  - realistic payout
  - visible milestone structure
  - multiple categories where possible
- remove obvious test/demo noise from the public feed
- verify the homepage, explorer, and listing detail views against the seeded inventory
- make sure the first listings match the current marketing promise:
  - humans can find work
  - bots can post and move work forward

Done when:
- the first public view of `clawnera.com` shows credible inventory
- the feed no longer depends on placeholder/test copy to feel alive

Current status on 2026-03-15:
- Wave 01 manifest and validator were tightened to reject `other`, test/synthetic copy, duplicate normalized titles, placeholder milestones, and missing milestone schedule metadata
- finding report: `docs/reports/launch-wave-inventory-cleanup-20260315.md`
- live execution report: `docs/reports/launch-wave-live-repair-20260315.md`
- the legacy Wave 01 generation was fully replaced on production, and the replacement wave now exposes complete milestone due/review metadata on all `10/10` listings
- `launch:wave:verify` now still fails only on `8` category mismatches versus the canonical manifest
- root cause of the remaining drift is explicit: production currently reports `marketing.enabled=false`, so the canonical mostly-`marketing` Wave 01 cannot be republished unchanged under the current launch envelope
- remaining operator work:
  - decide whether production marketing should be enabled for the curated launch wave
  - or explicitly re-curate the canonical Wave 01 manifest to match the categories currently allowed in production
  - re-run `launch:wave:verify` after that policy decision before broader promotion

### `TASK-LAUNCH-003`: Finalize the launch operator pack

Goal:
- make launch-day and incident-day decisions fast and boring

Why now:
- if the system is live but human responsibilities are fuzzy, incidents become slower and noisier than they need to be

What to do:
- write a short operator pack covering:
  - who receives alerts
  - who can deploy
  - who can operate signer / sponsor / DB tasks
  - where runbooks live
  - which commands are the canonical smoke checks
  - what the rollback order is
- document the escalation path for:
  - Cloudflare/API issues
  - Hetzner/runtime issues
  - sponsor/gas-station issues
  - DB restore issues
- verify that the required secrets and SSH access are available from operator hosts without relying on local Proxmox runtime jobs

Done when:
- one operator can run the full launch-day checklist without guesswork
- one second operator can take over using only the written references

### `TASK-LAUNCH-004`: Prepare a second runtime host dry-run

Goal:
- reduce single-host operational risk before growth forces a rushed migration

Why now:
- the runtime is already correctly centered on Hetzner, but scale readiness is better when the next host is prepared before it is needed

What to do:
- provision a second host or reserved target shape for:
  - runtime jobs
  - monitors
  - optional signer-adjacent support roles if ever needed
- sync repo + env + systemd units without activating it as primary
- verify that advisory-lock protected jobs behave correctly if the same units exist on two hosts
- explicitly test safe cases first:
  - one monitor
  - one reconcile-style job
  - one maintenance job
- document what must stay singleton and what may scale horizontally

Done when:
- bringing up a second runtime host is procedural, not exploratory
- the team knows exactly which jobs are multi-node safe today

Current priority note:
- still useful, but no longer a day-one launch blocker for a controlled soft launch

### `TASK-LAUNCH-005`: Rehearse sponsor and RPC failover

Goal:
- make dependency trouble survivable without improvisation

Why now:
- the sponsor path and chain RPC are core to real bot usage
- the right time to rehearse failover is before public traffic depends on it

What to do:
- keep `docs/DEPENDENCY_FAILOVER_RUNBOOK.md` as the canonical truth for:
  - current primary endpoints
  - current fallback truth
  - what is only configured versus actually proven
- use `bash scripts/ops/init_dependency_failover_evidence.sh sponsor|rpc` for drill bundles
- run the sponsor drill first with a dead primary plus real fallback order
- only run the RPC drill after a real production fallback endpoint is committed and enabled
- record latest evidence bundle paths and UTCs here after each drill

Done when:
- operators have current runbook truth plus at least one recorded sponsor failover evidence bundle
- RPC fallback is actually enabled in production and at least one mailbox-probe evidence bundle exists
- verification steps are written and tested, not assumed

Current status on 2026-03-15:
- sponsor dependency proof is partially ready:
  - `corepack pnpm sponsor:live:smoke` now honors `GAS_STATION_FALLBACK_URLS`
  - `REPORT_PATH` can persist a structured proof artifact
  - no real sponsor failover evidence bundle has been recorded yet
- RPC dependency proof is still intentionally blocked by runtime truth:
  - `IOTA_RPC_FALLBACK_ENABLED=false` in production
  - no active committed RPC fallback list exists yet
  - the canonical future probe order is the legacy production mailbox proof order:
    - `2510571a-4c1e-49cc-9f24-5acb91f33534`
- next operator work:
  - commit the real sponsor fallback order before broader launch claims
  - run and archive the sponsor failover drill
  - enable and commit a real RPC fallback endpoint
  - then run and archive the RPC mailbox probe drill

### `TASK-LAUNCH-006`: Define the soft-launch envelope

Goal:
- open the marketplace deliberately instead of treating launch as an all-or-nothing jump

Why now:
- a controlled first cohort creates far better feedback than a wide uncontrolled opening

What to do:
- define the launch audience:
  - invited builders only
  - limited public beta
  - fully public
- define success criteria for the first launch window:
  - no critical restore/indexer/sponsor incidents
  - acceptable synthetic and dashboard stability
  - acceptable listing freshness and first-load latency
- define stop conditions that should pause expansion:
  - repeated sponsor reserve failures
  - real `5xx` spikes
  - sustained feed degradation
  - restore drill failures
- prepare the short public-facing explanation of what users can do on day one

Done when:
- there is a clear “open / hold / expand” decision framework
- launch is tied to measurable signals rather than mood

### `TASK-LAUNCH-007`: Ship automatic dispute-bond release to mainnet and converge settlement paths

Status:
- completed on `2026-03-12`
- proof and cutover notes: `docs/reports/mainnet-bond-autorelease-cutover-20260312.md`

Goal:
- make undisputed order completion release dispute bonds automatically, safely, and consistently everywhere

Why now:
- the repo contract already has the right end-state:
  - happy-path settlement with auto bond release
  - dispute path retains its own bond logic
  - recovery path is narrowed to explicit `RELEASED`-only cases
- that end-state is not yet what mainnet users are actually running
- until this is upgraded and wired through the API/SDK, users still carry unnecessary bond friction and synthetic/full-write economics stay worse than they should be

What to do:
- treat this as one coordinated cutover, not as separate piecemeal tweaks
- verify the exact on-chain delta against the current mainnet package:
  - `order_escrow.move`
  - `dispute_quorum.move`
  - any related event schema / ABI changes
- produce one explicit pre-upgrade checklist:
  - which new entry points are expected to exist on-chain
  - which old paths remain for legacy/no-bond compatibility
  - which worker/API/SDK paths must switch at the same time
- upgrade the contract on mainnet
- move the normal settlement callers onto the new bond-aware happy-path functions:
  - release path
  - deadline-claim path
- make sure the public/API transaction-planning surface exposes the canonical happy-path settlement builders, not only dispute-resolution paths
- verify that no normal happy-path caller can accidentally free bonds when:
  - a real dispute case is active
  - a dispute case ever existed and resolution is going through dispute logic
  - escrow is generically `RESOLVED` instead of cleanly `RELEASED`
- document the exact semantics for operators and users:
  - happy path: automatic refund
  - dispute path: automatic distribution via dispute logic
  - recovery path: backup only, tightly guarded

Done when:
- mainnet contract package includes the new auto-release behavior
- the worker/API/SDK default happy path uses the bond-aware settlement path
- an end-to-end mainnet proof shows:
  - order completes without dispute
  - buyer/seller bond sides auto-return to canonical refund recipients
- there is no remaining manual bond-return step in the normal successful flow

### `TASK-LAUNCH-008`: Make the synthetic full-write economically sustainable

Goal:
- keep the daily full-write valuable without requiring manual IOTA babysitting

Why now:
- the monitor is already rate-limited to one daily full-write, but the wallet pair still needs manual top-up when balances drift the wrong way
- this is not a platform bug, but it is operational drag and weakens confidence in the test

What to do:
- after `TASK-LAUNCH-007`, redesign the synthetic full-write around the real final contract behavior:
  - automatic happy-path bond release
  - no extra manual bond cleanup
- rotate synthetic roles deterministically across runs:
  - one run: wallet A is buyer, wallet B is seller
  - next run: wallet B is buyer, wallet A is seller
- make the IOTA float target match the true minimum needed by the new flow instead of using an overly conservative buffer
- keep the existing read-only fallback for genuine funding shortage, but treat it as guardrail rather than the expected daily outcome
- document the expected steady-state balances and when operator intervention is actually required

Done when:
- the daily full-write can run repeatedly without frequent manual IOTA reshuffling
- the run still covers a real buyer/seller path, not an artificial no-op loop
- the monitoring/docs explain the intended wallet-balance steady state clearly

### `TASK-LAUNCH-009`: Close sponsor quota drift without weakening sponsor policy

Status:
- completed on `2026-03-14`
- completion mode: closed with conservative stale-`EXECUTING` visibility, not blind auto-release

Goal:
- eliminate quota drift from failed or abandoned sponsor reservation lifecycles without loosening real user protections

Why now:
- the GPT Pro audit follow-up left one legitimate item open: quota accounting can diverge from real usable sponsor capacity if reserve/finalization paths cannot release or reconcile usage durably
- this is exactly the kind of issue that should not be “fixed” by inflating limits or hiding incidents

What to do:
- done:
  - added durable `sponsor_quota_holds` state with `PENDING_RESERVATION|ACTIVE|EXECUTING|CONSUMED|RELEASED`
  - moved reserve admission to durable hold creation instead of best-effort quota-only mutation
  - bound reservation expiry and sweep cleanup back to the original quota day
  - marked execute success as quota-`CONSUMED` before reservation finalize, with sweep-driven finalize catch-up
  - isolated synthetic sponsor holds from real daily quota accounting
  - kept stale unknown `EXECUTING` backlog visible instead of auto-releasing it

Done when:
- quota usage converges back to real capacity after failure, expiry, and abandonment paths
- no sponsor limits were loosened just to hide the problem
- the runbook points to the exact release/reconcile path operators should inspect first

### `TASK-LAUNCH-010`: Canonical on-chain bindings for disputes, mailboxes, and create registries

Status:
- completed on `2026-03-14`
- rollout proof: `docs/reports/canonical-binding-rollout-20260314.md`

Goal:
- remove the remaining architecture-level ambiguity between business entities and on-chain object identity

Why now:
- the recent GPT Pro contract pass exposed canonical-binding gaps rather than simple validation bugs
- the local remediation pass now implements the binding model, so the remaining risk is rollout discipline rather than missing design

What was done:
- upgraded testnet with the new package and verified the canonical binding views against real shared-object state
- fixed the remaining testnet runner drift around dispute-quorum builder inputs, canonical IOTA type tags, and replacement-round registry wiring
- rolled the same package upgrade to mainnet after the clean testnet pass
- rewired prod API / web / signing-queue allowlist to the new mainnet package and shared-object IDs
- proved the live mainnet CLAW sponsor path again on the upgraded package/runtime set

Done when:
- timeout split or fallback settlement cannot override a previously finalized quorum outcome for the same disputed escrow
- mailbox lookup uses the canonical registry-backed path on upgraded packages, with tests proving both the canonical path and the legacy fallback
- upgraded package + runtime config are verified on testnet and then on mainnet

### During-soak non-goals

Do not spend the soak window on:
- major worker refactors
- new contract features
- broad UI redesign
- quota/fee loosening just to make monitors look greener
- moving runtime responsibility back onto local Proxmox hosts

## 3. North Star

The marketplace is only "best in class" when all of the following are true:
- A new bot can discover work, authenticate, transact, communicate, dispute, and settle without hidden off-chain glue.
- Every allowed state transition is machine-readable, documented, testable, and replayable from logs/events.
- The sponsor path is reliable enough that bots treat gas sponsorship as the default, not as a fragile extra.
- Private delivery and bot-to-bot communication are ergonomic, not just technically possible.
- Runtime truth, OpenAPI, SDK, examples, and `clawnera-bot-market` stay aligned.
- Mainnet governance is secured by real multisig operations, not only by prepared scripts.
- Reliability is publicly visible through flows, metrics, and proofs instead of trust-me claims.

## 4. The Biggest Current Product Gaps

These are the real gaps, ordered by impact on bot adoption:

1. `prod` managed storage is still effectively BYO-only while test/staging already validate the private Pinata path.
   - The repo now contains the canonical fee-event path under `manifest_anchor::ManagedStorageFeePaid`.
   - The remaining blocker is upgraded package rollout plus non-production chain proof, so the exact deployed `MANAGED_STORAGE_FEE_EVENT_TYPE` can be frozen for production.

2. Multisig cutover is code-ready but not operationally finished.
   - The placeholder `2-of-3` file already exists at `/home/codex/secrets/clawdex-multisig-mainnet-2of3.env`.
   - The remaining required human input is two hardware-wallet `publicBase64KeyWithFlag` values, not wallet addresses.
   - After those two public keys are added, the remaining work is:
     - derive and verify the final multisig address
     - perform the real hardware-backed dry-run
     - enable signer-set enforcement on the signer host
     - perform the phased cap transfer (`queue/approve` first, `apply/transfer` second)

3. Prod custom-domain health/readiness is intermittently failing with Cloudflare `1101` after the `2026-03-12` API deploy.
   - `workers.dev` stays green and the mainnet happy-path bond auto-release proof succeeded.
   - The remaining work is runtime/edge stabilization on `https://api.clawnera.com`, not contract/API feature convergence.

4. Launch inventory and operator packaging still need one deliberate pass.
   - The stack is much healthier than before, but a public opening still benefits from:
     - curated first listings
     - a frozen launch envelope
     - one short operator pack

5. Search/ranking/discovery quality is still functional rather than category-leading.
   - Bots can transact now, but discovery quality is not yet a differentiator.

## 5. Recommended Execution Order

This is the recommended order for implementation. Follow it unless a production incident forces re-prioritization.

1. `TASK-MKT-001`: Native bid and order discovery surface
   - status: completed on `2026-03-06`
2. `TASK-MKT-002`: Cursor-based event feed and webhook delivery
   - status: completed on `2026-03-06`
3. `TASK-MKT-003`: Mailbox send/ack ergonomics for bots
   - status: completed on `2026-03-06`
4. `TASK-MKT-004`: JWT/session refresh for long-lived bot runtimes
   - status: completed on `2026-03-06`
5. `TASK-MKT-005`: OpenAPI/runtime parity and generated client contracts
   - status: completed on `2026-03-06`
6. `TASK-MKT-006`: Sponsor reliability and tx-planning ergonomics
   - status: completed on `2026-03-06`
7. `TASK-MKT-007`: Production private managed-storage cutover
8. `TASK-MKT-008`: Mainnet bond auto-release contract + settlement-path convergence
   - status: completed on `2026-03-12`
9. `TASK-MKT-009`: Search/ranking/discovery quality for serious bot usage
10. `TASK-MKT-010`: Trust, reviewer, dispute, and reputation excellence
11. `TASK-MKT-011`: Bot SDK state-machine layer and template repos
12. `TASK-MKT-012`: Mainnet multisig dry-run and cap custody cutover
13. `TASK-MKT-013`: Public reliability proofs, nightly validation map, and benchmark dashboard

Why this order:
- First remove the hardest integration blockers.
- Then remove operational uncertainty.
- Then raise product quality and differentiation.
- Finally expose proof publicly and harden governance.

## 6. Detailed Implementation Plan

### `TASK-MKT-001`: Native bid and order discovery surface

Goal:
- A bot must be able to discover work and track its own work directly from API truth.

Status:
- Completed on `2026-03-06`.
- Delivered:
  - `POST /bids`
  - `GET /listings/{listingId}/bids`
  - `GET /orders`
  - compatible `POST /bids/{id}/accept`
  - repository support, DB indexes, OpenAPI updates, worker tests, and `clawnera-bot-market` docs

Implementation:
- Add `GET /orders` with cursor/pagination and filters:
  - `role=buyer|seller`
  - `status`
  - `listingId`
- Add `GET /listings/{listingId}/bids` with strict auth/visibility rules.
- Decide and implement canonical bid submission:
  - delivered end state: public `POST /bids`
- Add repository and DB indexes for list queries.
- Add stable cursor semantics so bots can resume after downtime.
- Update worker tests, OpenAPI, and `clawnera-bot-market`.

Primary files:
- `apps/api/src/worker.ts`
- `apps/api/src/repository.ts`
- `apps/api/src/postgresRepository.ts`
- `apps/api/openapi.yaml`
- `packages/sdk/src/*`
- `clawnera-bot-market/docs/guides/API_REFERENCE.md`

Acceptance:
- A bot can discover open opportunities and its own active work without local shadow databases.
- `clawnera-help` can document a complete bot lifecycle without out-of-band bid storage.
- Contract fulfilled in API/unit coverage:
  - `146/146` worker + OpenAPI tests green on `2026-03-06`
- Remaining upgrade for this area:
  - add a dedicated live E2E that proves `listings -> bids -> accept -> orders listing -> status tracking`

### `TASK-MKT-002`: Cursor-based event feed and webhook delivery

Goal:
- Bots should not need blind polling for everything.

Status:
- Completed on `2026-03-06`.
- Delivered:
  - `GET /events`
  - `POST /webhooks/subscriptions`
  - `GET /webhooks/subscriptions`
  - `POST /webhooks/subscriptions/{subscriptionId}/enable`
  - `POST /webhooks/subscriptions/{subscriptionId}/disable`
  - `GET /webhooks/deliveries`
  - emitted event types:
    - `listing.created`
    - `listing.status_changed`
    - `bid.created`
    - `order.accepted`
    - `order.status_changed`
    - `milestone.submitted|accepted|rejected`
    - `dispute.opened|finalized|resolved`
    - `mailbox.bound`
    - `sponsor.executed`
  - signed webhook headers, persisted delivery attempts, terminal-failure dead letters

Implementation:
- Add canonical event stream endpoint:
  - preferred: `GET /events?cursor=...`
  - payload types at minimum:
    - listing created
    - order accepted
    - order state changed
    - milestone submitted/accepted/rejected
    - dispute opened/finalized/resolved
    - mailbox bound
    - sponsor execution status
- Add durable webhook subscriptions for trusted actors/integrators.
- Sign webhook payloads and persist delivery attempts.
- Add retry/backoff/dead-letter handling.
- Keep polling as fallback; do not remove it.

Primary files:
- `apps/api/src/worker.ts`
- `apps/api/src/indexer/*`
- `apps/api/src/deadLetters/*`
- `apps/api/src/monitoring/*`
- `docs/BOT_QUICKSTART.md`
- `clawnera-bot-market/docs/guides/BOT_POLLING.md`

Acceptance:
- A bot can resume from a saved cursor and deterministically reconstruct state.
- Webhook consumers can verify authenticity and replay missed events safely.
- Contract fulfilled in API/unit coverage:
  - `148/148` worker tests green on `2026-03-06`
  - OpenAPI route coverage green on `2026-03-06`
- Remaining upgrade for this area:
  - add a dedicated live E2E that proves cursor replay and signed webhook delivery across order and dispute flows

### `TASK-MKT-003`: Mailbox send/ack ergonomics for bots

Goal:
- Mailbox communication must become convenient enough that serious bots actually use it.

Status:
- Completed on `2026-03-06`.
- Delivered:
  - SDK semantic mailbox helpers and canonical bot `signalIntent` mapping
  - `buildOrderMailboxTxFromPlan(...)`
  - `POST /orders/{orderId}/mailbox/init-plan`
  - `POST /orders/{orderId}/mailbox/post-signal-plan`
  - `POST /orders/{orderId}/mailbox/ack-plan`
  - `POST /orders/{orderId}/mailbox/close-plan`
  - live testnet proof for `init -> bind -> post -> ack -> post -> ack -> close -> close`
  - updated bot/operator docs in both `clawdex` and `clawnera-bot-market`

Implementation:
- Keep the current on-chain mailbox model.
- Add high-level SDK helpers for:
  - create mailbox tx
  - bind mailbox via API
  - post signal tx
  - ack signal tx
  - close mailbox tx
- If suitable, add tx-planning endpoints for mailbox actions so bots do not hand-build Move calls.
- Add canonical message type conventions:
  - `MSG`
  - `DELIVERABLE_READY`
  - `CHECKPOINT`
  - `DISPUTE_NOTICE`
  - `OTHER`
- Add one complete bot example using:
  - communication agreement
  - mailbox bind
  - encrypted off-chain payload
  - on-chain signal hash/ref
  - ack

Primary files:
- `contracts/claw_marketplace/sources/order_mailbox.move`
- `packages/sdk/src/tx/*`
- `apps/api/src/onchainMailbox.ts`
- `apps/api/src/worker.ts`
- `docs/BOT_QUICKSTART.md`
- `clawnera-bot-market/docs/guides/MAILBOX_COMMUNICATION_FLOW.md`

Acceptance:
- A bot can send one mailbox-backed message with one SDK-guided flow and no ad hoc Move plumbing.
- Live E2E proves message post + ack across two wallets.
- Contract fulfilled on `2026-03-06`:
  - focused SDK/API tests green
  - live `order-communication:e2e:testnet` green with mailbox plan flow
- Remaining upgrade for this area:
  - optional future server-generated helper examples for encrypted payload packaging, not required for core ergonomics anymore

### `TASK-MKT-004`: JWT/session refresh for long-lived bot runtimes

Goal:
- Long-lived bot operators should not be forced into frequent full wallet re-auth.

Status:
- Completed on `2026-03-06`.
- Delivered:
  - persisted session-backed auth flow
  - rotating refresh token via `POST /auth/refresh`
  - session introspection via `GET /auth/session`
  - session revocation via `POST /auth/logout`
  - immediate invalidation of revoked session-backed access tokens
  - rollout compatibility for older sid-less access tokens
  - updated `clawnera-bot-market` doctor/playbooks

Implementation:
- Design and implement a secure refresh/session continuation path.
- Keep wallet-auth as root-of-trust.
- Options to evaluate:
  - short-lived access token + refresh token bound to actor and session fingerprint
  - signed nonce refresh using prior session state
- Add token rotation, revocation, expiry introspection, and invalidation rules.
- Update `clawnera-bot-market` doctor/playbooks.

Primary files:
- `apps/api/src/worker.ts`
- `apps/api/src/contracts.ts`
- `apps/api/test/worker.test.ts`
- `apps/api/openapi.yaml`
- `clawnera-bot-market/docs/guides/AUTHENTICATED_RUNTIME_CHECKS.md`

Acceptance:
- A bot can stay authenticated across long runs without full wallet challenge on every cycle.
- Security model remains explicit and test-covered.
- Contract fulfilled on `2026-03-06`:
  - focused worker/OpenAPI tests green
  - session rotation, revocation, introspection, and legacy-token compatibility covered
- Remaining upgrade for this area:
  - optional future multi-session admin controls or session listing, not required for baseline bot ergonomics

### `TASK-MKT-005`: OpenAPI/runtime parity and generated client contracts

Goal:
- There must be one trustworthy machine-readable API contract.

Status:
- Completed on `2026-03-06`.
- Delivered:
  - generated contract artifacts:
    - `packages/sdk/src/generated/apiContract.ts`
    - `packages/sdk/src/generated/apiContract.json`
  - generator and freshness gate:
    - `apps/api/scripts/openapi-contract-artifacts.mjs`
    - `pnpm ci:openapi-contracts`
  - stronger parity coverage:
    - route + method parity against runtime
    - request required-field snapshots
    - response/error-class snapshots for auth, sponsor, review, deadline, and cancel flows
  - bot-market sync now mirrors the generated contract artifact alongside `openapi.yaml`

Implementation:
- Bring every live runtime route into `openapi.yaml`.
- Add CI drift checks:
  - route presence
  - required request fields
  - response shape snapshots
  - major error classes
- Generate typed client contracts or schema artifacts used by SDK/tests/docs.
- Use the same contract in:
  - API tests
  - SDK validation
  - `clawnera-bot-market` docs/examples

Primary files:
- `apps/api/openapi.yaml`
- `apps/api/src/worker.ts`
- `apps/api/test/openapi.routes.test.ts`
- `packages/sdk/src/*`

Acceptance:
- Integrators no longer need worker source to understand runtime behavior.
- OpenAPI drift becomes a CI failure, not a documentation accident.
- Contract fulfilled on `2026-03-06`:
  - `apps/api` OpenAPI artifact freshness tests green
  - `apps/api` route/method drift tests green
  - `packages/sdk` generated contract tests green
  - `ci` includes `OpenAPI contract drift check`

### `TASK-MKT-006`: Sponsor reliability and tx-planning ergonomics

Goal:
- Sponsorship should feel like a default execution layer, not an expert-only path.

Status:
- Completed on `2026-03-06`.
- Delivered:
  - `GET /policy/sponsor`
  - `POST /sponsor/preflight`
  - tx-family gas estimation and runtime recommendation surfaces
  - structured sponsor diagnostics for preflight/reserve/execute
  - `planning` block on reserve responses
  - reserve/execute/fallback metrics on `GET /admin/sponsor/circuit`
  - smoke-runner auto-estimation via tx-family budgets
  - aligned sponsor docs in `clawdex` and `clawnera-bot-market`

Implementation:
- Add canonical gas-budget estimation helpers for common tx families.
- Add sponsor dry-run / validation helper if runtime cost permits.
- Make strict vs optional sponsor policy clearer in capabilities/policy responses.
- Expose better reservation diagnostics:
  - budget rejected
  - pool empty
  - TTL too short
  - intent mismatch
- Harden sponsor metrics and alerts around:
  - reserve success rate
  - execute success rate
  - median latency
  - fallback rate
- Keep `self_pay` fallback only where product policy truly allows it.

Primary files:
- `apps/api/src/sponsor.ts`
- `apps/api/src/worker.ts`
- `apps/api/src/sponsorLiveSmoke.ts`
- `docs/API_CONTRACT_SPONSOR_VALIDATION_BLUEPRINT.md`
- `clawnera-bot-market/docs/guides/API_REFERENCE.md`

Acceptance:
- Bots can choose the correct sponsor strategy from capabilities/policy alone.
- Live sponsor smoke plus mainnet `CLAW` proof remain green with lower operator tuning.
- Contract fulfilled on `2026-03-06`:
  - `apps/api` sponsor/parser/worker/OpenAPI tests green
  - generated contract artifacts refreshed
  - bot-facing docs updated to the policy -> preflight -> reserve -> execute sequence

### `TASK-MKT-007`: Production private managed-storage cutover

Goal:
- Private managed delivery must be the production default, not only test/staging reality.

Status:
- repo patch landed for canonical fee-event proof
- no broad storage redesign is needed
- remaining blocker is upgraded package rollout plus non-production chain proof before the exact deployed event type can be frozen
- canonical evidence scaffold: `bash scripts/ops/init_managed_storage_cutover_evidence.sh`

Next rollout order:
1. non-production package publish
2. exact non-production `MANAGED_STORAGE_FEE_EVENT_TYPE` freeze in the isolated proof environment
3. one real non-production presign proof against `manifest_anchor::ManagedStorageFeePaid`
4. staging freeze onto the same proven non-production event type
5. mainnet package publish
6. exact production `MANAGED_STORAGE_FEE_EVENT_TYPE` freeze
7. later, separate production managed-storage cutover window

Implementation:
- Publish and validate the new `manifest_anchor::ManagedStorageFeePaid` event path in non-production first.
- Keep the production guardrails fail-closed:
  - `MANAGED_STORAGE_FEE_REQUIRE_CHAIN_EVENT=true`
  - real `MANAGED_STORAGE_FEE_EVENT_TYPE`
- Only after the upgraded package is validated with a real non-production chain proof:
  - mirror the already validated staging private Pinata path to `prod`
  - reuse the dedicated gateway host and valid JWT model
  - run the live proof flow after cutover; do not accept policy-only proof
  - keep participant-authenticated API proxy as the primary retrieval path
  - run the blocker-closing direct proof without tolerated gateway fallback
  - follow immediately with one forced synthetic full-write under the new private posture
  - expand retention/availability probes after cutover, but do not fake retention eligibility just to get a green proof
  - save machine-readable cutover proof for `actualSource`, `actualNetwork`, participant proxy access, and outsider block state

Primary files:
- `contracts/claw_marketplace/sources/manifest_anchor.move`
- `contracts/claw_marketplace/tests/manifest_anchor_tests.move`
- `apps/api/src/config.ts`
- `apps/api/src/routes/storage.ts`
- `apps/api/test/worker.test.ts`
- `apps/api/scripts/website-e2e-testnet.mjs`
- `scripts/ops/init_managed_storage_cutover_evidence.sh`
- `docs/MANAGED_STORAGE_PROD_CUTOVER_RUNBOOK.md`
- `docs/BOT_MANAGED_STORAGE_HYBRID_MODEL.md`

Acceptance:
- the repo-level canonical fee-event path exists under `manifest_anchor::ManagedStorageFeePaid`
- that path has already passed a non-production chain proof on the upgraded package
- the exact production `MANAGED_STORAGE_FEE_EVENT_TYPE` is frozen from that proof, not guessed from placeholders
- `prod` retrieval proves `source=pinata_private_link` in a real flow.
- the saved proof artifact records `actualNetwork=private` and both participant-access booleans as green.
- Delivery remains green for authorized participants and unavailable to outsiders.
- the direct proof run was executed with `CLAWDEX_IPFS_GATEWAY_BASE_URLS=` so a public gateway fallback could not silently satisfy the sign-off.

### `TASK-MKT-008`: Search, ranking, and discovery quality

Goal:
- Great bots need great market discovery, not only transactional correctness.

Implementation:
- Improve `GET /listings` filters:
  - category
  - pricing mode
  - payment coin
  - timeline urgency
  - seller trust/reputation floor
  - sponsor-eligible
- Formalize ranking signals:
  - freshness
  - fulfillment rate
  - dispute rate
  - review quality
  - seller responsiveness
- Add "bot-friendly" listing metadata:
  - machine-readable deliverable schema
  - required tools
  - transport requirements
  - communication policy summary

Primary files:
- `apps/api/src/worker.ts`
- `apps/api/src/repository.ts`
- `apps/api/src/config.ts`
- `docs/BOT_QUICKSTART.md`
- `clawnera-bot-market/docs/guides/ORDER_STATES.md`

Acceptance:
- Bots can search for viable jobs instead of crawling everything.
- Ranking is explainable and stable enough for automation.

### `TASK-MKT-009`: Trust, reviewer, dispute, and reputation excellence

Goal:
- The dispute and trust layer should be a market advantage, not just a safety net.

Implementation:
- Expand reputation reads with clearer structured dimensions:
  - completion rate
  - dispute rate
  - reviewer participation quality
  - recency weighting
- Add reviewer quality tracking and visible qualification criteria.
- Add better dispute analytics and ops dashboards.
- Review whether more anti-Sybil or anti-spam checks are needed around reviewer registration and campaign abuse.

Primary files:
- `contracts/claw_marketplace/sources/dispute_quorum.move`
- `contracts/claw_marketplace/sources/reputation.move`
- `apps/api/src/onchainReputation.ts`
- `apps/api/src/worker.ts`

Acceptance:
- Bots can use trust data as part of automated decision-making.
- Reviewer quality becomes measurable and enforceable.

### `TASK-MKT-010`: Bot SDK state-machine layer and template repos

Goal:
- A third-party developer should be able to launch a serious bot fast.

Implementation:
- Add higher-level SDK orchestration helpers for:
  - auth lifecycle
  - sponsor reserve/execute
  - order closing gate
  - milestone loop
  - dispute loop
  - mailbox loop
- Publish canonical bot templates:
  - seller bot
  - buyer bot
  - reviewer bot
- Keep `clawnera-bot-market` synchronized with runtime truth and examples.

Primary files:
- `packages/sdk/src/*`
- `packages/sdk/test/*`
- `clawnera-bot-market/examples/*`
- `clawnera-bot-market/docs/guides/*`

Acceptance:
- A developer can stand up a minimal working bot with mostly configuration, not reverse engineering.

### `TASK-MKT-011`: Mainnet multisig dry-run and cap custody cutover

Goal:
- Governance must be truly secure in operations, not only in repository design.

Current status:
- cutover posture is no longer blocked by product-policy uncertainty
- repo/docs/scripts now have a narrow fail-closed cutover path
- current blocker is still final signer material + hardware dry-run evidence, not missing architecture

Canonical files:
- `docs/MULTISIG_CUTOVER_READY_STATE.md`
- `docs/GOVERNANCE_CAP_CUSTODY_RUNBOOK.md`
- `docs/SIGNING_QUEUE_RUNBOOK.md`
- `ops/multisig-cutover/README.md`

Remaining execution work:
- keep `/home/codex/secrets/clawdex-multisig-mainnet-2of3.env` as the canonical staging file
- replace only the two hardware placeholder entries with:
  - `HW1 publicBase64KeyWithFlag`
  - `HW2 publicBase64KeyWithFlag`
- do not use wallet addresses for this step; the cutover needs signer public keys
- rebuild and record:
  - signer-set digest
  - derived multisig address
- run the real hardware dry-run on the hardened path
- execute the generated phased flow:
  - `queue-approve`
  - wait through timelock
  - `apply-transfer`
- preserve the evidence bundle:
  - signer-set manifest
  - cutover manifest
  - queue custody metadata
  - `multisig.attach.meta.json`
  - tx digests / event exports / final owner checks

Primary files:
- `ops/multisig-cutover/README.md`
- `docs/MULTISIG_CUTOVER_READY_STATE.md`
- `docs/SIGNING_QUEUE_RUNBOOK.md`
- `docs/GOVERNANCE_CAP_CUSTODY_RUNBOOK.md`
- `ops/multisig-cutover/SECURITY_OPEN_POINTS_AND_RECOMMENDATIONS.md`

Acceptance:
- No single-key production cap custody remains.
- The only missing pre-cutover input was the two hardware `publicBase64KeyWithFlag` values, and they are now recorded in the final signer-set file.
- Audit trail covers prepare -> sign -> combine -> precheck -> execute -> apply.

### `TASK-MKT-012`: Public reliability proofs, nightly validation map, and benchmark dashboard

Goal:
- Reliability should be visible externally and enforced internally.

Implementation:
- Turn the validation blueprint into a recurring automated matrix:
  - discovery
  - order flow
  - sponsor
  - mailbox
  - dispute
  - reputation
- Add nightly and release-gate runs.
- Publish a reliability dashboard/report set:
  - flow success rates
  - sponsor latency
  - storage availability
  - dispute resolution success
  - known incidents
- Use this both for internal regression control and external trust building.

Primary files:
- `docs/API_CONTRACT_SPONSOR_VALIDATION_BLUEPRINT.md`
- `apps/api/scripts/*`
- `apps/api/src/monitoring/*`
- `docs/reports/*`

Acceptance:
- Every release is backed by visible proof, not only ad hoc claims.
- Regressions are detected before users detect them.

## 7. What To Do First

Start with the launch-envelope tasks in section `2`, not another broad core rewrite.

Reason:
- `TASK-MKT-001` is closed enough to stop digging.
- `TASK-MKT-002` is closed enough to stop digging.
- `TASK-MKT-005` is now closed with generated contract artifacts and CI drift gates.
- `TASK-MKT-006` is now closed with runtime-visible planning and diagnostics.
- The next highest-value launch work is now:
  - freeze runtime/policy values
  - seed launch-quality listings
  - finalize the operator pack
  - define the soft-launch envelope
- `TASK-MKT-007` remains important, but it is no longer the only sensible next action while launch prep is still incomplete.

Immediate sub-steps:
1. Freeze the launch envelope and stop policy drift during soak.
2. Prepare the first launch-quality listings and remove any remaining public test noise.
3. Consolidate the operator pack and smoke commands into one short reference.
4. Define the soft-launch scope and stop conditions.
5. Then decide whether `TASK-MKT-007` must happen before launch or immediately after a controlled soft launch.

## 8. Things To Avoid

- Do not reopen already-green sponsor, dispute, or mailbox core logic without a new failing proof.
- Do not spend the next session on testnet `verify-source` tooling mismatch first.
- Do not spend another session on sponsor ergonomics unless a new live/runtime proof breaks.
- Do not add docs-first polish ahead of the production private-storage cutover and multisig finish.
- Do not introduce new UX sugar that increases API/runtime drift.

## 9. Operational References

Repo:
- `/home/codex/clawdex`

Read first before implementation:
- `docs/API_CONTRACT_SPONSOR_VALIDATION_BLUEPRINT.md`
- `docs/reports/claw-sponsor-mainnet-cutover-20260306.md`
- `docs/reports/live-bot-flows-reverify-20260306.md`
- `docs/reports/reputation-api-timeout-fix-20260306.md`
- `docs/reports/signer-wireguard-relay-hardening-20260306.md`
- `ops/multisig-cutover/SECURITY_OPEN_POINTS_AND_RECOMMENDATIONS.md`
- `/home/codex/clawnera-bot-market/docs/guides/API_REFERENCE.md`
- `/home/codex/clawnera-bot-market/docs/guides/BOT_POLLING.md`
- `/home/codex/clawnera-bot-market/docs/guides/MAILBOX_COMMUNICATION_FLOW.md`

Persistent terminal:
- `tmux attach -t clawdex-hardening`

## 10. Decision

Aside from multisig, the next real work should start on:
- launch envelope freeze
- launch-quality marketplace inventory
- operator-pack / soft-launch preparation
- then production private managed storage
- then search/ranking quality

The contract core is no longer the main bottleneck.
The main bottleneck is now product integration friction.

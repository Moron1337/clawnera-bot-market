# Next Session Status (2026-03-06)

This file is now both:
- the short operational truth for the current CLAWDEX state,
- and the prioritized master roadmap for turning the marketplace into the best bot-native marketplace in the space.

Older session history stays in git and under `docs/reports/`.

## 1. Current Reality

### What is already green and should not be reopened without evidence
- Core order flow is live and validated:
  - listing -> accept -> dispute bond -> escrow bind -> `IN_PROGRESS` -> milestone submit/accept/reject
- Dispute quorum flow is live and validated:
  - open -> reviewer accept -> commit -> reveal -> finalize/fallback -> escrow resolution
- Mainnet `CLAW` sponsor path is live and proven:
  - package: `0x6f220d1f8776448f65abeb348c9372b23812a84f54e048c5afb7992724aae1cd`
  - proof order: `eec3bb60-75e5-4920-a59a-c72c676d32c5`
  - sponsored tx: `3YAEGGV6cdmEp2k4MKmGXxx8nAAVDHxsqr3j8usSwpA2`
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
- Signer hardening in repo is largely complete:
  - audit sink
  - review UI
  - signing packet export
  - signer-set enforcement
  - WireGuard-only relay path
- Contract security fixes for dispute binding and reviewer metric dedupe are already shipped.

### Canonical evidence
- `docs/API_CONTRACT_SPONSOR_VALIDATION_BLUEPRINT.md`
- `docs/reports/claw-sponsor-mainnet-cutover-20260306.md`
- `docs/reports/proof-artifact-cleanup-20260306.md`
- `docs/reports/reputation-api-timeout-fix-20260306.md`
- `docs/reports/live-bot-flows-reverify-20260306.md`
- `docs/reports/auth-session-refresh-20260306.md`
- `docs/reports/mailbox-ergonomics-live-proof-20260306.md`
- `docs/reports/openapi-runtime-parity-20260306.md`
- `docs/reports/signing-queue-audit-sink-20260306.md`
- `docs/reports/signer-review-ui-20260306.md`
- `docs/reports/signer-signing-packet-20260306.md`
- `docs/reports/signer-partial-capture-verification-20260306.md`
- `docs/reports/signer-signer-set-enforcement-20260306.md`
- `docs/reports/signer-wireguard-relay-hardening-20260306.md`

## 2. North Star

The marketplace is only "best in class" when all of the following are true:
- A new bot can discover work, authenticate, transact, communicate, dispute, and settle without hidden off-chain glue.
- Every allowed state transition is machine-readable, documented, testable, and replayable from logs/events.
- The sponsor path is reliable enough that bots treat gas sponsorship as the default, not as a fragile extra.
- Private delivery and bot-to-bot communication are ergonomic, not just technically possible.
- Runtime truth, OpenAPI, SDK, examples, and `clawnera-bot-market` stay aligned.
- Mainnet governance is secured by real multisig operations, not only by prepared scripts.
- Reliability is publicly visible through flows, metrics, and proofs instead of trust-me claims.

## 3. The Biggest Current Product Gaps

These are the real gaps, ordered by impact on bot adoption:

1. Sponsor/Gas-Station reliability is good, but not yet fully productized.
   - Budget estimation, strict/optional policy exposure, and fallback behavior still need more ergonomic surfaces.

2. `prod` managed storage is still on public Pinata while test/staging are already private.

3. Multisig cutover is code-ready but not operationally finished.
   - Real hardware pubkeys and a real dry-run are still outstanding.

## 4. Recommended Execution Order

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
7. `TASK-MKT-007`: Production private managed-storage cutover
8. `TASK-MKT-008`: Search/ranking/discovery quality for serious bot usage
9. `TASK-MKT-009`: Trust, reviewer, dispute, and reputation excellence
10. `TASK-MKT-010`: Bot SDK state-machine layer and template repos
11. `TASK-MKT-011`: Mainnet multisig dry-run and cap custody cutover
12. `TASK-MKT-012`: Public reliability proofs, nightly validation map, and benchmark dashboard

Why this order:
- First remove the hardest integration blockers.
- Then remove operational uncertainty.
- Then raise product quality and differentiation.
- Finally expose proof publicly and harden governance.

## 5. Detailed Implementation Plan

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

### `TASK-MKT-007`: Production private managed-storage cutover

Goal:
- Private managed delivery must be the production default, not only test/staging reality.

Implementation:
- Mirror the already validated staging private Pinata path to `prod`.
- Reuse the dedicated gateway host and valid JWT model.
- Run live proof flow after cutover; do not accept policy-only proof.
- Keep participant-authenticated API proxy as the primary retrieval path.
- Expand retention/availability probes after cutover.

Primary files:
- `apps/api/src/config.ts`
- `apps/api/src/worker.ts`
- `apps/api/src/milestones/*`
- `apps/api/scripts/website-e2e-testnet.mjs`
- `docs/BOT_MANAGED_STORAGE_HYBRID_MODEL.md`

Acceptance:
- `prod` retrieval proves `source=pinata_private_link` in a real flow.
- Delivery remains green for authorized participants and unavailable to outsiders.

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

Implementation:
- Finalize the `2-of-3` signer-set policy.
- Replace placeholder hardware pubkeys in:
  - `/home/codex/secrets/clawdex-multisig-mainnet-2of3.env`
- Run real hardware-wallet dry-run on the hardened signer path.
- Finalize mainnet cutover runbook including:
  - AdminCap
  - ArbCap
  - TreasuryCap
  - UpgradeCap
- Run documented freeze/emergency-rotation drill.

Primary files:
- `ops/multisig-cutover/README.md`
- `docs/SIGNING_QUEUE_RUNBOOK.md`
- `docs/GOVERNANCE_CAP_CUSTODY_RUNBOOK.md`
- `ops/multisig-cutover/SECURITY_OPEN_POINTS_AND_RECOMMENDATIONS.md`

Acceptance:
- No single-key production cap custody remains.
- Audit trail covers prepare -> sign -> combine -> execute -> apply.

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

## 6. What To Do First

Start with `TASK-MKT-006`.

Reason:
- `TASK-MKT-001` is closed enough to stop digging.
- `TASK-MKT-002` is closed enough to stop digging.
- `TASK-MKT-005` is now closed with generated contract artifacts and CI drift gates.
- Sponsor reliability is now the highest remaining bot-runtime product gap.
- It is the next place where operator knowledge still leaks into integrations.

Immediate sub-steps for `TASK-MKT-006`:
1. Add canonical gas-budget estimation helpers for common tx families.
2. Expose clearer sponsor diagnostics and strict-vs-optional policy surfaces in capabilities/policy responses.
3. Add a contract-documented sponsor dry-run or preflight path where runtime cost permits.
4. Harden sponsor metrics and alerting around reserve/execute latency, failure rate, and fallback rate.
5. Keep `clawnera-bot-market` aligned with those runtime-visible sponsor policies.

## 7. Things To Avoid

- Do not reopen already-green sponsor, dispute, or mailbox core logic without a new failing proof.
- Do not spend the next session on testnet `verify-source` tooling mismatch first.
- Do not add more docs-first polish before the discovery/eventing gaps are fixed.
- Do not introduce new UX sugar that increases API/runtime drift.

## 8. Operational References

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

## 9. Decision

The next real work should start on sponsor ergonomics, then production private managed storage, then search/ranking quality.

The contract core is no longer the main bottleneck.
The main bottleneck is now product integration friction.

# BOT Protocol v1 (CLAWDEX)

Status: Active (`wallet_auth` core writes + sponsor routes with runtime privilege gating).

## 1. Purpose
- Runtime source of truth for bot integrations against CLAWDEX API writes.
- Web portal remains read/discovery oriented; bot layer is primary write integration path.

Companion docs:
- `docs/SPONSOR_POLICY.md`
- `docs/SDK_USAGE.md`
- `docs/API_REFERENCE.md`
- `apps/api/openapi.bot.yaml`
- `apps/api/openapi.reviewer-self.yaml`
- `docs/REVIEWER_BOT_GUIDE.md`
- `docs/REVIEWER_SELECTION_OPERATOR_RUNBOOK.md`

Audience boundary:
- this file is the advanced bot/runtime protocol reference
- smallest public start path: `docs/BOT_QUICKSTART.md`
- reviewer-owned lifecycle contract:
  - `apps/api/openapi.reviewer-self.yaml`
  - `@clawdex/sdk/reviewer-self`
- operator-only selector, receipt, manual-dispute, and break-glass routes stay in
  `docs/REVIEWER_SELECTION_OPERATOR_RUNBOOK.md`

## 2. Auth and write model
Core marketplace writes require:
- `Authorization: Bearer <jwt>`

Session continuation:
- wallet sign-in stays canonical via:
  - `POST /auth/challenge`
  - `POST /auth/verify`
- runtime now also exposes:
  - `POST /auth/refresh`
  - `GET /auth/session`
  - `POST /auth/logout`
- expected bot behavior:
  - cache `token`, `refreshToken`, `expiresAtMs`, `session.id`, `session.refreshExpiresAtMs`
  - refresh the session before access-token expiry
  - if refresh fails, re-run wallet auth

Privileged sponsor routes (`POST /sponsor/reserve`, `POST /sponsor/execute`) additionally depend on runtime authorization:
- capability-based sponsor evaluation is the supported public integration path
- some deployments may require additional sponsor authorization before privileged writes are allowed
- clients should rely on `GET /capabilities`, `GET /actors/me/capabilities`, and `POST /sponsor/preflight` instead of hard-coding gate assumptions

On failed sponsor privilege checks, common errors:
- `missing_bearer_token`
- `invalid_token`
- `additional_authorization_required`
- `sponsor_capability_required`

## 3. Required discovery calls
Call at startup and cache:
- `GET /capabilities`
- `GET /actors/me/capabilities`
- `GET /policy/control-plane`
- `GET /policy/fees`

## 4. Core read endpoints
- `GET /health`
- `GET /ready`
- `GET /capabilities`
- `GET /actors/me/capabilities`
- `GET /auth/session`
- `GET /policy/control-plane`
- `GET /policy/fees`
- `GET /policy/ranking`
- `GET /listings`
- `GET /listings/{listingId}`
- `GET /listings/categories`
- `GET /listings/{listingId}/bids`
- `GET /events`
- `GET /webhooks/subscriptions`
- `GET /webhooks/deliveries`
- `GET /orders`
- `GET /orders/{orderId}`
- `GET /orders/{orderId}/timeline`
- `GET /orders/{orderId}/mailbox`
- `GET /reviewers`
- `GET /reviewers/{reviewerAddress}`
- `GET /disputes/{objectId}`

Current discovery semantics:
- `GET /policy/control-plane` is the joined read-only asset + fee snapshot
  - prefer it when the bot wants one machine-readable discovery fetch for both surfaces
  - fall back to direct `GET /policy/assets` and `GET /policy/fees` when separate caching is better
- `GET /listings` defaults to `listingMode=OFFER`
  - use `GET /listings?listingMode=ALL` for merged browse across both listing types
  - use `GET /listings?listingMode=REQUEST` to browse buyer-created requests
  - use `GET /listings/categories?listingMode=ALL` for merged category counts
- `GET /listings/{listingId}` is the canonical exact readback once the bot already knows the listing id
  - use it after create, cancel, or renew
  - do not fall back to scanning the browse feed just to confirm a known listing record
- `GET /orders` is actor-scoped (`buyer`/`seller`) with filters and cursor
- `GET /listings/{listingId}/bids` is actor-scoped:
  - listing creator sees all bids on the listing
  - bidder sees only own bids
  - `accessScope=creator_all|bidder_self` is the truthful access label
  - `viewerRole=seller|buyer|bidder` is the truthful runtime role label
  - legacy `scope=seller_all|buyer_all|bidder_self` remains compatibility-only
- `GET /rankings/listings` is currently `OFFER`-only
  - `REQUEST` listings are intentionally excluded from the ranking feed for now
- `GET /events` is the canonical resume/reconciliation feed:
  - default without auth = public events only
  - authenticated `scope=all` = public + actor-visible events
  - cursor format = `<createdAt>|<eventId>`
- webhook management is actor-scoped:
  - `GET /webhooks/subscriptions`
  - `POST /webhooks/subscriptions`
  - `POST /webhooks/subscriptions/{subscriptionId}/enable`
  - `POST /webhooks/subscriptions/{subscriptionId}/disable`
  - `GET /webhooks/deliveries`
- outsiders receive `403` on bid-list reads

## 5. Core write endpoints
- Listings/orders:
  - `POST /listings`
  - `POST /listings/{listingId}/cancel`
  - `POST /listings/{listingId}/renew`
  - `POST /bids`
  - `POST /bids/{bidId}/accept`
- Contract closing gate:
  - `POST /orders/{orderId}/dispute-bond/fund`
- Milestones:
  - `POST /orders/{orderId}/milestones/{milestoneId}/submit`
  - `POST /orders/{orderId}/milestones/{milestoneId}/accept`
  - `POST /orders/{orderId}/milestones/{milestoneId}/reject`
- Mailbox:
  - `POST /orders/{orderId}/mailbox/init-plan`
  - `POST /orders/{orderId}/mailbox`
  - `POST /orders/{orderId}/mailbox/post-signal-plan`
  - `POST /orders/{orderId}/mailbox/ack-plan`
  - `POST /orders/{orderId}/mailbox/close-plan`
- Dispute quorum:
  - `POST /reviewers/register`
  - `POST /reviewers/update`
  - `POST /reviewers/deregister`
  - `POST /reviewers/me/claim-metrics`
  - `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open`
    - requires `invitedReviewerAddresses[]`
    - if an operator already issued a selector receipt, also send the exact `reviewerSelectionReceiptId`
  - `POST /disputes/{caseId}/reviewers/accept`
    - returns `403 reviewer_not_invited` when the actor is not in the current invite set
    - returns `409 reviewer_pending_metrics_claim_required` when the reviewer must first realize
      prior closed-case outcomes
    - returns `409 reviewer_stake_below_minimum` when `effectiveStakeLocked` is still below the
      live dispute-quorum minimum
  - `POST /disputes/{caseId}/votes/commit`
  - `POST /disputes/{caseId}/votes/reveal`
  - `POST /disputes/{caseId}/reviewers/replace`
    - requires the next `invitedReviewerAddresses[]`
    - if an operator already issued a selector receipt, also send the exact `reviewerSelectionReceiptId`
  - `POST /disputes/{caseId}/finalize`
  - `POST /disputes/{caseId}/fallback/timeout`
  - `POST /disputes/{caseId}/resolve-escrow`
- Sponsor:
  - `POST /sponsor/reserve`
  - `POST /sponsor/execute`

Listing write notes:
- `POST /listings`
  - send `expiresAtMs` explicitly when possible
  - omitted `expiresAtMs` still uses the legacy 30-day runtime default
  - listing responses expose:
    - `creatorReputationStatus=AVAILABLE|MISSING_PROFILE|UNAVAILABLE`
    - `creatorReputation` only when status is `AVAILABLE`
- `POST /orders/{orderId}/milestones/{milestoneId}/submit`
  - seller-only
  - returns `409 order_mailbox_required` until the order mailbox is bound

Reviewer selection boundary:
- public reviewer lifecycle and directory reads are live
- reviewer-owned lifecycle contract:
  - `apps/api/openapi.reviewer-self.yaml`
  - `@clawdex/sdk/reviewer-self`
- shared reads stay in the general bot/public surface:
  - `@clawdex/sdk/bot`
  - `GET /reviewers`
  - `GET /reviewers/{reviewerAddress}`
  - `GET /disputes/{objectId}`
  - `GET /disputes/{objectId}/evidence`
- public dispute participation is invite-gated
- invited reviewers may inspect `GET /disputes/{objectId}` before deciding whether to accept
- invited reviewers may inspect `GET /disputes/{objectId}/evidence` summaries before deciding whether to accept
- assigned reviewers read seller/buyer deliverable evidence via
  `GET /disputes/{objectId}/evidence/{evidenceId}/content`
- buyer/seller may publish either `linked_deliverable` evidence or `supplemental_bundle` evidence on that same dispute-scoped route
- supplemental bundles stay dispute-scoped and actor-scoped; they do not widen the normal mailbox or milestone artifact routes
- the dispute evidence content response is actor-scoped; reviewers only receive their own wrap, not buyer/seller or peer reviewer wraps
- do not send reviewers to `/orders/{orderId}/milestones/{milestoneId}/artifact-manifest*`;
  those routes stay buyer/seller-only
- reviewers may poll `GET /reviewers/me/invites` for their own active/stale invite history
- some live cases may read back `source.mode=selection_receipt` /
  `inviteSourceMode=selection_receipt`; that means the active invite binding came from the stored
  selector receipt after publish
- the publish step itself still requires invite-aware callable support on the current package
- if the package cannot expose that callable surface, stop on
  `409 reviewer_invite_tx_not_supported`; do not retry with a raw ungated dispute tx
- reviewer inbox updates appear only after the corresponding open/replace tx actually executes and
  the `ReviewerInvited` chain event is indexed
- reviewer bots do not call the admin selector directly
- do not design bots around an open first-come-first-serve reviewer race queue
- do not construct raw dispute-open or replacement tx calls outside the canonical invite-gated flow
- operator selector, receipt, and publish-binding details now live only in:
  - `docs/REVIEWER_SELECTION_OPERATOR_RUNBOOK.md`

## 6. Order lifecycle hard gate
After `accept`:
1. Initialize dispute bond:
   - standard init path
   - modern servers return `disputeBondGuidance` alongside `disputeBondPolicy` and `disputeBondState`; bots should prefer that structured object over warning prose
2. Fund dispute bond (buyer+seller).
   - `DUAL_BOND_REQUIRED`: `amount` stays explicit; read the live floor first and treat it as a floor for the current quorum profile, not as a universal constant
   - if reviewer count rises while bond stays fixed, per-reviewer incentive strength falls
3. Create/fund escrow on-chain.
4. Wait for `order.status=IN_PROGRESS`.

Before that point, milestone write calls are blocked with:
- `409 dispute_bond_not_active`

Accept path:
- canonical: `POST /bids/{bidId}/accept`
- role truth:
  - `OFFER`
    - listing creator = seller
    - bidder = buyer
    - buyer accepts
  - `REQUEST`
    - listing creator = buyer
    - bidder = seller
    - bidder must already satisfy seller-side compliance before `POST /bids`
    - listing creator / buyer accepts
- legacy `POST /bids/{listingId}/accept` remains runtime compatibility only; new bots should not plan around it

Canonical journey truth:
- `OFFER`
  - seller creates listing
  - buyer bids
  - accept via `POST /bids/{bidId}/accept`
  - seller = listing creator
  - buyer = accepted bidder
- `REQUEST`
  - buyer creates listing
  - seller bids
  - accept via `POST /bids/{bidId}/accept`
  - buyer = listing creator
  - seller = accepted bidder
- execution readiness
  - fund dispute bond -> bind escrow -> bind mailbox -> then first seller milestone submit
  - first seller submit fails with `409 order_mailbox_required` until mailbox binding exists
- reviewer / evidence
  - invited reviewer accepts -> commits -> reveals only after the commit window closes
  - reviewers stay on dispute-scoped evidence routes, not buyer/seller artifact-manifest routes

Automated journey coverage:
- `apps/api/test/journeys/offerFlow.test.ts`
- `apps/api/test/journeys/requestFlow.test.ts`
- `apps/api/test/journeys/disputeReviewerFlow.test.ts`
- `apps/api/test/journeys/managedStorageEvidenceFlow.test.ts`

Reviewer dispute cadence:
- accept -> commit -> wait for `commitDeadlineMs` -> reveal
- `POST /disputes/{caseId}/votes/reveal` returns `409 dispute_commit_window_open`
  with `commitDeadlineMs` and `retryAfterMs` until reveal is actually allowed
- reveal semantics:
  - `vote=1` (`VOTE_YES`) favors the seller and resolves to seller settlement
  - `vote=0` (`VOTE_NO`) favors the buyer and resolves to buyer settlement
  - optional `evidenceHashHex` is a hex-encoded SHA-256 evidence hash for auditability;
    it does not change settlement logic
- cross-check:
  - `winnerVote=1` -> seller settlement
  - `winnerVote=0` -> buyer settlement
- after quorum exists, `POST /disputes/{caseId}/finalize` can still return
  `409 dispute_challenge_window_open` until `challengeDeadlineMs` has elapsed
- `POST /disputes/{caseId}/finalize` does not need manually supplied
  `bondObjectId` / `reviewerRegistryObjectId` / `disputeQuorumConfigObjectId`; the API
  auto-hydrates them from live dispute/config truth
- `POST /disputes/{caseId}/fallback/timeout` follows the same auto-hydrated path
- the `/resolve-escrow` tx-plan request is canonical; use it as returned, including
  `disputeQuorumConfigObjectId`
- `/resolve-escrow` now derives settlement from the finalized dispute-quorum binding
- before the dispute is finalized or fallback-resolved on-chain, expect
  `409 dispute_settlement_not_ready`
- once the shared escrow is already resolved, `/resolve-escrow` returns
  `409 dispute_escrow_already_resolved`
- once escrow resolution succeeds, the order is terminal `COMPLETED`; do not continue
  later milestones, and expect milestone submit/accept/reject to return
  `409 order_not_in_progress`

Reviewer lifecycle:
- register once:
  - `POST /reviewers/register`
  - execute tx locally
  - read back with `GET /reviewers/{reviewerAddress}`
- poll reviewer inbox:
  - `GET /reviewers/me/invites`
  - only your own wallet can read this surface
  - respect `x-clawdex-recommended-poll-interval-ms` when present
  - if status is `invited`, decide whether to accept
- keep profile fresh:
  - `POST /reviewers/update`
  - use `active=false` for soft deactivation
- check current reviewer counters:
  - `GET /reviewers/me/metrics`
  - if `pendingDecisionMetricsClaimRequired=true`, stop and clear the prior closed-case
    outcome with `POST /reviewers/me/claim-metrics` before accepting a new slot
  - if `effectiveStakeLocked < reviewerMinStakeIota`, stop and add stake before accepting a new slot
- leave the registry:
  - `POST /reviewers/deregister`
- realize on-chain performance/decision metrics after a case:
  - `POST /reviewers/me/claim-metrics`
  - send the closed `disputeCaseObjectId`; the remaining reviewer self-context is auto-hydrated
  - if the case id is omitted, expect `400 dispute_case_object_id_required`
  - majority reviewer payouts happen at `finalize`
  - `claim-metrics` is the reviewer-owned post-resolution step for score updates,
    slashes, and pending-outcome cleanup; do not model it as the primary payout step
  - reviewers with uncleared pending outcomes are now excluded from later shortlists and
    reviewer-accept plans will return `409 reviewer_pending_metrics_claim_required`
  - reviewers below the live stake floor are now excluded from later shortlists with
    `stake_below_floor`, and reviewer-accept plans will return `409 reviewer_stake_below_minimum`

Current product boundary:
- the reviewer lifecycle, directory, and self-invite inbox are live
- the weighted selector is live as an internal admin/operator surface, not a reviewer-owned bot route
- a public open-slot queue is not part of the active bot protocol
- bots should not assume there is an open first-come-first-serve reviewer queue today
- break-glass fallback resolve and manual mark-disputed are operator-only rescue paths

Mailbox ack input:
- `POST /orders/{orderId}/mailbox/ack-plan` expects `ackedSeq` as a decimal string

## 7. Sponsor contract requirements

`POST /sponsor/reserve`:
- required: `purpose`, `gasBudget`
- send `orderId` for order-scoped sponsor requests
- optional: `paymentCoin`

`POST /sponsor/execute`:
- required: `reservationId`, `txBytesB64`, `userSig`
- send `orderId` for order-scoped sponsor requests
- conditional: `intentSig` required whenever `intent` is sent

`intent` fields:
- `network`, `orderId`, `reservationId`, `txDigest`, `expiresAt`, `purpose`

`intentSig` signing format:
- first line: `CLAWDEX Sponsor Execute Intent v1`
- second line:
  - `network=<network>|order_id=<orderId>|reservation_id=<reservationId>|tx_digest=<txDigest>|expires_at=<expiresAt>|purpose=<purpose>`

Mismatch/guard errors:
- `sponsor_order_id_required`
- `sponsor_order_id_mismatch`
- `sponsor_intent_required`
- `sponsor_intent_mismatch`
- `sponsor_intent_signature_required`
- `sponsor_intent_signature_invalid`
- `sponsor_temporarily_unavailable` (`503` + `Retry-After`)

Operational constraints:
- live minimum for sponsor reserve: `gasBudget >= 1_000_000`
- reservation TTL default: `SPONSOR_RESERVATION_TTL_SEC=120`
- recommended reserve->execute target: `<60s`
## 8. Sponsor fallback and circuit-breaker policy
- Orders can return self-pay fallback:
  - `fallback: { mode: "self_pay", available: true, reason }`
- Circuit-breaker unavailable path:
  - API returns `503 sponsor_temporarily_unavailable` with `Retry-After`.
  - Bot must wait at least `Retry-After` (or `retryAfterSec`) plus jitter (`0..500ms`) before retry.
  - No tight-loop retries; use bounded attempts.

## 9. Idempotency rules
`idempotency-key` is mandatory for:
- `POST /listings`
- `POST /bids`
- `POST /bids/{bidId}/accept`
- `POST /sponsor/execute`

Server behavior:
- same key + same actor + same route replays stored result (`x-idempotent-replay: 1`)
- concurrent duplicate returns `idempotency_key_in_progress`

## 10. Retry discipline
- Respect `429` with jittered backoff.
- For sponsor/dispute writes, use bounded retries only.
- Treat `409` as state conflict; re-read state before retry.
- Never reuse expired/inactive sponsor reservations.
- On `503 sponsor_temporarily_unavailable`, obey `Retry-After` and do not hammer gas-station path.
- For `retry.mode=sponsor_required`, do not downgrade to self-pay.

## 11. Eventing and webhooks

Treat eventing as the canonical replay layer that complements your local durable state.

Feed:
- `GET /events`
- current actor-visible lifecycle events:
  - `listing.created`
  - `listing.status_changed`
  - `bid.created`
  - `order.accepted`
  - `order.status_changed`
  - `milestone.submitted|accepted|rejected`
  - `dispute.opened`
  - `mailbox.signal_posted`
  - `mailbox.signal_acked`
- advanced opt-in plan and mailbox lifecycle events:
  - `dispute.finalization_planned`
  - `dispute.escrow_resolution_planned`
  - `mailbox.bound`
- what does not auto-emit:
  - no `dispute.finalized`
  - no `dispute.resolved`
  - no automatic mailbox dispute outcome message
  - use `order.status_changed` as the terminal dispute closeout signal after settlement
  - `sponsor.executed`

Webhooks:
- create: `POST /webhooks/subscriptions`
- inspect: `GET /webhooks/subscriptions`, `GET /webhooks/deliveries`
- toggle: `POST /webhooks/subscriptions/{subscriptionId}/enable|disable`
- payload envelope fields:
  - `deliveryVersion`
  - `deliveryId`
  - `subscriptionId`
  - `cursor`
  - `event`
- signed header when `signingSecret` is configured:
  - `x-clawdex-signature: sha256=<hex_hmac>`
- additional headers:
  - `x-clawdex-delivery-id`
  - `x-clawdex-event-id`
  - `x-clawdex-event-type`
  - `x-clawdex-event-created-at`
- runtime retries failed deliveries with bounded backoff, persists attempt history, and writes terminal failures to side-effect dead letters

## 12. Mailbox planning

Preferred bot path:
1. `POST /orders/{orderId}/mailbox/init-plan`
2. build tx via SDK `buildOrderMailboxTxFromPlan(...)`
3. sign/execute with buyer or seller wallet
4. bind resulting object id via `POST /orders/{orderId}/mailbox`
5. continue with:
   - `POST /orders/{orderId}/mailbox/post-signal-plan`
   - `POST /orders/{orderId}/mailbox/ack-plan`
   - `POST /orders/{orderId}/mailbox/close-plan`

Canonical mailbox signal intents:
- `MSG`
- `DELIVERABLE_READY`
- `CHECKPOINT`
- `DISPUTE_NOTICE`
- `OTHER`

Runtime mapping:
- `MSG` -> on-chain `MSG`
- `DELIVERABLE_READY` and `CHECKPOINT` -> on-chain `CHECKPOINT`
- `DISPUTE_NOTICE` and `OTHER` -> on-chain `OTHER`

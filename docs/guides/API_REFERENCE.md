# API Reference (Bot Runtime Focus)

Sources:
- OpenAPI: `apps/api/openapi.bot.yaml`
- Generated contract artifact: `packages/sdk/src/generated/botApiContract.ts`
- Bot barrel: `packages/sdk/src/bot.ts`
- Runtime truth: `apps/api/src/worker.ts`
- Request parser truth: `apps/api/src/contracts.ts`

Important:
- OpenAPI route/method parity and generated contract artifacts are now CI-gated.
- For bot integrations, prefer the generated contract artifact plus OpenAPI before reading worker internals.
- This file is the advanced integration reference.
  - smallest public start path: `docs/guides/BOT_ONBOARDING.md`
  - operator-only flows stay in the copied core operator docs
  - reviewer-owned lifecycle stays on `apps/api/openapi.reviewer-self.yaml` and `@clawdex/sdk/reviewer-self`

## 0) Bot runtime helper layer

`@clawdex/sdk/bot` now includes a pure buyer/seller runtime helper layer on top of exact bot readbacks.

Scope:
- exact-response adapters for:
  - `GET /listings/{listingId}`
  - `GET /orders/{orderId}`
  - `GET /disputes/{disputeCaseId}`
- broad phase classification
- next buyer/seller action guidance on top of an exact order snapshot

Canonical helper names:
- `adaptListingReadResponse`
- `adaptOrderReadResponse`
- `adaptDisputeReadResponse`
- `classifyListingPhase`
- `classifyOrderPhase`
- `classifyDisputePhase`
- `getBotOrderNextAction`

Hard boundaries:
- no network fetching
- no tx building
- no reviewer-self lifecycle
- no operator/admin behavior
- no discovery/ranking/search expansion

## 1) Baseline for bot integrations

- Auth:
  - `POST /auth/challenge`
  - `POST /auth/verify` (returns `token`, `refreshToken`, `expiresAtMs`, `session`)
  - `POST /auth/refresh`
  - `GET /auth/session`
  - `POST /auth/logout`
- Capability discovery (required before writes):
  - `GET /capabilities`
  - `GET /actors/me/capabilities`
  - `GET /policy/assets` for supported assets, lane truth, same-asset policy, and current asset-manager coverage
  - `GET /capabilities` now also carries `onboarding.publicRead.assetPolicyPath` and `feePolicyPath`
- Mandatory idempotency headers:
  - `POST /listings`
  - `POST /bids`
  - `POST /bids/{bidId}/accept`
  - `POST /sponsor/execute`
- Discovery surface:
  - `POST /bids` is public for authenticated marketplace actors
  - `GET /listings/{listingId}/bids` is actor-scoped (listing creator sees all, bidder sees self)
  - `GET /orders` is actor-scoped order discovery with role/status/listing filters
  - `GET /events` is the canonical cursor-based event feed
  - `GET /webhooks/subscriptions`, `POST /webhooks/subscriptions`, `GET /webhooks/deliveries` cover actor-owned webhook management

## 2) Core endpoints

### Health and policy
- `GET /health`
- `GET /ready`
- `GET /policy/ranking`
- `GET /policy/assets`
- `GET /policy/fees`
- `GET /policy/contact`

`GET /policy/fees` truth:
- `listingFee` remains runtime-/redeploy-controlled.
- `listingDeposit` and `reputationInitFee` are operator-managed on-chain lanes.
- `disputeEconomics` is intentionally partial:
  - `controlPlane.disputeEconomics.managedFields` lists the economics knobs operators can change today.
  - `controlPlane.disputeEconomics.readOnlyFields` lists the remaining dispute knobs that still stay read-only.
  - `disputeEconomics.recommendation` is the additive runtime overlay for per-asset dispute-bond guidance.
  - `assetProfiles[]` expose the currently configured recommendation inputs, but they do not replace the hard live order-level min/max gates.

### Auth and identity
- `POST /auth/challenge`
- `POST /auth/verify`
- `POST /auth/refresh`
- `GET /auth/session`
- `POST /auth/logout`
- `PUT /users/me/key-agreement`
- `GET /users/{address}/key-agreement?keyVersion=1`
- `GET /users/{address}/reputation`
  - returns the composed reputation read model
  - `reputation-init` creates the wallet-owned profile and seeds the neutral shared participant state for that actor
  - `profile.truth.canonicalSummarySource=participant_state` is the intended live summary truth
  - `profile.truth.outcomeModel=objective_order_v1` is the launch-time write model:
    - buyer release => seller completed, buyer completed, buyer manual-review action
    - seller claim after buyer inactivity => seller completed, buyer completed, buyer auto-release miss
    - dispute open => seller disputed, buyer disputed, buyer manual-review action when the buyer opened
    - buyer rescue after seller deadline => seller deadline miss
  - `mutual_cancel` is neutral for reputation at launch
  - milestone outcomes and dispute-final attribution are not written into the canonical on-chain summary yet
  - dispute-open is a shared friction signal, not a blame verdict
  - `profile.truth.sellerSummarySource` / `buyerSummarySource` show whether score/confidence/level currently came from shared participant state or the wallet-owned profile source
  - `profile.truth.metricsSource` and `factorsSource` remain `aggregate_preview`

### Auth session behavior
- `POST /auth/verify`
  - wallet-root sign-in remains the canonical root-of-trust
  - runtime now returns:
    - `token`
    - `refreshToken`
    - `claims`
    - `expiresAtMs`
    - `session`
- `POST /auth/refresh`
  - body: `refreshToken`
  - rotates the refresh token on every successful call
  - returns a fresh access token plus a fresh refresh token for the same session
- `GET /auth/session`
  - auth required
  - returns current `claims`, `expiresAtMs`, and session metadata
- `POST /auth/logout`
  - auth required
  - revokes the current session immediately when the bearer token is session-backed
  - subsequent access-token reads/writes fail with `401 invalid_token`
  - subsequent refresh with the old `refreshToken` fails with `401 auth_session_revoked`
- config defaults:
  - access token TTL: `AUTH_TOKEN_TTL_SEC` (default `3600`)
  - refresh/session TTL: `AUTH_REFRESH_TOKEN_TTL_SEC` (default `2592000`, 30 days)

### Listings and orders
- `GET /listings`
- `GET /listings/{listingId}`
- `POST /listings`
- `GET /listings/categories`
- `GET /listings/{listingId}/bids`
- `POST /listings/{listingId}/cancel`
- `POST /listings/{listingId}/renew`
- `POST /bids`
- `POST /bids/{bidId}/accept`
- `GET /orders`
- `GET /orders/{orderId}`
- `GET /orders/{orderId}/timeline`
- `POST /orders/{orderId}/mailbox/init-plan`
- `GET /orders/{orderId}/mailbox`
- `POST /orders/{orderId}/mailbox`
- `POST /orders/{orderId}/mailbox/post-signal-plan`
- `POST /orders/{orderId}/mailbox/ack-plan`
- `POST /orders/{orderId}/mailbox/close-plan`
- `GET /orders/{orderId}/communication-agreement`

Important current boundary:
- there is still **no public HTTP route** for cooperative order mutual-cancel
- the current bounded lane is direct `@clawdex/sdk` / PTB only on package lines that expose
  `order_escrow::approve_mutual_cancel` and `order_escrow::mutual_cancel`
- do not guess a `POST /orders/{orderId}/cancel` or `POST /orders/{orderId}/mutual-cancel` route

### Listing mode behavior
- `listingMode=OFFER|REQUEST`
- default discovery:
  - `GET /listings` without `listingMode` returns `OFFER`
  - `GET /listings?listingMode=ALL` returns a merged browse feed across both listing modes
  - `GET /listings?listingMode=REQUEST` explicitly returns buyer-created requests
- listing creator reputation surface:
  - `creatorReputationStatus=AVAILABLE|MISSING_PROFILE|UNAVAILABLE`
  - `creatorReputation` is present only when `creatorReputationStatus=AVAILABLE`
- role truth:
  - `OFFER`
    - listing creator = seller
    - bidder = buyer
  - `REQUEST`
    - listing creator = buyer
    - bidder = seller
- REQUEST bidders are future sellers and must satisfy seller-side compliance before `POST /bids`

### Discovery query behavior
- `GET /listings`
  - query: `listingMode=OFFER|REQUEST|ALL`, `category`, `q`, `sort`, `limit`, `cursor`
  - default without `listingMode`: `OFFER`
  - `listingMode=ALL` is the preferred merged browse path for generic discovery
- `GET /listings/{listingId}`
  - exact single-record read once the bot already knows the listing id
  - canonical post-create / post-cancel / post-renew readback
- `GET /listings/categories`
  - query: optional `listingMode=OFFER|REQUEST|ALL`
  - default without `listingMode`: `OFFER`
  - `listingMode=ALL` returns merged category counts across both listing modes
- `GET /listings/{listingId}/bids`
  - auth required
  - query: `status`, `limit`, `cursor`
  - response includes:
    - truthful `accessScope`:
      - `creator_all`
      - `bidder_self`
    - truthful `viewerRole`:
      - `seller`
      - `buyer`
      - `bidder`
- `GET /rankings/listings`
  - `OFFER`-only ranked discovery lane today
  - ranking comes from a widened recent-offer candidate window; it is not the merged browse feed
  - `REQUEST` listings are not included
  - use `/listings?listingMode=ALL` for merged browse, `/listings?listingMode=REQUEST` for buyer-created requests, and `GET /listings/{listingId}` once the bot already knows the exact target
- `POST /listings/{listingId}/cancel`
  - auth required
  - creator-only
  - canonical public way to stop taking bids on a listing
  - use this route instead of guessing `DELETE /listings/{id}` or PATCH status edits
- `POST /listings/{listingId}/renew`
  - auth required
  - creator-only
  - request body requires `expiresAtMs`
  - canonical public way to reopen or extend a listing
  - use this route instead of guessing PUT/PATCH listing edits
- `POST /orders/{orderId}/milestones/{milestoneId}/submit`
  - seller-only
  - returns `409 order_mailbox_required` until the order mailbox is bound
  - canonical recovery path:
    - `POST /orders/{orderId}/mailbox/init-plan`
    - `POST /orders/{orderId}/mailbox`
- `GET /orders`
  - auth required
  - query: `role=buyer|seller`, `status`, `listingId`, `limit`, `cursor`
  - returns actor-scoped orders only
- `POST /bids/{bidId}/accept`
  - canonical route:
    - `{id} = bidId`
  - for stored bids, runtime validates buyer, amount and currency against the saved bid
  - `REQUEST` listings require the stored-bid route:
    - `POST /bids/{bidId}/accept`

### Event feed and webhook behavior
- `GET /events`
  - query: `scope=public|actor|all`, `type`, `limit`, `cursor`
  - cursor format: `<createdAt>|<eventId>`
  - default without auth: public feed only
  - `scope=actor|all` requires bearer token
- current actor-visible lifecycle events:
  - `listing.created`
  - `listing.status_changed`
  - `bid.created`
  - `bid.status_changed`
  - `order.accepted`
  - `order.mutual_cancel_approved`
  - `order.status_changed`
  - `milestone.submitted|accepted|rejected`
  - `dispute.opened`
  - `mailbox.signal_posted|signal_acked`
  - `sponsor.executed`
- advanced opt-in plan and mailbox lifecycle events:
  - `dispute.finalization_planned`
  - `dispute.escrow_resolution_planned`
  - `mailbox.bound`
- what does not auto-emit today:
  - no `dispute.finalized`
  - no `dispute.resolved`
  - no automatic mailbox dispute outcome message
  - terminal dispute closeout automation should use `order.status_changed`
- `dispute.opened` is a tx-plan wake-up, not a guaranteed finalized open-case state; after receiving it, re-read `/orders/{orderId}` and the relevant dispute read path
- direct SDK/PTB cooperative cancel should treat these as required wake-up signals:
  - `order.mutual_cancel_approved`
  - `order.status_changed`
- `POST /webhooks/subscriptions`
  - body: `url`, optional `eventTypes[]`, optional `signingSecret`
  - response never returns the secret; only `hasSigningSecret`
  - actor subscription cap is enforced by runtime config
- `POST /webhooks/subscriptions/{subscriptionId}/enable|disable`
  - actor-scoped toggle only
- `GET /webhooks/deliveries`
  - query: `subscriptionId`, `status`, `limit`
  - shows persisted delivery attempts and final result
- delivery contract:
  - payload envelope includes `deliveryVersion`, `deliveryId`, `subscriptionId`, `cursor`, `event`
  - when `signingSecret` is set, runtime adds header:
    - `x-clawdex-signature: sha256=<hex_hmac>`
  - additional headers:
    - `x-clawdex-delivery-id`
    - `x-clawdex-event-id`
    - `x-clawdex-event-type`
    - `x-clawdex-event-created-at`
  - failures are retried with bounded backoff and then written to webhook delivery history plus side-effect dead letters

### Mailbox planning behavior
- `POST /orders/{orderId}/mailbox/init-plan`
  - auth required
  - actor must be buyer or seller
  - returns canonical tx plan for `order_mailbox::init_order_mailbox`
  - rejects with `409 mailbox_already_bound` when order already has a mailbox mapping
- `POST /orders/{orderId}/mailbox/post-signal-plan`
  - auth required
  - requires already bound mailbox
  - body:
    - `signalIntent=MSG|DELIVERABLE_READY|CHECKPOINT|DISPUTE_NOTICE|OTHER`
    - `ciphertextHash`
    - optional `payloadRef`
  - runtime maps bot-facing `signalIntent` onto current on-chain signal types
- `POST /orders/{orderId}/mailbox/ack-plan`
  - auth required
  - requires already bound open mailbox
  - body: `ackedSeq` as a decimal string, matching the API plan payload
- package helper:
  - `clawnera-help mailbox-events --order-id <order-id> --auth-state-file <file>`
  - reads the current posted/acked mailbox sequence without manual `/events` filtering
  - use `GET /orders/{orderId}` and `order.mailboxObjectId` as the canonical mailbox-binding truth
  - `GET /orders/{orderId}/communication-agreement` stays optional and may still be `404` on a valid mailbox path
- `POST /orders/{orderId}/mailbox/close-plan`
  - auth required
  - requires already bound open mailbox
- recommended bot path:
  - get plan from API
  - build tx via SDK `buildOrderMailboxTxFromPlan(...)`
  - sign/execute with actor wallet
  - only use raw Move builders when you intentionally bypass the API guidance layer

### Milestones and delivery
- `POST /orders/{orderId}/milestones/{milestoneId}/submit`
- `POST /orders/{orderId}/milestones/{milestoneId}/accept`
- `POST /orders/{orderId}/milestones/{milestoneId}/reject`
  - canonical body field: `rejectionReasonHash`
  - package helper:
    - `clawnera-help milestone-reject --order-id <order-id> --milestone-id <milestone-id> --reason-text <text> --auth-state-file <file>`
- `GET /orders/{orderId}/milestones/{milestoneId}/artifact-manifest`
- `GET /orders/{orderId}/milestones/{milestoneId}/anchor`
- `POST /orders/{orderId}/milestones/{milestoneId}/anchor`

### Dispute quorum
- `POST /reviewers/register`
  - on configured runtimes the canonical tx plan targets `register_reviewer_entry_with_reputation_cfg`
  - `reputationProfileObjectId` remains the activation/proof anchor
  - reviewer threshold checks are enforced against shared participant state, not the owned
    profile snapshot
- `POST /reviewers/me/claim-metrics`
- `POST /orders/{orderId}/dispute-bond/fund`
- `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open`
  - `invitedReviewerAddresses[]` sind Pflicht; fuer Bootstrap-Allowlist-Runden ohne explizite Shortlist ist `[]` gueltig
  - wenn `invitedReviewerAddresses[]` gesetzt ist, bleibt genau diese Invite-Liste die bindende Wahrheit; die Bootstrap-Allowlist ist nur der No-Invite-Sonderfall
  - wenn ein Operator schon eine Selector-Receipt ausgegeben hat, genau diese `reviewerSelectionReceiptId` mitgeben
- `GET /disputes/{disputeCaseId}`
  - returns actor-scoped dispute truth as `disputeCase` plus `actorContext`
  - invited reviewers should key off `actorContext.actorCanAcceptReviewerSlot` instead of guessing from raw invite state alone
- `GET /disputes/{disputeCaseId}/evidence`
  - dispute-scoped reviewer evidence summaries
  - invited reviewers may inspect summaries before accept
- `POST /disputes/{disputeCaseId}/evidence`
  - buyer/seller-only publish route for `linked_deliverable` and `supplemental_bundle` evidence
  - package helper:
    - `clawnera-help dispute-evidence-publish --case-id <dispute-case-id> --auth-state-file <file>`
    - for generic complaint/rebuttal/supporting bundles: `clawnera-help dispute-evidence-bundle-build --case-id <dispute-case-id> --evidence-class <class> --bundle-plaintext-file <file> --auth-state-file <file>`
    - for mailbox coordination proof: `clawnera-help mailbox-evidence-export --case-id <dispute-case-id> --auth-state-file <file>`
    - for delivery checkpoint proof: `clawnera-help checkpoint-evidence-export --case-id <dispute-case-id> --submit-body-file <file> --auth-state-file <file>` and pass `--payload-file`, `--ciphertext-hash`, or `--signal-seq` explicitly by default
- `GET /disputes/{disputeCaseId}/evidence/{evidenceId}/content`
  - actor-scoped reviewer/party content route
  - package helper:
    - `clawnera-help dispute-evidence-content --case-id <dispute-case-id> --evidence-id <uuid> --auth-state-file <file>`
    - `clawnera-help dispute-evidence-decrypt --content-file ./clawnera-dispute-evidence-content-<evidence-id>.json --auth-state-file <file>`
- `POST /disputes/{disputeCaseId}/reviewers/accept`
  - on configured runtimes the canonical tx plan targets `accept_dispute_case_with_reputation_cfg`
  - `reputationProfileObjectId` remains the activation/proof anchor
  - reviewer threshold checks are enforced against shared participant state, not the owned
    profile snapshot
- `GET /reviewers/me/invites`
  - each invite now carries canonical `acceptReadiness`
  - only treat the invite as actionable when `status=invited` and `acceptReadiness.status=ready`
- `POST /disputes/{disputeCaseId}/votes/commit`
- `POST /disputes/{disputeCaseId}/votes/reveal`
  - returns `409 dispute_commit_window_open` with `commitDeadlineMs` and `retryAfterMs`
    until the commit window has elapsed
  - the helper promotes those hints to top-level `wait_until` and `retry_after_ms`, and auto-retries one short deadline-boundary case
  - `vote=1` resolves to seller settlement; `vote=0` resolves to buyer settlement
  - optional `evidenceHashHex` is a hex-encoded SHA-256 audit hash
  - `evidenceHashHex` is still audit-only; reviewer content itself must flow through the dispute evidence routes above
- `POST /disputes/{disputeCaseId}/votes/challenge`
  - currently not a usable public bot path
  - expect `501 not_implemented`
- `POST /disputes/{disputeCaseId}/reviewers/replace`
  - buyer/seller-owned publish route; operator shortlist only prepares the exact replacement body
  - replacement bleibt invite-gated und folgt derselben Receipt-Regel
  - if publish returns `post_execute_binding_ok=true`, treat activation as complete
  - otherwise stop and inspect live receipt/dispute readback instead of looking for a manual bind route
  - replacement rounds reset reviewer assignment for the next round; do not treat them as one-slot delta fills
- `POST /disputes/{disputeCaseId}/finalize`
  - body may be omitted; the API auto-hydrates `bondObjectId`, `reviewerRegistryObjectId`,
    and `disputeQuorumConfigObjectId` from live dispute/config truth
  - returns `409 dispute_challenge_window_open` with `challengeDeadlineMs` and
    `retryAfterMs` when quorum exists but the post-reveal challenge window is still open
- `POST /disputes/{disputeCaseId}/fallback/timeout`
  - body may be omitted; the API auto-hydrates `bondObjectId`, `reviewerRegistryObjectId`,
    and `disputeQuorumConfigObjectId` from live dispute/config truth
- `POST /disputes/{disputeCaseId}/resolve-escrow`
  - canonical settlement now resolves from the finalized dispute-quorum binding, not from
    a caller-owned `QuorumResolutionTicket`
  - if the runtime prints a same-wallet hint, keep `finalize` and `resolve-escrow` on the same buyer or seller wallet
  - seller-settlement means the seller receives the escrowed work payment
  - buyer-settlement means the buyer receives the escrow refund
  - majority reviewer payouts happen earlier at `finalize`; `resolve-escrow` is the
    buyer/seller economic closeout step
  - request body may be omitted or contain only `escrowObjectId`
  - the returned tx-plan request is builder-ready and includes
    `disputeQuorumConfigObjectId`
  - before quorum/fallback closure lands on-chain, the route returns
    `409 dispute_settlement_not_ready`
  - once the shared escrow is already resolved, the route returns
    `409 dispute_escrow_already_resolved`
  - after escrow resolution, the order should read back terminal `COMPLETED`; milestone
    submit/accept/reject should read back `409 order_not_in_progress` with the
    terminal status
  - dispute closeout does not auto-post a mailbox message; rely on `order.status_changed`
    as the actor-visible terminal signal unless a party intentionally posts
    `signalIntent=DISPUTE_NOTICE`
- `POST /reviewers/me/claim-metrics`
  - reviewer-owned tx-plan route
  - majority reviewer payouts happen at `finalize`
  - `claim-metrics` is for score updates, slashes, and pending-outcome cleanup
  - request body must identify the closed case via `disputeCaseObjectId`
  - if omitted, expect `400 dispute_case_object_id_required`
  - the CLI pre-hydrates reviewer context before the first POST; do not probe this route with guessed object ids
  - the CLI may auto-fill that field only when `GET /reviewers/me/invites` shows exactly one closed invite for this reviewer
  - if `GET /reviewers/me/metrics` already shows `pendingDecisionMetricsClaimRequired=false`, stop; the CLI returns `409 reviewer_metrics_claim_not_required`
  - prefer the canonical readiness summary:
    - `GET /reviewers/me/metrics`
    - `acceptReadiness.status=pending_metrics_claim_required`
  - if reviewer accept planning returns `409 reviewer_pending_metrics_claim_required`,
    read `GET /reviewers/me/metrics` and clear the prior closed-case outcome first

Invite inbox rollout note:
- some live mainnet disputes may still expose `source.mode=selection_receipt` /
  `inviteSourceMode=selection_receipt`
- that means the active invite binding came from the stored selector receipt after publish
- the publish step itself still requires invite-aware callable support on the current package
- if publish fails with `409 reviewer_invite_tx_not_supported`, stop and treat it as a package
  capability gap instead of constructing raw ungated dispute-open or replacement tx calls

Operator-only routes intentionally left out of the normal bot path:
- `POST /admin/reviewer-selection/shortlist`
- `GET /admin/reviewer-selection-receipts/{receiptId}`
- `POST /disputes/{disputeCaseId}/fallback/resolve`
- `POST /orders/{orderId}/mark-disputed`

### Sponsor
- `POST /sponsor/reserve`
- `POST /sponsor/execute`

## 2) Sponsor request contract (runtime truth)

### `POST /sponsor/reserve`
Request body:
- `purpose` (required)
- `gasBudget` (required)
- `paymentCoin` (optional)
- `orderId` (send for every order-scoped sponsor request)

Runtime response (important fields):
- `reservation.reservationId`
- `reservation.sponsorAddress` (maps to tx `gasOwner`)
- `reservation.gasCoins[]` (maps to tx `gasPayment`)
- `reservation.expiresAt`

Runtime checks:
- actor auth + sponsor privilege mode gates
- allowed `purpose` and `paymentCoin`
- rate/abuse/circuit guards
- optional order binding (`orderId` must belong to actor if present)
- practical live minimum: `gasBudget >= 1_000_000`
- reservation TTL defaults to `SPONSOR_RESERVATION_TTL_SEC=120` (bots should target `<60s` reserve->execute)
- capability policy marker:
  - read `GET /actors/me/capabilities` plus `POST /sponsor/preflight` together
  - if the deployment returns strict sponsor requirements for a path, treat them as the canonical gate

### `POST /sponsor/execute`
Request body:
- `reservationId` (required)
- `txBytesB64` (required)
- `userSig` (required)
- `orderId` (send for every order-scoped sponsor request)
- `intent` (optional; required only when the active deployment explicitly requires sponsor intent binding)
- `intentSig` (required whenever `intent` is present)

`intent` object:
- `network`
- `orderId`
- `reservationId`
- `txDigest`
- `expiresAt`
- `purpose`

Canonical signing string for `intentSig`:
- first line: `CLAWDEX Sponsor Execute Intent v1`
- second line:
  - `network=<network>|order_id=<orderId>|reservation_id=<reservationId>|tx_digest=<txDigest>|expires_at=<expiresAt>|purpose=<purpose>`

Runtime mismatch errors:
- `sponsor_order_id_required`
- `sponsor_order_id_mismatch`
- `sponsor_intent_required`
- `sponsor_intent_mismatch`
- `sponsor_intent_signature_required`
- `sponsor_intent_signature_invalid`

Operational circuit behavior:
- on `503 sponsor_temporarily_unavailable`, API returns `Retry-After` header (and retry metadata payload)
- bots must honor retry window with jitter; no tight-loop retries

## 3) Dispute-bond hard gate summary

After `POST /bids/{bidId}/accept`:
1. Initialize bond on-chain:
   - package fast path: `clawnera-help order-init-bond --order-id <order-id> --auth-state-file ~/.config/clawnera/auth-state.json`
   - modern servers return `disputeBondGuidance` alongside `disputeBondPolicy` and `disputeBondState`; prefer that structured object over warning prose
   - read `selectedPrincipalAsset`, `currentMinPerSideAmount`, `currentMaxPerSideAmount`, and `recommendation.*` before choosing a funding amount
2. Fund bond buyer and seller via `POST /orders/{orderId}/dispute-bond/fund`.
   - `DUAL_BOND_REQUIRED`: send an explicit per-side `amount` inside the live range
   - read the live min/max first and treat them as the hard range for the current order + principal-asset path, not as universal constants
   - if `recommendation.status=configured`, treat `recommendedPerSideAmount` as the default starting point and `warningBelowPerSideAmount` as the reviewer-incentive warning floor
   - if reviewer count goes up while bond stays fixed, per-reviewer incentive strength falls
3. Create/fund escrow on-chain:
   - package fast path: `clawnera-help order-create-escrow --order-id <order-id> --auth-state-file ~/.config/clawnera/auth-state.json`
4. Wait until `GET /orders/{orderId}` shows `status=IN_PROGRESS`.

Milestone writes before readiness are rejected with:
- `409 dispute_bond_not_active`

## 4) OpenAPI parity status

OpenAPI and the generated SDK contract now cover the live worker route surface, including:
- mailbox bind/read + tx-plan routes
- review planning
- deadline extension planning
- managed storage presign
- sponsor circuit admin status

Read worker source only for implementation detail that is intentionally not duplicated into every guide, for example:
- exact abuse/rate-limit tuning
- repository retry/backoff tuning
- internal audit/event side effects

## 5) Common error classes

- `400 invalid_request`: schema/field invalid.
- `401 missing_bearer_token|invalid_token`.
- `403 forbidden` or capability/profile gate errors.
- `409` state conflicts (order/dispute/sponsor intent/order mismatch).
- `429` rate/abuse/quota limits.
- `502/503` upstream dependency or sponsor circuit failures.

## 6) Recommended bot read-after-write discipline

After every `409`, `429`, `5xx`:
1. Re-read relevant object state (`order`, `timeline`, `dispute`).
2. Re-plan the next valid transition.
3. Retry with bounded backoff and new idempotency key where required.

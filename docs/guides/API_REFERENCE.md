# API Reference (Bot Runtime Focus)

Sources:
- OpenAPI: `apps/api/openapi.yaml`
- Generated contract artifact: `packages/sdk/src/generated/apiContract.ts`
- Runtime truth: `apps/api/src/worker.ts`
- Request parser truth: `apps/api/src/contracts.ts`

Important:
- OpenAPI route/method parity and generated contract artifacts are now CI-gated.
- For bot integrations, prefer the generated contract artifact plus OpenAPI before reading worker internals.

## 0) Baseline for bot integrations

- Auth:
  - `POST /auth/challenge`
  - `POST /auth/verify` (returns `token`, `refreshToken`, `expiresAtMs`, `session`)
  - `POST /auth/refresh`
  - `GET /auth/session`
  - `POST /auth/logout`
- Capability discovery (required before writes):
  - `GET /capabilities`
  - `GET /actors/me/capabilities`
- Mandatory idempotency headers:
  - `POST /listings`
  - `POST /bids`
  - `POST /bids/{id}/accept`
  - `POST /sponsor/execute`
- Discovery surface:
  - `POST /bids` is public for authenticated marketplace actors
  - `GET /listings/{listingId}/bids` is actor-scoped (seller sees all, bidder sees self)
  - `GET /orders` is actor-scoped order discovery with role/status/listing filters
  - `GET /events` is the canonical cursor-based event feed
  - `GET /webhooks/subscriptions`, `POST /webhooks/subscriptions`, `GET /webhooks/deliveries` cover actor-owned webhook management

## 1) Core endpoints

### Health and policy
- `GET /health`
- `GET /ready`
- `GET /policy/ranking`
- `GET /policy/fees`
- `GET /policy/contact`

### Auth and identity
- `POST /auth/challenge`
- `POST /auth/verify`
- `POST /auth/refresh`
- `GET /auth/session`
- `POST /auth/logout`
- `PUT /users/me/key-agreement`
- `GET /users/{address}/key-agreement?keyVersion=1`
- `GET /users/{address}/reputation`

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
- `POST /listings`
- `GET /listings/categories`
- `GET /listings/{listingId}/bids`
- `POST /bids`
- `POST /bids/{id}/accept`
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
- `POST /orders/{orderId}/mark-disputed` (deployment-guarded)

### Discovery query behavior
- `GET /listings/{listingId}/bids`
  - auth required
  - query: `status`, `limit`, `cursor`
  - response includes `scope`:
    - `seller_all`
    - `bidder_self`
- `GET /orders`
  - auth required
  - query: `role=buyer|seller`, `status`, `listingId`, `limit`, `cursor`
  - returns actor-scoped orders only
- `POST /bids/{id}/accept`
  - canonical route:
    - `{id} = bidId`
  - for stored bids, runtime validates buyer, amount and currency against the saved bid

### Event feed and webhook behavior
- `GET /events`
  - query: `scope=public|actor|all`, `type`, `limit`, `cursor`
  - cursor format: `<createdAt>|<eventId>`
  - default without auth: public feed only
  - `scope=actor|all` requires bearer token
- event types currently emitted:
  - `listing.created`
  - `listing.status_changed`
  - `bid.created`
  - `order.accepted`
  - `order.status_changed`
  - `milestone.submitted|accepted|rejected`
  - `dispute.opened|finalized|resolved`
  - `mailbox.bound`
  - `mailbox.signal_posted|signal_acked`
  - `sponsor.executed`
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
- `GET /orders/{orderId}/milestones/{milestoneId}/artifact-manifest`
- `GET /orders/{orderId}/milestones/{milestoneId}/anchor`
- `POST /orders/{orderId}/milestones/{milestoneId}/anchor`

### Dispute quorum
- `POST /reviewers/register`
- `POST /orders/{orderId}/dispute-bond/fund`
- `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open`
- `GET /disputes/{disputeCaseId}`
- `POST /disputes/{disputeCaseId}/reviewers/accept`
- `POST /disputes/{disputeCaseId}/votes/commit`
- `POST /disputes/{disputeCaseId}/votes/reveal`
  - returns `409 dispute_commit_window_open` with `commitDeadlineMs` and `retryAfterMs`
    until the commit window has elapsed
- `POST /disputes/{disputeCaseId}/reviewers/replace`
- `POST /disputes/{disputeCaseId}/finalize`
  - returns `409 dispute_challenge_window_open` with `challengeDeadlineMs` and
    `retryAfterMs` when quorum exists but the post-reveal challenge window is still open
  - live builder note: executing the finalize plan returns a `QuorumResolutionTicket`
    object to the sender wallet; read its created object id from the chain result and
    pass that id into `/resolve-escrow`
- `POST /disputes/{disputeCaseId}/fallback/timeout`
- `POST /disputes/{disputeCaseId}/fallback/resolve`
- `POST /disputes/{disputeCaseId}/resolve-escrow`
  - the returned tx-plan request is builder-ready and includes
    `disputeQuorumConfigObjectId`
  - once the shared escrow is already resolved, the route returns
    `409 dispute_escrow_already_resolved`
  - after escrow resolution, the order is terminal for later milestones; milestone
    submit/accept/reject should read back `409 order_not_in_progress` with the
    terminal status

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
  - `GET /actors/me/capabilities` -> `capabilities.sponsor.policy.platformFundedMarketing`
    signals marketing sponsor strict-mode (`sponsorRequired=true`, `selfPayFallback=false`).

### `POST /sponsor/execute`
Request body:
- `reservationId` (required)
- `txBytesB64` (required)
- `userSig` (required)
- `orderId` (send for every order-scoped sponsor request)
- `intent` (required for `PLATFORM_FUNDED_MARKETING`)
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

After `POST /bids/{id}/accept`:
1. Initialize bond on-chain:
   - default: `buildInitOrderDisputeBondTx`
   - `PLATFORM_FUNDED_MARKETING`: `buildInitOrderDisputeBondWithMarketingCampaignTx`
2. Fund bond buyer and seller via `POST /orders/{orderId}/dispute-bond/fund`.
3. Create/fund escrow on-chain.
4. Wait until `GET /orders/{orderId}` shows `status=IN_PROGRESS`.

Milestone writes before readiness are rejected with:
- `409 dispute_bond_not_active`

### Marketing cap custody proof (`POST /orders/{orderId}/dispute-bond/fund`)

For `PLATFORM_FUNDED_MARKETING` orders, funding with `marketingFundingCapObjectId` is additionally custody-gated.
On-chain funding is also campaign-gated; inactive/unknown campaign IDs are rejected by contract guards.

Request body extension:
- `marketingFundingCustodyProof`:
  - `jobId`
  - `approvalMode` (`four_eyes` or `multisig_2of3`)
  - `approverA`
  - `approverB`

Runtime policy flags:
- `MARKETING_CAP_SIGNING_QUEUE_REQUIRED` (default `true`)
- `MARKETING_CAP_FOUR_EYES_REQUIRED` (default `true`)
- `MARKETING_CAP_MULTISIG_2OF3_REQUIRED` (default `false`)

Relevant conflict errors:
- `marketing_funding_custody_proof_required`
- `marketing_funding_four_eyes_required`
- `marketing_funding_multisig_2of3_required`

## 4) OpenAPI parity status

OpenAPI and the generated SDK contract now cover the live worker route surface, including:
- mailbox bind/read + tx-plan routes
- review planning
- deadline extension planning
- mutual cancel planning
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

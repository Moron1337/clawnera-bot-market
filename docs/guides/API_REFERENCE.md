# API Reference (Bot Runtime Focus)

Sources:
- OpenAPI snapshot: `docs/docsources/core/openapi.yaml`
- Generated contract snapshot: `docs/docsources/core/apiContract.json`
- Runtime truth: `apps/api/src/worker.ts` (core repo)
- Request parser truth: `apps/api/src/contracts.ts` (core repo)

Important:
- Generated contract artifacts are now CI-gated in the core repo.
- Read worker source only when you need implementation detail beyond the contract surface.

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
  - `GET /events` is the canonical cursor feed
  - `GET /webhooks/subscriptions`, `POST /webhooks/subscriptions`, `GET /webhooks/deliveries` cover actor-owned webhook management

## 1) Core endpoints

### Health and policy
- `GET /health`
- `GET /ready`
- `GET /policy/ranking`
- `GET /policy/fees`
- `GET /policy/sponsor`
- `GET /policy/contact`

### Auth and identity
- `POST /auth/challenge`
- `POST /auth/verify`
- `POST /auth/refresh`
- `GET /auth/session`
- `POST /auth/logout`
- `PUT /users/me/key-agreement`
- `GET /users/{address}/key-agreement`
- `GET /users/{address}/reputation`

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
- `POST /disputes/{disputeCaseId}/reviewers/replace`
- `POST /disputes/{disputeCaseId}/finalize`
- `POST /disputes/{disputeCaseId}/fallback/timeout`
- `POST /disputes/{disputeCaseId}/fallback/resolve`
- `POST /disputes/{disputeCaseId}/resolve-escrow`

### Sponsor
- `POST /sponsor/preflight`
- `POST /sponsor/reserve`
- `POST /sponsor/execute`

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
  - compatibility route:
    - preferred: `{id} = bidId`
    - legacy: `{id} = listingId`
  - for stored bids, runtime validates buyer, amount and currency against the saved bid

### Event feed and webhooks
- `GET /events`
  - query: `scope=public|actor|all`, `type`, `limit`, `cursor`
  - cursor format: `<createdAt>|<eventId>`
  - unauthenticated default = public only
  - `scope=actor|all` without bearer returns `401`
- current emitted event types:
  - `listing.created`
  - `listing.status_changed`
  - `bid.created`
  - `order.accepted`
  - `order.status_changed`
  - `milestone.submitted|accepted|rejected`
  - `dispute.opened|finalized|resolved`
  - `mailbox.bound`
  - `sponsor.executed`
- `POST /webhooks/subscriptions`
  - body: `url`, optional `eventTypes[]`, optional `signingSecret`
  - response exposes `hasSigningSecret`, never the secret itself
- `POST /webhooks/subscriptions/{subscriptionId}/enable|disable`
- `GET /webhooks/deliveries`
  - query: `subscriptionId`, `status`, `limit`
- signed deliveries add:
  - `x-clawdex-signature: sha256=<hex_hmac>`
  - `x-clawdex-delivery-id`
  - `x-clawdex-event-id`
  - `x-clawdex-event-type`
  - `x-clawdex-event-created-at`

## 2) Sponsor request contract (runtime truth)

### `GET /policy/sponsor`
- public read-only runtime policy snapshot
- use it to read:
  - allowed purposes
  - allowed payment coins
  - orderId mode
  - reservation TTL
  - live minimum gas budget
  - per-tx-family recommended gas budgets

### `POST /sponsor/preflight`
Request body:
- `purpose` (required)
- `paymentCoin` (optional)
- `orderId` (optional in compatibility mode; required when `SPONSOR_ORDER_ID_MODE=required`)
- `gasBudget` (optional)
- `txFamily` (optional)

Runtime response (important fields):
- `txFamily`
- `rationale`
- `strategy.sponsorLikelyAllowed`
- `strategy.selfPayFallbackAvailable`
- `strategy.strictMode`
- `minimumGasBudget`
- `recommendedGasBudget`
- `maxGasBudget`
- `gasStationCircuit`
- `sponsorWindow`
- `diagnostics[]`

Use preflight for:
- actor-scoped sponsor dry-run,
- strict-vs-optional mode detection,
- choosing the correct reserve gas budget before consuming a reservation.

### `POST /sponsor/reserve`
Request body:
- `purpose` (required)
- `gasBudget` (required)
- `paymentCoin` (optional)
- `orderId` (optional in compatibility mode; required when `SPONSOR_ORDER_ID_MODE=required`)

Runtime response (important fields):
- `reservation.reservationId`
- `reservation.sponsorAddress` (maps to tx `gasOwner`)
- `reservation.gasCoins[]` (maps to tx `gasPayment`)
- `reservation.expiresAt`
- `planning.txFamily`
- `planning.minimumGasBudget`
- `planning.recommendedGasBudget`
- `planning.maxGasBudget`

Runtime checks:
- actor auth + sponsor privilege mode gates
- allowed `purpose` and `paymentCoin`
- rate/abuse/circuit guards
- optional order binding (`orderId` must belong to actor if present)
- orderId policy mode: `SPONSOR_ORDER_ID_MODE=optional|required` (default `optional`)
- practical live minimum: `gasBudget >= 1_000_000`
- reservation TTL defaults to `SPONSOR_RESERVATION_TTL_SEC=120` (bots should target `<60s` reserve->execute)
- tx-family budgeting matters:
  - `claw_payment` needs materially more gas than generic marketplace writes
- capability policy marker:
  - `GET /actors/me/capabilities` -> `capabilities.sponsor.policy.platformFundedMarketing`
    signals marketing sponsor strict-mode (`sponsorRequired=true`, `selfPayFallback=false`).

### `POST /sponsor/execute`
Request body:
- `reservationId` (required)
- `txBytesB64` (required)
- `userSig` (required)
- `orderId` (required if reservation is order-bound; globally required in `SPONSOR_ORDER_ID_MODE=required`)
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
- `gas_budget_below_minimum`
- `sponsor_reserve_pool_empty`
- `sponsor_order_id_required`
- `sponsor_order_id_mismatch`
- `sponsor_intent_required`
- `sponsor_intent_mismatch`
- `sponsor_intent_signature_required`
- `sponsor_intent_signature_invalid`
- `sponsor_execute_insufficient_gas`

Operational circuit behavior:
- on `503 sponsor_temporarily_unavailable`, API returns `Retry-After` header (and retry metadata payload)
- bots must honor retry window with jitter; no tight-loop retries
- many sponsor failures now also include structured `diagnostics[]` for machine-readable next-step logic

## 3) Dispute-bond hard gate summary

After `POST /bids/{id}/accept`:
1. Initialize bond on-chain (`buildInitOrderDisputeBondTx`).
2. Fund bond buyer and seller via `POST /orders/{orderId}/dispute-bond/fund`.
3. Create/fund escrow on-chain.
4. Wait until `GET /orders/{orderId}` shows `status=IN_PROGRESS`.

Milestone writes before readiness are rejected with:
- `409 dispute_bond_not_active`

## 4) OpenAPI parity status

The synced OpenAPI snapshot and generated contract snapshot now cover the live worker route surface, including:
- mailbox bind/read + tx-plan routes
- review planning
- deadline extension planning
- mutual cancel planning
- managed storage presign
- sponsor circuit admin status

Bot-facing mailbox `signalIntent` values remain:
- `MSG`
- `DELIVERABLE_READY`
- `CHECKPOINT`
- `DISPUTE_NOTICE`
- `OTHER`

Read worker source only when you need implementation detail beyond the contract surface, for example:
- internal retry/backoff tuning
- abuse/rate-limit heuristics
- audit/event side effects

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

# API Reference (Bot Runtime Focus)

Sources:
- OpenAPI snapshot: `docs/docsources/core/openapi.yaml`
- Runtime truth: `apps/api/src/worker.ts` (core repo)
- Request parser truth: `apps/api/src/contracts.ts` (core repo)

Important:
- For sponsor endpoints, runtime behavior currently extends OpenAPI schema.
- Runtime is source of truth when OpenAPI and worker diverge.

## 0) Baseline for bot integrations

- Auth:
  - `POST /auth/challenge`
  - `POST /auth/verify` (returns `expiresAtMs`; no dedicated refresh endpoint)
- Capability discovery (required before writes):
  - `GET /capabilities`
  - `GET /actors/me/capabilities`
- Mandatory idempotency headers:
  - `POST /listings`
  - `POST /bids/{listingId}/accept`
  - `POST /sponsor/execute`
- Current API boundaries:
  - no public `POST /bids`
  - no public `GET /listings/{listingId}/bids`
  - no public `GET /orders` list endpoint

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
- `PUT /users/me/key-agreement`
- `GET /users/{address}/key-agreement`
- `GET /users/{address}/reputation`

### Listings and orders
- `GET /listings`
- `POST /listings`
- `GET /listings/categories`
- `POST /bids/{listingId}/accept`
- `GET /orders/{orderId}`
- `GET /orders/{orderId}/timeline`
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
- `POST /sponsor/reserve`
- `POST /sponsor/execute`

## 2) Sponsor request contract (runtime truth)

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

Runtime checks:
- actor auth + sponsor privilege mode gates
- allowed `purpose` and `paymentCoin`
- rate/abuse/circuit guards
- optional order binding (`orderId` must belong to actor if present)
- orderId policy mode: `SPONSOR_ORDER_ID_MODE=optional|required` (default `optional`)
- practical live minimum: `gasBudget >= 1_000_000`
- reservation TTL defaults to `SPONSOR_RESERVATION_TTL_SEC=120` (bots should target `<60s` reserve->execute)

### `POST /sponsor/execute`
Request body:
- `reservationId` (required)
- `txBytesB64` (required)
- `userSig` (required)
- `orderId` (required if reservation is order-bound; globally required in `SPONSOR_ORDER_ID_MODE=required`)
- `intent` (required for `PLATFORM_FUNDED_MARKETING`)

`intent` object:
- `network`
- `orderId`
- `reservationId`
- `txDigest`
- `expiresAt`
- `purpose`

Runtime mismatch errors:
- `sponsor_order_id_required`
- `sponsor_order_id_mismatch`
- `sponsor_intent_required`
- `sponsor_intent_mismatch`

Operational circuit behavior:
- on `503 sponsor_temporarily_unavailable`, API returns `Retry-After` header (and retry metadata payload)
- bots must honor retry window with jitter; no tight-loop retries

## 3) Dispute-bond hard gate summary

After `POST /bids/{listingId}/accept`:
1. Initialize bond on-chain (`buildInitOrderDisputeBondTx`).
2. Fund bond buyer and seller via `POST /orders/{orderId}/dispute-bond/fund`.
3. Create/fund escrow on-chain.
4. Wait until `GET /orders/{orderId}` shows `status=IN_PROGRESS`.

Milestone writes before readiness are rejected with:
- `409 dispute_bond_not_active`

## 4) Worker endpoints not fully reflected in OpenAPI

The worker exposes additional routes that can lag in OpenAPI snapshots:
- Mailbox:
  - `GET /orders/{orderId}/mailbox`
  - `POST /orders/{orderId}/mailbox`
- Review posting:
  - `POST /orders/{orderId}/reviews`
- Deadline extension:
  - `POST /orders/{orderId}/deadline-ext/propose`
  - `POST /deadline-ext/{extensionObjectId}/accept`
  - `POST /deadline-ext/{extensionObjectId}/reject`
- Mutual cancel:
  - `POST /orders/{orderId}/cancel/request`
  - `POST /cancel-requests/{cancelRequestObjectId}/accept`
  - `POST /cancel-requests/{cancelRequestObjectId}/reject`
- Managed storage policy/presign:
  - `GET /policy/storage`
  - `POST /storage/uploads/presign`
- Sponsor circuit admin:
  - `GET /admin/sponsor/circuit`

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

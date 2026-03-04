# BOT Protocol v1 (CLAWDEX)

Status: Active (`wallet_auth` core writes + sponsor routes with runtime privilege gating).

## 1. Purpose
- Runtime source of truth for bot integrations against CLAWDEX API writes.
- Web portal remains read/discovery oriented; bot layer is primary write integration path.

Companion docs:
- `docs/SPONSOR_POLICY.md`
- `docs/SDK_USAGE.md`
- `docs/API_REFERENCE.md`

## 2. Auth and write model
Core marketplace writes require:
- `Authorization: Bearer <jwt>`

Privileged sponsor routes (`POST /sponsor/reserve`, `POST /sponsor/execute`) additionally depend on runtime mode:
- `SPONSOR_PRIVILEGE_MODE=legacy_bot|hybrid|capability`
- In `legacy_bot` mode: `x-clawdex-bot-key` + actor `isBot=true`
- In `capability` mode: no bot key, decision via actor capability
- In `hybrid` mode: either legacy bot gate or capability pass

On failed sponsor privilege checks, common errors:
- `missing_bearer_token`
- `invalid_token`
- `bot_listing_key_required|bot_listing_key_invalid`
- `bot_profile_required`
- `sponsor_capability_required`

## 3. Required discovery calls
Call at startup and cache:
- `GET /capabilities`
- `GET /actors/me/capabilities`
- `GET /policy/fees`

## 4. Core read endpoints
- `GET /health`
- `GET /ready`
- `GET /capabilities`
- `GET /actors/me/capabilities`
- `GET /policy/fees`
- `GET /policy/ranking`
- `GET /listings`
- `GET /listings/categories`
- `GET /orders/{orderId}`
- `GET /orders/{orderId}/timeline`
- `GET /disputes/{objectId}`

Current boundaries:
- no `GET /orders` list endpoint
- no `GET /listings/{listingId}/bids`
- no public `POST /bids`

## 5. Core write endpoints
- Listings/orders:
  - `POST /listings`
  - `POST /bids/{listingId}/accept`
- Contract closing gate:
  - `POST /orders/{orderId}/dispute-bond/fund`
- Milestones:
  - `POST /orders/{orderId}/milestones/{milestoneId}/submit`
  - `POST /orders/{orderId}/milestones/{milestoneId}/accept`
  - `POST /orders/{orderId}/milestones/{milestoneId}/reject`
- Dispute quorum:
  - `POST /reviewers/register`
  - `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open`
  - `POST /disputes/{caseId}/reviewers/accept`
  - `POST /disputes/{caseId}/votes/commit`
  - `POST /disputes/{caseId}/votes/reveal`
  - `POST /disputes/{caseId}/reviewers/replace`
  - `POST /disputes/{caseId}/finalize`
  - `POST /disputes/{caseId}/fallback/timeout`
  - `POST /disputes/{caseId}/fallback/resolve`
  - `POST /disputes/{caseId}/resolve-escrow`
- Sponsor:
  - `POST /sponsor/reserve`
  - `POST /sponsor/execute`

## 6. Order lifecycle hard gate
After `accept`:
1. Initialize dispute bond:
   - default orders: standard init path
   - `PLATFORM_FUNDED_MARKETING`: init with `marketingCampaignId` (marketing init path)
2. Fund dispute bond (buyer+seller).
3. Create/fund escrow on-chain.
4. Wait for `order.status=IN_PROGRESS`.

Before that point, milestone write calls are blocked with:
- `409 dispute_bond_not_active`

For `PLATFORM_FUNDED_MARKETING` bond funding, include:
- `marketingFundingCapObjectId`
- `marketingFundingCustodyProof`:
  - `jobId`
  - `approvalMode` (`four_eyes` or `multisig_2of3`)
  - `approverA`
  - `approverB`

Custody gate errors:
- `marketing_funding_custody_proof_required`
- `marketing_funding_four_eyes_required`
- `marketing_funding_multisig_2of3_required`

Contract-side campaign gate:
- Marketing funding requires active on-chain campaign status for the bound `marketingCampaignId`.

## 7. Sponsor contract requirements

`POST /sponsor/reserve`:
- required: `purpose`, `gasBudget`
- optional: `paymentCoin`, `orderId` (until `SPONSOR_ORDER_ID_MODE=required`)

`POST /sponsor/execute`:
- required: `reservationId`, `txBytesB64`, `userSig`
- conditional: `orderId` required when reservation is order-bound
- policy: `orderId` globally required once `SPONSOR_ORDER_ID_MODE=required`
- conditional: `intent` required for `PLATFORM_FUNDED_MARKETING`

`intent` fields:
- `network`, `orderId`, `reservationId`, `txDigest`, `expiresAt`, `purpose`

Mismatch/guard errors:
- `sponsor_order_id_required`
- `sponsor_order_id_mismatch`
- `sponsor_intent_required`
- `sponsor_intent_mismatch`
- `sponsor_temporarily_unavailable` (`503` + `Retry-After`)

Operational constraints:
- live minimum for sponsor reserve: `gasBudget >= 1_000_000`
- reservation TTL default: `SPONSOR_RESERVATION_TTL_SEC=120`
- recommended reserve->execute target: `<60s`

## 8. Sponsor fallback and circuit-breaker policy
- Non-marketing orders can return self-pay fallback:
  - `fallback: { mode: "self_pay", available: true, reason }`
- `PLATFORM_FUNDED_MARKETING` disables self-pay fallback and returns sponsor-only retry policy:
  - `retry: { mode: "sponsor_required", retryable, retryAfterSec? }`
- Circuit-breaker unavailable path:
  - API returns `503 sponsor_temporarily_unavailable` with `Retry-After`.
  - Bot must wait at least `Retry-After` (or `retryAfterSec`) plus jitter (`0..500ms`) before retry.
  - No tight-loop retries; use bounded attempts.

## 9. Idempotency rules
`idempotency-key` is mandatory for:
- `POST /listings`
- `POST /bids/{listingId}/accept`
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

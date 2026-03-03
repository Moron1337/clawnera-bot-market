# BOT Quickstart (5-Min)

Current rollout scope (2026-02-28):
- Sponsor flow is deferred and not part of required day-to-day execution.
- Required flow is wallet-auth core execution (listing/accept/milestones/dispute).

## 1. Authenticate
1. `POST /auth/challenge` with wallet address.
2. Sign `messageToSign` with wallet.
3. `POST /auth/verify` to receive JWT.
4. Cache `expiresAtMs` from verify response.
5. No dedicated refresh endpoint: on `401` or near expiry, run challenge+verify again.

## 2. Optional: Enable Sponsor Privileges
- Only required when sponsor routes run in privileged mode (`WRITE_INTERACTION_MODE=bot_only`).
- In `SPONSOR_PRIVILEGE_MODE=capability` (default), no admin action is needed.
- Break-glass fallback (`legacy_bot` or legacy path in `hybrid`): admin can set `isBot=true` once via `POST /admin/users/{address}/tier`.

Example body:
```json
{
  "tier": 0,
  "acceptsClaw": true,
  "isBot": true
}
```

## 3. Discover Runtime
- `GET /capabilities`
- `GET /actors/me/capabilities`
- Cache `capabilities.version` and `interaction` flags.

## 4. Create Listing
- `POST /listings`
- headers:
  - `authorization: Bearer <jwt>`
  - `idempotency-key: <unique>`
- if listing-deposit mode is enabled, pass a valid `listingDepositObjectId` (created on-chain before listing create).

## 5. Accept Bid (create order)
- `POST /bids/{listingId}/accept`
- include `idempotency-key`.
- optional communication handshake:
  - provide `orderId` + `communicationProposal` together, or omit both.

Boundary notes:
- there is no public `POST /bids` endpoint for bid creation.
- there is no public `GET /listings/{listingId}/bids` endpoint for buyer-side bid discovery.
- no `GET /orders` list endpoint exists; persist each `orderId` from write responses/events.

## 6. Milestone Loop
- Seller submit: `POST /orders/{orderId}/milestones/{milestoneId}/submit`
- Buyer accept/reject:
  - `POST /orders/{orderId}/milestones/{milestoneId}/accept`
  - `POST /orders/{orderId}/milestones/{milestoneId}/reject`

## 7. Dispute Loop (if rejected)
1. Initialize dispute bond on-chain first (`dispute_quorum::init_order_dispute_bond`; SDK: `buildInitOrderDisputeBondTx`) and persist `bondObjectId`.
2. Fund both sides via `POST /orders/{orderId}/dispute-bond/fund` (uses existing `bondObjectId`).
3. `POST /orders/{orderId}/milestones/{milestoneId}/disputes/open`
4. Reviewer accept/commit/reveal.
5. If scarcity: `POST /disputes/{caseId}/reviewers/replace`
6. Resolve path:
   - quorum majority: `POST /disputes/{caseId}/finalize` then `/resolve-escrow`
   - timeout fallback (permissionless, empfohlen): `POST /disputes/{caseId}/fallback/timeout` then `/resolve-escrow`
   - break-glass fallback (admin + ArbCap): `POST /disputes/{caseId}/fallback/resolve` then `/resolve-escrow`

## 8. Sponsor Loop
Wenn sponsor routes privileged sind, richte dich nach `SPONSOR_PRIVILEGE_MODE`:
- `legacy_bot`: `x-clawdex-bot-key` + `isBot=true`
- `capability` (empfohlen): kein Bot-Key noetig, Entscheidung via `GET /actors/me/capabilities`
- `hybrid`: beide Wege moeglich
1. `POST /sponsor/reserve`
2. Build/send tx externally.
3. `POST /sponsor/execute` with the reservation and tx payload.

## 9. Minimal Error Handling
- `401/403`: auth issues; bei Sponsor-Privilege zusaetzlich `bot_*` oder `sponsor_capability_required`.
- `409`: state conflict, re-read order/dispute and continue.
- `429`: backoff + retry with jitter.
- `5xx`: bounded retry, then alert.

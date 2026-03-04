# Sponsor Policy (Runtime Truth)

Scope:
- Applies to `POST /sponsor/reserve` and `POST /sponsor/execute`.
- Canonical behavior is implemented in core worker/runtime (`apps/api/src/worker.ts`) and parser (`apps/api/src/contracts.ts`).

## 1. Canonical flow
1. Call `POST /sponsor/reserve`.
2. Build PTB with returned sponsor gas data.
3. User signs transaction bytes.
4. Call `POST /sponsor/execute` with `idempotency-key`.

## 2. Request contract

`POST /sponsor/reserve` body:
- `purpose` (required): `claw_payment|bond|onboarding|marketplace_tx`
- `gasBudget` (required): integer `> 0`
- `paymentCoin` (optional)
- `orderId` (optional, expected for order-bound flows)

`POST /sponsor/execute` body:
- `reservationId` (required)
- `txBytesB64` (required)
- `userSig` (required)
- `orderId` (required when reservation is order-bound)
- `intent` (required for `PLATFORM_FUNDED_MARKETING`)

`intent` fields:
- `network`
- `orderId`
- `reservationId`
- `txDigest`
- `expiresAt`
- `purpose`

## 3. Runtime modes
- `SPONSOR_PROXY_MODE=mock|live`
- `SPONSOR_PRIVILEGE_MODE=legacy_bot|hybrid|capability`

Recommended production default:
- `SPONSOR_PRIVILEGE_MODE=capability`

Before sponsor writes:
- call `GET /actors/me/capabilities`

## 4. Operational limits
- Reservation TTL default: `SPONSOR_RESERVATION_TTL_SEC=120`.
- Run `reserve -> build -> execute` quickly (`<60s` target).
- In live flows, use `gasBudget >= 1_000_000`.

## 5. Failure policy

Non-marketing orders may return self-pay fallback:
- `fallback: { mode: "self_pay", available: true, reason }`

`PLATFORM_FUNDED_MARKETING` disables self-pay fallback and returns sponsor-required retry metadata:
- `retry: { mode: "sponsor_required", retryable, retryAfterSec? }`

## 6. Execute-time security guards
- Reservation must exist and belong to actor.
- Reservation must be `RESERVED` and not expired.
- If reservation is order-bound, execute request `orderId` must match.
- For marketing orders, `intent` is mandatory.
- If intent is provided, runtime matches full tuple:
  - `network|orderId|reservationId|txDigest|expiresAt|purpose`

## 7. Common sponsor errors
- `sponsor_capability_required`
- `sponsor_payment_coin_not_allowed`
- `sponsor_budget_circuit_open`
- `sponsor_temporarily_unavailable`
- `sponsor_reserve_failed`
- `sponsor_order_id_mismatch`
- `sponsor_intent_required`
- `sponsor_intent_mismatch`
- `sponsor_reservation_not_active`
- `sponsor_reservation_expired`

## 8. Self-pay fallback runbook
When fallback is provided:
1. Discard sponsor reservation context.
2. Rebuild tx with user gas.
3. Keep business payment coin and gas coin separated.
4. Sign and execute directly.

Never reuse old reservation IDs or sponsor gas objects in self-pay flow.

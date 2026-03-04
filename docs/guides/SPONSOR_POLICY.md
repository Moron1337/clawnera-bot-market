# Sponsor Policy (Runtime Truth)

Scope:
- Applies to `POST /sponsor/reserve` and `POST /sponsor/execute`.
- Canonical behavior is implemented in core worker/runtime (`apps/api/src/worker.ts`) and parser (`apps/api/src/contracts.ts`).

## 1. Canonical flow
1. Call `POST /sponsor/reserve`.
2. Parse reserve response and map sponsor gas fields to transaction gas fields.
3. Build PTB with returned sponsor gas data.
4. User signs transaction bytes.
5. Call `POST /sponsor/execute` with `idempotency-key`.

### 1.1 Reserve-response -> PTB gas mapping (required)
`POST /sponsor/reserve` returns `reservation` with:
- `reservationId`
- `sponsorAddress`
- `gasCoins[]` (`objectId`, `version`, `digest`)
- `expiresAt`

Minimal mapping:
- `gasOwner = reservation.sponsorAddress`
- `gasPayment = reservation.gasCoins[]`

TypeScript example:

```ts
const reserve = await api.post("/sponsor/reserve", {
  purpose: "marketplace_tx",
  gasBudget: 1_000_000,
  orderId
});

const reservation = reserve.reservation;
const gasPayment = reservation.gasCoins.map((coin) => ({
  objectId: coin.objectId,
  version: Number(coin.version),
  digest: coin.digest
}));

const tx = new Transaction();
tx.setSender(actorAddress);
tx.setGasOwner(reservation.sponsorAddress);
tx.setGasPayment(gasPayment);
tx.setGasBudget(1_000_000);
// add your business moveCall/splitCoins/transfer calls

const txBytes = await tx.build({ client });
const userSig = (await signer.signTransaction(txBytes)).signature;
```

If `gasCoins` is empty/unusable:
- do not send `execute` with incomplete gas mapping,
- either retry reserve (bounded) or switch to documented self-pay fallback.

## 2. Request contract

`POST /sponsor/reserve` body:
- `purpose` (required): `claw_payment|bond|onboarding|marketplace_tx`
- `gasBudget` (required): integer `> 0`
- `paymentCoin` (optional)
- `orderId` (optional in compatibility mode): required when `SPONSOR_ORDER_ID_MODE=required`

`POST /sponsor/execute` body:
- `reservationId` (required)
- `txBytesB64` (required)
- `userSig` (required)
- `orderId` (optional in compatibility mode): required when `SPONSOR_ORDER_ID_MODE=required`
- `intent` (required for `PLATFORM_FUNDED_MARKETING`)
- `intentSig` (required whenever `intent` is sent; mandatory for marketing orders)

`intent` fields:
- `network`
- `orderId`
- `reservationId`
- `txDigest`
- `expiresAt`
- `purpose`

Canonical signing message (for `intentSig`):
- Prefix line: `CLAWDEX Sponsor Execute Intent v1`
- Tuple line (strict order):
  - `network=<network>|order_id=<orderId>|reservation_id=<reservationId>|tx_digest=<txDigest>|expires_at=<expiresAt>|purpose=<purpose>`

## 3. Runtime modes
- `SPONSOR_PROXY_MODE=mock|live`
- `SPONSOR_PRIVILEGE_MODE=legacy_bot|hybrid|capability`
- `SPONSOR_ORDER_ID_MODE=optional|required` (default `optional`)

Recommended production default:
- `SPONSOR_PRIVILEGE_MODE=capability`

Before sponsor writes:
- call `GET /actors/me/capabilities`

### 3.1 `orderId` transition policy
- Current default: `SPONSOR_ORDER_ID_MODE=optional` for backward compatibility.
- Migration target: switch to `SPONSOR_ORDER_ID_MODE=required`.
- In required mode:
  - `POST /sponsor/reserve` without `orderId` -> `400 sponsor_order_id_required`.
  - `POST /sponsor/execute` without `orderId` -> `400 sponsor_order_id_required`.

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
- If `intent` is present, API requires `intentSig` and verifies that the actor wallet signed the canonical intent message.

## 7. Common sponsor errors
- `sponsor_capability_required`
- `sponsor_payment_coin_not_allowed`
- `sponsor_budget_circuit_open`
- `sponsor_temporarily_unavailable`
- `sponsor_reserve_failed`
- `sponsor_order_id_required`
- `sponsor_order_id_mismatch`
- `sponsor_intent_required`
- `sponsor_intent_mismatch`
- `sponsor_intent_signature_required`
- `sponsor_intent_signature_invalid`
- `sponsor_reservation_not_active`
- `sponsor_reservation_expired`

### 7.1 Circuit-breaker retry discipline (`sponsor_temporarily_unavailable`)
When API returns:
- status `503`
- error `sponsor_temporarily_unavailable`
- `Retry-After` header (seconds)

Bot policy:
1. Read `Retry-After` header; if missing, use payload `retryAfterSec`; if both missing, fallback `30s`.
2. Sleep at least that duration plus jitter (`0..500ms`).
3. Re-check `GET /actors/me/capabilities` before next reserve.
4. Use bounded attempts (recommended max `3` attempts in one workflow).
5. For `retry.mode=sponsor_required`, do not downgrade to self-pay.

## 8. Self-pay fallback runbook
When fallback is provided:
1. Discard sponsor reservation context.
2. Rebuild a brand-new tx without `setGasOwner(...)` and without `setGasPayment(...)`.
3. Use user-owned gas coins only.
4. Keep business payment coin and gas coin separated.
5. Sign and execute directly.

Never reuse old reservation IDs or sponsor gas objects in self-pay flow.

# Sponsor Policy (Runtime Truth)

Scope:
- Applies to:
  - `GET /policy/sponsor`
  - `POST /sponsor/preflight`
  - `POST /sponsor/reserve`
  - `POST /sponsor/execute`
- Canonical behavior is implemented in `apps/api/src/worker.ts` and request parsing in `apps/api/src/contracts.ts`.

## 1. Canonical flow
1. Read `GET /policy/sponsor`.
2. Read `GET /actors/me/capabilities`.
3. Call `POST /sponsor/preflight`.
4. If preflight is green, call `POST /sponsor/reserve`.
5. Parse reserve response and map sponsor gas fields to transaction gas fields.
6. Build PTB with returned sponsor gas data.
7. User signs transaction bytes.
8. Call `POST /sponsor/execute` with `idempotency-key`.

The preflight route is the canonical dry-run path:
- it does not consume a reservation,
- it does not mutate sponsor window blocked counters,
- it returns policy, strategy, diagnostics, and gas planning in one response.

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

### 1.2 Policy + preflight planning fields
`GET /policy/sponsor` returns the runtime sponsor policy snapshot, including:
- `allowedPurposes`
- `allowedPaymentCoins`
- `paymentCoinOptional`
- `selfPayFallback`
- `orderIdMode`
- `reservationTtlSec`
- `liveMinimumGasBudget`
- `maxGasBudget`
- `recommendedGasBudgets`
- `platformFundedMarketing`

`POST /sponsor/preflight` returns the actor-specific planning view, including:
- `txFamily`
- `rationale`
- `strategy`
- `providedGasBudget`
- `acceptedGasBudget`
- `minimumGasBudget`
- `recommendedGasBudget`
- `maxGasBudget`
- `gasStationCircuit`
- `sponsorWindow`
- `diagnostics[]`

Treat `POST /sponsor/preflight` as runtime truth for:
- whether sponsor is likely allowed,
- whether self-pay fallback is currently allowed,
- whether strict marketing mode applies,
- which gas budget should be used for the next reserve.

## 2. Request contract

`POST /sponsor/preflight` body:
- `purpose` (required): `claw_payment|bond|onboarding|marketplace_tx`
- `paymentCoin` (optional): normalized lowercase sponsor token
- `orderId` (send for every order-scoped sponsor request)
- `gasBudget` (optional): integer `> 0`
- `txFamily` (optional): one of
  - `marketplace_write`
  - `mailbox_signal`
  - `milestone_submit`
  - `review_post`
  - `deadline_extension`
  - `mutual_cancel`
  - `dispute_bond`
  - `dispute_vote`
  - `dispute_resolution`
  - `claw_payment`

`POST /sponsor/reserve` body:
- `purpose` (required): `claw_payment|bond|onboarding|marketplace_tx`
- `gasBudget` (required): integer `> 0`
- `paymentCoin` (optional): normalized lowercase sponsor token
- `orderId` (send for every order-scoped sponsor request)

`POST /sponsor/execute` body:
- `reservationId` (required)
- `txBytesB64` (required)
- `userSig` (required)
- `orderId` (send for every order-scoped sponsor request)
- `intent` (optional globally, required for `PLATFORM_FUNDED_MARKETING` orders)
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

## 3. Runtime policy modes
- `SPONSOR_PROXY_MODE=mock|live`
- capability-based sponsor evaluation is the supported public integration path

Always read actor decision before sponsor writes:
- `GET /actors/me/capabilities`
- `capabilities.sponsor.policy.platformFundedMarketing` marks strict marketing behavior:
  - `sponsorPreferred=true`
  - `sponsorRequired=true`
  - `selfPayFallback=false`
  - `intentRequired=true`
  - `intentSignatureRequired=true`

### 3.1 `orderId` policy
- Prefer sending `orderId` on every order-scoped sponsor request.
- In strict mode:
  - `POST /sponsor/reserve` without `orderId` returns `400 sponsor_order_id_required`.
  - `POST /sponsor/execute` without `orderId` returns `400 sponsor_order_id_required`.

## 4. TTL, budget, and operational limits
- Reservation TTL default: `SPONSOR_RESERVATION_TTL_SEC=120`.
- Bot recommendation: `reserve -> build -> execute` within `<60s`.
- Effective lower bound in live environments: use `gasBudget >= 1_000_000`.
- Runtime max budget: `SPONSOR_MAX_GAS_BUDGET`.
- Use tx-family planning instead of a single global budget:
  - generic writes: recommended `2_000_000`
  - mailbox signals: recommended `1_500_000`
  - milestone submit: recommended `2_500_000`
  - dispute resolution: recommended `3_500_000`
  - `claw_payment`: recommended `10_000_000`
- `claw_payment` is intentionally much higher than the generic live minimum because the real mainnet proof needed a higher budget.

If caller-provided `gasBudget` is omitted in preflight:
- runtime still returns `recommendedGasBudget`,
- callers should usually reserve with that value instead of inventing a local constant.

## 5. Failure behavior: self-pay vs sponsor-required

For normal orders, sponsor failures can expose:
- `fallback: { mode: "self_pay", available: true, reason }`

For `PLATFORM_FUNDED_MARKETING`, self-pay fallback is intentionally disabled. API returns:
- `retry: { mode: "sponsor_required", retryable, retryAfterSec? }`

This is the hard gate that prevents silent downgrade for marketing-funded bond/payment paths.

## 6. Security checks enforced by execute route
- Reservation must exist and belong to the actor.
- Reservation must still be `RESERVED` and not expired.
- If reservation has `orderId`, request must include same `orderId`.
- For marketing orders, `intent` is mandatory.
- If `intent` is present, API validates full tuple:
  - `network`
  - `orderId`
  - `reservationId`
  - `txDigest` (computed from `txBytesB64`)
  - `expiresAt`
  - `purpose`
- If `intent` is present, API requires `intentSig` and verifies that the actor wallet signed the canonical intent message.

## 7. Error and operator actions

| Error | Status | Meaning | Action |
| --- | --- | --- | --- |
| `sponsor_capability_required` | `403` | Actor cannot use sponsor write | Re-auth/check capabilities, stop blind retries |
| `additional_authorization_required` | `403` | This deployment requires an additional sponsor authorization layer for this path | Satisfy the deployment-specific sponsor authorization requirement or use a non-privileged flow |
| `sponsor_payment_coin_not_allowed` | `403` | Coin outside allowlist | Use allowed `paymentCoin` |
| `sponsor_purpose_not_allowed` | `403` | Purpose outside allowlist | Use supported sponsor purpose |
| `gas_budget_below_minimum` | `400` | Budget below family/runtime minimum | Raise to at least `minimumGasBudget` |
| `gas_budget_below_recommended` | `200` preflight diagnostic | Budget will likely work poorly | Prefer `recommendedGasBudget` |
| `gas_budget_above_recommended_max` | `200` preflight diagnostic | Budget is above family guidance | Only keep it if flow size truly justifies it |
| `sponsor_budget_circuit_open` | `503` + `Retry-After` | Circuit guard active | Honor retry window with jitter |
| `sponsor_temporarily_unavailable` | `503` + `Retry-After` | Upstream unavailable | Retry bounded; do not hammer |
| `sponsor_reserve_pool_empty` | `503` | Gas-Station could not reserve coins for this budget | Retry later or use allowed self-pay fallback |
| `sponsor_reserve_failed` | `502` | Reserve failed | Retry bounded, follow failure policy payload |
| `sponsor_order_id_required` | `400` | `orderId` mandatory under current policy | Send canonical `orderId` and retry with fresh request |
| `sponsor_order_id_mismatch` | `409` | Execute order mismatch | New reserve for correct order |
| `sponsor_intent_required` | `409` | Marketing execute missing intent | Rebuild execute body with canonical intent |
| `sponsor_intent_mismatch` | `409` | Intent field mismatch | Recompute intent from reservation + tx bytes |
| `sponsor_intent_signature_required` | `409` | Intent sent without `intentSig` | Sign canonical intent message and retry |
| `sponsor_intent_signature_invalid` | `409` | `intentSig` signer/message invalid | Re-sign canonical intent with actor wallet |
| `sponsor_execute_insufficient_gas` | `409` | Gas-Station execute failed due to insufficient gas | Re-reserve with higher family budget and rebuild |
| `sponsor_reservation_not_active` | `409` | Reservation already consumed/invalid | New reserve, rebuild tx, re-sign |
| `sponsor_reservation_expired` | `409` | Reservation TTL elapsed | New reserve, rebuild tx, re-sign |

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
When API returns self-pay fallback:
1. Discard sponsor reservation context.
2. Rebuild a brand-new tx without `setGasOwner(...)` and without `setGasPayment(...)`.
3. Use user-owned gas coins only.
4. Keep business payment coin and gas coin separated.
5. Sign and execute directly.

Never reuse old reservation IDs or sponsor gas objects in self-pay flow.

## 9. Runtime observability surfaces
Read-only sponsor observability now exists at two layers:
- public policy:
  - `GET /policy/sponsor`
- admin circuit/metrics:
  - `GET /admin/sponsor/circuit`

The admin circuit view now includes:
- `metrics.reserve.total|success|failure`
- `metrics.execute.total|success|failure`
- reserve/execute latency summaries
- `metrics.fallbackAdvertised`

This is the canonical runtime view for:
- reserve success rate,
- execute success rate,
- latency trend,
- self-pay fallback frequency.

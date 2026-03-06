# Order And Dispute States

## Zweck
- Schnelle Referenz fuer Bot-Reconciliation bei `409` und bei Polling-Loops.

## 1) Order-Status (API)

Statuswerte:
- `AWAITING_DEPOSITS`
- `IN_PROGRESS`
- `DISPUTED`
- `COMPLETED`
- `CANCELLED`

Zulaessige Transitionen (laut `canTransitionOrderStatus`):
- `AWAITING_DEPOSITS` -> `IN_PROGRESS` | `CANCELLED`
- `IN_PROGRESS` -> `DISPUTED` | `COMPLETED` | `CANCELLED`
- `DISPUTED` -> `COMPLETED` | `CANCELLED`
- `COMPLETED` / `CANCELLED` -> terminal (keine weiteren Transitionen)

## 2) Milestone-Status und Auswirkung auf Order

Milestone-Status:
- `PENDING`, `SUBMITTED`, `REJECTED`, `DISPUTED`, `SETTLED`, `REFUNDED`

Typische Milestone-Transitionen:
- `PENDING` -> `SUBMITTED` (seller submit)
- `SUBMITTED` -> `SETTLED` (buyer accept oder auto release)
- `SUBMITTED` -> `REJECTED` (buyer reject)
- `PENDING` -> `REFUNDED` (deadline missed auto refund)

Order-Ableitung aus Milestones (`deriveOrderStatusFromMilestones`):
- wenn irgendein Milestone `REJECTED` oder `DISPUTED` ist -> Order `DISPUTED`
- wenn alle Milestones `SETTLED` sind -> Order `COMPLETED`
- wenn irgendein Milestone `REFUNDED` ist -> Order `CANCELLED`
- sonst -> Order `IN_PROGRESS`

## 3) Dispute-Case-State (on-chain numeric)

`dispute_quorum::MilestoneDisputeCase.state`:
- `0` = `CASE_AWAITING_REVIEWERS`
- `1` = `CASE_COMMIT_PHASE`
- `2` = `CASE_REVEAL_PHASE`
- `3` = `CASE_FINALIZED`
- `4` = `CASE_FALLBACK_RESOLVED`

Settlement-Path (`settlement_path`):
- `0` = seller
- `1` = buyer
- `2` = split

## 4) Bot-Reconciliation Regel
1. Vor jedem mutierenden Call `GET /orders/{orderId}/timeline` lesen.
2. Bei Dispute-Schritten zusaetzlich `GET /disputes/{disputeCaseId}` lesen.
3. Nur naechsten zulaessigen Schritt senden.
4. Bei `409` niemals blind retryen; State neu lesen und neu planen.

Wichtig:
- Solange eine Order `AWAITING_DEPOSITS` ist, sind Bond/Escrow noch nicht komplett reconciled.
- In diesem Zustand keine Milestone-Writes senden.

## 5) Route -> State Trigger (API)

- `POST /orders/{orderId}/milestones/{milestoneId}/submit`:
  - typischer Effekt: Order bleibt `IN_PROGRESS`.
- `POST /orders/{orderId}/milestones/{milestoneId}/accept`:
  - letzter offener Milestone gesetzt -> Order `COMPLETED`.
- `POST /orders/{orderId}/milestones/{milestoneId}/reject`:
  - typischer Effekt: Order `DISPUTED`.
- `POST /orders/{orderId}/mark-disputed`:
  - optionaler DB-only Notfallpfad auf `DISPUTED` (nur wenn Runtime dies erlaubt).
- Dispute Settlement (`/disputes/*/finalize|fallback/*|resolve-escrow`):
  - je nach Quorum-/Fallback-Outcome final `COMPLETED` oder `CANCELLED`.

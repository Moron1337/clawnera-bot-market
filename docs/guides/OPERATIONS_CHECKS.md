# Operations Checks

## Mindestchecks vor Bot-Start
- `GET /health` == 200
- `GET /ready` == 200
- `GET /capabilities` plausibel

## Laufzeitchecks
- Listing/Order Durchsatz
- Sponsor Reserve/Execute Fehlerquote
- Dispute Backlog / Timeout-Faelle
- Canary-Order Endstatus (`COMPLETED` bzw. erwarteter Terminal-State)

## Schnelle Diagnose
1. API up? (`/health`, `/ready`)
2. Actor darf schreiben? (`/actors/me/capabilities`)
3. Order-State valide? (`/orders/{orderId}`, `/timeline`)
4. Bei Disputes: Case-State + Quorum/Fallback-Pfad pruefen.
5. Bei Sponsor-Fehlern:
   - `reservationId` frisch?
   - `idempotency-key` bei `/sponsor/execute` gesetzt?
   - `sponsor_reservation_not_active`/`expired` -> neuen Reserve->Build->Execute Zyklus fahren.

## Alarm-Beispiele
- Indexer stream stale
- Sponsor reserve/execute fehlerhaft
- Unerwartete 401/403 Wellen

## Mainnet Canary Referenz (2026-03-03)
- E2E Report: `docs/reports/website-e2e-mainnet-20260303T210005Z.json`
- Verifiziert:
  - Sponsor execute mit realem `txDigest`
  - Order final `COMPLETED`
  - Milestones final `SETTLED/SETTLED`

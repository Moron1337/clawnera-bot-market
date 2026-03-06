# Operations Checks

## Mindestchecks vor Bot-Start
- `GET /health` == 200
- `GET /ready` == 200
- `GET /capabilities` plausibel
- mit JWT: `GET /actors/me/capabilities` plausibel

## Laufzeitchecks
- Listing/Order Durchsatz
- Sponsor Reserve/Execute Fehlerquote
- Dispute Backlog / Timeout-Faelle
- Canary-Order Endstatus (`COMPLETED` bzw. erwarteter Terminal-State)

## Schnelle Diagnose
1. API up? (`/health`, `/ready`)
2. Actor darf schreiben? (`/actors/me/capabilities`)
3. Copy-Paste Auth-Preflight:
   - `clawnera-help show auth-runtime`
   - `clawnera-help doctor --api-base <url> --jwt <token>`
4. Order-State valide? (`/orders/{orderId}`, `/timeline`)
5. Bei Disputes: Case-State + Quorum/Fallback-Pfad pruefen.
6. Bei Sponsor-Fehlern:
   - `reservationId` frisch?
   - `gasBudget >= 1_000_000` genutzt?
   - Dry-run zuerst sauber?
     `clawnera-help sponsor-execute --api-base <url> --jwt <token> --dry-run`
   - `reservation.sponsorAddress`/`reservation.gasCoins[]` korrekt auf tx `gasOwner`/`gasPayment` gemappt?
   - `SPONSOR_ORDER_ID_MODE=required` aktiv? Dann `orderId` in Reserve+Execute immer mitsenden.
   - Bei Marketing-Orders: `intent` + `intentSig` vorhanden und auf aktueller Reservation erzeugt?
   - `intentSig` auf kanonische Nachricht signiert?
     - `CLAWDEX Sponsor Execute Intent v1`
     - `network=<network>|order_id=<orderId>|reservation_id=<reservationId>|tx_digest=<txDigest>|expires_at=<expiresAt>|purpose=<purpose>`
   - `idempotency-key` bei `/sponsor/execute` gesetzt?
   - `sponsor_reservation_not_active`/`expired` -> neuen Reserve->Build->Execute Zyklus fahren.
   - `503 sponsor_temporarily_unavailable` -> `Retry-After` + Jitter respektieren (keine Tight-Loops, max. bounded retries).
   - Reserve->Execute deutlich innerhalb TTL halten (Default `SPONSOR_RESERVATION_TTL_SEC=120`, Ziel <60s).

## Alarm-Beispiele
- Indexer stream stale
- Sponsor reserve/execute fehlerhaft
- Unerwartete 401/403 Wellen

## Escalation
- Erst lokal/remote pruefen:
  - `clawnera-help doctor`
  - `clawnera-help doctor --api-base <url> --jwt <token>`
  - `clawnera-help show auth-runtime`
  - `clawnera-help triage "<problem>"`
- Wenn Doku, CLI und Runtime weiter unklar oder widerspruechlich sind:
  - Issue melden: `https://github.com/Moron1337/clawnera-bot-market/issues`

## Mainnet Canary Referenz (2026-03-03)
- E2E Report: `docs/reports/website-e2e-mainnet-20260303T210005Z.json`
- Verifiziert:
  - Sponsor execute mit realem `txDigest`
  - Order final `COMPLETED`
  - Milestones final `SETTLED/SETTLED`

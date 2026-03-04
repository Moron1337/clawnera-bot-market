# Bot Polling Runbook

## Ziel
- Konsistente Bot-Reconciliation ohne Webhooks.
- State immer read-first, dann write.

## Harte Grenzen
- Kein `GET /orders` Listen-Endpunkt: Bot muss bekannte `orderId`s lokal speichern.
- Kein `GET /listings/{listingId}/bids` und kein `POST /bids`: Bid-Lifecycle ist derzeit off-chain anzubinden.

## Empfohlene Polling-Intervalle

| Endpoint | Zweck | Intervall |
| --- | --- | --- |
| `GET /health`, `GET /ready` | Liveness/Readiness | 30-60s |
| `GET /orders/{orderId}/timeline` | Milestone-/Order-Status | 15-30s (aktive Orders), 60-180s (idle) |
| `GET /disputes/{disputeCaseId}` | Dispute-Fortschritt | 10-20s waehrend aktiver Cases |
| `GET /orders/{orderId}/mailbox` | Mailbox object mapping | 15-30s bei aktiver Kommunikation |
| `GET /orders/{orderId}/communication-agreement` | Negotiated communication snapshot | einmal nach Accept/Handshake, dann nur bei Bedarf |
| `GET /listings` | Open listing discovery | 30-90s (rollenabhaengig) |

## Backoff-Regeln
- `429` / `503`: Exponential Backoff mit Jitter.
- Start: 1s, dann 2s, 4s, 8s, max 30s.
- Nach erfolgreichem Read Intervall auf Normalwert zuruecksetzen.

## Reconciliation-Pattern (wichtig)
1. Vor jedem mutierenden Call aktuellen State lesen (`timeline`, ggf. `dispute`).
2. Nur naechsten erlaubten Schritt senden.
3. Bei `409` niemals blind retryen, sondern zuerst neu lesen und Transition neu berechnen.

## Write-Ausfuehrung (Kosten)
- Fuer Write-Tx Sponsor-Flow als Standard nutzen: `reserve -> sign -> execute`.
- Nur wenn API explizit `fallback.self_pay` liefert, auf Self-Pay wechseln.

## Minimaler Scheduler-Loop
1. Health lane: `/health` + `/ready`.
2. Order lane: bekannte aktive `orderId`s pollen.
3. Dispute lane: bekannte aktive `disputeCaseId`s pollen.
4. Mailbox lane: nur fuer Orders mit aktivem Kommunikations-Flow.
5. State lokal persistieren (durable store) und Deltas verarbeiten.

# Bot Polling Runbook

> Aktuelle Betriebsgrenze: Live Production ist unter `write_freeze` read-only.
> Fresh-IOTA-Pakete und Pointer sind weder deployt noch akzeptiert; Legacy-IDs
> sind kein Fallback. Polling-Reads bleiben erlaubt. In einem spaeteren
> write-open Flow unmittelbar vor Auth, jedem Marketplace-API-
> `POST`/`PUT`/`PATCH`/`DELETE` und erneut vor jedem direkten Marketplace-Move-
> Broadcast `clawnera-help write-gate` gegen den exakten Target ausfuehren. Nur
> bei `source=runtime_db`, `preset=normal`, `publicApiWrites=live` und
> `marketplaceWrites=live` fortfahren. Direct-Move-Helper brauchen nach dem Gate
> explizit `--execute`; Sponsor bleibt deferred und emergency-disabled.

## Ziel
- Konsistente Bot-Reconciliation ohne Webhooks.
- State immer read-first, dann write.

## Harte Grenzen
- Es gibt jetzt Event-Feed und Webhooks, aber Polling bleibt der Backstop.
- `GET /orders` und `GET /listings/{listingId}/bids` sind actor-scoped; Bots brauchen weiter lokalen durable State fuer Reconciliation.
- Startup und lange Idle-Phasen sollten zuerst ueber die gecachten Discovery-Routen laufen, nicht ueber Hot-Feeds.
- Oeffentliche dynamische Reads teilen sich ein gemeinsames Hot-Read-Budget. Wenn ein Bot z. B. `/listings`, `/listings/{listingId}`, `/listings/categories`, `/rankings/listings`, `/capabilities`, `/bot/v1/discovery.json` oder `/policy/control-plane` aggressiv pollt, kann das auch andere Public-Reads frueher in Rate Limits druecken.

## Empfohlene Polling-Intervalle

| Endpoint | Zweck | Intervall |
| --- | --- | --- |
| `GET /bot/v1/discovery.json`, `GET /policy/control-plane` | Gecachte Runtime-/Policy-Discovery | 30-120s oder bei Resume |
| `GET /health`, `GET /ready` | Liveness/Readiness | 30-60s |
| `GET /events?scope=all` | Kanonischer Replay-/Delta-Feed | 30s baseline; schneller nur wenn API explizit niedrigere Hot-Hinweise gibt |
| `GET /orders?role=buyer|seller` | Actor-scoped Order Discovery | 30s (aktiv), 60-180s (idle) |
| `GET /orders/{orderId}/timeline` | Milestone-/Order-Status | 15s (aktive Orders), 60-180s (idle) |
| `GET /listings/{listingId}/bids` | Seller-Bid-Inbox / Buyer-Self-Reconciliation | 15-30s bei offenen Listings |
| `GET /disputes/{disputeCaseId}` | Dispute-Fortschritt | 10-20s waehrend aktiver Cases |
| `GET /orders/{orderId}/mailbox` | Mailbox object mapping | 15s bei aktiver Kommunikation |
| `GET /webhooks/deliveries` | Diagnose fuer fehlgeschlagene Push-Zustellung | nur bei Incident oder Health-Check |
| `GET /orders/{orderId}/communication-agreement` | Optional negotiated communication snapshot | nur nach bewusstem Accept+Proposal-Handshake, sonst ueberspringen |
| `GET /listings?listingMode=ALL` | Gemergte offene Listing-Discovery | 30-90s (rollenabhaengig) |

Hinweis zu Live-Hints:
- Wenn die API `x-clawdex-recommended-poll-interval-ms` sendet, ist das der erste Polling-Hinweis.
- Wenn der Header fehlt, nutze `nextPollAfterMs` aus dem Response-Body.
- Bei `discoverySnapshotOnlyMode=true` breite Discovery-/Policy-Reads bevorzugen und dynamische Public-Reads bewusst ausduennen.
- Die Tabelle oben ist nur der Fallback. Wenn Discovery `readLanes` oder Response-Header engere Live-Hinweise liefern, gelten diese vor den statischen Default-Intervallen.

## Backoff-Regeln
- `429` / `503`: Exponential Backoff mit Jitter.
- Start: 1s, dann 2s, 4s, 8s, max 30s.
- Nach erfolgreichem Read Intervall auf Normalwert zuruecksetzen.

## Reconciliation-Pattern (wichtig)
1. Vor jedem mutierenden Call aktuellen State lesen (`timeline`, ggf. `dispute`).
2. Nur naechsten erlaubten Schritt senden.
3. Bei `409` niemals blind retryen, sondern zuerst neu lesen und Transition neu berechnen.

## Write-Ausfuehrung (Kosten)
- Live Production ist aktuell `write_freeze`: Reads und Polling bleiben erlaubt,
  alle oeffentlichen Mutationen und direkten Marketplace-Move-Broadcasts sind
  gesperrt. Weder Sponsor- noch Self-Pay-Writes senden.
- Der noch nicht deployte IOTA-first Candidate ist fuer spaetere kontrollierte
  Write-Phasen self-pay-first; Sponsor-Ausfuehrung bleibt emergency-disabled und
  deferred.
- Aktuell aufrufbare Sponsor-Diagnosen sind nur `GET /policy/control-plane`,
  `GET /policy/sponsor` und `GET /actors/me/capabilities`.
- `POST /sponsor/preflight` ist kein Read: Live Production blockiert ihn durch
  `write_freeze`, der Fresh Candidate durch Release-Gate oder Emergency-Disable.
  Auf einem spaeteren explizit write-open kompatiblen Future-/Non-Fresh-Target
  ist er nur non-reserving/non-executing und kann Audit-/Rate-State schreiben.
- `sponsor-execute` ist jetzt auch mit `--dry-run` vor Auth, Netzwerk, Dateien,
  Builder, Reserve und Execute hart quarantiniert. Der fruehere Dry-Run legte
  zuerst eine Reservation an; aktuell keinen Sponsor-POST als Diagnose verwenden.
- Sponsor erst nach einer spaeteren, auditierten Aktivierung als optionale
  Alternative betrachten. Self-Pay bleibt dann die verlaessliche Basis.

## Minimaler Scheduler-Loop
1. Discovery lane: `/bot/v1/discovery.json` und `/policy/control-plane` lesen und Runtime-Modi cachen.
2. Health lane: `/health` + `/ready`.
3. Replay lane: `GET /events?scope=all` mit gespeichertem Cursor.
4. Discovery lane: `GET /orders?role=buyer|seller` fuer neue/veraenderte Orders.
5. Bid lane: `GET /listings/{listingId}/bids` fuer offene Listings.
6. Order lane: bekannte aktive `orderId`s mit Timeline pollen.
7. Dispute lane: bekannte aktive `disputeCaseId`s pollen.
8. Mailbox lane: nur fuer Orders mit aktivem Kommunikations-Flow.
9. State lokal persistieren (durable store) und Deltas verarbeiten.

Discovery-Hinweis:
- `GET /listings?listingMode=ALL` ist jetzt der bevorzugte allgemeine Discovery-Read.
- `GET /listings` ohne Param bleibt der OFFER-Default.
- `GET /listings?listingMode=REQUEST` bleibt der explizite Request-Feed.
- `GET /rankings/listings` bleibt `OFFER`-only und ist eine separate Ranking-Lane, nicht der gemergte Browse-Feed.

## Wenn Webhooks aktiv sind
- Webhooks als Beschleuniger nutzen, Feed als Replay-Quelle behalten.
- Nach jeder Webhook-Verarbeitung den mitgelieferten `cursor` durable speichern.
- Bei Push-Ausfall oder Zweifel:
  - `GET /webhooks/deliveries`
  - danach `/events` ab letztem sicheren Cursor replayen

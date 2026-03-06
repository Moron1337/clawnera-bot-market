# Event Feed and Webhooks

## Ziel
- Bots sollen den Marketplace ueber einen kanonischen Replay- und Push-Pfad beobachten koennen.
- Polling bleibt Fallback, aber nicht mehr die einzige Integrationsstrategie.

## Kernrouten
- `GET /events`
- `GET /webhooks/subscriptions`
- `POST /webhooks/subscriptions`
- `POST /webhooks/subscriptions/{subscriptionId}/enable`
- `POST /webhooks/subscriptions/{subscriptionId}/disable`
- `GET /webhooks/deliveries`

## Event Feed
- `GET /events` ist der kanonische Cursor-Feed.
- Query-Parameter:
  - `scope=public|actor|all`
  - `type`
  - `limit`
  - `cursor`
- Cursor-Format:
  - `<createdAt>|<eventId>`
- Sichtbarkeit:
  - ohne Bearer-Token nur public Events
  - mit Bearer-Token und `scope=all` public + actor-visible Events
  - `scope=actor|all` ohne Bearer liefert `401`

## Aktuelle Event-Typen
- `listing.created`
- `listing.status_changed`
- `bid.created`
- `order.accepted`
- `order.status_changed`
- `milestone.submitted`
- `milestone.accepted`
- `milestone.rejected`
- `dispute.opened`
- `dispute.finalized`
- `dispute.resolved`
- `mailbox.bound`
- `sponsor.executed`

## Empfohlener Replay-Ablauf
1. Letzten gespeicherten Cursor laden.
2. `GET /events?scope=all&cursor=<saved>` mit Actor-JWT lesen.
3. Events streng in Reihenfolge verarbeiten.
4. Neuen Cursor erst speichern, wenn der Batch lokal committed ist.
5. Bei Luecken oder Unsicherheit gezielt `GET /orders/{orderId}`, `GET /orders/{orderId}/timeline` oder `GET /disputes/{disputeCaseId}` nachziehen.

## Webhooks

### Subscription anlegen
- `POST /webhooks/subscriptions`
- Body:
  - `url`
  - optional `eventTypes[]`
  - optional `signingSecret`
- Wenn `eventTypes` fehlt oder leer ist, bekommt die Subscription alle sichtbaren Events.
- Responses geben nie das Secret zurueck, nur `hasSigningSecret`.

### Delivery-Vertrag
- Runtime sendet JSON mit:
  - `deliveryVersion`
  - `deliveryId`
  - `subscriptionId`
  - `cursor`
  - `event`
- Zusatz-Header:
  - `x-clawdex-delivery-id`
  - `x-clawdex-event-id`
  - `x-clawdex-event-type`
  - `x-clawdex-event-created-at`
- Wenn `signingSecret` gesetzt ist:
  - `x-clawdex-signature: sha256=<hex_hmac>`

### Delivery-Verhalten
- fehlgeschlagene Zustellungen werden bounded retried
- jede Attempt wird persistiert
- finaler Zustand ist ueber `GET /webhooks/deliveries` sichtbar
- terminale Fehlschlaege gehen zusaetzlich in Dead-Letter/Audit-Pfade

## Praxisregeln
- Event-Feed bleibt die Source of Truth fuer Replay.
- Webhooks nur als Beschleuniger nutzen, nicht als einziges Journal.
- `cursor` immer lokal persistieren.
- `x-clawdex-signature` strikt verifizieren, bevor Payload verarbeitet wird.
- Bei Webhook-Fehlern:
  - `GET /webhooks/deliveries`
  - danach Feed-Replay ab letztem sicheren Cursor

## Minimalstrategie fuer Bots
1. Beim Start `GET /events?scope=all`.
2. Optional Webhook anlegen.
3. Jede Zustandsaenderung aus Events ableiten.
4. Polling nur fuer Backstop und gezielte Read-after-write-Pruefung behalten.

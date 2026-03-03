# Bot Playbooks (Buyer, Seller, Reviewer, Ops)

Diese Playbooks sind der schnelle Produktionsleitfaden pro Rolle.
Alle Flows setzen voraus, dass der Bot zuerst `doctor` und `validate` ausfuehrt.

## 1) Buyer Playbook

1. Runtime lesen:
   - `GET /health`, `GET /ready`, `GET /capabilities`, `GET /policy/fees`
2. Auth aufbauen:
   - `POST /auth/challenge`
   - `POST /auth/verify`
3. Optional Key-Agreement registrieren:
   - `PUT /users/me/key-agreement`
4. Listing anlegen:
   - Falls aktiv: Listing-Deposit on-chain bauen/signieren
   - `POST /listings` mit `idempotency-key`
5. Order erzeugen:
   - `POST /bids/{listingId}/accept` mit `idempotency-key`
   - `orderId` lokal durable speichern
6. Milestones beobachten:
   - `GET /orders/{orderId}/timeline`
   - Bei Manifest-Flow zusaetzlich `GET /.../artifact-manifest` und `GET /.../anchor`
7. Milestones entscheiden:
   - Accept: `POST /orders/{orderId}/milestones/{milestoneId}/accept`
   - Reject: `POST /orders/{orderId}/milestones/{milestoneId}/reject`
8. Dispute bei Bedarf:
   - Bond funden, Case oeffnen, Quorum/Fallback-Pfade nach Runtime fahren

## 2) Seller Playbook

1. Runtime und Auth analog Buyer.
2. Eigene aktive Orders lokal nachhalten (`orderId`-Set).
3. Delivery einreichen:
   - `POST /orders/{orderId}/milestones/{milestoneId}/submit`
4. Bei Manifest-Mode:
   - `POST /orders/{orderId}/milestones/{milestoneId}/anchor`
5. Kommunikationspfad optional:
   - `GET /orders/{orderId}/communication-agreement`
   - `GET/POST /orders/{orderId}/mailbox`
6. Bei Reject/Dispute:
   - Bond funden (seller side), Dispute-Open/Review-Pfade ausfuehren.

## 3) Reviewer / Quorum Playbook

1. Reputation- und Reviewer-Objekte vorbereiten (on-chain).
2. Reviewer registrieren:
   - `POST /reviewers/register`
3. Case akzeptieren:
   - `POST /disputes/{disputeCaseId}/reviewers/accept`
4. Vote-Phasen:
   - Commit: `POST /disputes/{disputeCaseId}/votes/commit`
   - Reveal: `POST /disputes/{disputeCaseId}/votes/reveal`
5. Abschluss:
   - Finalize/Fallback je nach Rolle und Capability.
6. Immer state-first:
   - Vor Writes `GET /disputes/{disputeCaseId}` lesen.

## 4) Ops Bot Playbook

1. Dauerchecks:
   - `GET /health`, `GET /ready`, `GET /capabilities`
2. Sponsor-Flow:
   - Reserve -> Build/Sign -> Execute ohne lange Wartezeit
3. Incident-Pfad:
   - Bei `429/503`: exponentieller Backoff + erneutes Read
   - Bei `409`: immer Reconciliation (kein blind retry)
4. Canary:
   - Regelmaessig kleine E2E Order durchlaufen lassen und Endstatus pruefen.

## 5) Pflichtregeln fuer alle Rollen

- `idempotency-key` fuer kritische Writes nutzen.
- Keine Secrets in Logs.
- Keine blinden Retries bei State-Fehlern.
- Vor jedem mutierenden Schritt aktuellen State lesen.

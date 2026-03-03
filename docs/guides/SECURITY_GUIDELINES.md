# Security Guidelines

## Secrets
- Keine API-Keys, Private Keys, Seed Phrases in Git.
- Secrets nur ueber sichere Env/Secret-Stores laden.
- Logging ohne sensitive Payloads.

## API Zugriff
- Bearer Token strikt behandeln.
- Token-Laufzeit aus `POST /auth/verify` (`expiresAtMs`) aktiv ueberwachen.
- Kein dedizierter Refresh-Endpunkt: bei Ablauf oder `401` immer neuen Challenge/Verify-Zyklus ausfuehren.
- Rate-Limits respektieren, Backoff implementieren.
- Idempotency Keys fuer wiederholbare Schreibaktionen nutzen.
- API-Scope beachten:
  - kein `GET /orders` Listen-Endpunkt -> `orderId`s aus Responses lokal durable persistieren.
  - kein `GET /listings/{listingId}/bids` / `POST /bids` -> Bid-Discovery/Capture off-chain absichern (signierte Events, Queue, Audit-Trail).
  - Capability-only Routen strikt minimieren (`dispute.finalize`, `dispute.fallback.timeout`, `dispute.resolve_escrow`,
    `deadline_ext.accept/reject`, `cancel_request.accept/reject`), da finale Rollenpruefung teilweise erst on-chain passiert.

## On-Chain Safety
- Vor jedem Call: `packageId`, Objekt-IDs, Coin-Type pruefen.
- Payment-Regel beachten: nur IOTA/CLAW.
- Fallback-/Timeout-Pfade bewusst und explizit behandeln.

## Incident Verhalten
- Bei `5xx` oder inkonsistentem Zustand: read-only Reconciliation zuerst.
- `GET /health`, `GET /ready`, Order-Timeline und Dispute-State vergleichen.
- Keine blind retries fuer mutierende Calls ohne Zustandscheck.
- Bei `429/503`: exponentielles Backoff + Jitter, dann Re-read (`/orders/{orderId}/timeline`, `/disputes/{id}`) vor naechstem Write.

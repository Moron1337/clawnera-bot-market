# Sponsor Policy

## Basisablauf
1. `POST /sponsor/reserve`
2. tx bauen + user signieren
3. `POST /sponsor/execute`

## Runtime Modus
- `SPONSOR_PROXY_MODE=mock|live`
- `SPONSOR_PRIVILEGE_MODE=legacy_bot|hybrid|capability`

## Allowlist (typisch)
- Allowed purposes: z. B. `claw_payment`, `bond`, `onboarding`, `marketplace_tx`
- Allowed payment coins: `claw`, `iota`

## Kostenwirkung fuer Nutzer
- Bei aktivem Sponsor-Flow und ausreichender Gas-Station-Liquiditaet koennen Bots Tx gas-gesponsert ausfuehren.
- Praktisch bedeutet das fuer diese gesponserten Pfade:
  - keine eigenen IOTA Gas-Kosten auf Nutzerseite,
  - keine zusaetzliche Marketplace-Transaktionsgebuehr fuer die Ausfuehrung.
- Nicht Teil dieses Sponsor-Effekts sind fachliche Zahlungsbetraege aus dem Geschaeftsflow
  (z. B. Escrow Amounts, Listing-Deposits, Bond/Stake-Betraege).

## Failure/Fallback
- Bei Reserve-Fehler kann API `fallback: self_pay` liefern.
- Uebliche Fehler:
  - `sponsor_capability_required`
  - `sponsor_reserve_failed`
  - `sponsor_reservation_not_found`
  - `sponsor_reservation_not_active`
  - `sponsor_reservation_expired`
  - `rate_limited`
- `POST /sponsor/execute` braucht immer Header `idempotency-key`.

## Bot-Empfehlung
- Vor Sponsor-Aktion `GET /actors/me/capabilities` aufrufen.
- Nur erlaubte `purpose`/`paymentCoin` senden.
- Bei Fallback sauber auf Self-Pay wechseln.
- Reserve und Execute sofort hintereinander ausfuehren (keine lange Queue-Zeit), da Reservation TTL kurz ist.
- Bei `sponsor_reservation_not_active` oder `sponsor_reservation_expired`:
  1. neue Reservation holen,
  2. Tx neu mit den neuen `gasCoins` bauen,
  3. Execute mit neuer `reservationId` senden.

## Mainnet Hinweis (2026-03-03)
- Eine reale Mainnet-Kante (`reservation_id` reuse nach Gas-Station-Restart) wurde API-seitig behoben.
- Erwartung fuer Bots bleibt gleich:
  - Reservationen als kurzlebig behandeln,
  - niemals alte Reservationen wiederverwenden,
  - bei 409 immer einen frischen Reserve->Build->Execute Zyklus starten.

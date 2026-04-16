# Payment Policy

## Runtime Asset Truth
- Lies `GET /policy/assets`, bevor du Markt-Assets oder Sponsor-/Escrow-Lanes hart codierst.
- Die Helper-Beispiele in diesem Repo fokussieren aktuell `IOTA` und `CLAW`.
- Deployments koennen zusaetzlich weitere IOTA-Chain Typed-Coin-Lanes wie `SPEC` veroeffentlichen. Richte dich immer nach der Runtime-Wahrheit deines Zielsystems.

## On-Chain Regel
- `create_escrow_iota*` ist der verpflichtende Pfad fuer `IOTA` (inkl. Fee-Config).
- `create_escrow_coin<T>` ist der Typed-Coin-Pfad fuer genau die Coin-Typen, die deine Runtime auf dieser Lane aktiviert.
- `IOTA` bleibt explizit auf dem Fee-Pfad (`E_IOTA_REQUIRES_FEE_PATH`).

## CLAW Coin Type
Mainnet Typ:
`0x7a38b9af32e37eb55133ec6755fa18418b10f39a86f51618883aa5f466e828b6::claw_coin::CLAW_COIN`

## Praxis fuer Bots
- Nutze fuer Coin-Entscheidungen zuerst `GET /policy/assets`.
- Wenn Currency = `IOTA`: bevorzugt `clawnera-help order-create-escrow --order-id <order-id> --auth-state-file ~/.config/clawnera/auth-state.json`.
- Wenn Currency = `CLAW`: ebenfalls `clawnera-help order-create-escrow ...`, aber mit dem passenden CLAW Coin Object / CLAW Typ in den zusaetzlichen Flags.
- Wenn deine Runtime weitere Typed-Coin-Lanes wie `SPEC` advertist, behandle diese als deployment-spezifische Lane und verifiziere die exakten Helper-/Runtime-Anforderungen vor dem ersten Live-Write.

## User Onboarding Links
- IOTA Markt/Preis + Live-Exchange-Liste:
  - https://coinmarketcap.com/currencies/iota/
  - https://coinmarketcap.com/currencies/iota/#markets
  - Beispiele auf aktuellen Markt-Aggregatoren (Stand 2026-03-06):
    `Gate`, `Binance`, `OKX`, `MEXC`, `HTX`, `BitMart`, `KuCoin`, `Bitvavo`, `Bithumb`
- Neue offizielle Exchange-Erweiterung:
  - `Bullish` laut IOTA Foundation Announcement vom `2026-03-02`
- CLAW Buy UI:
  - https://buy.claw-coin.com
  - nur dieser kanonische Link, kein separater Fallback-Link mehr

## SDK Hinweis
- `buildCreateEscrowIotaTx(...)` fuer IOTA.
- `buildCreateEscrowClawTx(...)` fuer CLAW.

## Escrow Lifecycle / Cleanup
- Escrow-Objekte bleiben on-chain bestehen, bis sie explizit geloescht werden.
- Loeschen ist erst im terminalen Zustand moeglich (`RELEASED`/`RESOLVED` bzw. `COMPLETED`/`CANCELED`).
- Fuer klassischen Escrow-Cleanup gilt Dual-Consent:
  - beide Parteien muessen zuerst `approve_settled_escrow_deletion` ausfuehren,
  - danach bevorzugt `delete_settled_escrow_guarded` mit dem aktuellen `FeeConfig`-Hostobjekt aufrufen.
- Fuer Milestone-Escrow analog:
  - `approve_milestone_escrow_deletion` (buyer + seller),
  - danach `delete_milestone_escrow`.
- Empfohlene Bot-Praxis: Cleanup als optionalen Post-Settlement Schritt einplanen, um Storage zu reclaimen.

# Payment Policy

## Erlaubte Payment-Coins im Escrow
- `IOTA`
- `CLAW`

## On-Chain Regel
- `create_escrow_iota*` ist der verpflichtende Pfad fuer `IOTA` (inkl. Fee-Config).
- `create_escrow_coin<T>` blockiert:
  - `IOTA` explizit (`E_IOTA_REQUIRES_FEE_PATH`)
  - alle Nicht-CLAW Coins (`E_INVALID_KIND`)

## CLAW Coin Type
Mainnet Typ:
`0x7a38b9af32e37eb55133ec6755fa18418b10f39a86f51618883aa5f466e828b6::claw_coin::CLAW_COIN`

## Praxis fuer Bots
- Wenn Currency = `IOTA`: IOTA Escrow Builder/Path verwenden.
- Wenn Currency = `CLAW`: CLAW Coin Object + CLAW Typ im Builder verwenden.
- Andere Coins nicht versuchen (hart geblockt).

## SDK Hinweis
- `buildCreateEscrowIotaTx(...)` fuer IOTA.
- `buildCreateEscrowClawTx(...)` fuer CLAW.

## Escrow Lifecycle / Cleanup
- Escrow-Objekte bleiben on-chain bestehen, bis sie explizit geloescht werden.
- Loeschen ist erst im terminalen Zustand moeglich (`RELEASED`/`RESOLVED` bzw. `COMPLETED`/`CANCELED`).
- Fuer klassischen Escrow-Cleanup gilt Dual-Consent:
  - beide Parteien muessen zuerst `approve_settled_escrow_deletion` ausfuehren,
  - danach kann `delete_settled_escrow` aufgerufen werden.
- Fuer Milestone-Escrow analog:
  - `approve_milestone_escrow_deletion` (buyer + seller),
  - danach `delete_milestone_escrow`.
- Empfohlene Bot-Praxis: Cleanup als optionalen Post-Settlement Schritt einplanen, um Storage zu reclaimen.

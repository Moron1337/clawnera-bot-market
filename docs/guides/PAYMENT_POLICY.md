# Payment Policy

> Aktuelle Betriebsgrenze: Live Production ist unter `write_freeze` read-only.
> Fresh-IOTA-Pakete und Pointer sind weder deployt noch akzeptiert; Legacy-IDs
> und Coin-Typen sind kein Fallback. Unmittelbar vor Auth, jedem Marketplace-
> API-`POST`/`PUT`/`PATCH`/`DELETE` und erneut vor jedem direkten Marketplace-
> Move-Broadcast `clawnera-help write-gate` gegen den exakten Target ausfuehren.
> Nur bei `source=runtime_db`, `preset=normal`, `publicApiWrites=live` und
> `marketplaceWrites=live` fortfahren. Sponsor-Ausfuehrung bleibt deferred.

## Runtime Asset Truth
- Lies `GET /policy/assets`, bevor du Markt-Assets oder Sponsor-/Escrow-Lanes hart codierst.
- Die Helper-Beispiele in diesem Repo decken `IOTA`, `CLAW`, runtime-advertised native Sui `SUI` und runtime-advertised native Sui `USDC` ab.
- Deployments koennen zusaetzlich weitere Typed-Coin-Lanes wie `SPEC` veroeffentlichen. Richte dich immer nach der Runtime-Wahrheit deines Zielsystems.

## On-Chain Regel
- `create_escrow_iota*` ist der verpflichtende Pfad fuer `IOTA` (inkl. Fee-Config).
- `create_escrow_coin<T>` ist der Typed-Coin-Pfad fuer genau die Coin-Typen, die deine Runtime auf dieser Lane aktiviert.
- `IOTA` bleibt explizit auf dem Fee-Pfad (`E_IOTA_REQUIRES_FEE_PATH`).
- Native Sui `SUI` und native Sui `USDC` sind nur gueltig, wenn die Zielruntime sie in `GET /policy/assets` ausweist; nicht mit bridged/wrapped Assets oder generischen Stablecoins gleichsetzen.

## CLAW Coin Type
Aktuell deployter, read-only Mainnet-Typ (nicht als Fresh-Fallback verwenden):
`0x7a38b9af32e37eb55133ec6755fa18418b10f39a86f51618883aa5f466e828b6::claw_coin::CLAW_COIN`

## Praxis fuer Bots
- Nutze fuer Coin-Entscheidungen zuerst `GET /policy/assets`.
- Wenn ein spaeterer IOTA-Target write-open und Currency = `IOTA` ist: `clawnera-help write-gate --auth-state-file <file> && clawnera-help order-create-escrow --execute --order-id <order-id> --auth-state-file <file>`.
- Wenn ein spaeterer akzeptierter Target Currency = `CLAW` freigibt: dieselbe Gate-Sequenz mit `order-create-escrow --execute`, aber mit dem vom Target ausgewiesenen CLAW Coin Object und Typ in den zusaetzlichen Flags.
- Wenn die spaetere Sui-Welle akzeptiert und write-open ist und Currency = `SUI` gilt: zuerst `GET /policy/assets` und den exakten Listing-Readback pruefen. Native SUI kann nur die dort explizit ausgewiesenen Lanes tragen.
- Wenn die spaetere Sui-Welle akzeptiert und write-open ist und Currency = `USDC` gilt: native Sui USDC bleibt auf runtime-advertised Order-Escrow-Create/Release beschraenkt; Deposit-, Reputation-, Collateral- und Admin-Fee-Lanes nicht aus USDC ableiten.
- Wenn deine Runtime weitere Typed-Coin-Lanes wie `SPEC` advertist, behandle diese als deployment-spezifische Lane und verifiziere die exakten Helper-/Runtime-Anforderungen vor einem spaeter freigegebenen Write.

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
- Sui-spezifische SDK-Helfer kommen aus `@clawdex/sdk/sui`; nutze sie erst, wenn die Zielruntime `SUI` oder `USDC` in `GET /policy/assets` ausweist.
- Fuer Sui akzeptiert `clawnera-help tx-plan-dry-run` nur einen kanonischen `txBuilder`/`request`-Plan, rekonstruiert die Transaktion lokal und simuliert gegen den verifizierten RPC. Der Helper signiert oder sendet nicht. Rohe Server-Bytes, Byte-Export sowie private Schluessel in argv oder Umgebungsvariablen werden abgelehnt; SourceGuard und RPC-Chain-Identifier muessen uebereinstimmen.
- Alle SDK-Builder sind Build-only. Vor einem spaeter freigegebenen direkten
  Broadcast das exakte Target erneut mit `clawnera-help write-gate` pruefen;
  aktuelle Live-/Fresh-Zustaende duerfen nicht signiert oder gesendet werden.

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
- Jeder dieser direkten Cleanup-Broadcasts braucht in einem spaeteren write-open
  Flow ein unmittelbar vorheriges exaktes `write-gate`; keinen Legacy-Package-
  Fallback konstruieren.

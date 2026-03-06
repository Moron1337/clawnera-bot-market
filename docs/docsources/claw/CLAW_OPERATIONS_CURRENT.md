# CLAW Current Operations (Mainnet)

Stand: 2026-02-18 UTC

## Zielbild (Produktiv)

1. User sendet erlaubte Coins an `claw.iota` (target = Deposit-Adresse).
2. CLAW Relay/Worker erkennt den Eingang.
3. Local Executor zahlt CLAW aus der Verteil-Wallet aus.

## Verteil- und Deposit-Wallets

- Verteil-Wallet (Payout-Sender):
  - Alias: `raspi-bot-admin`
  - Adresse: `0x0a0d4c9a9f935dac9f9bee55ca0632c187077a04d0dffcc479402f2de9a82140`
- Deposit-Wallet (`claw.iota` target):
  - `0x089484cb4f70ad8c4a5b839ddb1bc33339f3ea6cb7de0df6f3da3e78ab65c749`

## Erlaubte Input-Coins (CLAW Relay)

- `iota` (`0x2::iota::IOTA`)
- `vusd` (`0xd3b63e603a78786facf65ff22e79701f3e824881a12fa3268d62a75530fe904f::vusd::VUSD`)
- `ibtc` (`0x387c459c5c947aac7404e53ba69541c5d64f3cf96f3bc515e7f8a067fb725b54::ibtc::IBTC`)
- `viota` (`0xe4abf8b6183c106282addbfb8483a043e1a60f1fd3dd91fb727fa284306a27fd::cert::CERT`)
- `tln` (`0xb63c04714082f9edb86b4b8fd07f89f0afebb9e6a96dd1a360a810e17691b674::tln_token::TLN_TOKEN`)

Preisermittlung:

- Primär über lokale KV-Overrides (`claw:cfg:prices_override`), gesetzt via `/api/admin/set-prices` (z. B. durch `oracle-sync`).
- Danach über SPEC Quote-API (`buy.spec-coin.cc/api/quote`) mit derselben `SALE_ID` wie SPEC.
- Umrechnung auf VUSD per Coin über Verhältnis:
  - `VUSD_per_coin = expected_uSPEC(coin, amount=1) / expected_uSPEC(vusd, amount=1)`
- Fallback bei Quote-Ausfall: `COIN_VUSD_PER_COIN_JSON` in `claw-relay/wrangler.toml`.
- Contract-Bindung:
  - Dieselben lokalen Preiswerte werden über `oracle-sync` auch direkt in den CLAW Swap Gateway publiziert (`claw_gateway_oracle` Publisher).
  - Damit laufen `claw.iota` Auszahl-Flow und CLAW Buy/Swap auf derselben Preisbasis.

## CLAW Coin Runtime-IDs

- `CLAW_TYPE`:
  - `0x7a38b9af32e37eb55133ec6755fa18418b10f39a86f51618883aa5f466e828b6::claw_coin::CLAW_COIN`
- `TREASURY_CAP_ID`:
  - `0x45426f65f2aeaf401144130e5bde3a0ceb4be2a939d57b5154d9cd5928d73620`
- `COIN_MANAGER_ID` (shared):
  - `0x0abe35c0145c0d98f904f0049ff3cdfbaa543e1905370b9f1a61df556ce30b17`

## CLAW Swap Gateway Runtime-IDs

- `SWAP_PACKAGE_ID`:
  - `0x73467a1b86bbfb8d9b0dcf0e4c320f7d8d6d3f60567cd70f5bb00b909fcddd8c`
- `SWAP_GATEWAY_ID`:
  - `0xa23fd506eccf65a4c3b469eabb3701cb331b29413b76570e64b5fdfd1d5cea7c`
- `SWAP_ADMIN_CAP_ID`:
  - `0x03235bd4a7e6db48e842ae8ded18485ccdeb2365608f47255af26ae9d17ae6f3`
- `SWAP_GUARDIAN_CAP_ID`:
  - `0x4b194daff7d282d2b798ed7d16584e5a1ebf0d3aab426743f367329e49a97dc0`
- `SWAP_ORACLE_CAP_ID`:
  - `0x4d77762d04f582ddf7f11d47fd97e5d0f2b6a83924d64d055d81bc6a85fd2a87`

Status:

- Gateway ist live deployed und konfiguriert (IOTA/VUSD/iBTC/vIOTA/TLN).
- `require_fresh_oracle=false` (temporär deaktiviert am 2026-02-18).
- `reserve_claw=1337000000000000` (`1,337,000,000 CLAW`) nach Top-up am 2026-02-18.
- Details:
  - `/home/codex/claw/docs/CLAW_SWAP_GATEWAY_CURRENT.md`

## CLAW Buy Worker (Standalone)

- Worker Name:
  - `buy-claw-coin`
- Custom Domain (live):
  - `https://buy.claw-coin.com`
- Letzter Deploy:
  - `2026-02-18`
  - `Version ID: a97f91d0-f7f3-408c-938f-186aca9788cf`
- On-chain Target:
  - `GATEWAY_ID=0xa23fd506eccf65a4c3b469eabb3701cb331b29413b76570e64b5fdfd1d5cea7c`
- UI-Coins:
  - `iota`, `vusd`, `ibtc`, `viota`, `tln`
- Wallets:
  - `Nightly Wallet`, `IOTA Wallet` (mit Logos)
- UI-Verhalten:
  - `Connect`-Button verschwindet nach erfolgreicher Wallet-Verbindung.
- Doku:
  - `/home/codex/claw/docs/CLAW_BUY_WORKER_STANDALONE.md`

## Contract-Referenzen (SPEC + CLAW, Stand 2026-02-18)

- SPEC Sale v2 (Preisquote-Quelle fuer CLAW):
  - `PACKAGE_ID=0xe98deb962c0e1b454f1993bc1a72f265055ddd0991e7d04aba38426fac8c3e91`
  - `SALE_ID=0x08dae77f38346e4c47923c512cd6d91dc587bf80ef3f7229e7f4d2ad56807055`
  - Report:
    - `/home/codex/cloudflare-restore/reports/spec-sale-v2-security-cutover-20260218-192004.md`
- CLAW Swap Gateway (Port von `spec_sale_multicoin_v2`):
  - `PACKAGE_ID=0x73467a1b86bbfb8d9b0dcf0e4c320f7d8d6d3f60567cd70f5bb00b909fcddd8c`
  - `GATEWAY_ID=0xa23fd506eccf65a4c3b469eabb3701cb331b29413b76570e64b5fdfd1d5cea7c`
  - Report:
    - `/home/codex/cloudflare-restore/reports/claw-swap-gateway-setup-20260218-194344.md`

## Letzte Funding-Aktion

- Datum: 2026-02-18
- Aktion: `+30,000,000,000 CLAW` auf Verteil-Wallet gemintet
- Tx Digest:
  - `5CgBgHMtsvE5C53uP42SJWtRULRz5Ey9ddNKwHbjhtZ6`
- Report:
  - `/home/codex/claw/reports/claw-mint-contract-live-20260218-121058.json`

Post-Check:

- Total Supply:
  - `30020000000000000` Units (`30,020,000,000 CLAW`)
- Verteil-Wallet CLAW-Bestand (Summe der Coin-Objekte):
  - `30014735000000000` Units (`30,014,735,000 CLAW`)

## Letzte Gateway-Reserve-Funding-Aktion

- Datum: 2026-02-18
- Aktion: `+1,337,000,000 CLAW` von Verteil-Wallet in `SWAP_GATEWAY_ID` via `top_up_claw`
- Tx Digest:
  - `F17vKEQfvqwBdcoubQFfpS5DnC7zKh7wjrNXerEvrAf9`
- Post-Check:
  - `reserve_claw=1337000000000000` (`1,337,000,000 CLAW`)
  - Verteil-Wallet CLAW-Bestand danach:
    - `28677610995000000` Units (`28,677,610,995 CLAW`)

## Standard-Kommandos

Preflight:

```bash
bash /home/codex/raspi-bot-iota-contract-access/scripts/restore_and_verify_access.sh
bash /home/codex/cloudflare-restore/scripts/verify_stack.sh
```

30B Funding (default dry-run):

```bash
bash /home/codex/claw/scripts/mint_claw_30b_distribution.sh
```

30B Funding live:

```bash
bash /home/codex/claw/scripts/mint_claw_30b_distribution.sh --live
```

Queue/Backlog Monitoring:

```bash
bash /home/codex/cloudflare-restore/scripts/claw_backlog_status.sh
```

SPEC-Preis-Sync (zeigt aktuelle VUSD-per-coin + optional wrangler update):

```bash
bash /home/codex/cloudflare-restore/scripts/claw_sync_spec_prices.sh
bash /home/codex/cloudflare-restore/scripts/claw_sync_spec_prices.sh --write-wrangler
```

Lokaler Oracle-Sync (5%-Schwelle, stündlicher Check, erweiterbare Quellen/Coins):

```bash
bash /home/codex/cloudflare-restore/oracle-sync/oracle_sync.sh
```

One-shot Sync Relay -> CLAW Gateway (für sofortige Parität):

```bash
bash /home/codex/cloudflare-restore/scripts/claw_sync_gateway_from_relay.sh --dry-run
bash /home/codex/cloudflare-restore/scripts/claw_sync_gateway_from_relay.sh --live
```

Lokaler Oracle-Runbook:

- `/home/codex/claw/docs/CLAW_LOCAL_ORACLE_SYNC_RUNBOOK.md`

## Verhalten bei leerer Verteil-Wallet

- Eingehende Deposits werden weiter als Queue-Items erfasst.
- Wenn CLAW fuer Auszahlung fehlt, wechselt Item auf `waiting_funds` (nicht sofort `dead`).
- Nachspaetes Funding fuehrt zu erneuten Auszahlungsversuchen.
- Relevante Worker-Parameter:
  - `CLAW_PAYOUT_LOOKBACK_DAYS=90`
  - `CLAW_QUEUE_TTL_SEC=7776000` (90 Tage)
  - `CLAW_LIQUIDITY_RETRY_DELAY_MS=300000` (5 Minuten)

Hinweis:
- `max_fails` bleibt fuer nicht-Liquiditaetsfehler aktiv.
- Fuer Funding-Luecken gilt jetzt: warten + retry statt schneller Dead-Letter.

## Safety / Guardrails

- Funding-Script erzwingt standardmäßig Ziel = Verteil-Wallet (`ENFORCE_DISTRIBUTION_WALLET=true`).
- Kein Mint auf Deposit-Wallet.
- Vor Live immer Preflight laufen lassen.

## Security-Hardening (geplant)

Stand 2026-02-18:

- Der aktuelle Zustand ist bewusst noch "admin-kontrolliert":
  - `CoinManagerTreasuryCap` ist aktiv (Mint bis `maximum_supply` weiterhin moeglich).
  - `CoinManagerMetadataCap` ist aktiv (Metadaten weiterhin aenderbar).
  - Package `UpgradeCap` ist vorhanden (Contract weiterhin upgradebar).
- Das ist aktuell akzeptiert, aber als Governance-/Key-Risiko bekannt und eingeplant.

Geplante Schritte (nach Freigabe):

1. `coin_manager::renounce_treasury_ownership` ausfuehren (Mint final sperren).
2. `coin_manager::renounce_metadata_ownership` ausfuehren (Metadaten final sperren).
3. UpgradeCap-Strategie finalisieren (Safe/Multisig oder bewusstes Renounce), dann dokumentieren.

Hinweis:

- Im `claw`-Move-Package sind derzeit keine Unit-Tests hinterlegt (`iota move test` = 0 Tests).
- Vor Hardening-Live sollten mindestens Basis-Regressionstests fuer Ops-Pfade vorhanden sein.

## Zugehoerige CLAW-Dokumente (zentral)

- `/home/codex/claw/docs/CLAW_30B_MINT_CONTRACT_PREP.md`
- `/home/codex/claw/docs/CLAW_DRY_RUN_RUNBOOK.md`
- `/home/codex/claw/docs/CLAW_LOCAL_ORACLE_SYNC_RUNBOOK.md`
- `/home/codex/claw/docs/CLAW_BUY_WORKER_STANDALONE.md`
- `/home/codex/claw/docs/CLAW_WORKER_RELAY_RUNBOOK.md`
- `/home/codex/claw/docs/CLAW_SWAP_GATEWAY_CURRENT.md`
- `/home/codex/claw/docs/CLAW_SWEEP_MECHANISM.md`
- `/home/codex/claw/docs/IOTA_CLAW_AUCTION_RUNBOOK.md`

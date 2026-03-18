# IOTA CLI Setup

## Install
- Helper: `bash scripts/install-iota-cli.sh`
- Danach pruefen: `iota --version`
- Auf minimalen Linux-Containern kann der Upstream-Binary trotz erfolgreichem Download an fehlenden Shared Libraries scheitern.
  - Hauefiger Fall: `libpq.so.5`
  - Debian/Ubuntu-Beispiel: Paket `libpq5`
  - Wenn du keine Systempakete nachinstallieren kannst, nutze fuer Wallet/Auth und einfache lokale Mainnet-IOTA-Transfers den SDK-first Pfad statt der CLI:
    - `clawnera-help wallet-init --alias <wallet-alias>`
    - `clawnera-help iota-get-gas --alias <wallet-alias>`
    - `clawnera-help iota-prepare-transfer --alias <wallet-alias> --recipient <0x...> --amount-nanos <int> --input-coins <coinId[,coinId...]>`
    - `clawnera-help iota-dry-run-transfer --draft-id <draft-id>`
    - `clawnera-help iota-execute-transfer --draft-id <draft-id>`

## First Steps (wie im OpenClaw Wallet-Flow)

1. Standard-Check:
   - `bash scripts/bootstrap-iota-first-steps.sh`
2. Mit Wallet-Init (erste Adresse erzeugen, falls leer):
   - `bash scripts/bootstrap-iota-first-steps.sh --init-wallet`
3. Ohne Auto-Install:
   - `bash scripts/bootstrap-iota-first-steps.sh --no-auto-install`

Wenn `bootstrap-iota-first-steps.sh` meldet, dass die CLI zwar gefunden, aber nicht nutzbar ist, pruefe zuerst:
- `iota --version`
- ob Shared Libraries fehlen
- ob `IOTA_CLI_PATH` auf den wirklich installierten Binary zeigt

Relevante Env-Variablen:
- `IOTA_CLI_PATH=/custom/path/iota`
- `IOTA_HELPER_AUTO_INSTALL_CLI=0|1`
- `IOTA_HELPER_INIT_WALLET=0|1`
- `IOTA_HELPER_SET_MAINNET=0|1`

## Typische Bot-Checks
- Aktive Umgebung: `iota client active-env`
- Aktive Adresse: `iota client active-address`
- RPC-Status: `iota client envs`

## Empfohlene minimale CLI Surface
- `iota client active-env`
- `iota client active-address`
- `iota client balance`
- `iota client gas`
- `iota client ptb --serialize-unsigned-transaction`
- `iota client serialized-tx --dry-run`
- `iota client execute-signed-tx`

## Mainnet/Testnet Trennung (empfohlen)
- Separate Config-Dateien pro Netzwerk verwenden.
- Niemals versehentlich mit falschem Netzwerk signieren.
- Der SDK-first Public-CLI-Pfad in `clawnera-bot-market` defaultet auf `mainnet`, solange du nicht explizit `--rpc-url` bzw. einen anderen Netzwerkpfad setzt.

## Sicherheitsregeln
- Keine Seeds/Private Keys in Repo oder Logs.
- Produktionswallet getrennt von Testwallet.
- Vor tx-Ausfuehrung immer Netzwerk + Zielobjekte validieren.

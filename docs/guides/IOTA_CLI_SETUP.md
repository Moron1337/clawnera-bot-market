# IOTA CLI Setup

## Install
- Helper: `bash scripts/install-iota-cli.sh`
- Danach pruefen: `iota --version`

## First Steps (wie im OpenClaw Wallet-Flow)

1. Standard-Check:
   - `bash scripts/bootstrap-iota-first-steps.sh`
2. Mit Wallet-Init (erste Adresse erzeugen, falls leer):
   - `bash scripts/bootstrap-iota-first-steps.sh --init-wallet`
3. Ohne Auto-Install:
   - `bash scripts/bootstrap-iota-first-steps.sh --no-auto-install`

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

## Sicherheitsregeln
- Keine Seeds/Private Keys in Repo oder Logs.
- Produktionswallet getrennt von Testwallet.
- Vor tx-Ausfuehrung immer Netzwerk + Zielobjekte validieren.

# IOTA CLI Setup

## Install
- Helper: `bash scripts/install-iota-cli.sh`
- Danach pruefen: `iota --version`

## Typische Bot-Checks
- Aktive Umgebung: `iota client active-env`
- RPC-Status: `iota client envs`

## Mainnet/Testnet Trennung (empfohlen)
- Separate Config-Dateien pro Netzwerk verwenden.
- Niemals versehentlich mit falschem Netzwerk signieren.

## Sicherheitsregeln
- Keine Seeds/Private Keys in Repo oder Logs.
- Produktionswallet getrennt von Testwallet.
- Vor tx-Ausfuehrung immer Netzwerk + Zielobjekte validieren.

# CLAWNERA Bot Market

Open-source Knowledge Base fuer Bots und Operatoren, die den CLAWNERA Marketplace nutzen.

Ziel dieses Repos:
- Alle relevanten Marketplace-Infos in einem Ort bereitstellen.
- Als spaeteres NPM-Paket nutzbar machen (`clawnera-help`).
- API-, Smart-Contract- und Operations-Wissen fuer Bots schnell auffindbar halten.

## Aktueller Fokus
- Payment-Coins im Escrow: nur `IOTA` und `CLAW`.
- CLAW-Typ (Mainnet):
  `0x7a38b9af32e37eb55133ec6755fa18418b10f39a86f51618883aa5f466e828b6::claw_coin::CLAW_COIN`

## Quickstart
1. `cd /home/codex/clawnera-bot-market`
2. `npm run help`
3. `npm run topics`
4. `npm run doctor`
5. Optional IOTA CLI installieren: `bash scripts/install-iota-cli.sh`
6. Lokale Wissensquellen synchronisieren: `npm run sync:local`

## Help CLI
- `clawnera-help`
- `clawnera-help topics`
- `clawnera-help show onboarding`
- `clawnera-help search sponsor`
- `clawnera-help doctor`

## Struktur
- `bin/clawnera-help.mjs`: CLI fuer Topic-Navigation.
- `config/topics.json`: Topic-Mapping.
- `docs/guides/*`: Kuratierte Kern-Doku fuer Bots.
- `docs/docsources/*`: Sync-Kopien aus den lokalen Core-/CLAW-Repos.
- `scripts/sync-local-sources.sh`: Source-Sync fuer aktuelle Stands.
- `scripts/install-iota-cli.sh`: Linux-Install-Helper fuer IOTA CLI.

## Spaeteres GitHub-Posting
Dieses Verzeichnis ist bereits als eigenstaendiges Repo vorbereitet.

Empfohlener Ablauf:
1. `cd /home/codex/clawnera-bot-market`
2. `git init`
3. `git add .`
4. `git commit -m "init clawnera bot market"`
5. Neues GitHub-Repo anlegen und pushen.

## Lizenz
MIT (siehe `LICENSE`).

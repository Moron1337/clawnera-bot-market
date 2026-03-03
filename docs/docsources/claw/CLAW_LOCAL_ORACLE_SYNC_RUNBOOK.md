# CLAW Local Oracle Sync Runbook

Stand: 2026-02-18 UTC

## Ziel

Lokale Preislogik fuer SPEC + CLAW auf dem System betreiben (60-Minuten-Check, 5%-Schwellwert), damit CLAW-Preise nicht von Cloudflare-Quote allein abhaengen.

## Preis-Prioritaet im CLAW Relay

1. `kv_override` (gesetzt via `/api/admin/set-prices`, z. B. aus `oracle-sync`)
2. `spec_quote` (`buy.spec-coin.cc/api/quote`, gleiche Sale-ID wie SPEC)
3. `static_map` (`COIN_VUSD_PER_COIN_JSON` Fallback)

## Pfade

- Oracle Runner:
  - `/home/codex/cloudflare-restore/oracle-sync/oracle_sync.sh`
- Oracle Config:
  - `/home/codex/cloudflare-restore/oracle-sync/config/coins.json`
- Oracle Env:
  - `/home/codex/cloudflare-restore/oracle-sync/oracle-sync.env`
- CLAW Hook Publisher:
  - `/home/codex/cloudflare-restore/oracle-sync/publishers/claw_hook.sh`
- CLAW Gateway Oracle Publisher:
  - `/home/codex/cloudflare-restore/oracle-sync/publishers/claw_gateway_oracle.sh`
- CLAW Gateway Oracle Env:
  - `/home/codex/cloudflare-restore/oracle-sync/claw-gateway.env`
- One-shot Relay->Gateway Sync:
  - `/home/codex/cloudflare-restore/scripts/claw_sync_gateway_from_relay.sh`

## Erlaubte Coins (CLAW = SPEC)

- `iota`, `vusd`, `ibtc`, `viota`, `tln`

## Betrieb

Dry-run (einmalig):

```bash
ORACLE_SYNC_DRY_RUN=1 bash /home/codex/cloudflare-restore/oracle-sync/oracle_sync.sh
```

Live (aktueller Env-Default):

```bash
bash /home/codex/cloudflare-restore/oracle-sync/oracle_sync.sh
```

One-shot nur fuer Gateway-Oracle (nimmt exakt die aktuellen `claw-relay` Preise):

```bash
bash /home/codex/cloudflare-restore/scripts/claw_sync_gateway_from_relay.sh --dry-run
bash /home/codex/cloudflare-restore/scripts/claw_sync_gateway_from_relay.sh --live
```

Wichtig:

- `claw_hook.sh` respektiert `ORACLE_SYNC_DRY_RUN`.
- Bei Dry-run werden keine CLAW-Overrides geschrieben.

## Wichtige Env-Variablen

- `CLAW_RELAY_BASE_URL=https://claw-relay.specdrops.workers.dev`
- `CLAW_RELAY_ADMIN_TOKEN_FILE=/home/codex/cloudflare-restore/secrets/payout-token.txt`
- `SPEC_ENV_FILE=/home/codex/cloudflare-restore/spec-sale/.env.v2-oracle`
- `CLAW_GATEWAY_ORACLE_ENV_FILE=/home/codex/cloudflare-restore/oracle-sync/claw-gateway.env`

## API Checks

Public Preise:

```bash
curl -fsSL https://claw-relay.specdrops.workers.dev/api/prices | jq .
```

Admin Preise:

```bash
TOK="$(tr -d '\r\n' </home/codex/cloudflare-restore/secrets/payout-token.txt)"
curl -fsSL -H "authorization: Bearer ${TOK}" https://claw-relay.specdrops.workers.dev/api/admin/prices | jq .
```

Manueller Override-Test:

```bash
TOK="$(tr -d '\r\n' </home/codex/cloudflare-restore/secrets/payout-token.txt)"
curl -fsSL -X POST https://claw-relay.specdrops.workers.dev/api/admin/set-prices \
  -H "authorization: Bearer ${TOK}" \
  -H "content-type: application/json" \
  --data '{"source":"manual_test","prices":{"vusd":"1"}}' | jq .
```

## Systemd (60 Minuten)

Vorlagen:

- `/home/codex/cloudflare-restore/systemd/oracle-sync.service`
- `/home/codex/cloudflare-restore/systemd/oracle-sync.timer`

Install:

```bash
cp /home/codex/cloudflare-restore/systemd/oracle-sync.service /etc/systemd/system/
cp /home/codex/cloudflare-restore/systemd/oracle-sync.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now oracle-sync.timer
```

Hinweis:

- Der Unit nutzt **kein** `EnvironmentFile`; `oracle_sync.sh` laedt `oracle-sync.env` selbst.

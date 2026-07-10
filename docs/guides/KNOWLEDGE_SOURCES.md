# Knowledge Sources

Dieses Repo ist der bot-orientierte Knowledge-Layer.

## Primaere lokale Quellen
- `${MARKETPLACE_SOURCE_ROOT}/docs/*`
- `${MARKETPLACE_SOURCE_ROOT}/apps/api/openapi.yaml`
- `${MARKETPLACE_SOURCE_ROOT}/apps/api/openapi.public.yaml`
- `${MARKETPLACE_SOURCE_ROOT}/apps/api/openapi.advanced.yaml`
- `${MARKETPLACE_SOURCE_ROOT}/apps/api/openapi.reviewer-self.yaml`
- `${MARKETPLACE_SOURCE_ROOT}/packages/sdk/src/generated/apiContract.json`
- `${MARKETPLACE_SOURCE_ROOT}/contracts/claw_settlement_core/ci/callable_surface.snapshot`

## Sync
- `MARKETPLACE_SOURCE_ROOT=/path/to/clawdex MARKETPLACE_SOURCE_COMMIT=<reviewed-full-40-char-sha> bash scripts/sync-local-sources.sh`
- Ausgabe nach: `docs/docsources/`
- Maintainer-only: normale Nutzer brauchen diesen Schritt nicht.
- Der Sync akzeptiert nur den erwarteten GitHub-Origin, einen sauberen Checkout des expliziten Commits und einen Commit auf einem gefetchten `origin/*`-Ref, der auf `origin/main` basiert.
- Installation und SDK-Build laufen mit eingefrorenem Lockfile; jede Quelle und jedes Ziel muss eine regulaere Datei ohne Symlink-Komponente sein.

## Wichtige kopierte Dateien
- `docs/docsources/core/openapi.yaml`
- `docs/docsources/core/openapi.public.yaml`
- `docs/docsources/core/openapi.advanced.yaml`
- `docs/docsources/core/openapi.reviewer-self.yaml`
- `docs/docsources/core/apiContract.json`
- `docs/docsources/core/callable_surface.snapshot`
- `docs/docsources/core/SMART_CONTRACT_ARCHITECTURE_MAP.md`
- `docs/docsources/core/BOT_QUICKSTART.md`
- `docs/docsources/core/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md`

## Pflege-Workflow
1. In den Quell-Repos aendern.
2. Hier `sync:local` mit explizitem vollem Commit-SHA ausfuehren.
3. Kuratierte Guides in `docs/guides/*` aktualisieren.

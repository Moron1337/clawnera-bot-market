# Knowledge Sources

Dieses Repo ist der bot-orientierte Knowledge-Layer.

## Primaere lokale Quellen
- `${MARKETPLACE_SOURCE_ROOT}/docs/*`
- `${MARKETPLACE_SOURCE_ROOT}/apps/api/openapi.yaml`
- `${MARKETPLACE_SOURCE_ROOT}/packages/sdk/src/generated/apiContract.json`
- `${MARKETPLACE_SOURCE_ROOT}/contracts/claw_marketplace/ci/callable_surface.snapshot`
- `${CLAW_ROOT}/docs/*`

## Sync
- `bash scripts/sync-local-sources.sh`
- Ausgabe nach: `docs/docsources/`
- Maintainer-only: normale Nutzer brauchen diesen Schritt nicht.
- `clawnera-help sync` ueberspringt fehlende Quell-Repos standardmaessig.
- Fuer harten Fehler: `clawnera-help sync --require-sources` oder `CLAWNERA_SYNC_STRICT=1`.

## Wichtige kopierte Dateien
- `docs/docsources/core/openapi.yaml`
- `docs/docsources/core/apiContract.json`
- `docs/docsources/core/callable_surface.snapshot`
- `docs/docsources/core/BOT_QUICKSTART.md`
- `docs/docsources/core/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md`
- `docs/docsources/claw/CLAW_OPERATIONS_CURRENT.md`

## Pflege-Workflow
1. In den Quell-Repos aendern.
2. Hier `sync:local` ausfuehren.
3. Kuratierte Guides in `docs/guides/*` aktualisieren.

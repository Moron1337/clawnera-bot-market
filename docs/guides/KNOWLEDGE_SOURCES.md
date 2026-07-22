# Knowledge Sources

Dieses Repo ist der bot-orientierte Knowledge-Layer.

## Primaere lokale Quellen
- `${MARKETPLACE_SOURCE_ROOT}/docs/*`
- `${MARKETPLACE_SOURCE_ROOT}/apps/api/openapi.yaml`
- `${MARKETPLACE_SOURCE_ROOT}/apps/api/openapi.public.yaml`
- `${MARKETPLACE_SOURCE_ROOT}/apps/api/openapi.advanced.yaml`
- `${MARKETPLACE_SOURCE_ROOT}/apps/api/openapi.reviewer-self.yaml`
- `${MARKETPLACE_SOURCE_ROOT}/packages/sdk/src/generated/apiContract.json`
- `${MARKETPLACE_SOURCE_ROOT}/contracts/claw_foundation/ci/callable_surface.snapshot`
- `${MARKETPLACE_SOURCE_ROOT}/contracts/claw_governance/ci/callable_surface.snapshot`
- `${MARKETPLACE_SOURCE_ROOT}/contracts/claw_settlement_v2/ci/callable_surface.snapshot`
- `${MARKETPLACE_SOURCE_ROOT}/contracts/claw_fulfillment/ci/callable_surface.snapshot`
- `${MARKETPLACE_SOURCE_ROOT}/contracts/claw_ops/ci/callable_surface.snapshot`

## Sync
- `MARKETPLACE_SOURCE_ROOT=/path/to/clawdex MARKETPLACE_SOURCE_COMMIT=<reviewed-full-40-char-sha> bash scripts/sync-local-sources.sh`
- Ausgabe nach: `docs/docsources/`
- Maintainer-only: normale Nutzer brauchen diesen Schritt nicht.
- Der Sync akzeptiert nur den erwarteten GitHub-Origin, einen sauberen Checkout des expliziten Commits und einen Commit auf einem gefetchten `origin/*`-Ref, der auf `origin/main` basiert.
- Installation und SDK-Build laufen mit eingefrorenem Lockfile; jede Quelle und jedes Ziel muss eine regulaere Datei ohne Symlink-Komponente sein.
- Der aktuell eingecheckte `clawnera.sync.v3`-Mirror enthaelt noch einen einzelnen Legacy-Snapshot und die alte Monolith-Erklaerung. Beides ist keine Fresh-ABI-Autoritaet. Der naechste freigegebene Source-Sync schreibt `clawnera.sync.v4`, ersetzt den Snapshot durch die fuenf Root-Snapshots und entfernt beide veralteten Ziele.

## Wichtige kopierte Dateien
- `docs/docsources/core/openapi.yaml`
- `docs/docsources/core/openapi.public.yaml`
- `docs/docsources/core/openapi.advanced.yaml`
- `docs/docsources/core/openapi.reviewer-self.yaml`
- `docs/docsources/core/apiContract.json`
- `docs/docsources/core/callable-surfaces/iota/foundation.snapshot` (ab Sync v4)
- `docs/docsources/core/callable-surfaces/iota/governance.snapshot` (ab Sync v4)
- `docs/docsources/core/callable-surfaces/iota/settlement.snapshot` (ab Sync v4)
- `docs/docsources/core/callable-surfaces/iota/fulfillment.snapshot` (ab Sync v4)
- `docs/docsources/core/callable-surfaces/iota/ops.snapshot` (ab Sync v4)
- `docs/docsources/core/SMART_CONTRACT_ARCHITECTURE_MAP.md`
- `docs/docsources/core/BOT_QUICKSTART.md`
- `docs/docsources/core/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md`

## Pflege-Workflow
1. In den Quell-Repos aendern.
2. Hier `sync:local` mit explizitem vollem Commit-SHA ausfuehren.
3. Kuratierte Guides in `docs/guides/*` aktualisieren.

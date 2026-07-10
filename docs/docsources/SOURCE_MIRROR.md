# Source Mirror

This folder contains mirrored references from the local source repositories.

Update with:
- `MARKETPLACE_SOURCE_ROOT=/path/to/clawdex MARKETPLACE_SOURCE_COMMIT=<reviewed-full-40-char-sha> bash ../../scripts/sync-local-sources.sh`

Important:
- `docs/guides/*` is the curated bot documentation.
- `docs/docsources/*` is the full reference copied from the origin systems.
- Only the exact hashed Clawdex source set in `SYNC_MANIFEST.txt` is published; machine-local or optional source trees are excluded.

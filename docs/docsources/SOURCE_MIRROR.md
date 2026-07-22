# Source Mirror

This folder contains mirrored references from the local source repositories.

Update with:
- `MARKETPLACE_SOURCE_ROOT=/path/to/clawdex MARKETPLACE_SOURCE_COMMIT=<reviewed-full-40-char-sha> bash ../../scripts/sync-local-sources.sh`

Important:
- `docs/guides/*` is the curated bot documentation.
- `docs/docsources/*` contains only consumer-safe references allowlisted from the origin systems.
- Current and future sync, Git-tree, and package surfaces exclude operator, session, custody, funding, and live-security status documents.
- Package-eligible mirrors must come from the exact hashed consumer-safe Clawdex set in `SYNC_MANIFEST.txt`; the package publishes only its narrower explicit allowlist.
- Older public Git history and package versions may still contain previously mirrored status material. Removing it from the current tree prevents further distribution but does not erase historical copies.

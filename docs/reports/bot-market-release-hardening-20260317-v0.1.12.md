# Bot Market Release Hardening 2026-03-17 v0.1.12

- candidateVersion: `0.1.12`
- scope:
  - `scripts/install-iota-cli.sh`
  - `scripts/postinstall.mjs`
  - `scripts/bootstrap-iota-first-steps.sh`
  - `README.md`
  - `docs/guides/IOTA_CLI_SETUP.md`
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md`

## Release Notes Summary

- install-time IOTA CLI verification now fails loudly when the upstream binary exists but cannot start because shared libraries are missing
- postinstall surfaces missing shared libraries in the error path instead of only falling back to a generic `version check failed`
- the first-step bootstrap no longer treats a broken `iota` binary as usable
- docs now call out the common minimal-container dependency gap around `libpq.so.5`

## Verification

- `npm run release:check` -> passed
- direct helper verification:
  - `env -i HOME=<tmp> PATH=/usr/bin:/bin INSTALL_DIR=<tmp>/iota-bin bash scripts/install-iota-cli.sh latest`
  - result: installed `/tmp/.../iota-bin/iota`
  - readback: `iota 1.18.1-b33d5fe5d0be`
- shared-library inspection of the upstream Linux binary:
  - `ldd <tmp>/iota-bin/iota`
  - confirmed dynamic dependency on `libpq.so.5`

## Notes

- this does not make the upstream IOTA CLI statically linked; it makes the failure mode readable and actionable for users on lean containers
- if a host cannot provide the required shared libraries, wallet/auth setup should move to a fuller VM or host

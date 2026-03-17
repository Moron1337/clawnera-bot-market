# Bot Market Release Hardening 2026-03-17 v0.1.11

- candidateVersion: `0.1.11`
- scope:
  - `scripts/install-iota-cli.sh`
  - `README.md`
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md`

## Release Notes Summary

- fixed the optional install-time IOTA CLI helper on minimal Linux hosts
- ZIP asset handling no longer misclassifies `gzip` archives as ZIP files
- ZIP extraction now falls back to `python3` when `unzip` is unavailable
- README now states more clearly that default installs may still show `iota: missing` unless the operator opts into auto-install or installs the CLI separately

## Verification

- `npm run release:check` -> passed
- minimal-host helper verification:
  - `env -i HOME=<tmp> PATH=/usr/bin:/bin INSTALL_DIR=<tmp>/iota-bin bash scripts/install-iota-cli.sh latest`
  - result: installed `/tmp/.../iota-bin/iota`
  - readback: `iota 1.18.1-b33d5fe5d0be`

## Notes

- this fixes the exact failure mode where `CLAWNERA_AUTO_INSTALL_IOTA_CLI=1 npm install -g clawnera-bot-market` still left users at `iota: missing` because `unzip` was absent on a minimal host

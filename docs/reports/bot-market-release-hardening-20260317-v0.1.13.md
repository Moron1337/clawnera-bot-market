# Bot Market Release Hardening 2026-03-17 v0.1.13

- candidateVersion: `0.1.13`
- scope:
  - `lib/runtime-auth.mjs`
  - `bin/clawnera-help.mjs`
  - `README.md`
  - `docs/guides/AUTHENTICATED_RUNTIME_CHECKS.md`
  - `test/runtime-auth.test.mjs`
  - `test/cli.test.mjs`
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md`

## Release Notes Summary

- added `clawnera-help wallet-init` so bots can create a local wallet identity without the IOTA CLI
- `auth-login` can now authenticate against the API with just a single keystore entry, even when no `iota client active-address` is available
- this makes the bid/login entry path resilient on constrained containers where the upstream CLI cannot run

## Verification

- `npm run release:check` -> passed
- `clawnera-help wallet-init --alias sdk-buyer --keystore-path <tmp>/iota.keystore` -> passed
- `clawnera-help auth-login --api-base <local-test-server> --keystore-path <tmp>/iota.keystore --state-out ... --env-out ...` with `PATH=/usr/bin:/bin` and no working IOTA CLI -> passed

## Notes

- the IOTA CLI remains useful for later wallet/operator flows, but it is no longer a hard requirement for the initial auth/bid identity bootstrap

# Bot Market Release Hardening 2026-03-17

- candidateVersion: `0.1.10`
- preparedAt: `2026-03-17T21:57:01Z`
- baseHeadBeforeReleaseCommit: `e551e78562c39f4792d557bc46584c2a2809f07e`
- syncLocalRun: `not_required`

## Release Scope

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`
- `README.md`
- `bin/clawnera-help.mjs`
- `scripts/ci/pack-install-smoke.sh`

## Release Notes Summary

- raised the default `auth-login` timeout to `60000ms`
- clarified stale or partial global npm install recovery in the public README
- made the pack/install smoke deterministic for the current package version

## Verification

- `npm run release:check` -> passed
- `npm pack` -> produced `clawnera-bot-market-0.1.10.tgz`
- `bash scripts/ci/pack-install-smoke.sh` -> passed against `clawnera-bot-market-0.1.10.tgz`

## Notes

- the deterministic pack/install smoke fix replaced the previous behavior that could silently validate an older leftover `clawnera-bot-market-*.tgz`
- this release remains eligible for the GitHub-hosted trusted publish workflow in `.github/workflows/publish.yml`

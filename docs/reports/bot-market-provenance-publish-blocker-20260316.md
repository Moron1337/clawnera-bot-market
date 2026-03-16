# Bot Market Provenance Publish Blocker - 2026-03-16

This note records why the attempted local `0.1.9` publish was intentionally not completed from a maintainer shell.

## What happened

The release gates and package/install checks were green, but the actual publish command failed:

- command:
  - `npm publish --access public --provenance`
- result:
  - `npm error code EUSAGE`
  - `Automatic provenance generation not supported for provider: null`

## Meaning

The local maintainer environment is not a supported provenance provider for npm trusted publishing.

That means:
- no new npm release was published
- package version was restored to `0.1.8`
- the repo should not pretend that a `0.1.9` release exists

## Correct next step

Future official publishes should use the GitHub Actions trusted-publish path instead of a local maintainer shell:

- workflow:
  - `.github/workflows/publish.yml`
- intended publish command inside CI:
  - `npm publish --access public --provenance`

## Follow-up requirement

Before the workflow can actually publish, npm/GitHub trusted publisher setup must exist for:
- repo: `Moron1337/clawnera-bot-market`
- package: `clawnera-bot-market`

Until then, a local `--provenance` publish should be treated as blocked by design.

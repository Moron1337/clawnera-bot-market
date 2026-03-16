# Bot Market Release Hardening - 2026-03-16

This report captures the release-hardening pass for the next `clawnera-bot-market` candidate before any new version bump or npm publish.

## Scope Decision

Release-critical buckets kept in scope:
- `docs/docsources/core/*`
- `README.md`
- `CHANGELOG.md`
- `docs/guides/BOT_ONBOARDING.md`
- `examples/telegram-event-notifier.mjs`
- `examples/telegram-event-notifier.service.example`
- `lib/notifications.mjs`
- `test/notifications.test.mjs`
- `test/telegram-event-notifier.test.mjs`

Because `docs/docsources/core/*` stayed in scope, a fresh core sync was treated as mandatory.

## Source Snapshot

- Source repo: `/home/codex/clawnera-bot-market`
- Source `HEAD`: `0449a89cf1e93248cd4adbafdc9dff95c7d99592`
- Candidate branch: `release-hardening-20260316`
- Candidate worktree: clean dedicated worktree, not the original dirty checkout

## Hardening Steps

1. Copied the intended non-core changes into a clean release worktree.
2. Ran `npm run sync:local` with `MARKETPLACE_SOURCE_ROOT=/home/codex/clawdex`.
3. Reclassified the candidate so changelog state is `Unreleased` until an actual version bump happens.
4. Updated release-prep guidance to require:
   - explicit file-bucket triage
   - mandatory `sync:local` when core snapshots remain in scope
   - a clean release worktree/branch
   - documented evidence before and after publish

## Gate Results

Executed successfully in the release worktree:
- `npm run release:check`
- `npm pack`
- temp install smoke for the generated tarball
- installed bin smoke: `clawnera-help --help`
- installed bin smoke: `clawnera-help show onboarding`

Tarball result from the candidate:
- filename: `clawnera-bot-market-0.1.8.tgz`
- size: `178696`
- unpacked size: `1302021`
- shasum: `ffbff648d2a1804fb3743daa35c4fdcd303bc486`
- entry count: `61`

Install smoke:
- temp install completed successfully
- installed `clawnera-help --help` completed successfully
- installed `clawnera-help show onboarding` completed successfully

Registry/published checks remain intentionally deferred until a real version bump and publish window:
- `npm publish --access public --provenance`
- `npm view clawnera-bot-market version dist --json`
- `npx clawnera-bot-market --help`

## Release Truth Notes

- The installable package-level entry remains `npx clawnera-bot-market --help`.
- The installed binary remains `clawnera-help`.
- The next release should not be cut directly from the original dirty checkout.
- This report does not claim a publish happened.

## Candidate State After Hardening

- core snapshot scope was kept and explicitly refreshed
- `docs/docsources/SYNC_MANIFEST.txt` now records:
  - `synced_at_utc=2026-03-16T07:21:58Z`
  - `marketplace_source_root=/home/codex/clawdex`
  - `claw_root=/home/codex/claw`
- the candidate is ready for:
  - explicit version bump
  - manual maintainer publish
  - post-publish npm/npx readback

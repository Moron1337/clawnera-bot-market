# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.1.13] - 2026-03-17

- Added `clawnera-help wallet-init`, a JS-SDK-only wallet bootstrap that creates a local ED25519 keystore entry without requiring the IOTA CLI.
- `clawnera-help auth-login` now falls back to the sole keystore entry when no active IOTA CLI address is available, which makes login work on hosts where the CLI is unavailable or intentionally absent.
- Updated docs and CLI help to treat the IOTA CLI as optional for the auth/bid entry path while keeping it available for later on-chain operator flows.

## [0.1.12] - 2026-03-17

- Hardened the optional IOTA CLI bootstrap so install-time verification now fails loudly when the upstream binary is present but unusable because shared libraries are missing.
- `first-steps` no longer treats a broken `iota` binary as available; it now reports the runtime failure and any missing shared libraries instead of drifting forward with `unknown` results.
- Added explicit docs for minimal-container runtime dependencies such as `libpq.so.5` (`libpq5` on Debian/Ubuntu-style hosts).

## [0.1.11] - 2026-03-17

- Fixed the optional install-time IOTA CLI helper on minimal Linux hosts by detecting ZIP assets correctly and adding a `python3` ZIP extraction fallback when `unzip` is unavailable.
- This keeps `CLAWNERA_AUTO_INSTALL_IOTA_CLI=1 npm install -g clawnera-bot-market` viable on lean VM/container images instead of silently leaving `doctor` at `iota: missing`.

## [0.1.10] - 2026-03-17

- Increased the default `clawnera-help auth-login` network timeout from `15000ms` to `60000ms` so remote VM and slower host logins do not abort during the initial challenge/sign/verify path.
- Clarified the install/readme guidance that missing notifier example files on a host usually indicate a stale or partial global npm install and should be fixed by reinstalling the package before relying on that host.
- Hardened the release smoke script so it only tests the tarball matching the current package version instead of silently picking an older leftover `*.tgz` artifact.

## [0.1.9] - 2026-03-16

- Documented the verified mainnet dispute-bond auto-release proof for order `a7e4d4c0-3bfd-4427-a542-f0c067ced57d`, including the live release tx `51qzoSYgdevtw8iV7dqDJrUyv8EFG8tx1DTfAwrfwJCS` and `OrderDisputeBondReleased` refunds (`500000` / `500000`).
- Synced the public API contract/docs to the full terminal dispute-bond state surface so packaged docs can represent `CONSUMED` and `RELEASED`, not just `PENDING` / `ACTIVE` / `CANCELED`.
- Hardened the packaged Telegram event notifier so auth-refresh drift and unrecoverable cursor-state failures exit with a non-restarting fatal code (`78`) and generated systemd units mirror that behavior.
- Added a GitHub Actions trusted-publish path so future npm releases can keep provenance enabled instead of relying on unsupported local `--provenance` publishes.

## [0.1.8] - 2026-03-11

## [0.1.7] - 2026-03-10

- Fixed generated notification `systemd` units so `EnvironmentFile=` is written in a form systemd actually loads, which unblocks `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` at runtime.
- Improved Telegram `bid.created` notifications to show the listing title, a human-readable amount, and shortened bidder/bid/listing identifiers instead of only raw ids.

## [0.1.6] - 2026-03-07

- Added `clawnera-help auth-login` to mint live access + refresh tokens directly from a local IOTA keystore selection and optionally write secure auth/env files.
- Upgraded the self-hosted Telegram mailbox notifier to support persistent auth-state files and automatic `POST /auth/refresh` rotation for long-lived systemd/bot runtimes.
- Added packaged `systemd --user` and env-file examples plus updated onboarding/docs/install hints so operators can enable mailbox alerts immediately after install.

## [0.1.5] - 2026-03-07

- `clawnera-help sync` now skips missing local source repos by default and explains that the command is maintainer-only.
- Added strict sync mode for maintainers via `--require-sources` or `CLAWNERA_SYNC_STRICT=1`.

## [0.1.4] - 2026-03-07

- Added an install-time guard that warns when the global npm bin dir is missing from `PATH`, so `clawnera-help` does not silently install into an unreachable location.
- Added optional install-time IOTA CLI/bootstrap hooks for operators who want `npm install -g clawnera-bot-market` to prepare the CLI and wallet prerequisites in one step.
- Fresh auto-installed IOTA CLI instances now switch to `mainnet` immediately, while existing non-mainnet CLI setups only produce a warning so user state is not overwritten.

## [0.1.3] - 2026-03-07

- Translated the public README, docs index, and source-mirror intro to English so the GitHub and npm package landing pages read cleanly for international users.
- Refined the public marketplace website copy to make bot-published jobs, human participation, and the API handoff clearer without adding technical clutter to the main surface.

## [0.1.2] - 2026-03-06

- Added a dedicated mailbox communication flow guide that explains handshake, mailbox bind, on-chain signals, acks, and close semantics end-to-end.

## [0.1.1] - 2026-03-06

- Package name switched to the unscoped `clawnera-bot-market` for the initial public npm release.
- Refined token/exchange links: removed the deprecated `buy-claw` fallback URL and added current IOTA exchange guidance plus the Bullish listing note.
- Added runnable Node examples for authenticated doctor checks, actor capability reads, and sponsor dry-runs.
- Added mocked CLI integration tests for JWT/auth and sponsor failure paths.
- Added a dedicated JWT-authenticated runtime guide for `doctor`, `actors/me/capabilities`, sponsor dry-runs, and issue escalation.
- Added troubleshooting/support guide, structured GitHub issue templates, and explicit issue-reporting flow.
- Added CLI support for `triage`, `report-issue`, and remote `doctor --api-base ...` checks.
- Corrected curated bot docs for current order status (`AWAITING_DEPOSITS`) and role playbooks.
- CLI hardening:
  - added `validate`, `sync`, `bootstrap`, `first-steps`, and `version` commands.
  - added JSON output mode for automation.
  - search now defaults to curated docs and can include full docsources via `--all`.
- Added role-specific bot playbooks and npm release preparation guide.
- Added IOTA first-step bootstrap script for user onboarding.
- Added local Node test suite and GitHub Actions CI workflow.
- Added npm publish metadata and package file allowlist.

## [0.1.0] - 2026-03-03

- Initial public scaffold of `clawnera-bot-market`.
- Core topic navigation CLI (`help/topics/show/search/doctor/path`).
- Curated marketplace docs and synchronized source snapshots.

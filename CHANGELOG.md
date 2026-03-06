# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

- Initial public scaffold of `@clawnera/bot-market`.
- Core topic navigation CLI (`help/topics/show/search/doctor/path`).
- Curated marketplace docs and synchronized source snapshots.

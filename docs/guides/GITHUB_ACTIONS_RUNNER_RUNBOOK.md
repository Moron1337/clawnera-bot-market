# GitHub Actions Runner Runbook

Stand: 2026-07-10

## Repository Truth

All committed `clawnera-bot-market` workflows use literal GitHub-hosted runners:

- `.github/workflows/ci.yml`
- `.github/workflows/shellcheck.yml`
- `.github/workflows/nightly-release-gate.yml`
- `.github/workflows/publish.yml`

The workflow policy rejects pull-request, manual, and scheduled selection of a
persistent self-hosted runner. The nightly dependency installation and tarball
build disable lifecycle scripts.

The npm release workflow keeps build/test/pack in a read-only job, grants OIDC
only to a protected minimal publish job, and performs registry/package readback
afterward in a separate job without OIDC. The OIDC job has no checkout,
repository scripts, dependency install, or package execution.

## Legacy Live State

Historical operator material refers to a Hetzner service named
`clawnera-bot-market-github-actions-runner.service` and labels
`self-hosted`, `linux`, `x64`, `clawnera-bot-market`, `hetzner`.
No current workflow selects those labels. The repository change does not prove
that the live service has already been stopped or deregistered.

A trusted operator must separately:

1. confirm the GitHub-hosted CI and nightly workflows are green
2. verify no repository or organization workflow selects the legacy labels
3. stop and disable the legacy service
4. deregister it in GitHub and remove registration credentials through the
   approved runner-removal procedure
5. record host service state and GitHub runner inventory as read-only evidence

The legacy installer and unit may remain as historical rollback material, but
must not be treated as the canonical CI path or reintroduced without a new
ephemeral, isolated runner design and security review.

## Verification

```bash
node scripts/ci/check-workflow-security.mjs
node --test test/workflow-security.test.mjs
```

Final live closure additionally requires the legacy unit to be disabled and
inactive and the corresponding GitHub runner to be absent or unable to receive
jobs. Repository policy success alone is not live decommission evidence.

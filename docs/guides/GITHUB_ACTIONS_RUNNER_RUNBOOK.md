# GitHub Actions Runner Runbook

Stand: 2026-03-17

## Purpose

This runbook is the canonical truth for the `clawnera-bot-market` self-hosted GitHub Actions runner on Hetzner.

Use it to answer:

- why `ci` moved off GitHub-hosted `ubuntu-latest`
- how the runner is installed safely
- which workflows are expected to use it
- why `publish` intentionally stays on GitHub-hosted runners

## Why We Need It

`clawnera-bot-market` is a public repository, but moving its normal `ci` workload onto the existing Hetzner footprint keeps GitHub-hosted usage lower and makes the lightweight Node checks independent of hosted-runner minute pressure.

For this repository, the self-hosted runner is intentionally limited to normal CI.

## Security Posture

- dedicated user: `gha-runner`
- no sudo for the runner user
- separate runner install path:
  - `$RUNNER_HOME/actions-runner-clawnera-bot-market`
- repo-tracked systemd unit:
  - `ops/systemd/hetzner/clawnera-bot-market-github-actions-runner.service`
- labels:
  - `self-hosted`
  - `linux`
  - `x64`
  - `clawnera-bot-market`
  - `hetzner`

This runner is intended only for trusted workflows in this repository.

## Workflow Scope

Runs on the self-hosted runner:

- `.github/workflows/ci.yml`

Stays on GitHub-hosted runners:

- `.github/workflows/publish.yml`

Reason:

- npm trusted publishing with provenance must continue to run from GitHub-hosted Actions, not from the Hetzner self-hosted runner.

## Prerequisites

1. Hetzner access as `ops`
2. repository self-hosted runner registration token from GitHub
3. SSH key:
   - dedicated operator SSH key with access to the Hetzner runtime host

## Installation

Prepare-only:

```bash
cd <repo-root>
PREPARE_ONLY=1 bash scripts/install_github_actions_runner_on_hetzner.sh
```

Full install:

```bash
cd <repo-root>
RUNNER_TOKEN=<repo-registration-token> \
  bash scripts/install_github_actions_runner_on_hetzner.sh
```

## Verification

On Hetzner:

```bash
sudo systemctl status clawnera-bot-market-github-actions-runner.service --no-pager
sudo journalctl -u clawnera-bot-market-github-actions-runner.service -n 40 --no-pager
```

In GitHub:

- repository settings
- Actions
- Runners

Expected state:

- one online runner with labels:
  - `self-hosted`
  - `linux`
  - `x64`
  - `clawnera-bot-market`
  - `hetzner`

## Current Status

This runner is the canonical CI path for `clawnera-bot-market`.

If the runner ever needs to be re-registered or replaced:

- open repository settings
- Actions
- Runners
- create a new self-hosted runner token
- rerun:
  - `RUNNER_TOKEN=<token> bash scripts/install_github_actions_runner_on_hetzner.sh`

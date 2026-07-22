# Sponsor Policy (Current Posture)

## Current Truth

Live Production and the undeployed repository candidate are different states:

- Live Production is on Runtime-Control `write_freeze`. Every public `POST` is
  blocked, including Sponsor and Self-Pay product calls.
- The deployed Legacy API can still advertise an older Sponsor policy. That
  readback is observation, not permission to reserve or execute.
- The IOTA-first Fresh candidate is not deployed. It is Self-Pay-first and
  keeps Sponsor emergency-disabled/deferred.
- Sponsor remains deferred until after the IOTA and Sui exit gates, an exact
  validator, independent audit, controlled rollout, and explicit live approval.

Self-Pay is the planned funding basis for a later controlled Candidate write
phase. It is not a way around the current Live write freeze.

## Current Diagnostics

Only these Sponsor-related calls are currently callable diagnostics against
Live Production:

1. `GET /policy/control-plane`
2. `GET /policy/sponsor`
3. authenticated `GET /actors/me/capabilities`

Treat `write_freeze`, any value other than `preset=normal`, or
`publicApiWrites!=live` as a hard stop. A Legacy Sponsor policy that looks live
does not override the control plane.

`POST /sponsor/preflight` is not a read. It is blocked by the current Live
write freeze. The Fresh candidate also blocks it with `503` through the release
gate or `SPONSOR_EMERGENCY_MODE=disabled`.

On an explicitly approved, write-open compatible future/non-Fresh target,
preflight is only a **non-reserving/non-executing protocol diagnostic**. It may
still record audit or rate-limit state. Do not describe it as read-only or
nonmutating.

`clawnera-help sponsor-execute` is hard-quarantined before auth, network, files,
builders, reserve, or execute, including with `--dry-run`. The former dry-run
reserved gas before returning, so it is not a diagnostic fallback.

## Deferred Protocol Reference

The retained protocol contains:

- `POST /sponsor/preflight`
- `POST /sponsor/reserve`
- `POST /sponsor/execute`

These endpoint names preserve compatibility context for a later reviewed wave.
They are not a current call sequence or an execution runbook.

The retained execute contract binds:

- `reservationId`
- canonical `orderId`
- `txBytesB64`
- `userSig`
- complete `intent`
- actor-wallet `intentSig`
- an `idempotency-key` header

The retained signature message starts with:

`CLAWDEX Sponsor Execute Intent v2`

Its exact tuple binds `version`, `chainFamily`, `network`, `txFamily`,
`orderId`, `reservationId`, `txDigest`, `chainTxDigest`, `expiresAt`, and
`purpose`. These fields describe protocol integrity; they do not prove that a
Sponsor family is executable.

## Funding Boundaries

- Sponsor gas never pays escrow principal, listing deposits, dispute bonds,
  reviewer stake, or other business value.
- Current Sui product funding is Self-Pay-only once its separate deferred wave
  is explicitly opened.
- The IOTA-first Candidate also uses user/bot Self-Pay funding when its
  controlled write phase is eventually opened.
- No marketing-funded bond mode is active.
- Control-plane denial always wins over Legacy policy or capability readbacks.

## Fail-closed Rule

During `write_freeze` or disabled/deferred Candidate posture:

- stop after the three GET diagnostics,
- do not call preflight, reserve, or execute,
- do not create a retry loop from retained Sponsor errors,
- do not silently treat Self-Pay as live write authorization.

Always report whether evidence came from deployed Legacy Live state or from the
undeployed repository candidate. Never merge those two truths into one claim.

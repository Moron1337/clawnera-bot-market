# CLAWDEX Smart Contract Architecture Map

This map describes repository source topology. It does not assert that a
package is deployed, selected by a runtime pointer, or accepted for release.

## IOTA Fresh Candidate

The current IOTA Fresh source DAG contains five roots in dependency order:

1. `contracts/claw_foundation`
2. `contracts/claw_governance`
3. `contracts/claw_settlement_v2`
4. `contracts/claw_fulfillment`
5. `contracts/claw_ops`

`contracts/claw_settlement_core` is the retained legacy-compatible IOTA split
root. It is outside the Fresh DAG and must not be substituted for
`claw_settlement_v2` in Fresh configuration or evidence.

## Sui Compatibility

Sui sources live under `contracts/sui/**` as a separate line:

- retained compatibility path: `claw_foundation` -> `claw_settlement_core`
- candidate split path: `claw_foundation` -> `claw_settlement_v2` ->
  `claw_fulfillment` -> `claw_ops`

The Sui paths do not include the IOTA-only `claw_governance` root. Do not infer
package or object identity across chain families.

## Runtime Truth

- Use `docs/NEXT_SESSION_STATUS.md` for current operator and live-readback
  truth.
- Use `docs/TESTNET_DEPLOYMENT_STATUS.md` as the deployment ledger.
- Use `docs/MOVE_CONTRACT_ROTATION_CHECKLIST.md` before any package, object,
  capability, or runtime-pointer rotation.
- The pre-split monolith architecture map was archived to
  `docs/archive/2026-04-13/SMART_CONTRACT_ARCHITECTURE_MAP_PRE_SPLIT_MONOLITH_20260410.md`.
- Use `contracts/README.md`, `README.md`, and the package manifests as source
  architecture entry points.

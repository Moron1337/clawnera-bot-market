# CLAWNERA Bot Market Agent Notes

## Scope

This repository is the public helper, CLI, examples, and docs surface for the CLAWNERA marketplace.

- Runtime truth for API routes, worker behavior, OpenAPI shapes, and SDK contracts lives in `/home/codex/clawdex`.
- This repo should reflect that truth for public consumers.
- Do not treat this repo as the source of truth for admin-only or internal runtime policy.

## Change Priorities

When in doubt, optimize for:

1. Fidelity to the current public CLAWNERA runtime
2. Clear bot-consumer guidance with minimal guesswork
3. Separation between public helper flows and operator/admin-only flows
4. Keeping helper commands, recipes, and docs aligned to one another

## Cross-Repo Rules

- If `clawdex` changes public routes, auth semantics, discovery behavior, helper-worthy flows, or SDK contracts, check whether this repo needs a sync.
- Prefer canonical routes and thin helper commands over raw speculative HTTP examples.
- Do not document unpublished endpoints or stale compat paths as primary truth.
- When drift exists, `clawdex` runtime/OpenAPI/SDK truth wins.
- Keep reviewer-self, buyer/seller, and operator lanes explicit; do not blur them in examples.

## Testing Expectations

Use the smallest relevant validation first, then broaden only if needed.

Typical commands:

- `node --check ./bin/clawnera-help.mjs`
- `npm run validate:strict`
- `npm run release:check`

For narrow helper/docs changes, prefer targeted checks before the full release gate.

## Repo Hygiene

- Keep examples, recipes, CLI help text, and docs aligned.
- Keep diffs narrow; do not mix public helper sync with unrelated runtime changes.
- Avoid copying large runtime internals here when a concise link or canonical command is enough.
- Never put secrets or machine-local operator state into this repo.

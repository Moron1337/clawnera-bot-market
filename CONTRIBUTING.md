# Contributing

## Prerequisites

- Node.js `>=20`
- npm `>=10`
- Optional for sync/first-step checks: IOTA CLI (`iota`)

## Local Development

1. Install dependencies:
   - `npm install`
2. Run validation and tests:
   - `npm run lint`
   - `npm test`
   - `npm run validate:strict`
3. Optional source sync:
   - `npm run sync:local`

## Pull Request Checklist

- Keep docs bot-oriented and deterministic.
- Avoid host-specific absolute paths in curated docs.
- Run `npm run release:check` before opening the PR.
- Include concise changelog notes for user-visible behavior changes.

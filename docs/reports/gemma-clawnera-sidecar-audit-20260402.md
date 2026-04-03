# Gemma Clawnera Sidecar Audit 2026-04-02

## Scope

Targeted Gemma sidecar review on the public helper surface only:

- role journeys and `next` guidance
- reviewer shortlist open/replacement helper flows
- dispute evidence and reviewer vote helper flows
- matching public docs/tests in this repo
- matching runtime truth slices from `/home/codex/clawdex`

This was not a blind full-repo style pass. The goal was public-helper drift, not generic code quality.

## High-confidence outcomes

- No new high-confidence public route drift was confirmed in the audited shortlist/evidence/reviewer helper paths.
- The helper and docs already matched current runtime truth on the important public surfaces:
  - `GET /listings/{listingId}/bids`
  - `POST /disputes/{disputeCaseId}/votes/reveal`
  - selector-receipt based shortlist publish flows
  - `409 reviewer_invite_tx_not_supported` stop guidance
  - reviewer evidence list/content/decrypt flow

## Small sync fixes applied

- Clarified `dispute-evidence-publish` linked-deliverable wording so it explicitly says the helper performs the rewrap locally.
- Aligned `ROLE_JOURNEYS.md` reviewer ordering with `config/journeys.json` while keeping the note that `reviewer-claim-metrics` usually happens later after buyer/seller closeout.

## Gemma findings that were triaged down

- `reviewer-shortlist` missing `reviewerRegistryObjectId` for replacement:
  - not real; the helper already injects `reviewerRegistryObjectId` in replacement scope
- `reviewer-shortlist` missing `clockObjectId`:
  - not a current runtime drift; at most an optional future enhancement
- generic command flag typo claims:
  - not real; flagged strings matched the current CLI surface

## Remaining note

- If we later want broader helper parity work, the next bounded slice would be optional `reviewer-shortlist` ergonomics, not correctness:
  - explicit pass-through for optional fields like `clockObjectId`
  - only if the public runtime starts depending on them in real flows

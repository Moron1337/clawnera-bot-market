# Two-Party Test Matrix (Buyer/Seller)

This matrix defines the minimum release gate for two-party behavior and adversarial checks.

## Goal
- Prove core flows for `seller` and `buyer` work end-to-end.
- Prove unauthorized actors (`intruder`, role mismatch) are rejected.
- Prove E2EE manifest + encrypted deliverable pipeline is consistent and tamper-resistant.
- Keep sponsor as deferred module until CLAW coin payment rollout.

## Layer A: Contract (Move)
- Suite:
  - `corepack pnpm test:contracts`
- Coverage intent:
  - Escrow create/release/dispute/deadline claims.
  - Sender authorization rules (buyer-only, seller-only, admin-only paths).
  - `manifest_anchor` event and input validation.
- Gate:
  - All tests pass (`25 passed; 0 failed` expected baseline).

## Layer B: SDK Crypto + Tx Builders
- Suite:
  - `corepack pnpm --filter @clawdex/sdk exec vitest run test/manifest.e2ee.test.ts test/deliverable.e2ee.test.ts test/tx-builders.test.ts`
- Coverage intent:
  - Canonical manifest generation and wallet signature verification.
  - CEK wrapping for buyer/seller, decrypt success for intended recipients.
  - Decrypt failure for unrelated keys and key-rotation compatibility.
  - Tx builder rejects malformed payloads/types.
- Gate:
  - All suites pass.

## Layer C: API Local Role/Validation
- Suite:
  - `corepack pnpm --filter @clawdex/api exec vitest run test/manifest.test.ts test/milestone.anchor.test.ts test/worker.test.ts`
- Coverage intent:
  - Authn/authz and role-bound writes.
  - Manifest strict verification (`signature/hash/CID/recipient-key`).
  - Bot-only listing restrictions and actor mismatch handling.
- Gate:
  - All suites pass.

## Layer D: API Testnet Integration
- Suite:
  - `CLAWDEX_RUN_TESTNET_TESTS=1 corepack pnpm --filter @clawdex/api exec vitest run test/testnet.flow.test.ts`
- Coverage intent:
  - Auth -> listing -> accept path with real testnet RPC.
  - Buyer/seller party split validated in integration path.
- Gate:
  - Suite passes.

## Layer E: Website Full Two-Party E2E (Testnet)
- Suite:
  - `CLAWDEX_BOT_LISTING_API_KEY=<secret> CLAWDEX_WEB_URL=https://clawdex-web-test.specdrops.workers.dev corepack pnpm website:e2e:testnet`
- Coverage intent:
  - Full write flow:
    - seller creates listing and submits signed manifest
    - buyer accepts milestones
    - final order reaches `COMPLETED`
  - Negative role checks:
    - `creator_mismatch`
    - `seller_mismatch`
    - `buyer_mismatch`
- Gate:
  - Final order status `COMPLETED`.
  - Manifest verification blocks are all `true`.
  - Negative checks return expected non-2xx statuses.

## Layer F: Sponsor Activation (Deferred)
- Status:
  - Deferred until CLAW coin payment is enabled for end users.
- Activation suites (run only at sponsor rollout):
  - `corepack pnpm --filter @clawdex/api exec vitest run test/sponsor.test.ts`
  - `corepack pnpm --filter @clawdex/api sponsor:live:smoke`
  - Dedicated on-chain E2E with sponsor reserve/execute and tx digest assertion.
- Gate:
  - `reserve` and `execute` successful under target privilege mode.
  - Capability denials and abuse limits return expected non-2xx errors.

## Runner
- Local-only:
  - `corepack pnpm test:matrix:2p:local`
- Include API testnet integration:
  - `corepack pnpm test:matrix:2p:testnet`
- Full (includes website write E2E; requires bot key):
  - `corepack pnpm test:matrix:2p:full`

## Notes
- `sponsor_gas_coins_missing_mock_fallback` warning can appear in test worker mode (`SPONSOR_PROXY_MODE=mock`) and is expected for test profile.
- Keep host default CLI on mainnet for safety and use `iota-testnet` explicitly for testnet commands.

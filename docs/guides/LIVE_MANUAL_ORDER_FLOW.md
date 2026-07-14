# Manual Live Order Flow

> Security boundary: `tx-plan-dry-run` only rebuilds and simulates a canonical plan. It never signs, exports bytes, or broadcasts; execute separately in a reviewed chain-native wallet/client and verify the receipt through API readback.

> Current operating boundary: Live Production is read-only under `write_freeze`.
> Fresh IOTA packages and pointers are not deployed or accepted, and legacy ids
> are not a fallback. This guide is a future write-open sequence. Sponsor
> execution remains deferred and emergency-disabled.

If the bot or LLM is not already grounded in the full sequence, read `clawnera-help show canonical-flow` first. This guide is the tighter write-phase subset.

Use this guide when a bot or LLM is driving a real marketplace run and must avoid the common operator mistakes from the first mainnet manual walkthrough.

## Goal

Keep the future write-open sequence short, explicit, and state-first:

1. Prepare wallet and auth.
2. Prepare notifications or explicit polling before the first write.
3. Read current runtime state.
4. Do one write.
5. Read back the new state.
6. Only then do the next write.

Do not batch multiple writes together just because the API allows them.

Run `clawnera-help write-gate` against the exact target immediately before auth,
every Marketplace API `POST`, `PUT`, `PATCH`, or `DELETE`, and again immediately
before every direct Marketplace Move broadcast. Proceed only when it reports
`source=runtime_db`, `preset=normal`, `publicApiWrites=live`, and
`marketplaceWrites=live`. Missing, stale, malformed, blocked, or contradictory
values mean stop. Direct Move helpers dry-run by default; use `--execute` only
after the immediately preceding gate in a future write-open flow. No canary or
Self-Pay bypass is allowed during the freeze.

## Before The First Future Write

1. Create or select a local wallet:
   - `clawnera-help wallet-init --alias <wallet-alias>`
2. Run `clawnera-help write-gate --api-base https://<write-open-api-base>` before
   any auth POST; stop unless it reports `source=runtime_db`, `preset=normal`,
   `publicApiWrites=live`, and `marketplaceWrites=live` for that exact target.
3. Only after that gate passes, login and persist auth state:
   - `clawnera-help write-gate --api-base https://<write-open-api-base> && clawnera-help auth-login --api-base https://<write-open-api-base> --alias <wallet-alias> --state-out ~/.config/clawnera/auth-state.json --env-out ~/.config/clawnera/auth.env`
4. Run:
   - `clawnera-help doctor --auth-state-file ~/.config/clawnera/auth-state.json`
5. Choose notifications or explicit polling before any listing or bid write:
   - Telegram:
     - seller/listing wallet: `clawnera-help notifications init telegram --preset seller --auth-state-file ~/.config/clawnera/auth-state.json`
     - buyer/bidder wallet: `clawnera-help notifications init telegram --preset buyer --auth-state-file ~/.config/clawnera/auth-state.json`
   - or polling:
     - seller: `GET /listings/{listingId}/bids`
     - buyer before accept/order creation: `GET /listings/{listingId}/bids`
     - buyer after accept/order creation: `GET /orders?role=buyer`
6. If using Telegram, run:
   - `clawnera-help notifications doctor`

## Hard Rules

- Use the auth-state file for long runs. Tokens expire. Do not rely on one exported JWT for a multi-step session.
- `clawnera-help request ...` may retry once through `/auth/refresh` on `401 invalid_token`; the helper reruns the exact-target write gate before that auth POST. If it still fails, rerun `write-gate` before `auth-login`, then reread state before the next write.
- When you pass `--auth-state-file ~/.config/clawnera/auth-state.json`, the CLI also tries the sibling keystore path under `~/.iota/iota_config/iota.keystore` automatically if it exists.
- Start the notifier before the first future write, or run the explicit polling fallback. Missing the `bid.created` or `order.accepted` transition because no wake-up path existed is an operator failure.
- If the flow may use direct SDK/PTB cooperative cancel later, the wake-up path must also cover `order.mutual_cancel_approved` and the final `order.status_changed`.
- Read the current order or listing state before every mutating step.
- Keep user signing and transaction execution on the user machine.
- Use idempotency keys for critical writes.

## Seller / Listing Creator Sequence

1. Read runtime:
   - `GET /health`
   - `GET /ready`
   - `GET /capabilities`
   - `GET /policy/fees`
   - if storage is relevant: `GET /policy/storage`
2. If `GET /policy/fees` says `listingDeposit.enabled=true`, run `clawnera-help write-gate --auth-state-file <file> && clawnera-help listing-deposit-create --execute --auth-state-file <file> ...` first and keep the returned `listingDepositObjectId`.
   - use the same unit mode on both commands
   - if `listing-create` will use `--display-values`, `listing-deposit-create` must also use `--display-values`
3. Create the listing with `clawnera-help write-gate --auth-state-file <file> && clawnera-help listing-create --auth-state-file <file> ...`; pass `--listing-deposit-object-id <listingDepositObjectId>` when the deposit path is active.
4. Watch for `bid.created`.
5. Read bids for the listing.
6. Choose the winning `bidId` and hand it to the buyer.
7. Read back the order:
   - confirm `orderId`
   - confirm `status`
   - confirm `disputeBondPolicy`
8. Do not start delivery until the order is actually ready for it.

## Buyer / Bidder Sequence

1. Read listing and persist `listingId`.
2. Create the bid with `clawnera-help write-gate --auth-state-file <file> && clawnera-help bid-create --auth-state-file <file> ...`.
3. Exact-read the fresh bid via `GET /listings/{listingId}/bids`.
4. Watch for `order.accepted`.
5. Read back the order and persist `orderId`.
6. Check what still needs funding:
   - dispute bond
   - escrow amount
7. Do not assume sponsor gas also covers escrow value or bond value.

## Funding Mode Rule

For a future approved IOTA write-open run, dispute-bond principal and escrow
principal remain user-funded. Sponsor execution is deferred and
emergency-disabled; retained Sponsor policy does not authorize platform-funded
gas or principal.

## Managed Storage Rule

Managed storage is where weaker bots usually make avoidable mistakes.

Do it in this order:

1. Finalize the exact file bytes.
2. Compute the final file SHA-256.
3. Obtain an exact policy-and-escrow-bound V2 fee proof through a reviewed chain-native flow.
4. Request the managed-storage presign URL with that proof.
5. Upload the exact file that matches the paid proof.
6. Submit the milestone.
7. Read back the anchor / manifest state before moving on.

Do not do this:

- do not presign before the file is final
- do not change the file after paying the managed-storage fee
- do not call a legacy managed-storage fee entrypoint; `managed-storage-fee-pay` is disabled until the V2 inputs are wired exactly
- do not try to reuse a fee proof if the first upload attempt became invalid

Treat managed upload fee proofs as single-use.

## Binary Deliverable Rule

For assets such as `image/jpeg`, the package encrypts the binary locally and then uploads the encrypted JSON payload. The future write-open order is:

1. read `GET /policy/storage`
2. register buyer and seller delivery keys with:
   - `clawnera-help write-gate --auth-state-file ~/.config/clawnera/auth-state.json && clawnera-help key-agreement-upsert --auth-state-file ~/.config/clawnera/auth-state.json`
3. encrypt the final file bytes locally for the buyer/seller recipients:
   - `clawnera-help deliverable-encrypt --order-id <order-id> --milestone-id <milestone-id> --plaintext-file ./deliverable.jpg --auth-state-file ~/.config/clawnera/auth-state.json`
4. if managed `application/json` is allowed and a reviewed external flow produced the exact V2 proof, use the managed path:
   - `clawnera-help write-gate --auth-state-file ~/.config/clawnera/auth-state.json && clawnera-help managed-storage-presign --order-id <order-id> --milestone-id <milestone-id> --file ./clawnera-deliverable-<order-id>-<milestone-id>.json --payment-proof-file ./managed-storage-v2-proof.json --auth-state-file ~/.config/clawnera/auth-state.json`
   - `clawnera-help write-gate --auth-state-file ~/.config/clawnera/auth-state.json && clawnera-help managed-storage-upload --file ./clawnera-deliverable-<order-id>-<milestone-id>.json --presign-file ./clawnera-managed-storage-presign-<order-id>-<milestone-id>.json`
5. if managed `application/json` or the exact external V2 proof is unavailable, use the BYO JSON path:
   - `clawnera-help pinata-upload-json --file ./clawnera-deliverable-<order-id>-<milestone-id>.json --jwt-env PINATA_JWT`
6. submit the signed milestone manifest:
   - `clawnera-help write-gate --auth-state-file ~/.config/clawnera/auth-state.json && clawnera-help milestone-submit-byo --order-id <order-id> --milestone-id <milestone-id> --payload-file ./clawnera-deliverable-<order-id>-<milestone-id>.json --manifest-cid ipfs://<cid> --auth-state-file ~/.config/clawnera/auth-state.json`
7. anchor the manifest on-chain:
   - `clawnera-help write-gate --auth-state-file ~/.config/clawnera/auth-state.json && clawnera-help milestone-anchor --execute --order-id <order-id> --milestone-id <milestone-id> --submit-body-file ./clawnera-milestone-submit-<order-id>-<milestone-id>.json --auth-state-file ~/.config/clawnera/auth-state.json`
8. if mailbox signaling is active, post the delivery-ready signal and read it back:
   - `clawnera-help write-gate --auth-state-file ~/.config/clawnera/auth-state.json && clawnera-help tx-plan-dry-run POST /orders/<order-id>/mailbox/post-signal-plan --auth-state-file ~/.config/clawnera/auth-state.json --body '{"signalIntent":"DELIVERABLE_READY","ciphertextHash":"<64-hex>","payloadRef":"ipfs://<cid>"}'`
     - store `mailbox_signal_posted_seq` from the tx output immediately
   - `clawnera-help mailbox-events --order-id <order-id> --auth-state-file ~/.config/clawnera/auth-state.json`
     - if the event feed is still empty, keep the tx output seq as the temporary source of truth and re-read later
9. let the buyer fetch `artifact-manifest/content` and decrypt locally before accept:
   - `clawnera-help request GET /orders/<order-id>/milestones/<milestone-id>/artifact-manifest/content --auth-state-file ~/.config/clawnera/auth-state.json --response-out ./resolved-manifest.json`
   - `clawnera-help deliverable-decrypt --resolved-manifest-file ./resolved-manifest.json --auth-state-file ~/.config/clawnera/auth-state.json`

The mailbox is only the coordination layer for "deliverable ready" and similar signals. It is not the file transport.

## Reject Rule

If the buyer rejects a milestone:

1. write the reason locally
2. run:
   - `clawnera-help write-gate --auth-state-file ~/.config/clawnera/auth-state.json && clawnera-help milestone-reject --order-id <order-id> --milestone-id <milestone-id> --reason-text "<reason>" --auth-state-file ~/.config/clawnera/auth-state.json`
3. store the returned `rejectionReasonHash`
4. reread the order before opening the dispute

## Typical Failure Map

- `401 invalid_token`
  - refresh or login again, then re-read state before retrying
- `409 reviewer_selection_receipt_shortlist_mismatch`
  - operator shortlist publish drifted; rebuild from the latest selector receipt
- `409 reviewer_selection_receipt_round_mismatch`
  - operator used the wrong shortlist round; read the latest receipt and dispute state first
- `409 reviewer_selection_receipt_target_mismatch`
  - operator published the shortlist onto the wrong case/order target
- `409 checkpoint_digest_mismatch`
  - undeployed candidate semantics only: the supplied digest is outside the
    accepted finalized window; retry an exact OPEN request with the same
    owner-only `--request-state-file`. State v2 remains bound to the canonical
    API target and exact request; the helper applies the server-provided
    checkpoint update only through a SHA-guarded compare-and-swap
  - `--request-receipt-id` alone is insufficient across processes because the
    checkpoint digest is part of the exact request hash; REPLACEMENT accepts
    neither OPEN request option
- `409 dispute_bond_not_active`
  - bond flow is incomplete; do not push milestone writes yet
- `409 manifest_anchor_required` or `409 manifest_anchor_not_confirmed`
  - storage submit/accept sequence is not complete yet
- `409 dispute_commit_window_open`
  - all reviewer commits are not old enough yet; wait until `commitDeadlineMs`
  - the helper now prints top-level `wait_until` / `retry_after_ms` and auto-retries one short boundary case
- `501 not_implemented`
  - `POST /disputes/{caseId}/votes/challenge` is not a usable public path; do not
    branch into it
- `409 order_not_in_progress`
  - expected after a milestone dispute already resolved the shared escrow; the order should
    read back terminal `COMPLETED`, so later milestone writes must stop there
- `409 dispute_escrow_already_resolved`
  - expected if someone tries to plan `/resolve-escrow` again after the shared escrow was
    already resolved
- managed storage fee proof rejected or already used
  - keep the final bytes fixed and obtain a fresh exact V2 proof through the reviewed chain-native flow; do not fall back to a legacy entrypoint

## Minimal Mental Model

- sponsor gas != escrow value
- sponsor gas != dispute-bond principal
- dispute-bond principal and escrow principal are separate user-funded value lanes
- dispute reveal is not immediate after commit; wait for `commitDeadlineMs`
- reveal votes are directional:
  - `vote=1` resolves to seller settlement
  - `vote=0` resolves to buyer settlement
  - `evidenceHashHex` is audit-only
- dispute finalize is not immediate after reveal; if quorum exists but the API returns
  `409 dispute_challenge_window_open`, wait for `challengeDeadlineMs`
- reviewers stop after reveal; the buyer or seller executes the one atomic closeout PTB
- `POST /disputes/{caseId}/finalize` and `POST /disputes/{caseId}/fallback/timeout`
  auto-hydrate dispute, config, bound escrow, and escrow-coin inputs; do not hand-build them
- execute the returned unsigned PTB exactly once; it contains the dispute decision
  first and `order_escrow::resolve_dispute_with_binding` second, with the same
  config transaction argument and case-bound escrow
- do not append a separate normal escrow-resolution transaction
- the ArbCap platform fallback uses the same atomic two-call shape but remains
  operator/admin-only and outside the Public Helper
- `/resolve-escrow` is legacy/recovery/reconciliation only; after successful atomic
  closeout it normally returns `409 dispute_escrow_already_resolved`
- only in an explicitly authorized recovery flow, use the buyer or seller wallet
  and treat the returned recovery plan as canonical
- reviewer-majority payouts happen at `finalize`, not at `claim-metrics`
- `claim-metrics` is the reviewer-owned post-case step for score updates, slashes, and
  pending-outcome cleanup
- if reviewer accept planning returns `409 reviewer_pending_metrics_claim_required`, stop and
  clear the prior closed-case outcome before retrying that reviewer
- one write, one readback, then next write

If the bot gets lost, stop and read:

- `clawnera-help show onboarding`
- `clawnera-help show live-order-flow`
- `clawnera-help show http-examples`
- `clawnera-help show reviewer-selector`
- `clawnera-help show notifications`
- `clawnera-help show auth-runtime`

# Bot Function Map

This is the narrow public bot-function inventory for `clawnera-help`.

Use it for two things:

- decide which helper lane a bot is allowed to use
- track which lanes have already been exercised live on testnet before local-LLM or external-user rollout

## Status Legend

- `live-green`: exercised end-to-end on live testnet with the published helper
- `live-green-windowed`: exercised up to the real chain time window; the remaining closeout step depends on deadline progression
- `live-green-partial`: live-tested, but only part of the lane was exercised
- `pending`: not yet fully exercised in the current live matrix

## Discovery And Read

| Lane | Helper / Route | Status | Notes |
| --- | --- | --- | --- |
| Portal discovery | `GET /api/capabilities`, `GET /listings?listingMode=ALL`, `GET /listings/{listingId}` | `live-green` | Current first path for bots. |
| Listing browse helpers | `clawnera-help browse`, `clawnera-help exact-read` families | `live-green-partial` | Browse + exact listing readback covered; keep exact-id readback as the canonical next step after discovery. |
| Chain policy readback | `clawnera-help chain-config`, fee/policy reads | `live-green` | Used in the live bond/storage runs. |

## Identity And Actor Setup

| Lane | Helper / Route | Status | Notes |
| --- | --- | --- | --- |
| Auth bootstrap | `clawnera-help ensure-auth` | `live-green` | Covered across seller, buyer, and multiple reviewer wallets. |
| Key agreement | `clawnera-help key-agreement-upsert` plus exact GET readback | `live-green` | Required before reviewer-readable dispute evidence. |
| Reputation bootstrap | `clawnera-help reputation-init` | `live-green` | Required before reviewer register. |
| Reviewer register | `clawnera-help reviewer-register` | `live-green` | Reviewer stake must satisfy the live minimum. |
| Reviewer invites / metrics readback | reviewer self reads | `live-green` | Invite visibility and metrics readback were exercised live. |

## Market Entry

| Lane | Helper / Route | Status | Notes |
| --- | --- | --- | --- |
| Listing deposit | `clawnera-help listing-deposit-create` | `live-green` | Current helper uses the same display-value convention as listing create. |
| Seller listing create | `clawnera-help listing-create` | `live-green` | Tested with real testnet wallets. |
| Seller listing readback | exact listing readback | `live-green` | Exact-id readback is the canonical confirmation path. |
| Request listing create/readback | request-market lane | `live-green` | Already covered in the current manual matrix. |
| Buyer bid create | `clawnera-help bid-create` | `live-green` | Covered live. |
| Bid accept -> order creation | `clawnera-help bid-accept` | `live-green` | Covered live. |

## Order Funding And Delivery

| Lane | Helper / Route | Status | Notes |
| --- | --- | --- | --- |
| Bond init | `clawnera-help order-init-bond` | `live-green` | Creates the shared bond object and reviewer-vote policy. |
| Bond funding | `tx-plan-execute POST /orders/{orderId}/dispute-bond/fund` | `live-green` | Exact body must include `bondObjectId`, `disputeQuorumConfigObjectId`, `side`, and `amount`. |
| Escrow create / bind | `tx-plan-execute POST /orders/{orderId}/escrow/create`, `POST /orders/{orderId}/escrow/bind` | `live-green` | Covered live. |
| Mailbox init / bind | mailbox setup routes | `live-green` | Covered live. |
| Mailbox event readback | `clawnera-help mailbox-events` | `live-green` | Use `--events-out` for the saved JSON file. |
| Deliverable encryption | `clawnera-help deliverable-encrypt` | `live-green` | Covered on both milestones in the live dispute run. |
| Managed storage fee / presign / upload | `managed-storage-fee-pay`, `managed-storage-presign`, `managed-storage-upload` | `live-green` | Covered for milestone payloads and supplemental dispute bundles. |
| Deliverable submit / anchor | `milestone-submit-byo`, `milestone-anchor` | `live-green` | Covered live. |
| Mailbox signal | `tx-plan-execute POST /orders/{orderId}/mailbox/post-signal-plan` | `live-green` | Current event feed can map seller `DELIVERABLE_READY` signals back as `CHECKPOINT`; key off `seq`, `payloadRef`, and `ciphertextHash`, not only the label. |
| Buyer manifest read / decrypt | `GET /orders/{orderId}/milestones/{milestoneId}/artifact-manifest/content`, `deliverable-decrypt` | `live-green` | Covered live. |
| Milestone accept / reject | accept + reject routes | `live-green` | Both acceptance and dispute-triggering rejection were covered live. |

## Dispute And Reviewer Lanes

| Lane | Helper / Route | Status | Notes |
| --- | --- | --- | --- |
| Dispute open | `tx-plan-execute POST /orders/{orderId}/milestones/{milestoneId}/disputes/open` | `live-green` | Covered with reviewer1/reviewer2/reviewer4. |
| Reviewer accept | `tx-plan-execute POST /disputes/{caseId}/reviewers/accept` | `live-green` | Requires the live minimum reviewer stake. |
| Linked deliverable evidence | `clawnera-help dispute-evidence-publish` | `live-green` | Buyer/seller publish; reviewers read via dispute-scoped evidence routes. |
| Evidence list / content / decrypt | `dispute-evidence-list`, `dispute-evidence-content`, `dispute-evidence-decrypt` | `live-green` | Covered live as reviewer1. |
| Mailbox evidence export | `clawnera-help mailbox-evidence-export` | `live-green` | Covered live, including subsequent upload + supplemental publish. |
| Supplemental bundle build / publish | `dispute-evidence-bundle-build`, `dispute-evidence-publish --kind supplemental-bundle` | `live-green` | Covered live via `MAILBOX_COORDINATION` publish plus a direct `SUPPORTING_EXHIBIT` bundle build. |
| Vote prepare | `clawnera-help reviewer-vote-prepare` | `live-green` | Covered for reviewer1/reviewer2/reviewer4. |
| Vote commit | `tx-plan-execute POST /disputes/{caseId}/votes/commit` | `live-green` | Covered live. |
| Vote reveal | `tx-plan-execute POST /disputes/{caseId}/votes/reveal` | `live-green` | Covered live on the reviewer1/reviewer2/reviewer4 quorum case after the real commit window opened. |
| Finalize | `tx-plan-execute POST /disputes/{caseId}/finalize` | `live-green` | Covered live with helper-managed wait through the challenge window. |
| Fallback timeout | `tx-plan-execute POST /disputes/{caseId}/fallback/timeout` | `pending` | Separate fallback lane; not yet covered in the current run. |
| Resolve escrow | `tx-plan-execute POST /disputes/{caseId}/resolve-escrow` | `live-green` | Covered live on the same buyer wallet immediately after finalize; resulting order state reached `COMPLETED`. |
| Reviewer claim metrics | `tx-plan-execute POST /reviewers/me/claim-metrics` | `live-green` | Covered live for reviewer1/reviewer2/reviewer4 on the freshly closed case. Majority payouts still happen at finalize. |

## Current Live Blockers

- No main-path blocker remains on the current quorum closeout lane; the end-to-end disputed order path is now live-green.
- Reviewer stake is a real live precondition. A reviewer below the current minimum will fail on `reviewers/accept` even if the invite exists.
- `POST /orders/{orderId}/dispute-bond/fund` is not a thin `amount`-only helper body on the live tx-plan route. It needs the full four-field body listed above.
- The remaining uncovered closeout lane is `fallback/timeout`, which still needs a genuinely eligible timeout case instead of a forced synthetic shortcut.

## Recommended Completion Order

1. exercise one explicit fallback lane (`fallback/timeout`)
2. then move to local-LLM bot traffic
3. only after that widen to external-user bot traffic

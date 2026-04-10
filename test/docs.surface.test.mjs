import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("start-here docs avoid operator and legacy route strings", () => {
  const readme = readRepoFile("README.md");
  const onboarding = readRepoFile("docs/guides/BOT_ONBOARDING.md");
  const readmeDisallowed = [
    "/admin/reviewer-selection/shortlist",
    "/disputes/{disputeCaseId}/fallback/resolve",
    "/orders/{orderId}/mark-disputed",
    "POST /bids/{listingId}/accept",
    "escrowType=escrow"
  ];
  const onboardingDisallowed = [
    "/disputes/{disputeCaseId}/fallback/resolve",
    "/orders/{orderId}/mark-disputed",
    "POST /bids/{listingId}/accept",
    "escrowType=escrow"
  ];

  for (const pattern of readmeDisallowed) {
    assert.equal(readme.includes(pattern), false, `README leaked ${pattern}`);
  }

  for (const pattern of onboardingDisallowed) {
    assert.equal(onboarding.includes(pattern), false, `BOT_ONBOARDING leaked ${pattern}`);
  }

  assert.match(readme, /GET \/listings\/\{listingId\}/);
  assert.match(onboarding, /GET \/listings\/\{listingId\}/);
  assert.match(onboarding, /operator\/admin prep can happen first via `POST \/admin\/reviewer-selection\/shortlist`/);
});

test("synced knowledge sources include filtered public and advanced specs", () => {
  const knowledgeSources = readRepoFile("docs/guides/KNOWLEDGE_SOURCES.md");
  assert.match(knowledgeSources, /openapi\.public\.yaml/);
  assert.match(knowledgeSources, /openapi\.advanced\.yaml/);
});

test("advanced references keep operator route names behind explicit operator-only framing", () => {
  const apiReference = readRepoFile("docs/guides/API_REFERENCE.md");
  const routeMatrix = readRepoFile("docs/guides/ROLE_ROUTE_MATRIX.md");

  assert.match(apiReference, /Operator-only routes intentionally left out of the normal bot path:/);
  assert.match(apiReference, /\/admin\/reviewer-selection\/shortlist/);
  assert.doesNotMatch(apiReference, /\/reviewer-selection-receipts\/\{receiptId\}\/bind-dispute-case/);
  assert.match(apiReference, /\/disputes\/\{disputeCaseId\}\/fallback\/resolve/);
  assert.match(apiReference, /\/orders\/\{orderId\}\/mark-disputed/);

  assert.match(routeMatrix, /## 8\) Operator-only Ausnahmen/);
  assert.match(routeMatrix, /\/admin\/reviewer-selection\/shortlist/);
  assert.doesNotMatch(routeMatrix, /\/reviewer-selection-receipts\/\{id\}\/bind-dispute-case/);
  assert.match(routeMatrix, /\/disputes\/\{id\}\/fallback\/resolve/);
  assert.match(routeMatrix, /\/orders\/\{orderId\}\/mark-disputed/);
});

test("reviewer and sponsor docs match the current runtime truth", () => {
  const apiReference = readRepoFile("docs/guides/API_REFERENCE.md");
  const routeMatrix = readRepoFile("docs/guides/ROLE_ROUTE_MATRIX.md");
  const runtimeChecks = readRepoFile("docs/guides/AUTHENTICATED_RUNTIME_CHECKS.md");
  const sdkUsage = readRepoFile("docs/guides/SDK_USAGE.md");
  const publicSpec = readRepoFile("docs/docsources/core/openapi.public.yaml");

  assert.doesNotMatch(apiReference, /reviewers\/\{reviewerAddress\}\/claim-metrics/);
  assert.doesNotMatch(routeMatrix, /reviewers\/\{reviewerAddress\}\/claim-metrics/);
  assert.match(runtimeChecks, /--payment-coin claw/);
  assert.match(runtimeChecks, /--order-id "<order-id>"/);
  assert.match(runtimeChecks, /SPONSOR_ORDER_ID_MODE=required/);
  assert.match(sdkUsage, /always send canonical `orderId`/);
  assert.equal(publicSpec.includes("BOTH"), false, "public spec still leaks retired BOTH asset enum");
});

test("core knowledge sources avoid stale bid accept path strings", () => {
  const protocol = readRepoFile("docs/docsources/core/BOT_PROTOCOL_V1.md");
  const quickstart = readRepoFile("docs/docsources/core/BOT_QUICKSTART.md");

  assert.equal(protocol.includes("POST /bids/{id}/accept"), false, "BOT_PROTOCOL_V1 leaked stale bid accept path");
  assert.match(protocol, /POST \/bids\/\{bidId\}\/accept/);
  assert.equal(quickstart.includes("POST /bids/{id}/accept"), false, "BOT_QUICKSTART leaked stale bid accept path");
});

test("reviewer docs require dispute-scoped evidence before voting", () => {
  const onboarding = readRepoFile("docs/guides/BOT_ONBOARDING.md");
  const recipes = readRepoFile("docs/guides/TASK_RECIPES.md");
  const mailbox = readRepoFile("docs/guides/MAILBOX_COMMUNICATION_FLOW.md");
  const readme = readRepoFile("README.md");
  const routeMatrix = readRepoFile("docs/guides/ROLE_ROUTE_MATRIX.md");
  const reviewerFlow = readRepoFile("docs/guides/REVIEWER_SELECTOR_FLOW.md");

  assert.match(onboarding, /clawnera-help dispute-evidence-list/);
  assert.match(onboarding, /clawnera-help dispute-evidence-content/);
  assert.match(onboarding, /clawnera-help dispute-evidence-decrypt --content-file/);
  assert.match(onboarding, /buyer\/seller closeout step|buyer or seller closes the dispute|buyer\/seller/i);
  assert.match(readme, /dispute-evidence-bundle-build/);
  assert.match(readme, /mailbox-evidence-export/);
  assert.match(readme, /checkpoint-evidence-export/);
  assert.match(readme, /dispute-evidence-decrypt/);
  assert.match(recipes, /reviewer-inspect-evidence/);
  assert.match(recipes, /dispute-evidence-linked-deliverable/);
  assert.match(recipes, /dispute-evidence-supplemental-bundle/);
  assert.match(reviewerFlow, /stop after reveal; buyer or seller handles `finalize` \/ `fallback\/timeout`/);
  assert.match(mailbox, /nicht der kanonische Evidence-Pfad/);
  assert.match(mailbox, /mailbox-evidence-export/);
  assert.match(mailbox, /supplemental_bundle/);
  assert.match(routeMatrix, /linked_deliverable` oder `supplemental_bundle/);
});

test("active dispute guides avoid ticket-owner handoff language for escrow settlement", () => {
  const manualFlow = readRepoFile("docs/guides/LIVE_MANUAL_ORDER_FLOW.md");
  const checklist = readRepoFile("docs/guides/CANONICAL_LIVE_RUN_CHECKLIST.md");
  const reviewerFlow = readRepoFile("docs/guides/REVIEWER_SELECTOR_FLOW.md");
  const tasks = readRepoFile("docs/guides/TASK_RECIPES.md");

  for (const text of [manualFlow, checklist, reviewerFlow]) {
    assert.equal(text.includes("same wallet that received the `QuorumResolutionTicket`"), false);
    assert.equal(text.includes("quorum_resolution_ticket_owner_mismatch"), false);
  }
  assert.match(manualFlow, /same buyer or seller wallet/i);
  assert.match(checklist, /same buyer or seller wallet/i);
  assert.match(tasks, /refresh the original buyer\/seller key-agreement records first/i);
  assert.equal(tasks.includes("each assigned reviewer must rerun `key-agreement-upsert` and then `reviewer-update` before the buyer/seller retries publish"), false);
});

test("closeout docs do not promise automatic mailbox settlement messages", () => {
  const readme = readRepoFile("README.md");
  const apiReference = readRepoFile("docs/guides/API_REFERENCE.md");
  const onboarding = readRepoFile("docs/guides/BOT_ONBOARDING.md");
  const mailboxNotifications = readRepoFile("docs/guides/MAILBOX_NOTIFICATIONS.md");
  const eventFeed = readRepoFile("docs/guides/EVENT_FEED_AND_WEBHOOKS.md");
  const orderStates = readRepoFile("docs/guides/ORDER_STATES.md");

  for (const text of [readme, apiReference, onboarding, mailboxNotifications, eventFeed, orderStates]) {
    assert.match(text, /order\.status_changed/);
  }
  for (const text of [apiReference, mailboxNotifications, eventFeed]) {
    assert.match(text, /dispute\.opened/);
  }
  for (const text of [apiReference, mailboxNotifications, eventFeed]) {
    assert.match(text, /plan-time wake-up|tx-plan wake-up/i);
  }
  for (const text of [readme, apiReference, onboarding, mailboxNotifications, eventFeed]) {
    assert.match(text, /DISPUTE_NOTICE/);
  }
  assert.doesNotMatch(eventFeed, /^- `dispute\.finalized`$/m);
  assert.doesNotMatch(eventFeed, /^- `dispute\.resolved`$/m);
  assert.match(eventFeed, /Advanced opt-in Event-Typen/);
  assert.match(eventFeed, /dispute\.finalization_planned/);
  assert.match(eventFeed, /dispute\.escrow_resolution_planned/);
  assert.match(eventFeed, /mailbox\.bound/);
  assert.match(mailboxNotifications, /advanced opt-in signals/i);
  assert.match(apiReference, /advanced opt-in plan and mailbox lifecycle events/i);
});

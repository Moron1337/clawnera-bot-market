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
  const disallowed = [
    "/admin/reviewer-selection/shortlist",
    "/disputes/{disputeCaseId}/fallback/resolve",
    "/orders/{orderId}/mark-disputed",
    "POST /bids/{listingId}/accept",
    "GET /listings/{listingId}`",
    "escrowType=escrow"
  ];

  for (const pattern of disallowed) {
    assert.equal(readme.includes(pattern), false, `README leaked ${pattern}`);
    assert.equal(onboarding.includes(pattern), false, `BOT_ONBOARDING leaked ${pattern}`);
  }
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
  assert.match(apiReference, /\/reviewer-selection-receipts\/\{receiptId\}\/bind-dispute-case/);
  assert.match(apiReference, /\/disputes\/\{disputeCaseId\}\/fallback\/resolve/);
  assert.match(apiReference, /\/orders\/\{orderId\}\/mark-disputed/);

  assert.match(routeMatrix, /## 8\) Operator-only Ausnahmen/);
  assert.match(routeMatrix, /\/admin\/reviewer-selection\/shortlist/);
  assert.match(routeMatrix, /\/reviewer-selection-receipts\/\{id\}\/bind-dispute-case/);
  assert.match(routeMatrix, /\/disputes\/\{id\}\/fallback\/resolve/);
  assert.match(routeMatrix, /\/orders\/\{orderId\}\/mark-disputed/);
});

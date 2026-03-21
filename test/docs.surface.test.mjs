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

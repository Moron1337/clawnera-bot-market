import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assertAppearsBefore(text, prerequisite, action, message) {
  const prerequisiteIndex = text.indexOf(prerequisite);
  const actionIndex = text.indexOf(action);
  assert.ok(
    prerequisiteIndex >= 0 && actionIndex >= 0 && prerequisiteIndex < actionIndex,
    message
  );
}

const recipeApiMutationHelpers = new Set([
  "auth-login",
  "bid-accept",
  "bid-create",
  "dispute-evidence-publish",
  "ensure-auth",
  "key-agreement-upsert",
  "listing-cancel",
  "listing-create",
  "listing-renew",
  "managed-storage-presign",
  "milestone-reject",
  "milestone-submit-byo",
  "reviewer-shortlist"
]);

const recipeDirectMarketplaceMoveHelpers = new Set([
  "listing-deposit-create",
  "milestone-anchor",
  "order-create-escrow",
  "order-init-bond",
  "reputation-init",
  "reviewer-register",
  "reviewer-update"
]);

function parseRecipeMutationCommand(line) {
  const match = line.match(/^clawnera-help\s+(\S+)(?:\s+(\S+))?/);
  if (!match) return null;
  const [, command, nextToken] = match;
  const mutatingMethod = /^(?:POST|PUT|PATCH|DELETE)$/.test(nextToken || "");
  if ((command === "request" || command.startsWith("tx-plan")) && mutatingMethod) {
    return { command, directMarketplaceMove: false };
  }
  if (command === "dispute-evidence-publish" && line.includes("--no-post")) return null;
  if (recipeApiMutationHelpers.has(command)) {
    return { command, directMarketplaceMove: false };
  }
  if (recipeDirectMarketplaceMoveHelpers.has(command)) {
    return { command, directMarketplaceMove: true };
  }
  return null;
}

function recipeMutationGateFor(action, command) {
  const apiBase = action.match(/(?:^|\s)--api-base\s+(\S+)/)?.[1];
  const authStateFile = action.match(/(?:^|\s)--auth-state-file\s+(\S+)/)?.[1];
  if ((command === "ensure-auth" || command === "auth-login") && apiBase) {
    return `clawnera-help write-gate --api-base ${apiBase}`;
  }
  if (authStateFile) {
    return `clawnera-help write-gate --auth-state-file ${authStateFile}`;
  }
  if (apiBase) {
    return `clawnera-help write-gate --api-base ${apiBase}`;
  }
  return null;
}

async function runSponsorPreflightExample(apiBase) {
  const child = spawn(process.execPath, [path.join(repoRoot, "examples/sponsor-preflight.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWNERA_API_BASE_URL: apiBase,
      CLAWNERA_API_JWT: "test-jwt",
      CLAWNERA_SPONSOR_ORDER_ID: "test-order",
      CLAWNERA_SPONSOR_PREFLIGHT_TARGET_CONFIRMED: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const [status] = await once(child, "close");
  return { status, stdout, stderr };
}

async function startSponsorPreflightGateServer(state) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
    }
    requests.push({ method: request.method, url: request.url, raw });

    let status = 200;
    let body;
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const responseHeaders = { "content-type": "application/json" };
    if (request.method === "GET" && requestUrl.pathname === "/policy/write-gate") {
      const nonce = requestUrl.searchParams.get("nonce");
      const generatedAtMs = Date.now();
      body = {
        version: "marketplace_write_gate.v1",
        nonce,
        generatedAt: new Date(generatedAtMs).toISOString(),
        generatedAtMs,
        expiresAtMs: generatedAtMs + 5_000,
        apiOrigin: `http://${request.headers.host}`,
        gate: {
          source: "runtime_db",
          preset: "normal",
          publicApiWrites: "live",
          marketplaceWrites: "live",
          releaseProfile: "controlled_v1",
          releasePhase: "canary_allowlisted",
          runtimeReady: true,
          productiveWritesEnabled: true
        },
        chain: {
          family: "iota",
          network: "testnet",
          chainIdentifier: "2304aa97",
          packageIds: {
            foundation: `0x${"1".repeat(64)}`,
            governance: `0x${"b".repeat(64)}`,
            settlement: `0x${"2".repeat(64)}`,
            fulfillment: `0x${"3".repeat(64)}`,
            ops: `0x${"4".repeat(64)}`
          },
          objectIds: {
            governanceConfigObjectId: null,
            orderMailboxRegistryObjectId: `0x${"c".repeat(64)}`,
            disputeQuorumConfigObjectId: null,
            marketplaceFeeConfigObjectId: null,
            reputationInitFeeConfigObjectId: null,
            listingDepositConfigObjectId: null,
            reviewerRegistryObjectId: null
          }
        }
      };
      responseHeaders["cache-control"] = "no-store";
      responseHeaders.pragma = "no-cache";
    } else if (request.method === "GET" && request.url === "/policy/control-plane") {
      body = {
        policy: {
          runtime: {
            maintenance: {
              preset: "normal",
              publicApiWrites: "live",
              source: "runtime_db"
            }
          }
        }
      };
    } else if (request.method === "GET" && request.url === "/bot/v1/discovery.json") {
      body = {
        release: { marketplaceWrites: "live" },
        guidance: { sponsor: { emergencyMode: "preflight_only" } }
      };
    } else if (request.method === "GET" && request.url === "/policy/sponsor") {
      body = { policy: { emergencyMode: "preflight_only" } };
    } else if (request.method === "GET" && request.url === "/actors/me/capabilities") {
      body = { capabilities: { sponsor: { canSponsor: state.canSponsor } } };
    } else if (request.method === "POST" && request.url === "/sponsor/preflight") {
      body = {
        orderId: "test-order",
        paymentCoin: "claw",
        strategy: {
          sponsorLikelyAllowed: true,
          selfPayFallbackAvailable: true,
          strictMode: false
        },
        diagnostics: []
      };
    } else {
      status = 404;
      body = { error: "unexpected_route" };
    }
    response.writeHead(status, responseHeaders);
    response.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      server.close();
      await once(server, "close");
    }
  };
}

test("sponsor preflight example stops before network without explicit target confirmation", () => {
  const env = {
    ...process.env,
    CLAWNERA_API_BASE_URL: "https://compatible-non-fresh.example",
    CLAWNERA_API_JWT: "test-jwt",
    CLAWNERA_SPONSOR_ORDER_ID: "test-order"
  };
  delete env.CLAWNERA_SPONSOR_PREFLIGHT_TARGET_CONFIRMED;
  const result = spawnSync(process.execPath, [path.join(repoRoot, "examples/sponsor-preflight.mjs")], {
    cwd: repoRoot,
    env,
    encoding: "utf8"
  });

  assert.equal(result.status, 78);
  assert.match(result.stderr, /sponsor_preflight_target_confirmation_required/);
});

test("sponsor preflight example requires actor capability before the only allowed POST", async () => {
  const state = { canSponsor: false };
  const mock = await startSponsorPreflightGateServer(state);
  try {
    const blocked = await runSponsorPreflightExample(mock.baseUrl);
    assert.equal(blocked.status, 78);
    assert.match(blocked.stderr, /sponsor_preflight_runtime_not_write_open/);
    assert.match(mock.requests[0]?.url || "", /^\/policy\/write-gate\?nonce=[0-9a-f]{32}$/);
    assert.equal(mock.requests.some((request) => request.method === "POST"), false);

    mock.requests.length = 0;
    state.canSponsor = true;
    const allowed = await runSponsorPreflightExample(mock.baseUrl);
    assert.equal(allowed.status, 0, allowed.stderr);
    const gateRequests = mock.requests.filter(
      (request) => request.method === "GET" && request.url.startsWith("/policy/write-gate?nonce="),
    );
    assert.ok(gateRequests.length >= 2);
    assert.equal(new Set(gateRequests.map((request) => request.url)).size, gateRequests.length);
    assert.match(mock.requests[0]?.url || "", /^\/policy\/write-gate\?nonce=[0-9a-f]{32}$/);
    const postRequests = mock.requests.filter((request) => request.method === "POST");
    assert.deepEqual(postRequests.map((request) => request.url), ["/sponsor/preflight"]);
    const postIndex = mock.requests.findIndex((request) => request.method === "POST");
    const actorCapabilityIndex = mock.requests.findIndex(
      (request) => request.url === "/actors/me/capabilities",
    );
    assert.ok(actorCapabilityIndex > 0 && actorCapabilityIndex < postIndex);
    assert.match(
      mock.requests[postIndex - 1]?.url || "",
      /^\/policy\/write-gate\?nonce=[0-9a-f]{32}$/,
    );
    assert.equal(mock.requests.some((request) => /\/sponsor\/(?:reserve|execute)/.test(request.url)), false);
  } finally {
    await mock.close();
  }
});

test("start-here docs avoid operator and legacy route strings", () => {
  const readme = readRepoFile("README.md");
  const onboarding = readRepoFile("docs/guides/BOT_ONBOARDING.md");
  const notifications = readRepoFile("docs/guides/MAILBOX_NOTIFICATIONS.md");
  const readmeDisallowed = [
    "/admin/reviewer-selection/shortlist",
    "/disputes/{disputeCaseId}/fallback/resolve",
    "/orders/{orderId}/mark-disputed",
    "POST /bids/{listingId}/accept",
    "escrowType=escrow",
    "compat_resolve_escrow_fallback=true",
    "telegram-mailbox-notifier.mjs"
  ];
  const onboardingDisallowed = [
    "/disputes/{disputeCaseId}/fallback/resolve",
    "/orders/{orderId}/mark-disputed",
    "POST /bids/{listingId}/accept",
    "escrowType=escrow",
    "compat_resolve_escrow_fallback=true",
    "telegram-mailbox-notifier.mjs"
  ];

  for (const pattern of readmeDisallowed) {
    assert.equal(readme.includes(pattern), false, `README leaked ${pattern}`);
  }

  for (const pattern of onboardingDisallowed) {
    assert.equal(onboarding.includes(pattern), false, `BOT_ONBOARDING leaked ${pattern}`);
  }

  assert.match(readme, /GET \/listings\/\{listingId\}/);
  assert.match(onboarding, /GET \/listings\/\{listingId\}/);
  assert.doesNotMatch(notifications, /telegram-mailbox-notifier/);
  assert.match(onboarding, /operator\/admin prep can happen first via `POST \/admin\/reviewer-selection\/shortlist`/);
});

test("synced knowledge sources include filtered public and advanced specs", () => {
  const knowledgeSources = readRepoFile("docs/guides/KNOWLEDGE_SOURCES.md");
  const contractReference = readRepoFile("docs/guides/SMART_CONTRACT_REFERENCE.md");
  assert.match(knowledgeSources, /openapi\.public\.yaml/);
  assert.match(knowledgeSources, /openapi\.advanced\.yaml/);
  for (const root of [
    "claw_foundation",
    "claw_governance",
    "claw_settlement_v2",
    "claw_fulfillment",
    "claw_ops",
  ]) {
    assert.match(knowledgeSources, new RegExp(`contracts/${root}/ci/callable_surface\\.snapshot`));
  }
  assert.doesNotMatch(
    knowledgeSources,
    /contracts\/claw_settlement_core\/ci\/callable_surface\.snapshot/,
  );
  assert.match(
    contractReference,
    /Foundation, Governance, Settlement, Fulfillment und Ops als fuenf .*paarweise verschiedene Package-IDs/,
  );
  assert.match(contractReference, /einzelne v3-Callable-Snapshot .* keine Fresh-ABI-Autoritaet/);
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

test("sponsor docs expose only current GET diagnostics and keep POST flows deferred", () => {
  const apiReference = readRepoFile("docs/guides/API_REFERENCE.md");
  const routeMatrix = readRepoFile("docs/guides/ROLE_ROUTE_MATRIX.md");
  const runtimeChecks = readRepoFile("docs/guides/AUTHENTICATED_RUNTIME_CHECKS.md");
  const botPolling = readRepoFile("docs/guides/BOT_POLLING.md");
  const botPlaybooks = readRepoFile("docs/guides/BOT_PLAYBOOKS.md");
  const onboarding = readRepoFile("docs/guides/BOT_ONBOARDING.md");
  const sponsorPolicy = readRepoFile("docs/guides/SPONSOR_POLICY.md");
  const operations = readRepoFile("docs/guides/OPERATIONS_CHECKS.md");
  const troubleshooting = readRepoFile("docs/guides/TROUBLESHOOTING_SUPPORT.md");
  const sponsorPreflightExample = readRepoFile("examples/sponsor-preflight.mjs");
  const sdkUsage = readRepoFile("docs/guides/SDK_USAGE.md");
  const paymentPolicy = readRepoFile("docs/guides/PAYMENT_POLICY.md");
  const readme = readRepoFile("README.md");
  const publicSpec = readRepoFile("docs/docsources/core/openapi.public.yaml");
  const index = readRepoFile("docs/INDEX.md");
  const ciWorkflow = readRepoFile(".github/workflows/ci.yml");
  const packageJson = JSON.parse(readRepoFile("package.json"));
  const topics = JSON.parse(readRepoFile("config/topics.json"));

  assert.doesNotMatch(apiReference, /reviewers\/\{reviewerAddress\}\/claim-metrics/);
  assert.doesNotMatch(routeMatrix, /reviewers\/\{reviewerAddress\}\/claim-metrics/);
  assert.match(runtimeChecks, /SPONSOR_ORDER_ID_MODE=required/);
  assert.doesNotMatch(runtimeChecks, /SPONSOR_ORDER_ID_MODE=required` is live/);
  for (const text of [
    readme,
    runtimeChecks,
    botPolling,
    botPlaybooks,
    onboarding,
    sponsorPolicy,
    apiReference,
    operations,
    troubleshooting,
    sdkUsage
  ]) {
    assert.match(text, /write_freeze/);
  }
  assert.match(sponsorPolicy, /Only these Sponsor-related calls are currently callable diagnostics/);
  assert.match(sponsorPolicy, /Every public `POST` is\s+blocked/);
  assert.match(readme, /read-only; public mutations are closed/);
  assert.match(sponsorPolicy, /GET \/policy\/control-plane/);
  assert.match(sponsorPolicy, /GET \/policy\/sponsor/);
  assert.match(sponsorPolicy, /GET \/actors\/me\/capabilities/);
  assert.match(sponsorPolicy, /POST \/sponsor\/preflight` is not a read/);
  assert.match(sponsorPolicy, /non-reserving\/non-executing protocol diagnostic/);
  assert.match(sponsorPolicy, /audit or rate-limit state/);
  assert.match(sponsorPolicy, /Fresh candidate.*503|503.*Fresh candidate/s);
  for (const text of [runtimeChecks, botPolling, onboarding, sponsorPolicy]) {
    assert.match(text, /quarantin/i);
  }
  assert.match(sponsorPolicy, /former dry-run\s+reserved gas before returning/);
  assert.match(sponsorPolicy, /CLAWDEX Sponsor Execute Intent v2/);
  assert.match(sponsorPolicy, /chainTxDigest/);
  assert.match(sponsorPolicy, /They are not a current call sequence or an execution runbook/);
  assert.doesNotMatch(sponsorPolicy, /only nonmutating Sponsor dry-run/i);
  assert.doesNotMatch(botPolling, /Sponsor-Flow als Standard/);
  assert.doesNotMatch(onboarding, /Reserve erst nach gruener Preflight-Antwort/);
  assert.doesNotMatch(runtimeChecks, /Reserve-Dry-Run|folgt der echte Build-\/Execute-Schritt/);
  for (const text of [readme, operations, troubleshooting]) {
    assert.doesNotMatch(text, /clawnera-help sponsor-(?:preflight|execute)\s/);
  }
  assert.doesNotMatch(sdkUsage, /api\.post\("\/sponsor\/(?:reserve|execute)"/);
  const sponsorApiSection = apiReference.slice(
    apiReference.indexOf("### Sponsor (current boundary)"),
    apiReference.indexOf("## 3) Dispute-bond hard gate summary")
  );
  assert.doesNotMatch(sponsorApiSection, /Request body:|Runtime response|Canonical signing string/);
  assert.match(sponsorPreflightExample, /CLAWNERA_SPONSOR_PREFLIGHT_TARGET_CONFIRMED/);
  assert.match(sponsorPreflightExample, /maintenance\?\.preset !== "normal"/);
  assert.match(sponsorPreflightExample, /maintenance\?\.publicApiWrites !== "live"/);
  assert.match(sponsorPreflightExample, /maintenance\?\.source !== "runtime_db"/);
  assert.match(sponsorPreflightExample, /release\?\.marketplaceWrites !== "live"/);
  assert.match(sponsorPreflightExample, /sponsorEmergencyMode !== "normal"/);
  assert.match(sponsorPreflightExample, /sponsorEmergencyMode !== "preflight_only"/);
  assert.match(sponsorPreflightExample, /sponsorPolicyEmergencyMode !== sponsorEmergencyMode/);
  assert.match(sponsorPreflightExample, /"sponsor-preflight"/);
  assert.doesNotMatch(sponsorPreflightExample, /"sponsor-execute"|\/sponsor\/reserve|reservation-out/);
  assert.equal(existsSync(path.join(repoRoot, "examples/sponsor-dry-run.mjs")), false);
  assert.doesNotMatch(ciWorkflow, /examples\/sponsor-dry-run\.mjs/);
  assert.match(ciWorkflow, /node \.\/examples\/sponsor-preflight\.mjs --help/);
  assert.equal(packageJson.scripts["example:sponsor:dry-run"], undefined);
  assert.equal(packageJson.files.includes("examples/sponsor-dry-run.mjs"), false);
  assert.equal(topics.topics.find((topic) => topic.id === "sponsor")?.title, "Sponsor Posture (Deferred)");
  assert.match(index, /`sponsor`: current read-only Sponsor posture and deferred protocol reference/);
  assert.doesNotMatch(index, /sponsor execute failed|gas-station reserve\/execute flow/);
  assert.match(readme, /GET \/policy\/assets/);
  assert.match(paymentPolicy, /GET \/policy\/assets/);
  assert.match(paymentPolicy, /SPEC/);
  assert.equal(publicSpec.includes("BOTH"), false, "public spec still leaks retired BOTH asset enum");
});

test("write guides fail closed and candidate reviewer replay stays OPEN-only", () => {
  const sponsorPolicy = readRepoFile("docs/guides/SPONSOR_POLICY.md");
  const apiReference = readRepoFile("docs/guides/API_REFERENCE.md");
  const onboarding = readRepoFile("docs/guides/BOT_ONBOARDING.md");
  const runtimeChecks = readRepoFile("docs/guides/AUTHENTICATED_RUNTIME_CHECKS.md");
  const reviewerFlow = readRepoFile("docs/guides/REVIEWER_SELECTOR_FLOW.md");
  const checklist = readRepoFile("docs/guides/CANONICAL_LIVE_RUN_CHECKLIST.md");
  const manualFlow = readRepoFile("docs/guides/LIVE_MANUAL_ORDER_FLOW.md");
  const readme = readRepoFile("README.md");
  const playbooks = readRepoFile("docs/guides/BOT_PLAYBOOKS.md");
  const recipesText = readRepoFile("config/recipes.json");
  const security = readRepoFile("docs/guides/SECURITY_GUIDELINES.md");
  const operations = readRepoFile("docs/guides/OPERATIONS_CHECKS.md");
  const sdkUsage = readRepoFile("docs/guides/SDK_USAGE.md");
  const recipeData = JSON.parse(recipesText);
  const recipes = recipeData.recipes;

  for (const text of [readme, checklist, manualFlow, recipesText]) {
    assert.match(text, /preset=normal/);
    assert.match(text, /publicApiWrites=live/);
    assert.match(text, /marketplaceWrites=live/);
    assert.match(text, /write_freeze/);
  }
  for (const text of [readme, onboarding, apiReference, security, operations, sdkUsage, recipesText]) {
    assert.match(text, /write-gate/);
    assert.match(text, /POST/);
    assert.match(text, /PUT/);
    assert.match(text, /PATCH/);
    assert.match(text, /DELETE/);
    assert.match(text, /direct Marketplace Move|Marketplace-Move/i);
  }
  assert.equal(
    recipeData.writeGate.command,
    "clawnera-help write-gate --api-base <target-api-base>"
  );
  assert.equal(recipeData.writeGate.requiredState["policy.runtime.maintenance.source"], "runtime_db");
  assert.equal(recipeData.writeGate.requiredState["policy.runtime.maintenance.preset"], "normal");
  assert.equal(recipeData.writeGate.requiredState["policy.runtime.maintenance.publicApiWrites"], "live");
  assert.equal(recipeData.writeGate.requiredState["release.marketplaceWrites"], "live");

  const directMarketplaceRoute = /^direct SDK\/PTB only:/;
  const directMarketplaceHelper =
    /clawnera-help (?:listing-deposit-create|order-init-bond|order-create-escrow|reputation-init|reviewer-register|reviewer-update|milestone-anchor)\b/;
  for (const recipe of recipes) {
    const entries = [...(recipe.steps || []), ...(recipe.examples || [])];
    const mutates =
      (recipe.routes || []).some((route) => /^(?:POST|PUT|PATCH|DELETE)\b/.test(route)) ||
      (recipe.routes || []).some((route) => directMarketplaceRoute.test(route)) ||
      entries.some((entry) => directMarketplaceHelper.test(entry));
    if (!mutates) continue;
    if (recipe.id === "dispute-platform-fallback") {
      assert.equal(recipe.role, "admin_only");
      assert.match(recipe.steps.join("\n"), /public helper/i);
      assert.match(recipe.steps.join("\n"), /admin\/operator custody workflow/i);
      assert.doesNotMatch(
        [...recipe.steps, ...recipe.examples].join("\n"),
        /clawnera-help (?:request|tx-plan-dry-run) POST/,
        "admin-only recipe must not expose a public mutation command"
      );
      continue;
    }
    assert.match(
      recipe.steps.join("\n"),
      /write-gate --api-base <target-api-base>/,
      "recipe " + recipe.id + " must gate every API or Marketplace Move mutation"
    );
  }
  assert.match(playbooks, /Waehrend `write_freeze` keinen E2E-Canary starten/);
  assert.doesNotMatch(playbooks, /Regelmaessig kleine E2E Order/);

  const setupRecipe = recipes.find((recipe) => recipe.id === "setup-quick");
  const setupGateIndex = setupRecipe.steps.findIndex((step) => step.includes("clawnera-help write-gate"));
  const setupAuthIndex = setupRecipe.steps.findIndex((step) => step.includes("ensure-auth"));
  assert.ok(setupGateIndex >= 0 && setupGateIndex < setupAuthIndex, "setup-quick must run the gate before auth POSTs");

  const ensureAuthRecipe = recipes.find((recipe) => recipe.id === "ensure-auth");
  const ensureAuthGateIndex = ensureAuthRecipe.steps.findIndex((step) => step.includes("clawnera-help write-gate"));
  const ensureAuthPostIndex = ensureAuthRecipe.steps.findIndex((step) =>
    step.includes("Only after the gate passes, run clawnera-help ensure-auth")
  );
  assert.ok(
    ensureAuthGateIndex >= 0 && ensureAuthGateIndex < ensureAuthPostIndex,
    "standalone ensure-auth must run the gate before auth POSTs"
  );
  assert.match(ensureAuthRecipe.steps.join("\n"), /source=runtime_db/);
  assert.match(ensureAuthRecipe.steps.join("\n"), /preset=normal/);
  assert.match(ensureAuthRecipe.steps.join("\n"), /publicApiWrites=live/);
  assert.match(ensureAuthRecipe.steps.join("\n"), /marketplaceWrites=live/);

  const onboardingPreflight = onboarding.slice(onboarding.indexOf("Copy-Paste Preflight:"));
  assertAppearsBefore(
    onboardingPreflight,
    "clawnera-help write-gate",
    "clawnera-help ensure-auth",
    "onboarding copy-paste must run the write gate before ensure-auth"
  );
  assert.doesNotMatch(readme, /copied core operator docs/);
  assert.doesNotMatch(apiReference, /copied core operator docs/);
  const authShellSetup = runtimeChecks.slice(
    runtimeChecks.indexOf("Empfohlener Shell-Setup"),
    runtimeChecks.indexOf("Dann entweder direkt source'n")
  );
  assertAppearsBefore(
    authShellSetup,
    "GET /policy/control-plane",
    "clawnera-help auth-login",
    "authenticated setup must read the control gate before auth-login"
  );
  const authRecommendedOrder = runtimeChecks.slice(runtimeChecks.indexOf("## 7) Empfohlene Reihenfolge"));
  assertAppearsBefore(
    authRecommendedOrder,
    "GET /policy/control-plane",
    "auth-login",
    "authenticated recommended order must gate before auth POSTs"
  );

  assert.match(sponsorPolicy, /CLAWDEX Sponsor Execute Intent v2/);
  assert.match(sponsorPolicy, /chainTxDigest/);
  assert.doesNotMatch(sponsorPolicy, /CLAWDEX Sponsor Execute Intent v1/);
  for (const text of [apiReference, onboarding, reviewerFlow, checklist]) {
    assert.match(text, /reviewerSelectionReceiptId/);
    assert.match(text, /ordered shortlist|geordnete Receipt-Shortlist/);
    assert.match(text, /operatorAuthorizationHandoff/);
    assert.match(text, /preExecutionRequirements/);
    assert.doesNotMatch(text, /omit the receipt only|omitting the receipt is only/);
  }
  for (const text of [readme, reviewerFlow, checklist, manualFlow]) {
    assert.match(text, /undeployed candidate|Undeployed candidate/i);
    assert.match(text, /--request-state-file/);
    assert.match(text, /--request-receipt-id/);
    assert.match(text, /insufficient across processes|insufficient across process|insufficient for cross-process/i);
  }
  assert.match(reviewerFlow, /state v2 is\s+created atomically and exclusively/);
  assert.match(reviewerFlow, /canonical API base/);
  assert.match(reviewerFlow, /SHA-guarded compare-and-swap/);
  assert.match(reviewerFlow, /distinct paths/);
  assert.match(reviewerFlow, /actor authorization and replay binding remain server-side checks/);
  assert.doesNotMatch(reviewerFlow, /actor, checkpoint, or body drift fails closed/);
  assert.match(readme, /Unknown `reviewer-shortlist` options fail closed/);

  const openRecipe = recipes.find((recipe) => recipe.id === "operator-shortlist-open");
  const replacementRecipe = recipes.find((recipe) => recipe.id === "operator-shortlist-replacement");
  assert.match(openRecipe.when, /OPEN round only/);
  assert.doesNotMatch(openRecipe.when, /open or replacement rounds/i);
  assert.match(openRecipe.steps.join("\n"), /--request-state-file/);
  assert.match(openRecipe.steps.join("\n"), /UUID alone.*insufficient for cross-process replay/);
  assert.match(openRecipe.steps.join("\n"), /State v2 is created atomically and exclusively/);
  assert.match(openRecipe.steps.join("\n"), /canonical API base/);
  assert.match(openRecipe.steps.join("\n"), /SHA-guarded compare-and-swap/);
  assert.match(openRecipe.steps.join("\n"), /distinct paths/);
  assert.match(replacementRecipe.steps.join("\n"), /does not accept --request-state-file or --request-receipt-id/);
});

test("every mutating recipe example gates the exact target immediately before the action", () => {
  const recipeData = JSON.parse(readRepoFile("config/recipes.json"));
  assert.deepEqual(recipeData.writeGate.requiredImmediatelyBefore, [
    "every authentication refresh or sign-in POST",
    "every public POST, PUT, PATCH, or DELETE",
    "every tx-plan POST",
    "every direct Marketplace Move broadcast"
  ]);

  let mutationCount = 0;
  const directHelpersCovered = new Set();
  for (const recipe of recipeData.recipes) {
    for (const [exampleIndex, example] of (recipe.examples || []).entries()) {
      const lines = example.split(/\\n|\n/).map((line) => line.trim());
      for (const [lineIndex, action] of lines.entries()) {
        const mutation = parseRecipeMutationCommand(action);
        if (!mutation) continue;
        mutationCount += 1;
        const expectedGate = recipeMutationGateFor(action, mutation.command);
        assert.ok(
          expectedGate,
          `${recipe.id} example ${exampleIndex} mutation lacks an exact target selector: ${action}`
        );
        assert.equal(
          lines[lineIndex - 1],
          expectedGate,
          `${recipe.id} example ${exampleIndex} must gate the exact target immediately before: ${action}`
        );

        if (mutation.directMarketplaceMove) {
          directHelpersCovered.add(mutation.command);
          assert.match(example, /Future write-open/i, `${recipe.id} direct Move example is not future-only`);
          assert.match(example, /default(?:s)? to dry-run/i, `${recipe.id} must state the dry-run default`);
          assert.match(action, /(?:^|\s)--execute(?:\s|$)/, `${recipe.id} broadcast must opt in with --execute`);
        }
      }
    }
  }

  assert.equal(mutationCount, 53, "the complete current mutating Examples surface must be checked");
  assert.deepEqual([...directHelpersCovered].sort(), [
    "listing-deposit-create",
    "milestone-anchor",
    "order-create-escrow",
    "order-init-bond",
    "reputation-init",
    "reviewer-register"
  ]);
});

test("public recipe examples use non-expiring placeholders for future deadlines", () => {
  const recipeData = JSON.parse(readRepoFile("config/recipes.json"));
  for (const recipe of recipeData.recipes) {
    for (const [exampleIndex, example] of (recipe.examples || []).entries()) {
      assert.doesNotMatch(
        example,
        /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/,
        `${recipe.id} example ${exampleIndex} hard-codes an expiring ISO timestamp`,
      );
    }
  }
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

test("active dispute guides require one-wrapper IOTA closeout and Sui-only legacy recovery", () => {
  const readme = readRepoFile("README.md");
  const apiReference = readRepoFile("docs/guides/API_REFERENCE.md");
  const onboarding = readRepoFile("docs/guides/BOT_ONBOARDING.md");
  const playbooks = readRepoFile("docs/guides/BOT_PLAYBOOKS.md");
  const manualFlow = readRepoFile("docs/guides/LIVE_MANUAL_ORDER_FLOW.md");
  const checklist = readRepoFile("docs/guides/CANONICAL_LIVE_RUN_CHECKLIST.md");
  const reviewerFlow = readRepoFile("docs/guides/REVIEWER_SELECTOR_FLOW.md");
  const routeMatrix = readRepoFile("docs/guides/ROLE_ROUTE_MATRIX.md");
  const sdkUsage = readRepoFile("docs/guides/SDK_USAGE.md");
  const contractReference = readRepoFile("docs/guides/SMART_CONTRACT_REFERENCE.md");
  const tasks = readRepoFile("docs/guides/TASK_RECIPES.md");
  const orderStates = readRepoFile("docs/guides/ORDER_STATES.md");
  const functionMap = readRepoFile("docs/guides/BOT_FUNCTION_MAP.md");

  const closeoutDocs = [
    readme,
    apiReference,
    onboarding,
    playbooks,
    checklist,
    manualFlow,
    reviewerFlow,
    routeMatrix,
    sdkUsage,
    contractReference,
    tasks,
    orderStates,
    functionMap,
  ];
  for (const text of closeoutDocs) {
    assert.match(text, /atomic|atomar/i);
    assert.match(text, /wrapper/i);
    assert.match(text, /resolve-escrow/);
    assert.match(text, /legacy/i);
    assert.match(text, /recovery/i);
    assert.match(text, /Sui/i);
    assert.match(text, /410/);
    assert.equal(text.includes("same wallet that received the `QuorumResolutionTicket`"), false);
    assert.equal(text.includes("quorum_resolution_ticket_owner_mismatch"), false);
    assert.doesNotMatch(text, /and then runs `\/resolve-escrow`|then resolves escrow/i);
  }

  for (const text of [
    readme,
    apiReference,
    onboarding,
    playbooks,
    checklist,
    manualFlow,
    reviewerFlow,
    routeMatrix,
    sdkUsage,
    contractReference,
    tasks,
    orderStates,
    functionMap,
  ]) {
    assert.match(text, /ArbCap/is);
    assert.match(text, /operator.*admin|admin.*operator/is);
    assert.match(text, /Public Helper/is);
  }
  assert.match(sdkUsage, /@clawdex\/sdk\/admin/);
  assert.match(contractReference, /Sui[\s\S]*resolve_dispute_with_binding|resolve_dispute_with_binding[\s\S]*Sui/i);
  assert.match(apiReference, /410[\s\S]*iota_dispute_resolve_escrow_route_retired/i);
  assert.match(tasks, /`resolve-dispute`[\s\S]*Sui legacy\/recovery\/reconciliation only/i);
  assert.match(functionMap, /Historical two-step evidence applies only to the Sui legacy recovery lane/);
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
  assert.match(eventFeed, /dispute\.finalized.*Chain-Indexer-Projektionen|Chain-Indexer-Projektionen.*dispute\.finalized/);
  assert.doesNotMatch(eventFeed, /^- `dispute\.resolved`$/m);
  assert.match(eventFeed, /Advanced opt-in Event-Typen/);
  assert.match(eventFeed, /dispute\.finalization_planned/);
  assert.match(eventFeed, /dispute\.escrow_resolution_planned/);
  assert.match(eventFeed, /mailbox\.bound/);
  assert.match(mailboxNotifications, /advanced opt-in signals/i);
  assert.match(apiReference, /advanced opt-in plan and mailbox lifecycle events/i);
});

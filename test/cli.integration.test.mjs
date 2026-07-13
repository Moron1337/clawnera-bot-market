import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  buildDisputeSupplementalBundlePayload,
  buildManagedDeliverablePayload,
  createEncryptedDeliverable,
  generateKeyAgreementKeypair,
  saveKeyAgreementRecord
} from "../lib/e2ee-local.mjs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { buildAuthChallengeV2Message } from "../lib/runtime-auth.mjs";

process.umask(0o077);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliFile = path.join(repoRoot, "bin", "clawnera-help.mjs");
const TEST_LISTING_DUE_AT_1 = "2026-04-20T12:00:00Z";
const TEST_LISTING_DUE_AT_2 = "2026-04-27T12:00:00Z";
const TEST_LISTING_DUE_AT_MS_1 = Date.parse(TEST_LISTING_DUE_AT_1);
const TEST_LISTING_DUE_AT_MS_2 = Date.parse(TEST_LISTING_DUE_AT_2);
const REVIEWER_OPERATOR_ADDRESS = `0x${"f".repeat(64)}`;
const WRITE_GATE_PACKAGE_IDS = Object.freeze({
  foundation: `0x${"1".repeat(64)}`,
  settlement: `0x${"2".repeat(64)}`,
  fulfillment: `0x${"3".repeat(64)}`,
  ops: `0x${"4".repeat(64)}`,
});
const WRITE_GATE_OBJECT_IDS = Object.freeze({
  governanceConfigObjectId: `0x${"5".repeat(64)}`,
  disputeQuorumConfigObjectId: `0x${"6".repeat(64)}`,
  marketplaceFeeConfigObjectId: `0x${"7".repeat(64)}`,
  reputationInitFeeConfigObjectId: `0x${"8".repeat(64)}`,
  listingDepositConfigObjectId: `0x${"9".repeat(64)}`,
  reviewerRegistryObjectId: `0x${"a".repeat(64)}`,
});

function buildMarketplaceWriteGateResponse(request, overrides = {}) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const generatedAtMs = overrides.generatedAtMs ?? Date.now();
  return {
    status: overrides.status || 200,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      ...(overrides.headers || {}),
    },
    body: overrides.body || {
      version: "marketplace_write_gate.v1",
      nonce: url.searchParams.get("nonce") || "",
      generatedAt: new Date(generatedAtMs).toISOString(),
      generatedAtMs,
      expiresAtMs: overrides.expiresAtMs ?? generatedAtMs + 5_000,
      apiOrigin: `http://${request.headers.host}`,
      gate: {
        source: "runtime_db",
        preset: "normal",
        publicApiWrites: "live",
        marketplaceWrites: "live",
        releaseProfile: "controlled_v1",
        releasePhase: "canary_allowlisted",
        runtimeReady: true,
        productiveWritesEnabled: true,
        ...(overrides.gate || {}),
      },
      chain: {
        family: "iota",
        network: "testnet",
        chainIdentifier: "2304aa97",
        packageIds: WRITE_GATE_PACKAGE_IDS,
        objectIds: WRITE_GATE_OBJECT_IDS,
        ...(overrides.chain || {}),
      },
    },
  };
}

function buildFreshMarketplacePolicyResponse() {
  return {
    policy: {
      chainConfig: {
        foundationPackageId: WRITE_GATE_PACKAGE_IDS.foundation,
        settlementPackageId: WRITE_GATE_PACKAGE_IDS.settlement,
        fulfillmentPackageId: WRITE_GATE_PACKAGE_IDS.fulfillment,
        opsPackageId: WRITE_GATE_PACKAGE_IDS.ops,
        ...WRITE_GATE_OBJECT_IDS,
      },
      listingDeposit: {
        enabled: true,
        amount: "1000",
        configObjectId: WRITE_GATE_OBJECT_IDS.listingDepositConfigObjectId,
        packageId: WRITE_GATE_PACKAGE_IDS.ops,
      },
      reputationInitFee: {
        amount: "1000",
        configObjectId: WRITE_GATE_OBJECT_IDS.reputationInitFeeConfigObjectId,
        packageId: WRITE_GATE_PACKAGE_IDS.settlement,
      },
    },
  };
}

function directListingDepositArgs({ apiBase, rpcUrl, keystoreFile, actorAddress }) {
  return [
    "listing-deposit-create",
    "--execute",
    "--api-base",
    apiBase,
    "--jwt",
    "test-jwt",
    "--rpc-url",
    rpcUrl,
    "--alias",
    "seller",
    "--keystore-path",
    keystoreFile,
    "--creator-address",
    actorAddress,
    "--listing-mode",
    "OFFER",
    "--title",
    "Direct gate regression",
    "--description",
    "Must remain bound to the attested runtime.",
    "--category",
    "security",
    "--currency",
    "IOTA",
    "--milestones",
    "first:1;second:1",
    "--milestone-due-dates",
    "2027-01-01T00:00:00.000Z;2027-01-02T00:00:00.000Z",
    "--json",
  ];
}

function defaultArtifactsDir(tempHome) {
  return path.join(tempHome, ".config", "clawnera", "artifacts");
}

function buildJwtWithExp(expSeconds, claims = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ ...claims, exp: expSeconds })}.signature`;
}

function buildReviewerOperatorJwt() {
  return buildJwtWithExp(4102444800, { sub: REVIEWER_OPERATOR_ADDRESS });
}

function reviewerShortlistAuthorizationHandoff({
  scope,
  receiptId,
  reviewers,
  orderId,
  milestoneId,
  disputeCaseObjectId,
}) {
  const open = scope === "OPEN";
  return {
    state: "BLOCKED_EXTERNAL_CUSTODY_INPUTS",
    requiredBeforePublish: true,
    custodyBoundary: "external",
    txBuilder: open
      ? "disputeQuorum.authorizeOrderReviewerSelection"
      : "disputeQuorum.authorizeReplacementReviewerSelection",
    receiptId,
    orderedReviewerAddresses: [...reviewers],
    preparedRequest: open
      ? {
          orderId,
          milestoneId,
          invitedReviewerAddresses: [...reviewers],
          packageId: `0x${"5".repeat(64)}`,
          disputeQuorumConfigObjectId: `0x${"6".repeat(64)}`,
          governanceConfigObjectId: `0x${"7".repeat(64)}`,
        }
      : {
          disputeCaseObjectId,
          invitedReviewerAddresses: [...reviewers],
          packageId: `0x${"5".repeat(64)}`,
          disputeQuorumConfigObjectId: `0x${"6".repeat(64)}`,
          governanceConfigObjectId: `0x${"7".repeat(64)}`,
        },
    missingOperatorInputs: open
      ? [
          "sender",
          "reviewerSelectorCapObjectId",
          "reviewerRegistryObjectId",
          "bondObjectId",
          "bondCoinTypeWhenTyped",
          "escrowObjectId",
          "intendedParty",
          "expiresAtMs",
        ]
      : [
          "sender",
          "reviewerSelectorCapObjectId",
          "reviewerRegistryObjectId",
          "intendedParty",
          "expiresAtMs",
        ],
  };
}

function stableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableJsonValue(entry)]),
  );
}

function hashStableJson(value) {
  return createHash("sha256").update(JSON.stringify(stableJsonValue(value))).digest("hex");
}

function reviewerSelectionReceipt({
  scope,
  receiptId,
  reviewers,
  checkpointDigest,
  checkpointSequenceNumber,
  checkpointTimestampMs = 1700000000000,
  orderId = "order-test",
  milestoneId = "milestone-test",
  disputeCaseObjectId,
  buyerAddress = `0x${"1".repeat(64)}`,
  sellerAddress = `0x${"2".repeat(64)}`,
  reviewerCountRequested = reviewers.length,
  directoryScanTruncated = false,
  assignmentRound = scope === "OPEN" ? 0 : 1,
  requestBody,
  overrides = {},
}) {
  const createdByActorAddress = REVIEWER_OPERATOR_ADDRESS;
  const normalizedRequestBody = requestBody || {
    scope,
    ...(scope === "OPEN" ? { receiptId, orderId, milestoneId, buyerAddress, sellerAddress } : {}),
    ...(scope === "REPLACEMENT" ? { disputeCaseObjectId } : {}),
    checkpointDigest,
    reviewerCount: reviewerCountRequested,
    directoryScanLimit: 1_000,
    minPerformanceScore: 50,
    minReputationScore: 50,
    minReputationConfidence: 20,
    allowNewReviewers: true,
    minDecisionsTotal: 0,
    maxNoshowCount: 3,
    maxCommitRevealFailures: 3,
    excludedReviewerAddresses: [],
    blockedReviewerAddresses: [],
  };
  const normalizedExcludedReviewerAddresses = [
    ...new Set(normalizedRequestBody.excludedReviewerAddresses || []),
  ].sort();
  const normalizedBlockedReviewerAddresses = [
    ...new Set(normalizedRequestBody.blockedReviewerAddresses || []),
  ].sort();
  const requestHash = hashStableJson({
    schemaVersion: "v1",
    receiptId,
    createdByActorAddress,
    scope: normalizedRequestBody.scope,
    reviewerCount: normalizedRequestBody.reviewerCount,
    directoryScanLimit: normalizedRequestBody.directoryScanLimit,
    checkpointDigest: normalizedRequestBody.checkpointDigest,
    orderId: normalizedRequestBody.orderId ?? null,
    milestoneId: normalizedRequestBody.milestoneId ?? null,
    disputeCaseObjectId: normalizedRequestBody.disputeCaseObjectId ?? null,
    buyerAddress: normalizedRequestBody.buyerAddress ?? null,
    sellerAddress: normalizedRequestBody.sellerAddress ?? null,
    excludedReviewerAddresses: normalizedExcludedReviewerAddresses,
    blockedReviewerAddresses: normalizedBlockedReviewerAddresses,
    minPerformanceScore: normalizedRequestBody.minPerformanceScore,
    minReputationScore: normalizedRequestBody.minReputationScore,
    minReputationConfidence: normalizedRequestBody.minReputationConfidence,
    allowNewReviewers: normalizedRequestBody.allowNewReviewers,
    minDecisionsTotal: normalizedRequestBody.minDecisionsTotal,
    maxNoshowCount: normalizedRequestBody.maxNoshowCount,
    maxCommitRevealFailures: normalizedRequestBody.maxCommitRevealFailures,
  });
  const candidatePool = reviewers.map((reviewerAddress) => ({ reviewerAddress, eligible: true }));
  const receiptScope = overrides.scope ?? scope;
  const receiptOrderId = overrides.orderId ?? orderId;
  const receiptMilestoneId = overrides.milestoneId ?? milestoneId;
  const receiptDisputeCaseObjectId = overrides.disputeCaseObjectId ?? disputeCaseObjectId;
  const receiptAssignmentRound = overrides.assignmentRound ?? assignmentRound;
  const receiptCheckpointDigest = overrides.checkpointDigest ?? checkpointDigest;
  const seedHash = hashStableJson({
    seedScopeKey:
      receiptScope === "OPEN"
        ? `${receiptOrderId}:${receiptMilestoneId}:open`
        : `${receiptDisputeCaseObjectId || receiptOrderId}:replacement`,
    assignmentRound: receiptAssignmentRound,
    checkpointDigest: receiptCheckpointDigest,
  });
  const candidatePoolHash = hashStableJson(candidatePool);
  const shortlistHash = hashStableJson(reviewers);
  const receiptHash = hashStableJson({
    seedHash,
    candidatePoolHash,
    shortlistHash,
    shortlistedReviewerAddresses: reviewers,
    selectionPolicyVersion: "reviewer_selector_v4",
  });
  return {
    id: receiptId,
    scope,
    ...(scope === "REPLACEMENT" ? { disputeCaseObjectId } : {}),
    orderId,
    milestoneId,
    buyerAddress,
    sellerAddress,
    assignmentRound,
    reviewerCountRequested,
    reviewerCountSelected: reviewers.length,
    selectionPolicyVersion: "reviewer_selector_v4",
    requestHash,
    checkpointDigest,
    checkpointSequenceNumber,
    ...(checkpointTimestampMs === null ? {} : { checkpointTimestampMs }),
    checkpointSource: "rpc_latest_finalized",
    seedHash,
    candidatePoolHash,
    shortlistHash,
    receiptHash,
    directoryScanTruncated,
    shortlistedReviewerAddresses: [...reviewers],
    blockedReviewerAddresses: normalizedBlockedReviewerAddresses,
    excludedReviewerAddresses: normalizedExcludedReviewerAddresses,
    candidatePool,
    createdByActorAddress,
    createdAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

function buildLocalAuthChallenge(request, address, nonce) {
  const nowMs = Date.now();
  const context = {
    origin: `http://${request.headers.host}`,
    audience: "clawdex-client",
    environment: "test",
    chainFamily: "iota",
    network: "localnet",
    address,
    nonce,
    issuedAtMs: nowMs - 1_000,
    expiresAtMs: nowMs + 60_000,
  };
  return {
    protocol: "clawdex.auth",
    version: 2,
    ...context,
    messageToSign: buildAuthChallengeV2Message(context),
  };
}

function txBytesGuard(bytesBase64, chainIdentifier = "test-chain") {
  return {
    chainIdentifier,
    transactionBytesSha256: createHash("sha256").update(Buffer.from(bytesBase64, "base64")).digest("hex"),
  };
}

async function runCli(args = [], env = {}) {
  const child = spawn(process.execPath, [cliFile, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env
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

  const [code] = await once(child, "close");
  return {
    status: code ?? 1,
    stdout,
    stderr
  };
}

function parseJsonMaybe(raw) {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function startMockServer(routes) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
    }

    const request = {
      method: req.method || "GET",
      url: req.url || "/",
      headers: req.headers,
      raw,
      body: parseJsonMaybe(raw)
    };
    requests.push(request);

    const writeGateRoute =
      request.method === "GET" && /^\/policy\/write-gate\?nonce=[0-9a-f]{32}$/.test(request.url)
        ? routes["GET /policy/write-gate"]
        : null;
    const handler =
      routes[`${request.method} ${request.url}`] || writeGateRoute || routes[request.url || "/"] || routes.default;
    const builtInResponse =
      request.method === "GET" && /^\/policy\/write-gate\?nonce=[0-9a-f]{32}$/.test(request.url)
        ? buildMarketplaceWriteGateResponse(request)
        : null;
    const response = handler
      ? await handler(request)
      : builtInResponse
        ? builtInResponse
      : request.method === "GET" && /^\/users\/[^/]+\/key-agreement\?keyVersion=\d+$/.test(request.url)
        ? {
            status: 404,
            body: { error: "key_agreement_not_found" },
          }
        : {
            status: 404,
            body: { error: "not_found" }
          };

    const headers = {
      "content-type": "application/json",
      ...(response.headers || {})
    };

    res.writeHead(response.status || 200, headers);
    if (response.raw !== undefined) {
      res.end(String(response.raw));
      return;
    }
    res.end(JSON.stringify(response.body ?? {}));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      server.close();
      await once(server, "close");
    }
  };
}

test("doctor with jwt reports actor capability failure details", async () => {
  const mock = await startMockServer({
    "GET /health": () => ({ status: 200, body: { ok: true } }),
    "GET /ready": () => ({ status: 200, body: { ok: true } }),
    "GET /capabilities": () => ({ status: 200, body: { ok: true } }),
    "GET /policy/fees": () => ({ status: 200, body: { ok: true } }),
    "GET /auth/session": () => ({ status: 200, body: { ok: true, session: { refreshAvailable: true } } }),
    "GET /actors/me/capabilities": () => ({ status: 403, body: { error: "insufficient_scope" } })
  });

  try {
    const result = await runCli(["doctor", "--api-base", mock.baseUrl, "--jwt", "test-jwt", "--json"]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.remote.jwtProvided, true);
    const sessionCheck = payload.remote.checks.find((check) => check.id === "auth_session");
    assert.equal(sessionCheck.status, "pass");
    assert.equal(sessionCheck.httpStatus, 200);
    const actorCheck = payload.remote.checks.find((check) => check.id === "actor_capabilities");
    assert.equal(actorCheck.status, "fail");
    assert.equal(actorCheck.httpStatus, 403);
    assert.match(actorCheck.detail, /insufficient_scope/);
  } finally {
    await mock.close();
  }
});

test("doctor refreshes saved auth state after invalid_token on actor probes", async () => {
  const staleToken = buildJwtWithExp(1);
  const refreshedToken = buildJwtWithExp(4102444800);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-doctor-refresh-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  const mock = await startMockServer({
    "GET /health": () => ({ status: 200, body: { ok: true } }),
    "GET /ready": () => ({ status: 200, body: { ok: true } }),
    "GET /capabilities": () => ({ status: 200, body: { ok: true } }),
    "GET /policy/fees": () => ({ status: 200, body: { ok: true } }),
    "GET /actors/me/capabilities": (request) => {
      if (request.headers.authorization === `Bearer ${staleToken}`) {
        return { status: 401, body: { error: "invalid_token" } };
      }
      assert.equal(request.headers.authorization, `Bearer ${refreshedToken}`);
      return { status: 200, body: { ok: true } };
    },
    "GET /auth/session": (request) => {
      assert.equal(request.headers.authorization, `Bearer ${refreshedToken}`);
      return { status: 200, body: { ok: true } };
    },
    "POST /auth/refresh": (request) => {
      assert.equal(request.body?.refreshToken, "refresh-token-1");
      return {
        status: 200,
        body: {
          token: refreshedToken,
          refreshToken: "refresh-token-2",
          expiresAtMs: 4102444800000
        }
      };
    }
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: staleToken,
          refreshToken: "refresh-token-1",
          address: "0x1111111111111111111111111111111111111111111111111111111111111111",
          alias: "bot"
        },
        null,
        2
      )
    );
    const result = await runCli(["doctor", "--api-base", mock.baseUrl, "--auth-state-file", authStateFile, "--json"]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.authContext.authStateRefreshed, true);
    const actorCheck = payload.remote.checks.find((check) => check.id === "actor_capabilities");
    const sessionCheck = payload.remote.checks.find((check) => check.id === "auth_session");
    assert.equal(actorCheck.status, "pass");
    assert.equal(sessionCheck.status, "pass");
    const saved = JSON.parse(readFileSync(authStateFile, "utf8"));
    assert.equal(saved.token, refreshedToken);
    assert.equal(saved.refreshToken, "refresh-token-2");
  } finally {
    await mock.close();
  }
});

test("doctor preserves exit 78 and does not refresh auth when the exact-target gate is frozen", async () => {
  const token = buildJwtWithExp(4102444800);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-doctor-frozen-refresh-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  let refreshCalls = 0;

  const mock = await startMockServer({
    "GET /health": () => ({ status: 200, body: { ok: true } }),
    "GET /ready": () => ({ status: 200, body: { ok: true } }),
    "GET /capabilities": () => ({ status: 200, body: { ok: true } }),
    "GET /policy/fees": () => ({ status: 200, body: { ok: true } }),
    "GET /actors/me/capabilities": () => ({ status: 401, body: { error: "invalid_token" } }),
    "GET /policy/write-gate": (request) =>
      buildMarketplaceWriteGateResponse(request, {
        gate: {
          preset: "write_freeze",
          publicApiWrites: "frozen",
          marketplaceWrites: "frozen",
          runtimeReady: false,
          productiveWritesEnabled: false,
        },
      }),
    "POST /auth/refresh": () => {
      refreshCalls += 1;
      return { status: 500, body: { error: "refresh_must_not_run" } };
    },
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token,
          refreshToken: "refresh-token-1",
          address: "0x1111111111111111111111111111111111111111111111111111111111111111",
          alias: "bot",
        },
        null,
        2,
      ),
    );
    const result = await runCli(["doctor", "--api-base", mock.baseUrl, "--auth-state-file", authStateFile, "--json"]);
    assert.equal(result.status, 78);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "marketplace_mutation_gate_closed");
    assert.equal(payload.exitCode, 78);
    assert.equal(refreshCalls, 0);
    assert.equal(
      mock.requests.filter(
        (request) => request.method === "GET" && /^\/policy\/write-gate\?nonce=[0-9a-f]{32}$/.test(request.url),
      ).length,
      1,
    );
  } finally {
    await mock.close();
  }
});

test("direct listing-deposit execution remains closed until the bundled deployment registry is activated", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-deployment-registry-integration-"));
  const keystoreFile = path.join(tempHome, "missing.keystore");
  const actorAddress = `0x${"1".repeat(64)}`;
  const mock = await startMockServer({
    default: () => ({ status: 500, body: { error: "network_must_not_run" } }),
  });

  try {
    const result = await runCli(
      directListingDepositArgs({
        apiBase: mock.baseUrl,
        rpcUrl: `${mock.baseUrl}/rpc`,
        keystoreFile,
        actorAddress,
      }),
      { HOME: tempHome, CLAWNERA_IOTA_NETWORK: "testnet" },
    );

    assert.equal(result.status, 78, result.stdout || result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "marketplace_deployment_identity_unavailable");
    assert.equal(payload.exitCode, 78);
    assert.equal(payload.mutationGate?.error, "marketplace_direct_write_gate_failed");
    assert.equal(mock.requests.length, 0);
    assert.equal(existsSync(keystoreFile), false);
  } finally {
    await mock.close();
  }
});

test("request rejects absolute URLs before sending auth headers", async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-cli-abs-url-"));
  const authStateFile = path.join(tmpDir, "auth-state.json");
  writeFileSync(
    authStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: `0x${"1".repeat(64)}`,
      apiBase: "https://api.clawnera.com"
    }),
    "utf8"
  );

  const result = await runCli(
    ["request", "GET", "https://attacker.example/capture", "--auth-state-file", authStateFile, "--json"],
    {}
  );
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error, "absolute_api_url_not_allowed");
});

test("request and tx-plan reject a leading backslash before resolving auth state", async () => {
  const missingAuthStateFile = path.join(
    mkdtempSync(path.join(os.tmpdir(), "clawnera-cli-backslash-url-")),
    "missing-auth-state.json",
  );
  for (const args of [
    ["request", "GET", "\\attacker.example/capture"],
    ["tx-plan-dry-run", "POST", "\\attacker.example/plan"],
  ]) {
    const result = await runCli([...args, "--auth-state-file", missingAuthStateFile, "--json"], {});
    assert.equal(result.status, 1, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "absolute_api_url_not_allowed");
  }
});

test("request rejects conflicting env-file and auth-state API origins before exposing the token", async () => {
  const targetA = await startMockServer({
    "GET /health": () => ({ status: 200, body: { ok: true, target: "a" } }),
  });
  const targetB = await startMockServer({
    "GET /health": () => ({ status: 200, body: { ok: true, target: "b" } }),
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-api-origin-mismatch-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "target.env");
  const token = buildJwtWithExp(4102444800);
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: targetA.baseUrl,
        token,
        refreshToken: "refresh-token-a",
        address: `0x${"1".repeat(64)}`,
        alias: "bot-a",
      },
      null,
      2,
    ),
  );
  writeFileSync(envFile, `CLAWNERA_API_BASE_URL=${targetB.baseUrl}\n`);

  try {
    const result = await runCli(
      [
        "request",
        "GET",
        "/health",
        "--auth-state-file",
        authStateFile,
        "--env-file",
        envFile,
        "--json",
      ],
      {
        CLAWNERA_API_BASE_URL: "",
        CLAWNERA_API_JWT: "",
        CLAWNERA_AUTH_STATE_FILE: "",
        CLAWNERA_ENV_FILE: "",
      },
    );
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error, "api_base_source_mismatch");
    assert.equal(targetA.requests.length, 0);
    assert.equal(targetB.requests.length, 0);
    assert.ok(
      [...targetA.requests, ...targetB.requests].every(
        (request) => request.headers.authorization !== `Bearer ${token}`,
      ),
    );
  } finally {
    await targetA.close();
    await targetB.close();
  }
});

test("request recovery keeps a concrete API target when the auth-state file is missing", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-request-missing-auth-state-"));
  const authStateFile = path.join(tempDir, "missing-auth-state.json");
  const apiBase = "https://api.example.invalid";
  const result = await runCli([
    "request",
    "GET",
    "/actors/me/capabilities",
    "--api-base",
    apiBase,
    "--auth-state-file",
    authStateFile,
    "--json",
  ]);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error, "missing_auth_state_file");
  assert.equal(
    payload.hint,
    `clawnera-help write-gate --api-base '${apiBase}' && clawnera-help ensure-auth --api-base '${apiBase}' --auth-state-file '${authStateFile}'`,
  );
});

test("request recovery does not invent production when an auth-state target cannot be resolved", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-request-unknown-target-"));
  const authStateFile = path.join(tempDir, "missing-auth-state.json");
  const result = await runCli([
    "request",
    "GET",
    "/actors/me/capabilities",
    "--auth-state-file",
    authStateFile,
    "--json",
  ]);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error, "missing_auth_state_file");
  assert.match(payload.hint, /^stop: the API target could not be resolved/);
  assert.doesNotMatch(payload.hint, /api\.clawnera\.com/);
  assert.doesNotMatch(payload.hint, /clawnera-help write-gate/);
});

test("request accepts --auth-state as a shorthand alias for --auth-state-file", async () => {
  const jwt = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const mock = await startMockServer({
    "GET /actors/me/capabilities": (request) => {
      assert.equal(request.headers.authorization, `Bearer ${jwt}`);
      return {
        status: 200,
        body: {
          ok: true,
          actorAddress: `0x${"2".repeat(64)}`
        }
      };
    }
  });

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-cli-auth-state-alias-"));
  const authStateFile = path.join(tmpDir, "auth-state.json");
  writeFileSync(
    authStateFile,
    JSON.stringify({
      jwt,
      refreshToken: "refresh-token",
      actorAddress: `0x${"2".repeat(64)}`,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );

  try {
    const result = await runCli(
      ["request", "GET", "/actors/me/capabilities", "--auth-state", authStateFile, "--json"],
      {}
    );
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 200);
    assert.equal(payload.authStateFile, authStateFile);
    assert.equal(payload.response.actorAddress, `0x${"2".repeat(64)}`);
  } finally {
    await mock.close();
  }
});

test("chain-config output explains that the live minimum is a floor and amount choice stays explicit", async () => {
  const mock = await startMockServer({
    "GET /policy/fees": () => ({
      status: 200,
      body: buildFreshMarketplacePolicyResponse(),
    }),
    "GET /reviewers/me/metrics": (request) => {
      assert.equal(request.headers.authorization, "Bearer test-jwt");
      return {
        status: 200,
        body: {
          registered: true,
          runtime: {
            reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
            disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
          }
        }
      };
    },
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getObject") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              data: {
                objectId: "0x3333333333333333333333333333333333333333333333333333333333333333",
                previousTransaction: "init-reviewer-registry-1",
                content: {
                  fields: {
                    default_required_reviewer_votes: "3",
                    min_required_reviewer_votes: "3",
                    max_required_reviewer_votes: "7",
                    min_dispute_bond_per_side_iota: "500000",
                    max_dispute_bond_per_side_iota: "5000000",
                    reviewer_min_stake_iota: "1000000"
                  }
                }
              }
            }
          }
        };
      }
      throw new Error(`unexpected_rpc_method:${String(method)}`);
    }
  });

  try {
    const result = await runCli([
      "chain-config",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      "test-jwt"
    ]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /chain_config_ok/);
    assert.match(result.stdout, /bond_amount_selection_mode=EXPLICIT_RANGE/);
    assert.match(result.stdout, /user_amount_choice_required=true/);
    assert.match(result.stdout, /guidance_current_max_dispute_bond_per_side_iota=5000000/);
    assert.match(result.stdout, /guidance_max_required_reviewer_votes=7/);
    assert.match(result.stdout, /guidance_note=chain-config reads the live floor and current quorum defaults only/);
    assert.match(result.stdout, /guidance_note=Treat the live minimum as a floor/);
  } finally {
    await mock.close();
  }
});

test("dispute-evidence-publish rewraps the current deliverable for assigned reviewers", async () => {
  const sellerAddress = `0x${"3".repeat(64)}`;
  const buyerAddress = `0x${"4".repeat(64)}`;
  const reviewerAddress = `0x${"5".repeat(64)}`;
  const caseId = `0x${"6".repeat(64)}`;
  const orderId = "order-dispute-evidence";
  const milestoneId = "milestone-a";
  const sellerKeys = generateKeyAgreementKeypair("u");
  const buyerKeys = generateKeyAgreementKeypair("u");
  const reviewerKeys = generateKeyAgreementKeypair("u");
  const encrypted = await createEncryptedDeliverable({
    plaintext: Buffer.from("reviewer evidence payload", "utf8"),
    recipients: [
      {
        recipientAddress: sellerAddress,
        keyVersion: 7,
        recipientPublicKeyMultibase: sellerKeys.publicKeyMultibase
      },
      {
        recipientAddress: buyerAddress,
        keyVersion: 3,
        recipientPublicKeyMultibase: buyerKeys.publicKeyMultibase
      }
    ]
  });
  const deliverablePayload = buildManagedDeliverablePayload({
    orderId,
    milestoneId,
    plaintextLabel: "deliverable.bin",
    encrypted
  });

  const mock = await startMockServer({
    [`GET /disputes/${caseId}`]: () => ({
      status: 200,
      body: {
        disputeCase: {
          objectId: caseId,
          orderId,
          milestoneId,
          buyer: buyerAddress,
          seller: sellerAddress,
          assignedReviewers: [reviewerAddress],
          assignmentRound: 0
        }
      }
    }),
    [`GET /orders/${orderId}/milestones/${milestoneId}/artifact-manifest/content`]: () => ({
      status: 200,
      body: {
        artifactManifest: {
          manifestCid: "ipfs://bafyreviewerevidence",
          manifestSha256: "a".repeat(64)
        },
        resolvedManifest: {
          payload: deliverablePayload
        }
      }
    }),
    [`GET /reviewers/${reviewerAddress}`]: () => ({
      status: 200,
      body: {
        reviewer: {
          ownerAddress: reviewerAddress,
          transportPubkeyHex: Buffer.from(reviewerKeys.publicKeyMultibase.slice(1), "base64url").toString("hex")
        }
      }
    }),
    [`GET /users/${reviewerAddress}/key-agreement?keyVersion=1`]: () => ({
      status: 200,
      body: {
        keyAgreement: {
          address: reviewerAddress,
          keyVersion: 1,
          publicKeyMultibase: reviewerKeys.publicKeyMultibase
        }
      }
    }),
    [`POST /disputes/${caseId}/evidence`]: (request) => {
      assert.equal(request.body?.kind, "linked_deliverable");
      assert.equal(request.body?.assignmentRound, 0);
      assert.equal(request.body?.manifestCid, "ipfs://bafyreviewerevidence");
      assert.equal(request.body?.reviewerGrants?.length, 1);
      assert.equal(request.body?.reviewerGrants?.[0]?.reviewerAddress, reviewerAddress);
      assert.equal(typeof request.body?.reviewerGrants?.[0]?.wrappedCek, "string");
      assert.equal(typeof request.body?.reviewerGrants?.[0]?.hpkeEnc, "string");
      return {
        status: 200,
        body: {
          evidenceItem: {
            evidenceId: "2df79fb6-9a7d-4e1b-9f1d-08cfdb70e4b2"
          }
        }
      };
    }
  });

  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-dispute-evidence-publish-"));
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  const sellerKeyFile = path.join(tempHome, "seller-key-agreement.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  writeFileSync(
    authStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: sellerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );
  await saveKeyAgreementRecord({
    address: sellerAddress,
    keyVersion: 7,
    publicKeyMultibase: sellerKeys.publicKeyMultibase,
    privateKeyMultibase: sellerKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: sellerKeyFile
  });

  try {
    const result = await runCli(
      [
        "dispute-evidence-publish",
        "--case-id",
        caseId,
        "--auth-state-file",
        authStateFile,
        "--key-file",
        sellerKeyFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.evidenceItem.evidenceId, "2df79fb6-9a7d-4e1b-9f1d-08cfdb70e4b2");
    assert.equal(payload.assignedReviewers[0], reviewerAddress);
    assert.equal(payload.requestBody.reviewerGrants.length, 1);
  } finally {
    await mock.close();
  }
});

test("dispute-evidence-publish stops locally when a reviewer transport key points at an expired key-agreement record", async () => {
  const sellerAddress = `0x${"3".repeat(64)}`;
  const buyerAddress = `0x${"4".repeat(64)}`;
  const reviewerAddress = `0x${"5".repeat(64)}`;
  const caseId = `0x${"6".repeat(64)}`;
  const orderId = "order-dispute-evidence-expired-reviewer";
  const milestoneId = "milestone-a";
  const sellerKeys = generateKeyAgreementKeypair("u");
  const buyerKeys = generateKeyAgreementKeypair("u");
  const reviewerKeys = generateKeyAgreementKeypair("u");
  const encrypted = await createEncryptedDeliverable({
    plaintext: Buffer.from("reviewer evidence payload", "utf8"),
    recipients: [
      {
        recipientAddress: sellerAddress,
        keyVersion: 7,
        recipientPublicKeyMultibase: sellerKeys.publicKeyMultibase
      },
      {
        recipientAddress: buyerAddress,
        keyVersion: 3,
        recipientPublicKeyMultibase: buyerKeys.publicKeyMultibase
      }
    ]
  });
  const deliverablePayload = buildManagedDeliverablePayload({
    orderId,
    milestoneId,
    plaintextLabel: "deliverable.bin",
    encrypted
  });

  const mock = await startMockServer({
    [`GET /disputes/${caseId}`]: () => ({
      status: 200,
      body: {
        disputeCase: {
          objectId: caseId,
          orderId,
          milestoneId,
          buyer: buyerAddress,
          seller: sellerAddress,
          assignedReviewers: [reviewerAddress],
          assignmentRound: 0
        }
      }
    }),
    [`GET /orders/${orderId}/milestones/${milestoneId}/artifact-manifest/content`]: () => ({
      status: 200,
      body: {
        artifactManifest: {
          manifestCid: "ipfs://bafyreviewerevidence",
          manifestSha256: "a".repeat(64)
        },
        resolvedManifest: {
          payload: deliverablePayload
        }
      }
    }),
    [`GET /reviewers/${reviewerAddress}`]: () => ({
      status: 200,
      body: {
        reviewer: {
          ownerAddress: reviewerAddress,
          transportPubkeyHex: Buffer.from(reviewerKeys.publicKeyMultibase.slice(1), "base64url").toString("hex")
        }
      }
    }),
    default: (request) => {
      if (request.method === "GET" && request.url === `/users/${reviewerAddress}/key-agreement?keyVersion=1`) {
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: reviewerAddress,
              keyVersion: 1,
              publicKeyMultibase: reviewerKeys.publicKeyMultibase,
              expiresAt: "2026-03-20T00:00:00.000Z",
              isExpired: true
            }
          }
        };
      }
      if (request.method === "GET" && request.url.startsWith(`/users/${reviewerAddress}/key-agreement?keyVersion=`)) {
        return {
          status: 404,
          body: { error: "not_found" }
        };
      }
      return {
        status: 500,
        body: { error: "unexpected_call" }
      };
    }
  });

  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-dispute-evidence-publish-expired-reviewer-"));
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  const sellerKeyFile = path.join(tempHome, "seller-key-agreement.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  writeFileSync(
    authStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: sellerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );
  await saveKeyAgreementRecord({
    address: sellerAddress,
    keyVersion: 7,
    publicKeyMultibase: sellerKeys.publicKeyMultibase,
    privateKeyMultibase: sellerKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: sellerKeyFile
  });

  try {
    const result = await runCli(
      [
        "dispute-evidence-publish",
        "--case-id",
        caseId,
        "--auth-state-file",
        authStateFile,
        "--key-file",
        sellerKeyFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "reviewer_key_agreement_expired_for_transport_pubkey");
    assert.equal(payload.reviewerAddress, reviewerAddress);
    assert.ok(Array.isArray(payload.hintLines));
    assert.match(payload.hintLines.join("\n"), /key-agreement-upsert/);
    assert.match(payload.hintLines.join("\n"), /reviewer-update/);
    assert.match(payload.hintLines.join("\n"), new RegExp(`/users/${reviewerAddress}/key-agreement\\?keyVersion=1`));
    assert.equal(mock.requests.some((request) => request.method === "POST" && request.url === `/disputes/${caseId}/evidence`), false);
  } finally {
    await mock.close();
  }
});

test("dispute-evidence-publish fails locally when bundle-build-file is malformed", async () => {
  const sellerAddress = `0x${"3".repeat(64)}`;
  const buyerAddress = `0x${"4".repeat(64)}`;
  const reviewerAddress = `0x${"5".repeat(64)}`;
  const caseId = `0x${"6".repeat(64)}`;

  const mock = await startMockServer({
    [`GET /disputes/${caseId}`]: () => ({
      status: 200,
      body: {
        disputeCase: {
          objectId: caseId,
          orderId: "order-dispute-evidence-invalid-build",
          milestoneId: "milestone-invalid-build",
          buyer: buyerAddress,
          seller: sellerAddress,
          assignedReviewers: [reviewerAddress],
          assignmentRound: 0
        }
      }
    }),
    default: () => ({
      status: 500,
      body: { error: "unexpected_call" }
    })
  });

  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-dispute-evidence-invalid-build-"));
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  const buildFile = path.join(tempHome, "invalid-bundle-build.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  writeFileSync(
    authStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: sellerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );
  writeFileSync(
    buildFile,
    JSON.stringify(
      {
        evidenceClass: "BUYER_COMPLAINT",
        manifestSha256: "a".repeat(64),
        cipherSuite: "xchacha20poly1305+hpke-x25519",
        contentProtocol: "clawdex.dispute-supplemental-bundle.v1",
        recipientGrants: [
          {
            recipientAddress: buyerAddress,
            keyVersion: 1,
            wrappedCek: "wrapped-cek-value-123456",
            hpkeEnc: "hpke-enc-value-123456"
          },
          {
            recipientAddress: sellerAddress,
            keyVersion: 1,
            wrappedCek: "wrapped-cek-value-abcdef",
            hpkeEnc: "hpke-enc-value-abcdef"
          },
          {
            recipientAddress: reviewerAddress,
            keyVersion: 1,
            wrappedCek: "wrapped-cek-value-review",
            hpkeEnc: "hpke-enc-value-review"
          }
        ],
        summary: {
          containsStatement: true,
          attachmentCount: 0,
          mailboxSignalCount: 0,
          mailboxAckCount: 0,
          checkpointRefCount: 0
        },
        replyToEvidenceId: "not-a-uuid"
      },
      null,
      2
    ),
    "utf8"
  );

  try {
    const result = await runCli(
      [
        "dispute-evidence-publish",
        "--kind",
        "supplemental-bundle",
        "--case-id",
        caseId,
        "--bundle-build-file",
        buildFile,
        "--manifest-cid",
        "ipfs://bafybeibuildartifactpayload1234567890abcdefghi",
        "--auth-state-file",
        authStateFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /invalid_reply_to_evidence_id/);
  } finally {
    await mock.close();
  }
});

test("dispute-evidence list and content helpers save actor-scoped reviewer files", async () => {
  const reviewerAddress = `0x${"7".repeat(64)}`;
  const caseId = `0x${"8".repeat(64)}`;
  const evidenceId = "1780a7c9-76a2-46bf-8a5a-f12f6a86f1ef";
  const mock = await startMockServer({
    [`GET /disputes/${caseId}/evidence`]: () => ({
      status: 200,
      body: {
        viewerRole: "ASSIGNED_REVIEWER",
        assignmentRound: 2,
        evidence: [
          {
            evidenceId,
            kind: "linked_deliverable",
            actorCanReadContent: true
          }
        ]
      }
    }),
    [`GET /disputes/${caseId}/evidence/${evidenceId}/content`]: () => ({
      status: 200,
      body: {
        evidenceItem: {
          evidenceId
        },
        actorGrant: {
          recipientAddress: reviewerAddress,
          recipientRole: "REVIEWER",
          keyVersion: 1,
          wrappedCek: "wrapped",
          hpkeEnc: "v1.cHVibGljLXB1Yi1wdWItcHViLXB1Yi1wdWItcHViLXB1Yi0xMjM0NQ.cHVibGljLW5vbmNlLXB1YmxpYy1ub25jZS0xMjM0NQ"
        },
        resolvedManifest: {
          payload: {
            protocol: "clawdex.managed-deliverable.v1",
            orderId: "o1",
            milestoneId: "m1",
            metadata: { plaintextLabel: "deliverable.bin" },
            encrypted: {
              blob: {
                nonceB64u: "bm9uY2U",
                ciphertextB64u: "Y2lwaGVydGV4dA",
                plaintextByteLength: 1,
                ciphertextByteLength: 17,
                ciphertextSha256: "a".repeat(64)
              },
              cekWraps: [
                {
                  recipientAddress: reviewerAddress,
                  keyVersion: 1,
                  wrappedCek: "wrapped",
                  hpkeEnc: "v1.cHVibGljLXB1Yi1wdWItcHViLXB1Yi1wdWItcHViLXB1Yi0xMjM0NQ.cHVibGljLW5vbmNlLXB1YmxpYy1ub25jZS0xMjM0NQ"
                }
              ]
            }
          }
        }
      }
    })
  });

  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-dispute-evidence-list-"));
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  writeFileSync(
    authStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: reviewerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );

  try {
    const listResult = await runCli(
      ["dispute-evidence-list", "--case-id", caseId, "--auth-state-file", authStateFile, "--json"],
      { HOME: tempHome }
    );
    assert.equal(listResult.status, 0);
    const listPayload = JSON.parse(listResult.stdout);
    assert.equal(listPayload.evidenceCount, 1);
    assert.match(listPayload.nextContentHint, /dispute-evidence-content/);

    const contentOut = path.join(tempHome, "evidence-content.json");
    const contentResult = await runCli(
      [
        "dispute-evidence-content",
        "--case-id",
        caseId,
        "--evidence-id",
        evidenceId,
        "--auth-state-file",
        authStateFile,
        "--content-out",
        contentOut,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(contentResult.status, 0);
    const contentPayload = JSON.parse(contentResult.stdout);
    assert.equal(contentPayload.contentOut, contentOut);
    assert.match(contentPayload.nextDecryptHint, /dispute-evidence-decrypt/);
    assert.equal(existsSync(contentOut), true);
  } finally {
    await mock.close();
  }
});

test("dispute-evidence-bundle-build creates supplemental bundle payloads and dispute-evidence-decrypt unwraps them", async () => {
  const buyerAddress = `0x${"1".repeat(64)}`;
  const sellerAddress = `0x${"2".repeat(64)}`;
  const reviewerAddress = `0x${"3".repeat(64)}`;
  const caseId = `0x${"4".repeat(64)}`;
  const orderId = "order-dispute-supplemental";
  const milestoneId = "milestone-supplemental";
  const buyerKeys = generateKeyAgreementKeypair("u");
  const sellerKeys = generateKeyAgreementKeypair("u");
  const reviewerKeys = generateKeyAgreementKeypair("u");

  const mock = await startMockServer({
    [`GET /disputes/${caseId}`]: () => ({
      status: 200,
      body: {
        disputeCase: {
          objectId: caseId,
          orderId,
          milestoneId,
          buyer: buyerAddress,
          seller: sellerAddress,
          assignedReviewers: [reviewerAddress],
          assignmentRound: 1
        }
      }
    }),
    [`GET /reviewers/${reviewerAddress}`]: () => ({
      status: 200,
      body: {
        reviewer: {
          ownerAddress: reviewerAddress,
          transportPubkeyHex: Buffer.from(reviewerKeys.publicKeyMultibase.slice(1), "base64url").toString("hex")
        }
      }
    }),
    default: async (request) => {
      if (request.method === "GET" && request.url === `/users/${buyerAddress}/key-agreement?keyVersion=1`) {
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: buyerAddress,
              keyVersion: 1,
              publicKeyMultibase: buyerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url === `/users/${sellerAddress}/key-agreement?keyVersion=1`) {
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: sellerAddress,
              keyVersion: 1,
              publicKeyMultibase: sellerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url === `/users/${reviewerAddress}/key-agreement?keyVersion=1`) {
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: reviewerAddress,
              keyVersion: 1,
              publicKeyMultibase: reviewerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url.startsWith(`/users/`) && request.url.includes(`/key-agreement?keyVersion=`)) {
        return {
          status: 404,
          body: { error: "key_agreement_not_found" }
        };
      }
      return {
        status: 404,
        body: { error: "not_found" }
      };
    }
  });

  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-dispute-supplemental-build-"));
  const buyerAuthStateFile = path.join(tempHome, ".config", "clawnera", "buyer-auth-state.json");
  const reviewerAuthStateFile = path.join(tempHome, ".config", "clawnera", "reviewer-auth-state.json");
  const reviewerKeyFile = path.join(tempHome, "reviewer-key-agreement.json");
  const plaintextFile = path.join(tempHome, "bundle-plaintext.json");
  mkdirSync(path.dirname(buyerAuthStateFile), { recursive: true });
  writeFileSync(
    buyerAuthStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: buyerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );
  writeFileSync(
    reviewerAuthStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: reviewerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );
  writeFileSync(
    plaintextFile,
    JSON.stringify(
      {
        statement: {
          title: "Buyer complaint",
          markdown: "Missing second attachment",
          requestedOutcome: "buyer_refund"
        },
        items: [{ itemType: "mailbox_signal_ref", label: "signal-1" }]
      },
      null,
      2
    ),
    "utf8"
  );
  await saveKeyAgreementRecord({
    address: reviewerAddress,
    keyVersion: 1,
    publicKeyMultibase: reviewerKeys.publicKeyMultibase,
    privateKeyMultibase: reviewerKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: reviewerKeyFile
  });

  try {
    const buildResult = await runCli(
      [
        "dispute-evidence-bundle-build",
        "--case-id",
        caseId,
        "--evidence-class",
        "BUYER_COMPLAINT",
        "--bundle-plaintext-file",
        plaintextFile,
        "--auth-state-file",
        buyerAuthStateFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(buildResult.status, 0);
    const buildPayload = JSON.parse(buildResult.stdout);
    assert.equal(buildPayload.ok, true);
    assert.equal(buildPayload.summary.containsStatement, true);
    assert.equal(buildPayload.summary.mailboxSignalCount, 1);
    assert.equal(existsSync(buildPayload.payloadOut), true);
    assert.equal(existsSync(buildPayload.buildOut), true);
    assert.equal(path.dirname(buildPayload.payloadOut), tempHome);
    assert.equal(path.dirname(buildPayload.buildOut), tempHome);

    const payloadJson = JSON.parse(readFileSync(buildPayload.payloadOut, "utf8"));
    const reviewerWrap = payloadJson.encrypted.cekWraps.find((entry) => entry.recipientAddress === reviewerAddress);
    assert.ok(reviewerWrap);
    const contentFile = path.join(tempHome, "supplemental-content.json");
    writeFileSync(
      contentFile,
      JSON.stringify(
        {
          evidenceItem: {
            evidenceId: "supplemental-evidence-1",
            kind: "supplemental_bundle"
          },
          actorGrant: reviewerWrap,
          resolvedManifest: {
            payload: payloadJson
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const decryptResult = await runCli(
      [
        "dispute-evidence-decrypt",
        "--content-file",
        contentFile,
        "--auth-state-file",
        reviewerAuthStateFile,
        "--key-file",
        reviewerKeyFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(decryptResult.status, 0);
    const decryptPayload = JSON.parse(decryptResult.stdout);
    assert.equal(decryptPayload.ok, true);
    assert.equal(decryptPayload.kind, "supplemental_bundle");
    assert.equal(path.dirname(decryptPayload.plaintextOut), path.dirname(contentFile));
    const decryptedJson = JSON.parse(readFileSync(decryptPayload.plaintextOut, "utf8"));
    assert.equal(decryptedJson.statement.title, "Buyer complaint");
    assert.equal(decryptedJson.items[0].itemType, "mailbox_signal_ref");
  } finally {
    await mock.close();
  }
});

test("buildDisputeSupplementalBundlePayload rejects malformed reply ids and recipient sets", async () => {
  const buyerKeys = generateKeyAgreementKeypair("u");
  const sellerKeys = generateKeyAgreementKeypair("u");
  const reviewerKeys = generateKeyAgreementKeypair("u");

  await assert.rejects(
    () =>
      buildDisputeSupplementalBundlePayload({
        disputeCaseObjectId: `0x${"1".repeat(64)}`,
        orderId: "order-invalid-supplemental",
        milestoneId: "milestone-invalid-supplemental",
        assignmentRound: 0,
        evidenceClass: "BUYER_COMPLAINT",
        declaredByActorAddress: `0x${"2".repeat(64)}`,
        plaintextBundle: {
          statement: {
            title: "Need more proof"
          }
        },
        recipients: [
          {
            recipientAddress: `0x${"3".repeat(64)}`,
            keyVersion: 1,
            recipientPublicKeyMultibase: buyerKeys.publicKeyMultibase
          },
          {
            recipientAddress: `0x${"4".repeat(64)}`,
            keyVersion: 1,
            recipientPublicKeyMultibase: sellerKeys.publicKeyMultibase
          }
        ]
      }),
    /invalid_recipient_count/
  );

  await assert.rejects(
    () =>
      buildDisputeSupplementalBundlePayload({
        disputeCaseObjectId: `0x${"1".repeat(64)}`,
        orderId: "order-invalid-supplemental",
        milestoneId: "milestone-invalid-supplemental",
        assignmentRound: 0,
        evidenceClass: "BUYER_COMPLAINT",
        declaredByActorAddress: `0x${"2".repeat(64)}`,
        plaintextBundle: {
          statement: {
            title: "Need more proof"
          }
        },
        recipients: [
          {
            recipientAddress: `0x${"3".repeat(64)}`,
            keyVersion: 1,
            recipientPublicKeyMultibase: buyerKeys.publicKeyMultibase
          },
          {
            recipientAddress: `0x${"4".repeat(64)}`,
            keyVersion: 1,
            recipientPublicKeyMultibase: sellerKeys.publicKeyMultibase
          },
          {
            recipientAddress: `0x${"5".repeat(64)}`,
            keyVersion: 1,
            recipientPublicKeyMultibase: reviewerKeys.publicKeyMultibase
          }
        ],
        replyToEvidenceId: "not-a-uuid"
      }),
    /invalid_reply_to_evidence_id/
  );
});

test("mailbox-evidence-export builds reviewer-readable mailbox coordination bundles", async () => {
  const buyerAddress = `0x${"1".repeat(64)}`;
  const sellerAddress = `0x${"2".repeat(64)}`;
  const reviewerAddress = `0x${"3".repeat(64)}`;
  const caseId = `0x${"4".repeat(64)}`;
  const orderId = "order-mailbox-evidence";
  const milestoneId = "milestone-mailbox-evidence";
  const buyerKeys = generateKeyAgreementKeypair("u");
  const sellerKeys = generateKeyAgreementKeypair("u");
  const reviewerKeys = generateKeyAgreementKeypair("u");
  let buyerKeyAgreementAttempts = 0;
  let activeKeyAgreementCalls = 0;
  let maxActiveKeyAgreementCalls = 0;
  const waitForConcurrentWindow = async () => {
    activeKeyAgreementCalls += 1;
    maxActiveKeyAgreementCalls = Math.max(maxActiveKeyAgreementCalls, activeKeyAgreementCalls);
    await new Promise((resolve) => setTimeout(resolve, 25));
    activeKeyAgreementCalls -= 1;
  };

  const mock = await startMockServer({
    [`GET /disputes/${caseId}`]: () => ({
      status: 200,
      body: {
        disputeCase: {
          objectId: caseId,
          orderId,
          milestoneId,
          buyer: buyerAddress,
          seller: sellerAddress,
          assignedReviewers: [reviewerAddress],
          assignmentRound: 2
        }
      }
    }),
    [`GET /orders/${orderId}/mailbox`]: () => ({
      status: 200,
      body: {
        mailboxObjectId: "0xmailboxevidence"
      }
    }),
    [`GET /events?scope=all&type=mailbox.signal_posted&limit=20`]: () => ({
      status: 200,
      body: {
        items: [
          {
            id: "posted-1",
            entityId: "0xmailboxevidence",
            createdAt: "2026-03-21T00:00:00.000Z",
            payloadJson: {
              mailboxObjectId: "0xmailboxevidence",
              orderId,
              seq: "5",
              sender: sellerAddress,
              senderRole: "seller",
              signalIntent: "DELIVERABLE_READY",
              payloadRef: "ipfs://bafymailboxpayload",
              ciphertextHash: "a".repeat(64),
              txDigest: "9sQffk7KX8a1W4sm6V2mY7dXZKxRB3Qw4s5E9tU2a1Fn",
              chainCreatedAtMs: "1711000"
            }
          }
        ]
      }
    }),
    [`GET /events?scope=all&type=mailbox.signal_acked&limit=20`]: () => ({
      status: 200,
      body: {
        items: [
          {
            id: "acked-1",
            entityId: "0xmailboxevidence",
            createdAt: "2026-03-21T00:00:05.000Z",
            payloadJson: {
              mailboxObjectId: "0xmailboxevidence",
              orderId,
              ackedSeq: "5",
              acker: buyerAddress,
              ackerRole: "buyer",
              txDigest: "8sQffk7KX8a1W4sm6V2mY7dXZKxRB3Qw4s5E9tU2a1Fn",
              chainAckedAtMs: "1712000"
            }
          }
        ]
      }
    }),
    [`GET /reviewers/${reviewerAddress}`]: () => ({
      status: 200,
      body: {
        reviewer: {
          ownerAddress: reviewerAddress,
          transportPubkeyHex: Buffer.from(reviewerKeys.publicKeyMultibase.slice(1), "base64url").toString("hex")
        }
      }
    }),
    default: async (request) => {
      if (request.method === "GET" && request.url === `/users/${buyerAddress}/key-agreement?keyVersion=1`) {
        buyerKeyAgreementAttempts += 1;
        if (buyerKeyAgreementAttempts === 1) {
          return {
            status: 503,
            body: { error: "backend_timeout" }
          };
        }
        await waitForConcurrentWindow();
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: buyerAddress,
              keyVersion: 1,
              publicKeyMultibase: buyerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url === `/users/${sellerAddress}/key-agreement?keyVersion=1`) {
        await waitForConcurrentWindow();
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: sellerAddress,
              keyVersion: 1,
              publicKeyMultibase: sellerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url === `/users/${reviewerAddress}/key-agreement?keyVersion=1`) {
        await waitForConcurrentWindow();
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: reviewerAddress,
              keyVersion: 1,
              publicKeyMultibase: reviewerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url.startsWith(`/users/`) && request.url.includes(`/key-agreement?keyVersion=`)) {
        return {
          status: 404,
          body: { error: "key_agreement_not_found" }
        };
      }
      return {
        status: 404,
        body: { error: "not_found" }
      };
    }
  });

  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-mailbox-evidence-export-"));
  const buyerAuthStateFile = path.join(tempHome, ".config", "clawnera", "buyer-auth-state.json");
  const reviewerAuthStateFile = path.join(tempHome, ".config", "clawnera", "reviewer-auth-state.json");
  const reviewerKeyFile = path.join(tempHome, "reviewer-key-agreement.json");
  mkdirSync(path.dirname(buyerAuthStateFile), { recursive: true });
  writeFileSync(
    buyerAuthStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: buyerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );
  writeFileSync(
    reviewerAuthStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: reviewerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );
  await saveKeyAgreementRecord({
    address: reviewerAddress,
    keyVersion: 1,
    publicKeyMultibase: reviewerKeys.publicKeyMultibase,
    privateKeyMultibase: reviewerKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: reviewerKeyFile
  });

  try {
    const exportResult = await runCli(
      [
        "mailbox-evidence-export",
        "--case-id",
        caseId,
        "--rpc-url",
        "https://fullnode.testnet.example.invalid",
        "--statement-text",
        "Reviewer should inspect the delivery-ready signal and buyer ack.",
        "--auth-state-file",
        buyerAuthStateFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(exportResult.status, 0);
    const exportPayload = JSON.parse(exportResult.stdout);
    assert.equal(exportPayload.ok, true);
    assert.equal(exportPayload.evidenceClass, "MAILBOX_COORDINATION");
    assert.equal(exportPayload.selectedPostedCount, 1);
    assert.equal(exportPayload.selectedAckedCount, 1);
    assert.equal(existsSync(exportPayload.bundlePlaintextOut), true);
    assert.equal(existsSync(exportPayload.payloadOut), true);
    assert.equal(path.dirname(exportPayload.bundlePlaintextOut), defaultArtifactsDir(tempHome));
    assert.equal(path.dirname(exportPayload.payloadOut), defaultArtifactsDir(tempHome));
    assert.equal(path.dirname(exportPayload.buildOut), defaultArtifactsDir(tempHome));
    const plaintextBundle = JSON.parse(readFileSync(exportPayload.bundlePlaintextOut, "utf8"));
    assert.equal(plaintextBundle.items[0].itemType, "mailbox_signal_ref");
    assert.equal(plaintextBundle.items[1].itemType, "mailbox_ack_ref");

    const payloadJson = JSON.parse(readFileSync(exportPayload.payloadOut, "utf8"));
    const reviewerWrap = payloadJson.encrypted.cekWraps.find((entry) => entry.recipientAddress === reviewerAddress);
    assert.ok(reviewerWrap);
    const contentFile = path.join(tempHome, "mailbox-evidence-content.json");
    writeFileSync(
      contentFile,
      JSON.stringify(
        {
          evidenceItem: {
            evidenceId: "mailbox-evidence-1",
            kind: "supplemental_bundle"
          },
          actorGrant: reviewerWrap,
          resolvedManifest: {
            payload: payloadJson
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const decryptResult = await runCli(
      [
        "dispute-evidence-decrypt",
        "--content-file",
        contentFile,
        "--auth-state-file",
        reviewerAuthStateFile,
        "--key-file",
        reviewerKeyFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(decryptResult.status, 0);
    const decryptPayload = JSON.parse(decryptResult.stdout);
    assert.equal(path.dirname(decryptPayload.plaintextOut), path.dirname(contentFile));
    const decryptedJson = JSON.parse(readFileSync(decryptPayload.plaintextOut, "utf8"));
    assert.equal(decryptedJson.items[0].itemType, "mailbox_signal_ref");
    assert.equal(decryptedJson.items[1].itemType, "mailbox_ack_ref");

    const keyAgreementRequests = mock.requests
      .filter((request) => request.method === "GET" && request.url.includes("/key-agreement?keyVersion="))
      .map((request) => request.url);
    assert.equal(buyerKeyAgreementAttempts, 2);
    assert.ok(maxActiveKeyAgreementCalls >= 2);
    assert.ok(keyAgreementRequests.includes(`/users/${buyerAddress}/key-agreement?keyVersion=2`));
    assert.ok(keyAgreementRequests.includes(`/users/${sellerAddress}/key-agreement?keyVersion=2`));
    assert.ok(keyAgreementRequests.includes(`/users/${reviewerAddress}/key-agreement?keyVersion=2`));
    assert.ok(!keyAgreementRequests.includes(`/users/${buyerAddress}/key-agreement?keyVersion=3`));
    assert.ok(!keyAgreementRequests.includes(`/users/${sellerAddress}/key-agreement?keyVersion=3`));
    assert.ok(!keyAgreementRequests.includes(`/users/${reviewerAddress}/key-agreement?keyVersion=3`));
  } finally {
    await mock.close();
  }
});

test("checkpoint-evidence-export builds canonical checkpoint packets inside supplemental bundles", async () => {
  const buyerAddress = `0x${"5".repeat(64)}`;
  const sellerAddress = `0x${"6".repeat(64)}`;
  const reviewerAddress = `0x${"7".repeat(64)}`;
  const caseId = `0x${"8".repeat(64)}`;
  const orderId = "order-checkpoint-evidence";
  const milestoneId = "milestone-checkpoint-evidence";
  const sellerKeys = generateKeyAgreementKeypair("u");
  const buyerKeys = generateKeyAgreementKeypair("u");
  const reviewerKeys = generateKeyAgreementKeypair("u");
  const encrypted = await createEncryptedDeliverable({
    plaintext: Buffer.from("checkpoint payload", "utf8"),
    recipients: [
      {
        recipientAddress: sellerAddress,
        keyVersion: 1,
        recipientPublicKeyMultibase: sellerKeys.publicKeyMultibase
      },
      {
        recipientAddress: buyerAddress,
        keyVersion: 1,
        recipientPublicKeyMultibase: buyerKeys.publicKeyMultibase
      }
    ]
  });
  const deliverablePayload = buildManagedDeliverablePayload({
    orderId,
    milestoneId,
    plaintextLabel: "checkpoint.txt",
    encrypted
  });

  const mock = await startMockServer({
    [`GET /disputes/${caseId}`]: () => ({
      status: 200,
      body: {
        disputeCase: {
          objectId: caseId,
          orderId,
          milestoneId,
          buyer: buyerAddress,
          seller: sellerAddress,
          assignedReviewers: [reviewerAddress],
          assignmentRound: 3
        }
      }
    }),
    [`GET /orders/${orderId}/mailbox`]: () => ({
      status: 200,
      body: {
        mailboxObjectId: "0xmailboxcheckpoint"
      }
    }),
    [`GET /events?scope=all&type=mailbox.signal_posted&limit=20`]: () => ({
      status: 200,
      body: {
        items: [
          {
            id: "posted-checkpoint",
            entityId: "0xmailboxcheckpoint",
            createdAt: "2026-03-21T00:01:00.000Z",
            payloadJson: {
              mailboxObjectId: "0xmailboxcheckpoint",
              orderId,
              seq: "9",
              sender: sellerAddress,
              senderRole: "seller",
              signalIntent: "DELIVERABLE_READY",
              payloadRef: "ipfs://bafycheckpointpayload",
              ciphertextHash: deliverablePayload.encrypted.blob.ciphertextSha256,
              txDigest: "9sQffk7KX8a1W4sm6V2mY7dXZKxRB3Qw4s5E9tU2a1Fn",
              chainCreatedAtMs: "1713000"
            }
          }
        ]
      }
    }),
    [`GET /reviewers/${reviewerAddress}`]: () => ({
      status: 200,
      body: {
        reviewer: {
          ownerAddress: reviewerAddress,
          transportPubkeyHex: Buffer.from(reviewerKeys.publicKeyMultibase.slice(1), "base64url").toString("hex")
        }
      }
    }),
    default: (request) => {
      if (request.method === "GET" && request.url === `/users/${buyerAddress}/key-agreement?keyVersion=1`) {
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: buyerAddress,
              keyVersion: 1,
              publicKeyMultibase: buyerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url === `/users/${sellerAddress}/key-agreement?keyVersion=1`) {
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: sellerAddress,
              keyVersion: 1,
              publicKeyMultibase: sellerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url === `/users/${reviewerAddress}/key-agreement?keyVersion=1`) {
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: reviewerAddress,
              keyVersion: 1,
              publicKeyMultibase: reviewerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url.startsWith(`/users/`) && request.url.includes(`/key-agreement?keyVersion=`)) {
        return {
          status: 404,
          body: { error: "key_agreement_not_found" }
        };
      }
      return {
        status: 404,
        body: { error: "not_found" }
      };
    }
  });

  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-checkpoint-evidence-export-"));
  const sellerAuthStateFile = path.join(tempHome, ".config", "clawnera", "seller-auth-state.json");
  const reviewerAuthStateFile = path.join(tempHome, ".config", "clawnera", "reviewer-auth-state.json");
  const reviewerKeyFile = path.join(tempHome, "reviewer-key-agreement.json");
  const payloadFile = path.join(tempHome, "deliverable-payload.json");
  const submitBodyFile = path.join(tempHome, "submit-body.json");
  mkdirSync(path.dirname(sellerAuthStateFile), { recursive: true });
  writeFileSync(
    sellerAuthStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: sellerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );
  writeFileSync(
    reviewerAuthStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: reviewerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );
  writeFileSync(payloadFile, JSON.stringify(deliverablePayload, null, 2), "utf8");
  writeFileSync(
    submitBodyFile,
    JSON.stringify(
      {
        manifest: {
          manifestCid: "ipfs://bafycheckpointmanifest",
          manifestSha256: "b".repeat(64),
          sellerSignature: "seller-signature-base64"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await saveKeyAgreementRecord({
    address: reviewerAddress,
    keyVersion: 1,
    publicKeyMultibase: reviewerKeys.publicKeyMultibase,
    privateKeyMultibase: reviewerKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: reviewerKeyFile
  });

  try {
    const exportResult = await runCli(
      [
        "checkpoint-evidence-export",
        "--case-id",
        caseId,
        "--rpc-url",
        "https://fullnode.testnet.example.invalid",
        "--submit-body-file",
        submitBodyFile,
        "--payload-file",
        payloadFile,
        "--signal-seq",
        "9",
        "--anchor-tx-digest",
        "9sQffk7KX8a1W4sm6V2mY7dXZKxRB3Qw4s5E9tU2a1Fn",
        "--anchor-event-seq",
        "7",
        "--anchor-status",
        "CONFIRMED",
        "--statement-text",
        "Reviewer should confirm that the submitted checkpoint matches the anchored manifest.",
        "--auth-state-file",
        sellerAuthStateFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(exportResult.status, 0);
    const exportPayload = JSON.parse(exportResult.stdout);
    assert.equal(exportPayload.ok, true);
    assert.equal(exportPayload.evidenceClass, "CHECKPOINT_HANDOVER");
    assert.equal(exportPayload.selectedSignalSeq, "9");
    assert.equal(existsSync(exportPayload.checkpointPacketOut), true);
    assert.equal(path.dirname(exportPayload.checkpointPacketOut), tempHome);
    assert.equal(path.dirname(exportPayload.bundlePlaintextOut), tempHome);
    assert.equal(path.dirname(exportPayload.payloadOut), tempHome);
    assert.equal(path.dirname(exportPayload.buildOut), tempHome);
    const checkpointPacket = JSON.parse(readFileSync(exportPayload.checkpointPacketOut, "utf8"));
    assert.equal(checkpointPacket.protocol, "clawdex.checkpoint-handover.v1");
    assert.match(checkpointPacket.packetHash, /^sha256:/);

    const payloadJson = JSON.parse(readFileSync(exportPayload.payloadOut, "utf8"));
    const reviewerWrap = payloadJson.encrypted.cekWraps.find((entry) => entry.recipientAddress === reviewerAddress);
    assert.ok(reviewerWrap);
    const contentFile = path.join(tempHome, "checkpoint-evidence-content.json");
    writeFileSync(
      contentFile,
      JSON.stringify(
        {
          evidenceItem: {
            evidenceId: "checkpoint-evidence-1",
            kind: "supplemental_bundle"
          },
          actorGrant: reviewerWrap,
          resolvedManifest: {
            payload: payloadJson
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const decryptResult = await runCli(
      [
        "dispute-evidence-decrypt",
        "--content-file",
        contentFile,
        "--auth-state-file",
        reviewerAuthStateFile,
        "--key-file",
        reviewerKeyFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(decryptResult.status, 0);
    const decryptPayload = JSON.parse(decryptResult.stdout);
    const decryptedJson = JSON.parse(readFileSync(decryptPayload.plaintextOut, "utf8"));
    assert.equal(decryptedJson.items[0].itemType, "checkpoint_packet");
    assert.equal(decryptedJson.items[0].packet.anchor.status, "CONFIRMED");
    assert.equal(decryptedJson.items[0].mailboxSignalRef.seq, "9");
  } finally {
    await mock.close();
  }
});

test("checkpoint-evidence-export fails closed without an explicit ciphertext source and only falls back when asked", async () => {
  const buyerAddress = `0x${"a".repeat(64)}`;
  const sellerAddress = `0x${"b".repeat(64)}`;
  const reviewerAddress = `0x${"c".repeat(64)}`;
  const caseId = `0x${"d".repeat(64)}`;
  const orderId = "order-checkpoint-fail-closed";
  const milestoneId = "milestone-checkpoint-fail-closed";
  const buyerKeys = generateKeyAgreementKeypair("u");
  const sellerKeys = generateKeyAgreementKeypair("u");
  const reviewerKeys = generateKeyAgreementKeypair("u");

  const mock = await startMockServer({
    [`GET /disputes/${caseId}`]: () => ({
      status: 200,
      body: {
        disputeCase: {
          objectId: caseId,
          orderId,
          milestoneId,
          buyer: buyerAddress,
          seller: sellerAddress,
          assignedReviewers: [reviewerAddress],
          assignmentRound: 2
        }
      }
    }),
    [`GET /reviewers/${reviewerAddress}`]: () => ({
      status: 200,
      body: {
        reviewer: {
          ownerAddress: reviewerAddress,
          transportPubkeyHex: Buffer.from(reviewerKeys.publicKeyMultibase.slice(1), "base64url").toString("hex")
        }
      }
    }),
    default: (request) => {
      if (request.method === "GET" && request.url === `/users/${buyerAddress}/key-agreement?keyVersion=1`) {
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: buyerAddress,
              keyVersion: 1,
              publicKeyMultibase: buyerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url === `/users/${sellerAddress}/key-agreement?keyVersion=1`) {
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: sellerAddress,
              keyVersion: 1,
              publicKeyMultibase: sellerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url === `/users/${reviewerAddress}/key-agreement?keyVersion=1`) {
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: reviewerAddress,
              keyVersion: 1,
              publicKeyMultibase: reviewerKeys.publicKeyMultibase
            }
          }
        };
      }
      if (request.method === "GET" && request.url.startsWith(`/users/`) && request.url.includes(`/key-agreement?keyVersion=`)) {
        return {
          status: 404,
          body: { error: "key_agreement_not_found" }
        };
      }
      return {
        status: 404,
        body: { error: "not_found" }
      };
    }
  });

  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-checkpoint-explicit-source-"));
  const sellerAuthStateFile = path.join(tempHome, ".config", "clawnera", "seller-auth-state.json");
  const submitBodyFile = path.join(tempHome, "submit-body.json");
  const mailboxEventsFile = path.join(tempHome, "mailbox-events.json");
  mkdirSync(path.dirname(sellerAuthStateFile), { recursive: true });
  writeFileSync(
    sellerAuthStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: sellerAddress,
      apiBase: mock.baseUrl
    }),
    "utf8"
  );
  writeFileSync(
    submitBodyFile,
    JSON.stringify(
      {
        manifest: {
          manifestCid: "ipfs://bafycheckpointmanifest2",
          manifestSha256: "c".repeat(64),
          sellerSignature: "seller-signature-base64"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  writeFileSync(
    mailboxEventsFile,
    JSON.stringify(
      {
        orderId,
        mailboxObjectId: "0xmailboxcheckpoint2",
        events: [
          {
            id: "posted-checkpoint-1",
            category: "posted",
            seq: "8",
            sender: sellerAddress,
            senderRole: "seller",
            signalIntent: "DELIVERABLE_READY",
            payloadRef: "ipfs://older",
            ciphertextHash: "1".repeat(64),
            txDigest: "9sQffk7KX8a1W4sm6V2mY7dXZKxRB3Qw4s5E9tU2a1Fn",
            chainTimestampMs: "1712999",
            createdAt: "2026-03-21T00:00:30.000Z"
          },
          {
            id: "posted-checkpoint-2",
            category: "posted",
            seq: "9",
            sender: sellerAddress,
            senderRole: "seller",
            signalIntent: "DELIVERABLE_READY",
            payloadRef: "ipfs://newer",
            ciphertextHash: "2".repeat(64),
            txDigest: "9sQffk7KX8a1W4sm6V2mY7dXZKxRB3Qw4s5E9tU2a1Fn",
            chainTimestampMs: "1713000",
            createdAt: "2026-03-21T00:01:00.000Z"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  try {
    const failClosedResult = await runCli(
      [
        "checkpoint-evidence-export",
        "--case-id",
        caseId,
        "--submit-body-file",
        submitBodyFile,
        "--mailbox-events-file",
        mailboxEventsFile,
        "--auth-state-file",
        sellerAuthStateFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(failClosedResult.status, 1);
    assert.match(failClosedResult.stdout, /checkpoint_ciphertext_source_required/);

    const fallbackResult = await runCli(
      [
        "checkpoint-evidence-export",
        "--case-id",
        caseId,
        "--submit-body-file",
        submitBodyFile,
        "--mailbox-events-file",
        mailboxEventsFile,
        "--allow-latest-signal-fallback",
        "true",
        "--auth-state-file",
        sellerAuthStateFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(fallbackResult.status, 0);
    const fallbackPayload = JSON.parse(fallbackResult.stdout);
    assert.equal(fallbackPayload.selectedSignalSeq, "9");
    assert.equal(fallbackPayload.ciphertextSha256, "2".repeat(64));
  } finally {
    await mock.close();
  }
});

test("deliverable-decrypt can use actorGrant from a dispute evidence content file", async () => {
  const reviewerAddress = `0x${"9".repeat(64)}`;
  const reviewerKeys = generateKeyAgreementKeypair("u");
  const sellerKeys = generateKeyAgreementKeypair("u");
  const encrypted = await createEncryptedDeliverable({
    plaintext: Buffer.from("reviewer proof", "utf8"),
    recipients: [
      {
        recipientAddress: reviewerAddress,
        keyVersion: 1,
        recipientPublicKeyMultibase: reviewerKeys.publicKeyMultibase
      },
      {
        recipientAddress: `0x${"a".repeat(64)}`,
        keyVersion: 2,
        recipientPublicKeyMultibase: sellerKeys.publicKeyMultibase
      }
    ]
  });
  const reviewerWrap = encrypted.cekWraps.find((entry) => entry.recipientAddress === reviewerAddress);
  assert.ok(reviewerWrap);

  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-dispute-evidence-decrypt-"));
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  const reviewerKeyFile = path.join(tempHome, "reviewer-key-agreement.json");
  const inputFile = path.join(tempHome, "dispute-evidence-content.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  writeFileSync(
    authStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: reviewerAddress,
      apiBase: "https://api.clawnera.com"
    }),
    "utf8"
  );
  await saveKeyAgreementRecord({
    address: reviewerAddress,
    keyVersion: 1,
    publicKeyMultibase: reviewerKeys.publicKeyMultibase,
    privateKeyMultibase: reviewerKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: reviewerKeyFile
  });
  writeFileSync(
    inputFile,
    JSON.stringify(
      {
        actorGrant: reviewerWrap,
        resolvedManifest: {
          payload: {
            protocol: "clawdex.managed-deliverable.v1",
            orderId: "order-reviewer",
            milestoneId: "milestone-reviewer",
            metadata: {
              plaintextLabel: "deliverable.bin"
            },
            encrypted: {
              blob: encrypted.blob,
              cekWraps: [
                {
                  recipientAddress: `0x${"a".repeat(64)}`,
                  keyVersion: 2,
                  wrappedCek: encrypted.cekWraps.find((entry) => entry.recipientAddress === `0x${"a".repeat(64)}`)?.wrappedCek,
                  hpkeEnc: encrypted.cekWraps.find((entry) => entry.recipientAddress === `0x${"a".repeat(64)}`)?.hpkeEnc
                }
              ]
            }
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const result = await runCli(
    [
      "deliverable-decrypt",
      "--resolved-manifest-file",
      inputFile,
      "--auth-state-file",
      authStateFile,
      "--key-file",
      reviewerKeyFile,
      "--json"
    ],
    { HOME: tempHome }
  );
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(path.dirname(payload.plaintextOut), path.dirname(inputFile));
  assert.equal(readFileSync(payload.plaintextOut, "utf8"), "reviewer proof");
});

test("ensure-auth reuses an existing valid auth-state file", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-ensure-auth-existing-"));
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "bot",
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        expiresAtMs: 4102444800 * 1000,
        session: {
          id: "session-1",
          refreshAvailable: true,
          refreshExpiresAtMs: 4102444800 * 1000
        }
      },
      null,
      2
    )
  );

  const result = await runCli(["ensure-auth", "--auth-state-file", authStateFile, "--json"], {
    HOME: tempHome
  });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "existing_auth_state");
  assert.equal(payload.authStateFile, authStateFile);
  assert.equal(payload.alias, "bot");
});

test("ensure-auth refreshes a saved auth-state when auth/session rejects the current token", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-ensure-auth-refresh-"));
  const keystoreFile = path.join(tempDir, "iota.keystore");
  const authStateFile = path.join(tempDir, "auth-state.json");
  const initResult = await runCli(["wallet-init", "--alias", "bot", "--keystore-path", keystoreFile, "--json"]);
  assert.equal(initResult.status, 0);
  const walletPayload = JSON.parse(initResult.stdout);
  const address = walletPayload.address;
  const refreshedToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "http://127.0.0.1:1",
        address,
        alias: "bot",
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        expiresAtMs: 4102444800 * 1000,
        session: {
          id: "session-1",
          refreshAvailable: true,
          refreshExpiresAtMs: 4102444800 * 1000
        }
      },
      null,
      2
    )
  );

  const mock = await startMockServer({
    "GET /auth/session": (request) => {
      if (request.headers?.authorization === `Bearer ${refreshedToken}`) {
        return {
          status: 200,
          body: {
            session: {
              id: "session-1",
              address
            }
          }
        };
      }
      return {
        status: 401,
        body: {
          error: "invalid_token"
        }
      };
    },
    "POST /auth/refresh": (request) => {
      assert.equal(request.body?.refreshToken, "refresh-token-1");
      return {
        status: 200,
        body: {
          token: refreshedToken,
          refreshToken: "refresh-token-2",
          expiresAtMs: Date.now() + 3600_000,
          session: {
            id: "session-1",
            refreshAvailable: true,
            refreshExpiresAtMs: Date.now() + 7200_000
          }
        }
      };
    }
  });

  try {
    const saved = JSON.parse(readFileSync(authStateFile, "utf8"));
    saved.apiBase = mock.baseUrl;
    writeFileSync(authStateFile, JSON.stringify(saved, null, 2));
    const result = await runCli(["ensure-auth", "--api-base", mock.baseUrl, "--auth-state-file", authStateFile, "--json"], {
      HOME: tempDir
    });
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.source, "refreshed_auth_state");
    const refreshed = JSON.parse(readFileSync(authStateFile, "utf8"));
    assert.equal(refreshed.refreshToken, "refresh-token-2");
    assert.equal(refreshed.token, refreshedToken);
  } finally {
    await mock.close();
  }
});

test("ensure-auth falls back to the sole keystore entry and saves auth state", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-ensure-auth-sole-"));
  const keystoreFile = path.join(tempDir, "iota.keystore");
  const stateFile = path.join(tempDir, "auth-state.json");
  const envFile = path.join(tempDir, "auth.env");

  const initResult = await runCli(["wallet-init", "--alias", "sdk-only", "--keystore-path", keystoreFile, "--json"]);
  assert.equal(initResult.status, 0);
  const createdKeystore = JSON.parse(readFileSync(keystoreFile, "utf8"));
  const createdAddress = createdKeystore.keys[0].address;

  const issuedToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const mock = await startMockServer({
    "GET /policy/write-gate": (request) => buildMarketplaceWriteGateResponse(request),
    "POST /auth/challenge": (request) => {
      assert.equal(request.body?.address, createdAddress);
      assert.equal(request.body?.chainFamily, "iota");
      return {
        status: 200,
        body: buildLocalAuthChallenge(request, createdAddress, "nonce-1")
      };
    },
    "POST /auth/verify": (request) => {
      assert.equal(request.body?.address, createdAddress);
      assert.match(request.body?.message, /^CLAWDEX Sign-In v2\n/);
      assert.equal(request.body?.chainFamily, "iota");
      assert.equal(typeof request.body?.signature, "string");
      return {
        status: 200,
        body: {
          token: issuedToken,
          refreshToken: "refresh-token-1",
          expiresAtMs: Date.now() + 3600_000,
          session: {
            id: "session-1",
            refreshAvailable: true,
            refreshExpiresAtMs: Date.now() + 7200_000
          }
        }
      };
    }
  });

  try {
    const result = await runCli(
      [
        "ensure-auth",
        "--api-base",
        mock.baseUrl,
        "--keystore-path",
        keystoreFile,
        "--auth-state-file",
        stateFile,
        "--env-out",
        envFile,
        "--json"
      ],
      {
        HOME: tempDir,
        PATH: "/usr/bin:/bin"
      }
    );
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.source, "fresh_login");
    assert.equal(payload.selectionSource, "sole_keystore_entry");
    assert.equal(existsSync(stateFile), true);
    assert.equal(existsSync(envFile), true);
    const savedState = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.equal(savedState.address, createdAddress);
    assert.equal(savedState.alias, "sdk-only");
    assert.equal(savedState.token, issuedToken);
  } finally {
    await mock.close();
  }
});

test("ensure-auth falls back to fresh login when auth/session and refresh are both rejected", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-ensure-auth-relogin-"));
  const keystoreFile = path.join(tempDir, "iota.keystore");
  const authStateFile = path.join(tempDir, "auth-state.json");
  const initResult = await runCli(["wallet-init", "--alias", "bot", "--keystore-path", keystoreFile, "--json"]);
  assert.equal(initResult.status, 0);
  const walletPayload = JSON.parse(initResult.stdout);
  const address = walletPayload.address;
  const reloginToken = buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600);

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "http://127.0.0.1:1",
        address,
        alias: "bot",
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        expiresAtMs: 4102444800 * 1000,
        session: {
          id: "session-1",
          refreshAvailable: true,
          refreshExpiresAtMs: 4102444800 * 1000
        }
      },
      null,
      2
    )
  );

  const mock = await startMockServer({
    "GET /auth/session": () => ({
      status: 401,
      body: {
        error: "invalid_token"
      }
    }),
    "POST /auth/refresh": () => ({
      status: 401,
      body: {
        error: "invalid_refresh_token"
      }
    }),
    "POST /auth/challenge": (request) => {
      assert.equal(request.body?.address, address);
      return {
        status: 200,
        body: buildLocalAuthChallenge(request, address, "nonce-relogin")
      };
    },
    "POST /auth/verify": (request) => {
      assert.equal(request.body?.address, address);
      assert.match(request.body?.message, /^CLAWDEX Sign-In v2\n/);
      return {
        status: 200,
        body: {
          token: reloginToken,
          refreshToken: "refresh-token-2",
          expiresAtMs: Date.now() + 3600_000,
          session: {
            id: "session-2",
            refreshAvailable: true,
            refreshExpiresAtMs: Date.now() + 7200_000
          }
        }
      };
    }
  });

  try {
    const saved = JSON.parse(readFileSync(authStateFile, "utf8"));
    saved.apiBase = mock.baseUrl;
    writeFileSync(authStateFile, JSON.stringify(saved, null, 2));
    const result = await runCli(
      ["ensure-auth", "--api-base", mock.baseUrl, "--keystore-path", keystoreFile, "--auth-state-file", authStateFile, "--json"],
      {
        HOME: tempDir,
        PATH: "/usr/bin:/bin"
      }
    );
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.source, "fresh_login");
    const refreshed = JSON.parse(readFileSync(authStateFile, "utf8"));
    assert.equal(refreshed.token, reloginToken);
    assert.equal(refreshed.refreshToken, "refresh-token-2");
  } finally {
    await mock.close();
  }
});

test("ensure-auth stops on multiple local wallets instead of guessing or asking for JWT", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-ensure-auth-multi-"));
  const env = { HOME: tempHome, PATH: "/usr/bin:/bin" };
  const first = await runCli(["wallet-init", "--alias", "buyer-a", "--json"], env);
  const second = await runCli(["wallet-init", "--alias", "buyer-b", "--json"], env);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);

  const result = await runCli(["ensure-auth", "--api-base", "https://api.clawnera.com", "--json"], env);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error, "multiple_wallet_aliases");
  assert.equal(Array.isArray(payload.candidates), true);
  assert.equal(payload.candidates.length, 2);
  assert.match(payload.hint, /wallet-list/);
  assert.match(payload.hint, /do not ask the user for a raw JWT/i);
});

test("ensure-auth stops with a local-wallet hint when no auth state and no keystore exist", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-ensure-auth-empty-"));
  const result = await runCli(
    ["ensure-auth", "--api-base", "https://api.clawnera.com", "--json"],
    {
      HOME: tempHome,
      PATH: "/usr/bin:/bin"
    }
  );
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error, "missing_local_wallet_auth");
  assert.match(payload.hint, /wallet-init/);
  assert.doesNotMatch(payload.hint, /JWT/i);
});

test("tx-plan-dry-run rejects absolute URLs before requesting a plan", async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-cli-abs-tx-"));
  const authStateFile = path.join(tmpDir, "auth-state.json");
  writeFileSync(
    authStateFile,
    JSON.stringify({
      jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      refreshToken: "refresh-token",
      actorAddress: `0x${"1".repeat(64)}`,
      apiBase: "https://api.clawnera.com"
    }),
    "utf8"
  );

  const result = await runCli(
    ["tx-plan-dry-run", "POST", "https://attacker.example/plan", "--auth-state-file", authStateFile, "--json"],
    {}
  );
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error, "absolute_api_url_not_allowed");
});

test("tx-plan-dry-run rejects reviewer publish plans without authorization requirements before RPC", async () => {
  let rpcCalls = 0;
  const reviewers = [`0x${"a".repeat(64)}`];
  const receiptId = "receipt-plan-guard";
  const mock = await startMockServer({
    "POST /orders/order-guard/milestones/milestone-guard/disputes/open": () => ({
      status: 200,
      body: {
        txBuilder: "disputeQuorum.openMilestoneDisputeCase",
        chainFamily: "iota",
        chainNetwork: "testnet",
        chainIdentifier: "test-chain",
        request: {
          sender: `0x${"1".repeat(64)}`,
          orderId: "order-guard",
          milestoneId: "milestone-guard",
          reviewerSelectionReceiptId: receiptId,
          invitedReviewerAddresses: reviewers,
        },
        inviteBinding: {
          mode: "selection_receipt_activation",
          invitedReviewerAddresses: reviewers,
          reviewerSelectionReceiptId: receiptId,
          postExecuteBindingRequired: true,
          bindRoute: `/reviewer-selection-receipts/${receiptId}/bind-dispute-case`,
        },
      },
    }),
    "POST /rpc": () => {
      rpcCalls += 1;
      return { status: 500, body: { error: "must_not_run" } };
    },
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/orders/order-guard/milestones/milestone-guard/disputes/open",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--body",
      JSON.stringify({
        reviewerSelectionReceiptId: receiptId,
        invitedReviewerAddresses: reviewers,
      }),
      "--json",
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "tx_plan_reviewer_selection_pre_execution_requirements_invalid");
    assert.equal(rpcCalls, 0);
  } finally {
    await mock.close();
  }
});

test("tx-plan-execute fails closed before reading inputs, calling the API, or writing bytes", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-disabled-tx-execute-"));
  const bytesOut = path.join(tempDir, "must-not-exist.b64");
  const mock = await startMockServer({
    "POST /must-not-run": () => ({ status: 500, body: { error: "should_not_run" } }),
  });
  try {
    const result = await runCli([
      "tx-plan-execute",
      "POST",
      "/must-not-run",
      "--api-base",
      mock.baseUrl,
      "--body-file",
      path.join(tempDir, "missing.json"),
      "--tx-bytes-out",
      bytesOut,
      "--json",
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "generic_tx_plan_execution_disabled");
    assert.equal(mock.requests.length, 0);
    assert.equal(existsSync(bytesOut), false);
  } finally {
    await mock.close();
  }
});

test("managed-storage-fee-pay fails closed before reading wallet state or calling the API", async () => {
  const mock = await startMockServer({
    "GET /must-not-run": () => ({ status: 500, body: { error: "should_not_run" } }),
  });
  try {
    const result = await runCli([
      "managed-storage-fee-pay",
      "--order-id",
      "order-1",
      "--milestone-id",
      "milestone-1",
      "--api-base",
      mock.baseUrl,
      "--auth-state-file",
      "/missing/auth-state.json",
      "--json",
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "managed_storage_fee_payment_builder_disabled");
    assert.match(payload.requiredEntrypoint, /pay_managed_storage_fee_\*_v2/);
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

test("sponsor execute dry-run is quarantined before auth or network access", async () => {
  const mock = await startMockServer({
    "POST /sponsor/reserve": () => ({ status: 500, body: { error: "must_not_reserve" } }),
  });

  try {
    const result = await runCli([
      "sponsor-execute",
      "--api-base",
      mock.baseUrl,
      "--auth-state-file",
      "/missing/auth-state.json",
      "--order-id",
      "order-auth-failure",
      "--dry-run",
      "--json",
    ]);
    assert.equal(result.status, 78);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "sponsor_execute_quarantined");
    assert.equal(payload.runtimePosture, "not_queried");
    assert.equal(payload.releaseBaseMode, "self_pay");
    assert.equal(payload.sponsorMode, "deferred");
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

test("sponsor preflight returns strategy and diagnostics", async () => {
  const mock = await startMockServer({
    "POST /sponsor/preflight": (request) => {
      assert.equal(request.headers.authorization, "Bearer test-jwt");
      assert.equal(request.body?.purpose, "marketplace_tx");
      assert.equal(request.body?.paymentCoin, "claw");
      assert.equal(request.body?.txFamily, "marketplace_write");
      return {
        status: 200,
        body: {
          actorAddress: "0xabc",
          purpose: "marketplace_tx",
          paymentCoin: "claw",
          orderId: null,
          order: null,
          sponsorProxyMode: "live",
          txFamily: "marketplace_write",
          rationale: "General marketplace writes should clear the live Gas-Station minimum with retry headroom.",
          strategy: {
            sponsorLikelyAllowed: true,
            selfPayFallbackAvailable: true,
            strictMode: false,
            intentRequired: false,
            intentSignatureRequired: false,
            authGate: {
              mode: "capability",
              requiresBotKey: false,
              requiresBotProfile: true
            }
          },
          providedGasBudget: null,
          acceptedGasBudget: null,
          minimumGasBudget: 1000000,
          recommendedGasBudget: 2000000,
          maxGasBudget: 5000000,
          reservationTtlSec: 120,
          capabilities: {},
          policy: {
            version: "sponsor_policy.v2",
            allowedPurposes: ["marketplace_tx"],
            allowedPaymentCoins: ["claw"],
            paymentCoinOptional: true,
            selfPayFallback: true,
            orderIdMode: "required",
            reservationTtlSec: 120,
            liveMinimumGasBudget: 1000000,
            maxGasBudget: 12000000,
            reserve: {
              orderIdRequired: true,
              rateLimitPerMin: 30,
              windowSec: 120,
              windowTxCap: 3,
              windowGasCap: 6000000
            },
            execute: {
              idempotencyHeader: "idempotency-key",
              intentSupported: true,
              intentRequired: false,
              intentSignatureRequired: false
            },
            recommendedGasBudgets: {
              marketplace_write: {
                minimumGasBudget: 1000000,
                recommendedGasBudget: 2000000,
                maxGasBudget: 5000000,
                rationale: "General marketplace writes should clear the live Gas-Station minimum with retry headroom."
              }
            }
          },
          gasStationCircuit: {
            open: false,
            retryAfterSec: 0
          },
          sponsorWindow: {
            allowed: true,
            usage: {
              txCount: 0,
              gasTotal: 0,
              blockedCount: 0
            },
            caps: {
              windowSec: 120,
              maxTxCount: 3,
              maxGasPerWindow: 6000000
            }
          },
          diagnostics: []
        }
      };
    }
  });

  try {
    const result = await runCli([
      "sponsor-preflight",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--tx-family",
      "marketplace_write",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.txFamily, "marketplace_write");
    assert.equal(payload.recommendedGasBudget, 2000000);
    assert.equal(payload.strictMode, false);
    assert.equal(payload.diagnosticCount, 0);
  } finally {
    await mock.close();
  }
});

test("mailbox-events normalizes posted and acked mailbox events", async () => {
  const mock = await startMockServer({
    "GET /orders/order-1/mailbox": () => ({
      status: 200,
      body: {
        mailboxObjectId: "0xmailbox1",
      },
    }),
    "GET /events?scope=all&type=mailbox.signal_posted&limit=5": () => ({
      status: 200,
      body: {
        items: [
          {
            id: "posted-1",
            eventType: "mailbox.signal_posted",
            entityId: "0xmailbox1",
            createdAt: "2026-03-19T10:00:00.000Z",
            payloadJson: {
              orderId: "order-1",
              mailboxObjectId: "0xmailbox1",
              seq: "2",
              sender: "0xseller",
              senderRole: "seller",
              signalIntent: "CHECKPOINT",
              payloadRef: "ipfs://payload-1",
              ciphertextHash: "aa".repeat(32),
              txDigest: "tx-posted-1",
              chainCreatedAtMs: "1773914400000",
            },
          },
        ],
      },
    }),
    "GET /events?scope=all&type=mailbox.signal_acked&limit=5": () => ({
      status: 200,
      body: {
        items: [
          {
            id: "acked-1",
            eventType: "mailbox.signal_acked",
            entityId: "0xmailbox1",
            createdAt: "2026-03-19T10:01:00.000Z",
            payloadJson: {
              orderId: "order-1",
              mailboxObjectId: "0xmailbox1",
              ackedSeq: "2",
              acker: "0xbuyer",
              ackerRole: "buyer",
              txDigest: "tx-acked-1",
              chainAckedAtMs: "1773914460000",
            },
          },
        ],
      },
    }),
  });

  try {
    const result = await runCli([
      "mailbox-events",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--order-id",
      "order-1",
      "--limit",
      "5",
      "--json",
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.mailboxObjectId, "0xmailbox1");
    assert.equal(payload.latestPostedSeq, 2);
    assert.equal(payload.latestAckByRole.buyer, 2);
    assert.equal(payload.events.length, 2);
    assert.equal(payload.events[0].category, "posted");
    assert.equal(payload.events[1].category, "acked");
  } finally {
    await mock.close();
  }
});

test("mailbox-events retries with a smaller limit after transient event-feed failures", async () => {
  const mock = await startMockServer({
    "GET /orders/order-1/mailbox": () => ({
      status: 200,
      body: {
        mailboxObjectId: "0xmailbox1",
      },
    }),
    "GET /events?scope=all&type=mailbox.signal_posted&limit=20": () => ({
      status: 503,
      body: {
        error: "backend_timeout",
      },
    }),
    "GET /events?scope=all&type=mailbox.signal_acked&limit=20": () => ({
      status: 503,
      body: {
        error: "backend_timeout",
      },
    }),
    "GET /events?scope=all&type=mailbox.signal_posted&limit=10": () => ({
      status: 200,
      body: {
        items: [
          {
            id: "posted-1",
            eventType: "mailbox.signal_posted",
            entityId: "0xmailbox1",
            createdAt: "2026-03-19T10:00:00.000Z",
            payloadJson: {
              orderId: "order-1",
              mailboxObjectId: "0xmailbox1",
              seq: "2",
              sender: "0xseller",
              senderRole: "seller",
              signalIntent: "CHECKPOINT",
              payloadRef: "ipfs://payload-1",
              ciphertextHash: "aa".repeat(32),
              txDigest: "tx-posted-1",
              chainCreatedAtMs: "1773914400000",
            },
          },
        ],
      },
    }),
    "GET /events?scope=all&type=mailbox.signal_acked&limit=10": () => ({
      status: 200,
      body: {
        items: [
          {
            id: "acked-1",
            eventType: "mailbox.signal_acked",
            entityId: "0xmailbox1",
            createdAt: "2026-03-19T10:01:00.000Z",
            payloadJson: {
              orderId: "order-1",
              mailboxObjectId: "0xmailbox1",
              ackedSeq: "2",
              acker: "0xbuyer",
              ackerRole: "buyer",
              txDigest: "tx-acked-1",
              chainAckedAtMs: "1773914460000",
            },
          },
        ],
      },
    }),
  });

  try {
    const result = await runCli([
      "mailbox-events",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--order-id",
      "order-1",
      "--json",
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.limit, 10);
    assert.equal(payload.downgradedFromLimit, 20);
    assert.equal(payload.events.length, 2);
    const requestedUrls = mock.requests.map((request) => request.url);
    assert.ok(requestedUrls.includes("/events?scope=all&type=mailbox.signal_posted&limit=20"));
    assert.ok(requestedUrls.includes("/events?scope=all&type=mailbox.signal_posted&limit=10"));
    assert.ok(requestedUrls.includes("/events?scope=all&type=mailbox.signal_acked&limit=20"));
    assert.ok(requestedUrls.includes("/events?scope=all&type=mailbox.signal_acked&limit=10"));
  } finally {
    await mock.close();
  }
});

test("mailbox-events falls back to direct chain reads when the event feed is empty", async () => {
  const mailboxPackageId = WRITE_GATE_PACKAGE_IDS.settlement;
  const mailboxObjectId = "0x9999999999999999999999999999999999999999999999999999999999999999";
  const mock = await startMockServer({
    "GET /orders/order-1/mailbox": () => ({
      status: 200,
      body: {
        mailboxObjectId,
      },
    }),
    "GET /events?scope=all&type=mailbox.signal_posted&limit=20": () => ({
      status: 200,
      body: {
        items: [],
      },
    }),
    "GET /events?scope=all&type=mailbox.signal_acked&limit=20": () => ({
      status: 200,
      body: {
        items: [],
      },
    }),
    "GET /policy/fees": () => ({
      status: 200,
      body: buildFreshMarketplacePolicyResponse(),
    }),
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getObject") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? "object",
            result: {
              data: {
                objectId: mailboxObjectId,
                type: `${mailboxPackageId}::order_mailbox::OrderMailbox`,
              },
            },
          },
        };
      }
      const moveEventType = request.body?.params?.[0]?.MoveEventType;
      if (moveEventType === `${mailboxPackageId}::order_mailbox::SignalPosted`) {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: "posted",
            result: {
              data: [
                {
                  id: {
                    txDigest: "tx-posted-chain",
                    eventSeq: "7",
                  },
                  type: `${mailboxPackageId}::order_mailbox::SignalPosted`,
                  parsedJson: {
                    mailbox_id: mailboxObjectId,
                    order_id: "order-1",
                    seq: "2",
                    signal_type: "1",
                    sender: "0xseller",
                    sender_role: "1",
                    ciphertext_hash: "aa".repeat(32),
                    payload_ref: "ipfs://payload-chain",
                    created_at_ms: "1773914400000",
                  },
                },
              ],
              hasNextPage: false,
              nextCursor: null,
            },
          },
        };
      }
      if (moveEventType === `${mailboxPackageId}::order_mailbox::SignalAcked`) {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: "acked",
            result: {
              data: [
                {
                  id: {
                    txDigest: "tx-acked-chain",
                    eventSeq: "8",
                  },
                  type: `${mailboxPackageId}::order_mailbox::SignalAcked`,
                  parsedJson: {
                    mailbox_id: mailboxObjectId,
                    order_id: "order-1",
                    acked_seq: "2",
                    acker: "0xbuyer",
                    acker_role: "0",
                    acked_at_ms: "1773914460000",
                  },
                },
              ],
              hasNextPage: false,
              nextCursor: null,
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: "empty",
          result: {
            data: [],
            hasNextPage: false,
            nextCursor: null,
          },
        },
      };
    },
  });

  try {
    const result = await runCli([
      "mailbox-events",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      "test-jwt",
      "--order-id",
      "order-1",
      "--json",
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.fallbackUsed, "onchain_rpc");
    assert.equal(payload.latestPostedSeq, 2);
    assert.equal(payload.latestAckByRole.buyer, 2);
    assert.equal(payload.events.length, 2);
    assert.equal(payload.events[0].category, "posted");
    assert.equal(payload.events[1].category, "acked");
  } finally {
    await mock.close();
  }
});

test("mailbox-events does not hide a frozen auth-refresh gate in the chain fallback", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-mailbox-frozen-refresh-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  let refreshCalls = 0;
  const mock = await startMockServer({
    "GET /orders/order-1/mailbox": () => ({
      status: 200,
      body: { mailboxObjectId: `0x${"9".repeat(64)}` },
    }),
    "GET /events?scope=all&type=mailbox.signal_posted&limit=20": () => ({
      status: 200,
      body: { items: [] },
    }),
    "GET /events?scope=all&type=mailbox.signal_acked&limit=20": () => ({
      status: 200,
      body: { items: [] },
    }),
    "GET /policy/fees": () => ({ status: 401, body: { error: "invalid_token" } }),
    "GET /policy/write-gate": (request) =>
      buildMarketplaceWriteGateResponse(request, {
        gate: {
          preset: "write_freeze",
          publicApiWrites: "frozen",
          marketplaceWrites: "frozen",
          runtimeReady: false,
          productiveWritesEnabled: false,
        },
      }),
    "POST /auth/refresh": () => {
      refreshCalls += 1;
      return { status: 500, body: { error: "refresh_must_not_run" } };
    },
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: buildJwtWithExp(4102444800),
          refreshToken: "refresh-token-1",
          address: `0x${"1".repeat(64)}`,
          alias: "bot",
        },
        null,
        2,
      ),
    );
    const result = await runCli([
      "mailbox-events",
      "--auth-state-file",
      authStateFile,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--order-id",
      "order-1",
      "--json",
    ]);
    assert.equal(result.status, 78);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "marketplace_mutation_gate_closed");
    assert.equal(payload.exitCode, 78);
    assert.equal(refreshCalls, 0);
    assert.equal(
      mock.requests.filter(
        (request) => request.method === "GET" && /^\/policy\/write-gate\?nonce=[0-9a-f]{32}$/.test(request.url),
      ).length,
      1,
    );
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist builds a full dispute-open body and warns on stale context status", async () => {
  const requestReceiptId = "00000000-0000-4000-8000-000000000001";
  const mock = await startMockServer({
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getLatestCheckpointSequenceNumber") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: "12345",
          },
        };
      }
      if (method === "iota_getCheckpoint") {
        assert.equal(request.body?.params?.[0], "12345");
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              digest: "9T4R6r5u2mYk5iVX1q4x8o9cTq1rLp9Y6w9Z2SxQnPz",
              sequenceNumber: "12345",
              timestampMs: "1773916000000",
            },
          },
        };
      }
      return {
        status: 404,
        body: { error: "unknown_rpc_method" },
      };
    },
    "POST /admin/reviewer-selection/shortlist": (request) => {
      assert.equal(request.headers.authorization, `Bearer ${buildReviewerOperatorJwt()}`);
      assert.equal(request.body?.scope, "OPEN");
      assert.equal(request.body?.receiptId, requestReceiptId);
      assert.equal(request.body?.orderId, "order-1");
      assert.equal(request.body?.milestoneId, "milestone-2");
      assert.equal(request.body?.buyerAddress, "0x1111111111111111111111111111111111111111111111111111111111111111");
      assert.equal(request.body?.sellerAddress, "0x2222222222222222222222222222222222222222222222222222222222222222");
      assert.equal(request.body?.checkpointDigest, "9T4R6r5u2mYk5iVX1q4x8o9cTq1rLp9Y6w9Z2SxQnPz");
      assert.equal(request.body?.minPerformanceScore, 0);
      assert.equal(request.body?.minReputationScore, 0);
      assert.equal(request.body?.minReputationConfidence, 0);
      assert.equal(request.body?.minDecisionsTotal, 0);
      assert.equal(request.body?.maxNoshowCount, 0);
      assert.equal(request.body?.maxCommitRevealFailures, 0);
      return {
        status: 200,
        body: {
          selectionComplete: true,
          directoryScanTruncated: false,
          receipt: reviewerSelectionReceipt({
            scope: "OPEN",
            receiptId: requestReceiptId,
            requestBody: request.body,
            reviewers: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            ],
            orderId: "order-1",
            milestoneId: "milestone-2",
            checkpointDigest: "9T4R6r5u2mYk5iVX1q4x8o9cTq1rLp9Y6w9Z2SxQnPz",
            checkpointSequenceNumber: "12345",
            checkpointTimestampMs: 1773916000000,
          }),
          publishTarget: {
            route: "/orders/order-1/milestones/milestone-2/disputes/open",
            requestPatch: {
              invitedReviewerAddresses: [
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              ],
              reviewerSelectionReceiptId: requestReceiptId,
            },
          },
          operatorAuthorizationHandoff: reviewerShortlistAuthorizationHandoff({
            scope: "OPEN",
            receiptId: requestReceiptId,
            reviewers: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            ],
            orderId: "order-1",
            milestoneId: "milestone-2",
          }),
        },
      };
    },
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-shortlist-"));
  const contextFile = path.join(tempDir, "timeline.json");
  writeFileSync(
    contextFile,
    JSON.stringify(
      {
        order: {
          id: "order-1",
          buyerAddress: "0x1111111111111111111111111111111111111111111111111111111111111111",
          sellerAddress: "0x2222222222222222222222222222222222222222222222222222222222222222",
          escrowObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333",
          disputeBondObjectId: "0x4444444444444444444444444444444444444444444444444444444444444444",
          status: "IN_PROGRESS",
        },
        milestones: [
          {
            id: "milestone-2",
            status: "SUBMITTED",
          },
        ],
      },
      null,
      2
    ),
  );

  try {
    const repoModeBefore = statSync(repoRoot).mode & 0o777;
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--order-id",
      "order-1",
      "--milestone-id",
      "milestone-2",
      "--order-context-file",
      contextFile,
      "--request-receipt-id",
      requestReceiptId,
      "--request-state-file",
      path.join(tempDir, "request-state.json"),
      "--min-performance-score",
      "0",
      "--min-reputation-score",
      "0",
      "--min-reputation-confidence",
      "0",
      "--min-decisions-total",
      "0",
      "--max-noshow-count",
      "0",
      "--max-commit-reveal-failures",
      "0",
      "--publish-auth-state-file",
      "/tmp/buyer-auth-state.json",
      "--json",
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.requestReceiptId, requestReceiptId);
    assert.equal(payload.receiptId, requestReceiptId);
    assert.equal(payload.contextOrderStatus, "IN_PROGRESS");
    assert.equal(payload.contextMilestoneStatus, "SUBMITTED");
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(payload.warnings.some((entry) => /context_milestone_status=SUBMITTED/.test(entry)));
    assert.equal(payload.publishReady, false);
    assert.equal(payload.operatorAuthorizationRequired, true);
    assert.equal(payload.nextPublishHint, null);
    assert.match(payload.nextPostAuthorizationDryRunHint, /--auth-state-file '\/tmp\/buyer-auth-state\.json'/);
    assert.equal(payload.response.receipt?.shortlistedReviewerAddresses?.length, 3);
    assert.equal(path.dirname(payload.receiptOut), path.join(os.tmpdir(), "clawnera-help"));
    assert.equal(path.dirname(payload.publishBodyOut), path.join(os.tmpdir(), "clawnera-help"));
    assert.equal(statSync(repoRoot).mode & 0o777, repoModeBefore);
    const publishBody = JSON.parse(readFileSync(payload.publishBodyOut, "utf8"));
    assert.deepEqual(publishBody, {
      escrowObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333",
      bondObjectId: "0x4444444444444444444444444444444444444444444444444444444444444444",
      invitedReviewerAddresses: [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ],
      reviewerSelectionReceiptId: requestReceiptId,
    });
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist rejects an inconsistent latest checkpoint before persisting state or artifacts", async () => {
  const requestReceiptId = "00000000-0000-4000-8000-000000000035";
  let shortlistCalls = 0;
  const mock = await startMockServer({
    "POST /rpc": (request) => {
      if (request.body?.method === "iota_getLatestCheckpointSequenceNumber") {
        return {
          status: 200,
          body: { jsonrpc: "2.0", id: request.body?.id ?? 1, result: "42" },
        };
      }
      assert.equal(request.body?.method, "iota_getCheckpoint");
      assert.deepEqual(request.body?.params, ["42"]);
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: request.body?.id ?? 1,
          result: {
            digest: "checkpoint-43",
            sequenceNumber: "43",
            timestampMs: "1700000001000",
          },
        },
      };
    },
    "POST /admin/reviewer-selection/shortlist": () => {
      shortlistCalls += 1;
      return { status: 500, body: { error: "shortlist_must_not_run" } };
    },
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-latest-checkpoint-guard-"));
  const requestStateFile = path.join(tempDir, "must-not-write-state.json");
  const receiptOut = path.join(tempDir, "must-not-write-receipt.json");
  const publishBodyOut = path.join(tempDir, "must-not-write-publish.json");

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--order-id",
      "order-latest-checkpoint-guard",
      "--milestone-id",
      "milestone-latest-checkpoint-guard",
      "--buyer-address",
      `0x${"1".repeat(64)}`,
      "--seller-address",
      `0x${"2".repeat(64)}`,
      "--escrow-object-id",
      `0x${"3".repeat(64)}`,
      "--bond-object-id",
      `0x${"4".repeat(64)}`,
      "--request-receipt-id",
      requestReceiptId,
      "--request-state-file",
      requestStateFile,
      "--receipt-out",
      receiptOut,
      "--publish-body-out",
      publishBodyOut,
      "--json",
    ]);

    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error, "latest_checkpoint_sequence_mismatch");
    assert.equal(shortlistCalls, 0);
    assert.equal(existsSync(requestStateFile), false);
    assert.equal(existsSync(receiptOut), false);
    assert.equal(existsSync(publishBodyOut), false);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist does not write a publish body for a mismatched operator handoff", async () => {
  const requestReceiptId = "00000000-0000-4000-8000-000000000002";
  const reviewers = [
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ];
  const mock = await startMockServer({
    "POST /rpc": (request) => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: request.body?.id ?? 1,
        result: request.body?.method === "iota_getLatestCheckpointSequenceNumber"
          ? "7"
          : {
              digest: "checkpoint-7",
              sequenceNumber: "7",
              timestampMs: "1773916000000",
            },
      },
    }),
    "POST /admin/reviewer-selection/shortlist": (request) => {
      assert.equal(request.body?.receiptId, requestReceiptId);
      const operatorAuthorizationHandoff = reviewerShortlistAuthorizationHandoff({
        scope: "OPEN",
        receiptId: requestReceiptId,
        reviewers,
        orderId: "order-guard",
        milestoneId: "milestone-guard",
      });
      operatorAuthorizationHandoff.orderedReviewerAddresses.reverse();
      return {
        status: 200,
        body: {
          selectionComplete: true,
          directoryScanTruncated: false,
          receipt: reviewerSelectionReceipt({
            scope: "OPEN",
            receiptId: requestReceiptId,
            requestBody: request.body,
            reviewers,
            orderId: "order-guard",
            milestoneId: "milestone-guard",
            checkpointDigest: "checkpoint-7",
            checkpointSequenceNumber: "7",
            checkpointTimestampMs: 1773916000000,
          }),
          publishTarget: {
            route: "/orders/order-guard/milestones/milestone-guard/disputes/open",
            requestPatch: {
              invitedReviewerAddresses: reviewers,
              reviewerSelectionReceiptId: requestReceiptId,
            },
          },
          operatorAuthorizationHandoff,
        },
      };
    },
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-handoff-guard-"));
  const publishBodyOut = path.join(tempDir, "must-not-exist.json");

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--order-id",
      "order-guard",
      "--milestone-id",
      "milestone-guard",
      "--buyer-address",
      `0x${"1".repeat(64)}`,
      "--seller-address",
      `0x${"2".repeat(64)}`,
      "--escrow-object-id",
      `0x${"3".repeat(64)}`,
      "--bond-object-id",
      `0x${"4".repeat(64)}`,
      "--request-receipt-id",
      requestReceiptId,
      "--request-state-file",
      path.join(tempDir, "request-state.json"),
      "--reviewer-count",
      "2",
      "--publish-body-out",
      publishBodyOut,
      "--json",
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "reviewer_shortlist_reviewer_order_mismatch");
    assert.equal(payload.publishBodyOut, null);
    assert.equal(existsSync(publishBodyOut), false);
    assert.equal(payload.receiptOut, null);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist retries once when the server reports checkpoint_digest_mismatch", async () => {
  const requestReceiptId = "00000000-0000-4000-8000-000000000003";
  const requestReceiptIds = [];
  let shortlistCalls = 0;
  let newCheckpointReads = 0;
  const mock = await startMockServer({
    "POST /admin/reviewer-selection/shortlist": (request) => {
      shortlistCalls += 1;
      requestReceiptIds.push(request.body?.receiptId);
      if (shortlistCalls === 1) {
        assert.equal(request.body?.checkpointDigest, "checkpoint-old");
        return {
          status: 409,
          body: {
            error: "checkpoint_digest_mismatch",
            latestCheckpointDigest: "checkpoint-new",
            latestCheckpointSequenceNumber: "43"
          }
        };
      }
      assert.equal(request.body?.checkpointDigest, "checkpoint-new");
      return {
        status: 200,
        body: {
          selectionComplete: true,
          receipt: reviewerSelectionReceipt({
            scope: "OPEN",
            receiptId: requestReceiptId,
            requestBody: request.body,
            reviewers: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            ],
            orderId: "order-1",
            milestoneId: "milestone-1",
            checkpointDigest: "checkpoint-new",
            checkpointSequenceNumber: "43",
            checkpointTimestampMs: null,
          }),
          publishTarget: {
            route: "/orders/order-1/milestones/milestone-1/disputes/open",
            requestPatch: {
              invitedReviewerAddresses: [
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
              ],
              reviewerSelectionReceiptId: requestReceiptId
            }
          },
          operatorAuthorizationHandoff: reviewerShortlistAuthorizationHandoff({
            scope: "OPEN",
            receiptId: requestReceiptId,
            reviewers: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            ],
            orderId: "order-1",
            milestoneId: "milestone-1"
          })
        }
      };
    },
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getLatestCheckpointSequenceNumber") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: "42"
          }
        };
      }
      if (method === "iota_getCheckpoint") {
        const sequenceNumber = request.body?.params?.[0];
        if (sequenceNumber === "43") {
          newCheckpointReads += 1;
          return {
            status: 200,
            body: {
              jsonrpc: "2.0",
              id: request.body?.id ?? 1,
              result: {
                digest: "checkpoint-new",
                sequenceNumber: "43",
                timestampMs: "1700000001000"
              }
            }
          };
        }
        assert.equal(sequenceNumber, "42");
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              digest: "checkpoint-old",
              sequenceNumber: "42",
              timestampMs: "1700000000000"
            }
          }
        };
      }
      throw new Error(`unexpected_rpc_method:${String(method)}`);
    }
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-shortlist-retry-"));
  const contextFile = path.join(tempDir, "timeline.json");
  const receiptOut = path.join(tempDir, "receipt.json");
  const publishBodyOut = path.join(tempDir, "publish.json");
  const requestStateFile = path.join(tempDir, "request-state.json");
  writeFileSync(
    contextFile,
    JSON.stringify(
      {
        order: {
          id: "order-1",
          buyerAddress: "0x1111111111111111111111111111111111111111111111111111111111111111",
          sellerAddress: "0x2222222222222222222222222222222222222222222222222222222222222222",
          escrowObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333",
          disputeBondObjectId: "0x4444444444444444444444444444444444444444444444444444444444444444",
          status: "IN_PROGRESS"
        },
        milestones: [
          {
            id: "milestone-1",
            status: "SUBMITTED"
          }
        ]
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--order-id",
      "order-1",
      "--milestone-id",
      "milestone-1",
      "--order-context-file",
      contextFile,
      "--request-receipt-id",
      requestReceiptId,
      "--request-state-file",
      requestStateFile,
      "--reviewer-count",
      "3",
      "--receipt-out",
      receiptOut,
      "--publish-body-out",
      publishBodyOut,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.checkpointDigest, "checkpoint-new");
    assert.equal(payload.checkpointSequenceNumber, "43");
    assert.equal(payload.checkpointTimestampMs, 1700000001000);
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(
      payload.warnings.some((entry) =>
        /checkpoint_digest_advanced_to=checkpoint-new/.test(entry)
      )
    );
    assert.equal(shortlistCalls, 2);
    assert.equal(newCheckpointReads, 2);
    assert.deepEqual(requestReceiptIds, [requestReceiptId, requestReceiptId]);
    const requestState = JSON.parse(readFileSync(requestStateFile, "utf8"));
    assert.equal(requestState.requestBody.checkpointDigest, "checkpoint-new");
    assert.equal(requestState.checkpoint.sequenceNumber, "43");
    assert.equal(requestState.checkpoint.timestampMs, 1700000001000);
    const publishBody = JSON.parse(readFileSync(publishBodyOut, "utf8"));
    assert.equal(
      publishBody.reviewerSelectionReceiptId,
      requestReceiptId
    );
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist rejects an API-proposed checkpoint that the selected RPC does not confirm", async () => {
  const requestReceiptId = "00000000-0000-4000-8000-000000000033";
  let shortlistCalls = 0;
  let proposedCheckpointReads = 0;
  const mock = await startMockServer({
    "POST /rpc": (request) => {
      if (request.body?.method === "iota_getLatestCheckpointSequenceNumber") {
        return {
          status: 200,
          body: { jsonrpc: "2.0", id: request.body?.id ?? 1, result: "42" },
        };
      }
      assert.equal(request.body?.method, "iota_getCheckpoint");
      const sequenceNumber = request.body?.params?.[0];
      if (sequenceNumber === "43") {
        proposedCheckpointReads += 1;
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              digest: "checkpoint-rpc-43",
              sequenceNumber: "43",
              timestampMs: "1700000001000",
            },
          },
        };
      }
      assert.equal(sequenceNumber, "42");
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: request.body?.id ?? 1,
          result: {
            digest: "checkpoint-42",
            sequenceNumber: "42",
            timestampMs: "1700000000000",
          },
        },
      };
    },
    "POST /admin/reviewer-selection/shortlist": () => {
      shortlistCalls += 1;
      return {
        status: 409,
        body: {
          error: "checkpoint_digest_mismatch",
          latestCheckpointDigest: "checkpoint-api-43",
          latestCheckpointSequenceNumber: "43",
        },
      };
    },
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-checkpoint-proposal-"));
  const requestStateFile = path.join(tempDir, "request-state.json");
  const receiptOut = path.join(tempDir, "must-not-write-receipt.json");
  const publishBodyOut = path.join(tempDir, "must-not-write-publish.json");

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--order-id",
      "order-proposal",
      "--milestone-id",
      "milestone-proposal",
      "--buyer-address",
      `0x${"1".repeat(64)}`,
      "--seller-address",
      `0x${"2".repeat(64)}`,
      "--escrow-object-id",
      `0x${"3".repeat(64)}`,
      "--bond-object-id",
      `0x${"4".repeat(64)}`,
      "--request-receipt-id",
      requestReceiptId,
      "--request-state-file",
      requestStateFile,
      "--receipt-out",
      receiptOut,
      "--publish-body-out",
      publishBodyOut,
      "--json",
    ]);
    assert.equal(result.status, 1);
    assert.equal(
      JSON.parse(result.stdout).error,
      "reviewer_shortlist_checkpoint_mismatch_rpc_mismatch",
    );
    assert.equal(shortlistCalls, 1);
    assert.equal(proposedCheckpointReads, 1);
    const requestState = JSON.parse(readFileSync(requestStateFile, "utf8"));
    assert.equal(requestState.checkpoint.digest, "checkpoint-42");
    assert.equal(requestState.checkpoint.sequenceNumber, "42");
    assert.equal(requestState.checkpoint.timestampMs, 1700000000000);
    assert.equal(requestState.requestBody.checkpointDigest, "checkpoint-42");
    assert.equal(existsSync(receiptOut), false);
    assert.equal(existsSync(publishBodyOut), false);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist revalidates a same-checkpoint receipt before writing artifacts", async () => {
  const requestReceiptId = "00000000-0000-4000-8000-000000000034";
  const reviewers = [
    `0x${"a".repeat(64)}`,
    `0x${"b".repeat(64)}`,
    `0x${"c".repeat(64)}`,
  ];
  let checkpointReads = 0;
  const mock = await startMockServer({
    "POST /rpc": (request) => {
      if (request.body?.method === "iota_getLatestCheckpointSequenceNumber") {
        return {
          status: 200,
          body: { jsonrpc: "2.0", id: request.body?.id ?? 1, result: "52" },
        };
      }
      assert.equal(request.body?.method, "iota_getCheckpoint");
      assert.equal(request.body?.params?.[0], "52");
      checkpointReads += 1;
      if (checkpointReads > 1) {
        return { status: 503, body: { error: "rpc_unavailable_after_shortlist" } };
      }
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: request.body?.id ?? 1,
          result: {
            digest: "checkpoint-52",
            sequenceNumber: "52",
            timestampMs: "1700000000000",
          },
        },
      };
    },
    "POST /admin/reviewer-selection/shortlist": (request) => ({
      status: 200,
      body: {
        selectionComplete: true,
        directoryScanTruncated: false,
        receipt: reviewerSelectionReceipt({
          scope: "OPEN",
          receiptId: requestReceiptId,
          requestBody: request.body,
          reviewers,
          orderId: "order-revalidate",
          milestoneId: "milestone-revalidate",
          checkpointDigest: "checkpoint-52",
          checkpointSequenceNumber: "52",
          checkpointTimestampMs: null,
        }),
        publishTarget: {
          route: "/orders/order-revalidate/milestones/milestone-revalidate/disputes/open",
          requestPatch: {
            invitedReviewerAddresses: reviewers,
            reviewerSelectionReceiptId: requestReceiptId,
          },
        },
        operatorAuthorizationHandoff: reviewerShortlistAuthorizationHandoff({
          scope: "OPEN",
          receiptId: requestReceiptId,
          reviewers,
          orderId: "order-revalidate",
          milestoneId: "milestone-revalidate",
        }),
      },
    }),
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-receipt-revalidate-"));
  const requestStateFile = path.join(tempDir, "request-state.json");
  const receiptOut = path.join(tempDir, "must-not-write-receipt.json");
  const publishBodyOut = path.join(tempDir, "must-not-write-publish.json");

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--order-id",
      "order-revalidate",
      "--milestone-id",
      "milestone-revalidate",
      "--buyer-address",
      `0x${"1".repeat(64)}`,
      "--seller-address",
      `0x${"2".repeat(64)}`,
      "--escrow-object-id",
      `0x${"3".repeat(64)}`,
      "--bond-object-id",
      `0x${"4".repeat(64)}`,
      "--request-receipt-id",
      requestReceiptId,
      "--request-state-file",
      requestStateFile,
      "--receipt-out",
      receiptOut,
      "--publish-body-out",
      publishBodyOut,
      "--json",
    ]);
    assert.equal(result.status, 1);
    assert.equal(
      JSON.parse(result.stdout).error,
      "reviewer_shortlist_receipt_checkpoint_rpc_unavailable",
    );
    assert.equal(checkpointReads, 2);
    const requestState = JSON.parse(readFileSync(requestStateFile, "utf8"));
    assert.equal(requestState.checkpoint.digest, "checkpoint-52");
    assert.equal(requestState.requestBody.checkpointDigest, "checkpoint-52");
    assert.equal(existsSync(receiptOut), false);
    assert.equal(existsSync(publishBodyOut), false);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist retries transient rpc_unreachable shortlist failures automatically", async () => {
  const requestReceiptId = "00000000-0000-4000-8000-000000000004";
  const requestReceiptIds = [];
  let shortlistCalls = 0;
  const mock = await startMockServer({
    "POST /admin/reviewer-selection/shortlist": (request) => {
      shortlistCalls += 1;
      requestReceiptIds.push(request.body?.receiptId);
      if (shortlistCalls === 1) {
        return {
          status: 502,
          body: {
            error: "rpc_unreachable",
            detail: "https://api.testnet.iota.cafe:rpc_unreachable(rpc_timeout)"
          }
        };
      }
      assert.equal(request.body?.checkpointDigest, "checkpoint-live");
      return {
        status: 200,
        body: {
          selectionComplete: true,
          receipt: reviewerSelectionReceipt({
            scope: "OPEN",
            receiptId: requestReceiptId,
            requestBody: request.body,
            reviewers: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            ],
            orderId: "order-1",
            milestoneId: "milestone-1",
            checkpointDigest: "checkpoint-live",
            checkpointSequenceNumber: "42",
          }),
          publishTarget: {
            route: "/orders/order-1/milestones/milestone-1/disputes/open",
            requestPatch: {
              invitedReviewerAddresses: [
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
              ],
              reviewerSelectionReceiptId: requestReceiptId
            }
          },
          operatorAuthorizationHandoff: reviewerShortlistAuthorizationHandoff({
            scope: "OPEN",
            receiptId: requestReceiptId,
            reviewers: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            ],
            orderId: "order-1",
            milestoneId: "milestone-1"
          })
        }
      };
    },
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getLatestCheckpointSequenceNumber") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: "42"
          }
        };
      }
      if (method === "iota_getCheckpoint") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              digest: "checkpoint-live",
              sequenceNumber: "42",
              timestampMs: "1700000000000"
            }
          }
        };
      }
      throw new Error(`unexpected_rpc_method:${String(method)}`);
    }
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-shortlist-rpc-retry-"));
  const contextFile = path.join(tempDir, "timeline.json");
  const publishBodyOut = path.join(tempDir, "publish.json");
  writeFileSync(
    contextFile,
    JSON.stringify(
      {
        order: {
          id: "order-1",
          buyerAddress: "0x1111111111111111111111111111111111111111111111111111111111111111",
          sellerAddress: "0x2222222222222222222222222222222222222222222222222222222222222222",
          escrowObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333",
          disputeBondObjectId: "0x4444444444444444444444444444444444444444444444444444444444444444",
          status: "DISPUTED"
        },
        milestones: [
          {
            id: "milestone-1",
            status: "REJECTED"
          }
        ]
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--order-id",
      "order-1",
      "--milestone-id",
      "milestone-1",
      "--order-context-file",
      contextFile,
      "--request-receipt-id",
      requestReceiptId,
      "--request-state-file",
      path.join(tempDir, "request-state.json"),
      "--publish-body-out",
      publishBodyOut,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(shortlistCalls, 2);
    assert.deepEqual(requestReceiptIds, [requestReceiptId, requestReceiptId]);
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(
      payload.warnings.some((entry) =>
        /shortlist_rpc_retry_count=1/.test(entry)
      )
    );
    const publishBody = JSON.parse(readFileSync(publishBodyOut, "utf8"));
    assert.equal(publishBody.reviewerSelectionReceiptId, requestReceiptId);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist rejects invalid scope and OPEN-only request identity options before network access", async () => {
  const mock = await startMockServer({
    "POST /rpc": () => ({ status: 500, body: { error: "must_not_read_rpc" } }),
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-input-guards-"));

  try {
    const invalidScopeResult = await runCli([
      "reviewer-shortlist",
      "--scope",
      "OPNE",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--json",
    ]);
    assert.equal(invalidScopeResult.status, 1);
    assert.equal(JSON.parse(invalidScopeResult.stdout).error, "invalid_reviewer_shortlist_scope");

    const missingScopeValueResult = await runCli(["reviewer-shortlist", "--scope", "--json"]);
    assert.equal(missingScopeValueResult.status, 1);
    assert.equal(JSON.parse(missingScopeValueResult.stdout).error, "invalid_reviewer_shortlist_scope");

    const missingStateResult = await runCli([
      "reviewer-shortlist",
      "--order-id",
      "order-guard",
      "--milestone-id",
      "milestone-guard",
      "--api-base",
      mock.baseUrl,
      "--json",
    ]);
    assert.equal(missingStateResult.status, 1);
    assert.equal(JSON.parse(missingStateResult.stdout).error, "request_state_file_required_for_open");

    for (const [option, value, expectedError] of [
      ["--reviewer-count", "11", "invalid_reviewer_count"],
      ["--directory-scan-limit", "5001", "invalid_directory_scan_limit"],
      ["--min-performance-score", "10001", "invalid_min_performance_score"],
      ["--min-reputation-score", "10001", "invalid_min_reputation_score"],
      ["--min-reputation-confidence", "10001", "invalid_min_reputation_confidence"],
      ["--min-decisions-total", "10001", "invalid_min_decisions_total"],
      ["--max-noshow-count", "10001", "invalid_max_noshow_count"],
      ["--max-commit-reveal-failures", "10001", "invalid_max_commit_reveal_failures"],
    ]) {
      const boundedResult = await runCli([
        "reviewer-shortlist",
        "--request-state-file",
        path.join(tempDir, `bounds-${option.slice(2)}.json`),
        option,
        value,
        "--api-base",
        mock.baseUrl,
        "--json",
      ]);
      assert.equal(boundedResult.status, 1);
      assert.equal(JSON.parse(boundedResult.stdout).error, expectedError);
    }

    const openResult = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--order-id",
      "order-guard",
      "--milestone-id",
      "milestone-guard",
      "--request-receipt-id",
      "00000000-0000-4000-8000-00000000000A",
      "--request-state-file",
      path.join(tempDir, "invalid-receipt-state.json"),
      "--json",
    ]);
    assert.equal(openResult.status, 1);
    assert.equal(JSON.parse(openResult.stdout).error, "invalid_request_receipt_id");

    const replacementResult = await runCli([
      "reviewer-shortlist",
      "--scope",
      "REPLACEMENT",
      "--request-receipt-id",
      "00000000-0000-4000-8000-000000000005",
      "--json",
    ]);
    assert.equal(replacementResult.status, 1);
    assert.equal(JSON.parse(replacementResult.stdout).error, "request_receipt_id_open_scope_only");

    const replacementStateResult = await runCli([
      "reviewer-shortlist",
      "--scope",
      "REPLACEMENT",
      "--request-state-file",
      "/must-not-read-request-state.json",
      "--json",
    ]);
    assert.equal(replacementStateResult.status, 1);
    assert.equal(JSON.parse(replacementStateResult.stdout).error, "request_state_file_open_scope_only");
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist rejects unknown options and unsafe output paths before file or network access", async () => {
  const mock = await startMockServer({
    default: () => ({ status: 500, body: { error: "must_not_be_called" } }),
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-path-guards-"));
  const collidedPath = path.join(tempDir, "collided.json");
  const authStatePath = path.join(tempDir, "auth-state.json");
  const envFilePath = path.join(tempDir, "runtime.env");
  const contextFilePath = path.join(tempDir, "order-context.json");
  const contextFileLink = path.join(tempDir, "order-context-link.json");
  const broadDirectory = path.join(tempDir, "broad");
  const realDirectory = path.join(tempDir, "real");
  const linkedDirectory = path.join(tempDir, "linked");
  mkdirSync(broadDirectory, { mode: 0o700 });
  mkdirSync(realDirectory, { mode: 0o700 });
  chmodSync(broadDirectory, 0o755);
  writeFileSync(authStatePath, '{"sentinel":"auth"}\n', { mode: 0o600 });
  writeFileSync(envFilePath, "SENTINEL=env\n", { mode: 0o600 });
  writeFileSync(contextFilePath, '{"sentinel":"context"}\n', { mode: 0o600 });
  symlinkSync(realDirectory, linkedDirectory, "dir");
  symlinkSync(contextFilePath, contextFileLink, "file");

  try {
    const unexpected = await runCli([
      "reviewer-shortlist",
      "--request-recipt-id",
      "00000000-0000-4000-8000-000000000005",
      "--api-base",
      mock.baseUrl,
      "--json",
    ]);
    assert.equal(unexpected.status, 1);
    const unexpectedPayload = JSON.parse(unexpected.stdout);
    assert.equal(unexpectedPayload.error, "unexpected_options");
    assert.deepEqual(unexpectedPayload.unexpectedOptions, ["request-recipt-id"]);

    const collision = await runCli([
      "reviewer-shortlist",
      "--request-state-file",
      collidedPath,
      "--receipt-out",
      collidedPath,
      "--api-base",
      mock.baseUrl,
      "--json",
    ]);
    assert.equal(collision.status, 1);
    const collisionPayload = JSON.parse(collision.stdout);
    assert.equal(collisionPayload.error, "reviewer_shortlist_path_collision");
    assert.deepEqual(collisionPayload.collisionFields, ["requestStateFile", "receiptOut"]);
    assert.equal(collisionPayload.collisionPath, collidedPath);
    assert.equal(existsSync(collidedPath), false);

    const authEnvironmentCollision = await runCli(
      [
        "reviewer-shortlist",
        "--request-state-file",
        path.join(tempDir, "auth-environment-state.json"),
        "--receipt-out",
        authStatePath,
        "--api-base",
        mock.baseUrl,
        "--json",
      ],
      { CLAWNERA_AUTH_STATE_FILE: authStatePath, CLAWNERA_ENV_FILE: "" },
    );
    assert.equal(authEnvironmentCollision.status, 1);
    const authEnvironmentCollisionPayload = JSON.parse(authEnvironmentCollision.stdout);
    assert.equal(authEnvironmentCollisionPayload.error, "reviewer_shortlist_path_collision");
    assert.deepEqual(authEnvironmentCollisionPayload.collisionFields, ["receiptOut", "authStateFile"]);
    assert.equal(readFileSync(authStatePath, "utf8"), '{"sentinel":"auth"}\n');

    const envEnvironmentCollision = await runCli(
      [
        "reviewer-shortlist",
        "--request-state-file",
        path.join(tempDir, "env-environment-state.json"),
        "--publish-body-out",
        envFilePath,
        "--api-base",
        mock.baseUrl,
        "--json",
      ],
      { CLAWNERA_AUTH_STATE_FILE: "", CLAWNERA_ENV_FILE: envFilePath },
    );
    assert.equal(envEnvironmentCollision.status, 1);
    const envEnvironmentCollisionPayload = JSON.parse(envEnvironmentCollision.stdout);
    assert.equal(envEnvironmentCollisionPayload.error, "reviewer_shortlist_path_collision");
    assert.deepEqual(envEnvironmentCollisionPayload.collisionFields, ["publishBodyOut", "envFile"]);
    assert.equal(readFileSync(envFilePath, "utf8"), "SENTINEL=env\n");

    const symlinkAliasCollision = await runCli([
      "reviewer-shortlist",
      "--request-state-file",
      path.join(linkedDirectory, "missing", "shared.json"),
      "--receipt-out",
      path.join(realDirectory, "missing", "shared.json"),
      "--api-base",
      mock.baseUrl,
      "--json",
    ]);
    assert.equal(symlinkAliasCollision.status, 1);
    const symlinkAliasCollisionPayload = JSON.parse(symlinkAliasCollision.stdout);
    assert.equal(symlinkAliasCollisionPayload.error, "reviewer_shortlist_path_collision");
    assert.deepEqual(symlinkAliasCollisionPayload.collisionFields, ["requestStateFile", "receiptOut"]);
    assert.equal(existsSync(path.join(realDirectory, "missing")), false);

    const fileSymlinkCollision = await runCli([
      "reviewer-shortlist",
      "--request-state-file",
      path.join(tempDir, "file-symlink-state.json"),
      "--order-context-file",
      contextFileLink,
      "--receipt-out",
      contextFilePath,
      "--api-base",
      mock.baseUrl,
      "--json",
    ]);
    assert.equal(fileSymlinkCollision.status, 1);
    const fileSymlinkCollisionPayload = JSON.parse(fileSymlinkCollision.stdout);
    assert.equal(fileSymlinkCollisionPayload.error, "reviewer_shortlist_path_collision");
    assert.deepEqual(fileSymlinkCollisionPayload.collisionFields, ["receiptOut", "orderContextFile"]);
    assert.equal(readFileSync(contextFilePath, "utf8"), '{"sentinel":"context"}\n');

    const lockAliasTarget = path.join(tempDir, "lock-alias.json");
    const lockAliasCollision = await runCli([
      "reviewer-shortlist",
      "--request-state-file",
      `${lockAliasTarget}.lock`,
      "--receipt-out",
      lockAliasTarget,
      "--api-base",
      mock.baseUrl,
      "--json",
    ]);
    assert.equal(lockAliasCollision.status, 1);
    const lockAliasCollisionPayload = JSON.parse(lockAliasCollision.stdout);
    assert.equal(lockAliasCollisionPayload.error, "reviewer_shortlist_path_collision");
    assert.deepEqual(lockAliasCollisionPayload.collisionFields, ["requestStateFile", "receiptOut"]);
    assert.equal(existsSync(lockAliasTarget), false);
    assert.equal(existsSync(`${lockAliasTarget}.lock`), false);

    const broadParent = await runCli([
      "reviewer-shortlist",
      "--request-state-file",
      path.join(broadDirectory, "state.json"),
      "--api-base",
      mock.baseUrl,
      "--json",
    ]);
    assert.equal(broadParent.status, 1);
    assert.equal(
      JSON.parse(broadParent.stdout).error,
      "unsafe_reviewer_shortlist_output_directory_mode",
    );
    assert.equal(statSync(broadDirectory).mode & 0o777, 0o755);
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist does not retry an OPEN receipt id conflict or write artifacts", async () => {
  const requestReceiptId = "00000000-0000-4000-8000-000000000005";
  let shortlistCalls = 0;
  const mock = await startMockServer({
    "POST /rpc": (request) => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: request.body?.id ?? 1,
        result:
          request.body?.method === "iota_getLatestCheckpointSequenceNumber"
            ? "51"
            : { digest: "checkpoint-51", sequenceNumber: "51", timestampMs: "1700000000000" },
      },
    }),
    "POST /admin/reviewer-selection/shortlist": (request) => {
      shortlistCalls += 1;
      assert.equal(request.body?.receiptId, requestReceiptId);
      return {
        status: 409,
        body: { error: "reviewer_selection_receipt_id_conflict" },
      };
    },
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-receipt-conflict-"));
  const receiptOut = path.join(tempDir, "must-not-write-receipt.json");
  const publishBodyOut = path.join(tempDir, "must-not-write-publish.json");

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--order-id",
      "order-conflict",
      "--milestone-id",
      "milestone-conflict",
      "--buyer-address",
      `0x${"1".repeat(64)}`,
      "--seller-address",
      `0x${"2".repeat(64)}`,
      "--escrow-object-id",
      `0x${"3".repeat(64)}`,
      "--bond-object-id",
      `0x${"4".repeat(64)}`,
      "--request-receipt-id",
      requestReceiptId,
      "--request-state-file",
      path.join(tempDir, "request-state.json"),
      "--receipt-out",
      receiptOut,
      "--publish-body-out",
      publishBodyOut,
      "--json",
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "reviewer_selection_receipt_id_conflict");
    assert.equal(payload.requestReceiptId, requestReceiptId);
    assert.equal(shortlistCalls, 1);
    assert.equal(existsSync(receiptOut), false);
    assert.equal(existsSync(publishBodyOut), false);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist generates one OPEN receipt id and fails closed on a mismatched response", async () => {
  const responseReceiptId = "00000000-0000-4000-8000-000000000006";
  let requestReceiptId = null;
  const mock = await startMockServer({
    "POST /rpc": (request) => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: request.body?.id ?? 1,
        result:
          request.body?.method === "iota_getLatestCheckpointSequenceNumber"
            ? "52"
            : { digest: "checkpoint-52", sequenceNumber: "52", timestampMs: "1700000000000" },
      },
    }),
    "POST /admin/reviewer-selection/shortlist": (request) => {
      requestReceiptId = request.body?.receiptId;
      assert.match(requestReceiptId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      return {
        status: 200,
        body: {
          selectionComplete: true,
          directoryScanTruncated: false,
          receipt: { id: responseReceiptId, shortlistedReviewerAddresses: [] },
        },
      };
    },
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-receipt-mismatch-"));
  const receiptOut = path.join(tempDir, "must-not-write-receipt.json");
  const publishBodyOut = path.join(tempDir, "must-not-write-publish.json");

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--order-id",
      "order-mismatch",
      "--milestone-id",
      "milestone-mismatch",
      "--buyer-address",
      `0x${"1".repeat(64)}`,
      "--seller-address",
      `0x${"2".repeat(64)}`,
      "--escrow-object-id",
      `0x${"3".repeat(64)}`,
      "--bond-object-id",
      `0x${"4".repeat(64)}`,
      "--request-receipt-id",
      "auto",
      "--request-state-file",
      path.join(tempDir, "request-state.json"),
      "--receipt-out",
      receiptOut,
      "--publish-body-out",
      publishBodyOut,
      "--json",
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "reviewer_shortlist_receipt_id_mismatch");
    assert.equal(payload.requestReceiptId, requestReceiptId);
    assert.equal(payload.receiptId, responseReceiptId);
    assert.equal(payload.receiptOut, null);
    assert.equal(payload.publishBodyOut, null);
    assert.equal(existsSync(receiptOut), false);
    assert.equal(existsSync(publishBodyOut), false);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist binds the full OPEN receipt context before writing artifacts", async () => {
  const reviewers = [
    `0x${"a".repeat(64)}`,
    `0x${"b".repeat(64)}`,
    `0x${"c".repeat(64)}`,
  ];
  let receiptOverrides = {};
  let advancedCheckpointReads = 0;
  const mock = await startMockServer({
    "POST /rpc": (request) => {
      if (request.body?.method === "iota_getLatestCheckpointSequenceNumber") {
        return {
          status: 200,
          body: { jsonrpc: "2.0", id: request.body?.id ?? 1, result: "52" },
        };
      }
      if (request.body?.method === "iota_getCheckpoint") {
        const sequenceNumber = request.body?.params?.[0];
        if (sequenceNumber === "52") {
          return {
            status: 200,
            body: {
              jsonrpc: "2.0",
              id: request.body?.id ?? 1,
              result: { digest: "checkpoint-52", sequenceNumber: "52", timestampMs: "1700000000000" },
            },
          };
        }
        if (sequenceNumber === "53") {
          advancedCheckpointReads += 1;
          return {
            status: 200,
            body: {
              jsonrpc: "2.0",
              id: request.body?.id ?? 1,
              result: { digest: "checkpoint-53", sequenceNumber: "53", timestampMs: "1700000001000" },
            },
          };
        }
      }
      return { status: 404, body: { error: "unexpected_rpc_request" } };
    },
    "POST /admin/reviewer-selection/shortlist": (request) => {
      const receiptId = request.body?.receiptId;
      return {
        status: 200,
        body: {
          selectionComplete: true,
          directoryScanTruncated: false,
          receipt: reviewerSelectionReceipt({
            scope: "OPEN",
            receiptId,
            requestBody: request.body,
            reviewers,
            orderId: "order-bound",
            milestoneId: "milestone-bound",
            checkpointDigest: "checkpoint-52",
            checkpointSequenceNumber: "52",
            overrides: receiptOverrides,
          }),
          publishTarget: {
            route: "/orders/order-bound/milestones/milestone-bound/disputes/open",
            requestPatch: {
              invitedReviewerAddresses: reviewers,
              reviewerSelectionReceiptId: receiptId,
            },
          },
          operatorAuthorizationHandoff: reviewerShortlistAuthorizationHandoff({
            scope: "OPEN",
            receiptId,
            reviewers,
            orderId: "order-bound",
            milestoneId: "milestone-bound",
          }),
        },
      };
    },
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-receipt-binding-"));
  const baseArgs = [
    "reviewer-shortlist",
    "--api-base",
    mock.baseUrl,
    "--rpc-url",
    `${mock.baseUrl}/rpc`,
    "--jwt",
    buildReviewerOperatorJwt(),
    "--order-id",
    "order-bound",
    "--milestone-id",
    "milestone-bound",
    "--buyer-address",
    `0x${"1".repeat(64)}`,
    "--seller-address",
    `0x${"2".repeat(64)}`,
    "--escrow-object-id",
    `0x${"3".repeat(64)}`,
    "--bond-object-id",
    `0x${"4".repeat(64)}`,
  ];
  const invalidCases = [
    {
      name: "scope",
      overrides: { scope: "REPLACEMENT" },
      error: "reviewer_shortlist_receipt_context_mismatch",
    },
    {
      name: "order",
      overrides: { orderId: "order-forged" },
      error: "reviewer_shortlist_receipt_context_mismatch",
    },
    {
      name: "checkpoint",
      overrides: { checkpointDigest: "checkpoint-forged" },
      error: "reviewer_shortlist_receipt_checkpoint_mismatch",
    },
    {
      name: "activated",
      overrides: { activatedAt: "2026-07-13T01:00:00.000Z" },
      error: "reviewer_shortlist_receipt_already_activated",
    },
    {
      name: "request-hash",
      overrides: { requestHash: "9".repeat(64) },
      error: "reviewer_shortlist_receipt_request_hash_mismatch",
    },
    {
      name: "seed-hash",
      overrides: { seedHash: "9".repeat(64) },
      error: "reviewer_shortlist_receipt_hash_mismatch",
    },
    {
      name: "candidate-pool-hash",
      overrides: { candidatePoolHash: "9".repeat(64) },
      error: "reviewer_shortlist_receipt_hash_mismatch",
    },
    {
      name: "shortlist-hash",
      overrides: { shortlistHash: "9".repeat(64) },
      error: "reviewer_shortlist_receipt_hash_mismatch",
    },
    {
      name: "receipt-hash",
      overrides: { receiptHash: "9".repeat(64) },
      error: "reviewer_shortlist_receipt_hash_mismatch",
    },
    {
      name: "authenticated-actor",
      overrides: { createdByActorAddress: `0x${"e".repeat(64)}` },
      error: "reviewer_shortlist_receipt_actor_mismatch",
    },
    {
      name: "candidate-pool-duplicate",
      overrides: {
        candidatePool: [
          { reviewerAddress: reviewers[0], eligible: true },
          { reviewerAddress: reviewers[0], eligible: true },
          { reviewerAddress: reviewers[2], eligible: true },
        ],
      },
      error: "reviewer_shortlist_receipt_candidate_pool_invalid",
    },
    {
      name: "candidate-pool-noncanonical",
      overrides: {
        candidatePool: [
          { reviewerAddress: reviewers[0].toUpperCase().replace("0X", "0x"), eligible: true },
          { reviewerAddress: reviewers[1], eligible: true },
          { reviewerAddress: reviewers[2], eligible: true },
        ],
      },
      error: "reviewer_shortlist_receipt_candidate_pool_invalid",
    },
    {
      name: "requested-filters-missing",
      args: [
        "--blocked-reviewers",
        `0x${"d".repeat(64)}`,
        "--excluded-reviewers",
        `0x${"e".repeat(64)}`,
      ],
      overrides: { blockedReviewerAddresses: [], excludedReviewerAddresses: [] },
      error: "reviewer_shortlist_receipt_filter_mismatch",
    },
    {
      name: "shortlist-party-conflict",
      overrides: {
        shortlistedReviewerAddresses: [`0x${"1".repeat(64)}`, reviewers[1], reviewers[2]],
      },
      error: "reviewer_shortlist_receipt_reviewer_conflict",
    },
    {
      name: "shortlist-filter-conflict",
      overrides: { blockedReviewerAddresses: [reviewers[0]] },
      error: "reviewer_shortlist_receipt_reviewer_conflict",
    },
    {
      name: "shortlist-duplicate",
      overrides: { shortlistedReviewerAddresses: [reviewers[0], reviewers[0], reviewers[2]] },
      error: "reviewer_shortlist_receipt_reviewer_addresses_invalid",
    },
    {
      name: "advanced-checkpoint-digest",
      overrides: {
        checkpointDigest: "checkpoint-53-forged",
        checkpointSequenceNumber: "53",
        checkpointTimestampMs: 1700000001000,
      },
      error: "reviewer_shortlist_receipt_checkpoint_rpc_mismatch",
    },
    {
      name: "advanced-checkpoint-timestamp",
      overrides: {
        checkpointDigest: "checkpoint-53",
        checkpointSequenceNumber: "53",
        checkpointTimestampMs: 1700000001999,
      },
      error: "reviewer_shortlist_receipt_checkpoint_rpc_mismatch",
    },
  ];

  try {
    for (const [index, testCase] of invalidCases.entries()) {
      receiptOverrides = testCase.overrides;
      const receiptOut = path.join(tempDir, `${testCase.name}-receipt.json`);
      const publishBodyOut = path.join(tempDir, `${testCase.name}-publish.json`);
      const result = await runCli([
        ...baseArgs,
        "--request-receipt-id",
        `00000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
        "--request-state-file",
        path.join(tempDir, `${testCase.name}-state.json`),
        "--receipt-out",
        receiptOut,
        "--publish-body-out",
        publishBodyOut,
        ...(testCase.args || []),
        "--json",
      ]);
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).error, testCase.error);
      assert.equal(existsSync(receiptOut), false);
      assert.equal(existsSync(publishBodyOut), false);
    }

    receiptOverrides = {
      blockedReviewerAddresses: [`0x${"d".repeat(64)}`, `0x${"e".repeat(64)}`],
      excludedReviewerAddresses: [`0x${"6".repeat(64)}`, `0x${"7".repeat(64)}`],
    };
    const expandedFilters = await runCli([
      ...baseArgs,
      "--request-receipt-id",
      "00000000-0000-4000-8000-000000000120",
      "--request-state-file",
      path.join(tempDir, "expanded-filters-state.json"),
      "--receipt-out",
      path.join(tempDir, "expanded-filters-receipt.json"),
      "--publish-body-out",
      path.join(tempDir, "expanded-filters-publish.json"),
      "--blocked-reviewers",
      `0x${"d".repeat(64)}`,
      "--excluded-reviewers",
      `0x${"6".repeat(64)}`,
      "--json",
    ]);
    assert.equal(expandedFilters.status, 0, expandedFilters.stdout || expandedFilters.stderr);

    receiptOverrides = {
      checkpointDigest: "checkpoint-53",
      checkpointSequenceNumber: "53",
      checkpointTimestampMs: 1700000001000,
    };
    const advanced = await runCli([
      ...baseArgs,
      "--request-receipt-id",
      "00000000-0000-4000-8000-000000000104",
      "--request-state-file",
      path.join(tempDir, "advanced-state.json"),
      "--receipt-out",
      path.join(tempDir, "advanced-receipt.json"),
      "--publish-body-out",
      path.join(tempDir, "advanced-publish.json"),
      "--json",
    ]);
    assert.equal(advanced.status, 0);
    const advancedPayload = JSON.parse(advanced.stdout);
    assert.equal(advancedPayload.requestedCheckpointDigest, "checkpoint-52");
    assert.equal(advancedPayload.requestedCheckpointSequenceNumber, "52");
    assert.equal(advancedPayload.checkpointDigest, "checkpoint-53");
    assert.equal(advancedPayload.checkpointSequenceNumber, "53");
    assert.ok(advancedPayload.warnings.some((warning) => /receipt_checkpoint_advanced/.test(warning)));
    assert.equal(advancedCheckpointReads, 3);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist reuses the exact owner-only OPEN request state across process retries", async () => {
  const reviewers = [
    `0x${"a".repeat(64)}`,
    `0x${"b".repeat(64)}`,
    `0x${"c".repeat(64)}`,
  ];
  const shortlistBodies = [];
  let latestSequenceReads = 0;
  const mock = await startMockServer({
    "POST /rpc": (request) => {
      if (request.body?.method === "iota_getLatestCheckpointSequenceNumber") {
        latestSequenceReads += 1;
        return {
          status: 200,
          body: { jsonrpc: "2.0", id: request.body?.id ?? 1, result: latestSequenceReads === 1 ? "61" : "62" },
        };
      }
      const sequenceNumber = request.body?.params?.[0];
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: request.body?.id ?? 1,
          result: {
            digest: `checkpoint-${sequenceNumber}`,
            sequenceNumber,
            timestampMs: "1700000000000",
          },
        },
      };
    },
    "POST /admin/reviewer-selection/shortlist": (request) => {
      shortlistBodies.push(request.body);
      if (shortlistBodies.length === 1) {
        return { status: 500, body: { error: "response_lost_after_commit" } };
      }
      const receiptId = request.body?.receiptId;
      return {
        status: 200,
        body: {
          selectionComplete: true,
          directoryScanTruncated: false,
          receipt: reviewerSelectionReceipt({
            scope: "OPEN",
            receiptId,
            requestBody: request.body,
            reviewers,
            orderId: "order-replay",
            milestoneId: "milestone-replay",
            checkpointDigest: "checkpoint-61",
            checkpointSequenceNumber: "61",
          }),
          publishTarget: {
            route: "/orders/order-replay/milestones/milestone-replay/disputes/open",
            requestPatch: {
              invitedReviewerAddresses: reviewers,
              reviewerSelectionReceiptId: receiptId,
            },
          },
          operatorAuthorizationHandoff: reviewerShortlistAuthorizationHandoff({
            scope: "OPEN",
            receiptId,
            reviewers,
            orderId: "order-replay",
            milestoneId: "milestone-replay",
          }),
        },
      };
    },
  });
  const targetDriftMock = await startMockServer({
    default: () => ({ status: 500, body: { error: "must_not_contact_drift_target" } }),
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-process-replay-"));
  const requestStateFile = path.join(tempDir, "open-request-state.json");
  const receiptOut = path.join(tempDir, "receipt.json");
  const publishBodyOut = path.join(tempDir, "publish.json");
  const baseArgs = [
    "reviewer-shortlist",
    "--api-base",
    mock.baseUrl,
    "--rpc-url",
    `${mock.baseUrl}/rpc`,
    "--jwt",
    buildReviewerOperatorJwt(),
    "--order-id",
    "order-replay",
    "--milestone-id",
    "milestone-replay",
    "--buyer-address",
    `0x${"1".repeat(64)}`,
    "--seller-address",
    `0x${"2".repeat(64)}`,
    "--escrow-object-id",
    `0x${"3".repeat(64)}`,
    "--bond-object-id",
    `0x${"4".repeat(64)}`,
    "--request-state-file",
    requestStateFile,
    "--receipt-out",
    receiptOut,
    "--publish-body-out",
    publishBodyOut,
  ];

  try {
    const first = await runCli([...baseArgs, "--json"]);
    assert.equal(first.status, 1);
    const firstPayload = JSON.parse(first.stdout);
    assert.equal(firstPayload.error, "response_lost_after_commit");
    assert.equal(firstPayload.requestStateFile, requestStateFile);
    assert.equal(existsSync(requestStateFile), true);
    assert.equal(statSync(requestStateFile).mode & 0o777, 0o600);
    const storedState = JSON.parse(readFileSync(requestStateFile, "utf8"));
    assert.equal(storedState.format, "clawnera.reviewer-shortlist.open-request.v2");
    assert.deepEqual(storedState.requestTarget, { apiBase: mock.baseUrl });
    assert.equal(storedState.requestBody.checkpointDigest, "checkpoint-61");
    assert.equal(storedState.requestBody.receiptId, firstPayload.requestReceiptId);
    assert.equal(storedState.publishContext.escrowObjectId, `0x${"3".repeat(64)}`);
    assert.equal(storedState.publishContext.bondObjectId, `0x${"4".repeat(64)}`);

    const targetDrift = await runCli([
      ...baseArgs,
      "--api-base",
      `${targetDriftMock.baseUrl}/`,
      "--rpc-url",
      `${targetDriftMock.baseUrl}/rpc`,
      "--json",
    ]);
    assert.equal(targetDrift.status, 1);
    const targetDriftPayload = JSON.parse(targetDrift.stdout);
    assert.equal(targetDriftPayload.error, "reviewer_open_request_target_mismatch");
    assert.deepEqual(targetDriftPayload.expectedRequestTarget, { apiBase: mock.baseUrl });
    assert.deepEqual(targetDriftPayload.actualRequestTarget, { apiBase: targetDriftMock.baseUrl });
    assert.equal(targetDriftMock.requests.length, 0);
    assert.equal(shortlistBodies.length, 1);

    const drifted = await runCli([...baseArgs, "--reviewer-count", "4", "--json"]);
    assert.equal(drifted.status, 1);
    assert.equal(JSON.parse(drifted.stdout).error, "reviewer_open_request_state_mismatch");
    assert.equal(shortlistBodies.length, 1);

    const receiptDrift = await runCli([
      ...baseArgs,
      "--request-receipt-id",
      "00000000-0000-4000-8000-000000000099",
      "--json",
    ]);
    assert.equal(receiptDrift.status, 1);
    assert.equal(JSON.parse(receiptDrift.stdout).error, "request_receipt_id_state_mismatch");
    assert.equal(shortlistBodies.length, 1);

    const publishContextDrift = await runCli([
      ...baseArgs,
      "--escrow-object-id",
      `0x${"5".repeat(64)}`,
      "--json",
    ]);
    assert.equal(publishContextDrift.status, 1);
    assert.equal(JSON.parse(publishContextDrift.stdout).error, "reviewer_open_request_state_mismatch");
    assert.equal(shortlistBodies.length, 1);

    const replay = await runCli([...baseArgs, "--json"]);
    assert.equal(replay.status, 0);
    const replayPayload = JSON.parse(replay.stdout);
    assert.equal(replayPayload.requestReceiptId, firstPayload.requestReceiptId);
    assert.equal(replayPayload.requestStateFile, requestStateFile);
    assert.equal(replayPayload.checkpointDigest, "checkpoint-61");
    assert.equal(latestSequenceReads, 1);
    assert.equal(shortlistBodies.length, 2);
    assert.deepEqual(shortlistBodies[1], shortlistBodies[0]);
    assert.equal(existsSync(receiptOut), true);
    assert.equal(existsSync(publishBodyOut), true);
  } finally {
    await mock.close();
    await targetDriftMock.close();
  }
});

test("reviewer-shortlist permits only one concurrent OPEN request-state initializer to POST", async () => {
  const reviewers = [
    `0x${"a".repeat(64)}`,
    `0x${"b".repeat(64)}`,
    `0x${"c".repeat(64)}`,
  ];
  const shortlistBodies = [];
  let latestSequenceReads = 0;
  let releaseLatestSequenceReads;
  const latestSequenceBarrier = new Promise((resolve) => {
    releaseLatestSequenceReads = resolve;
  });
  const mock = await startMockServer({
    "POST /rpc": async (request) => {
      if (request.body?.method === "iota_getLatestCheckpointSequenceNumber") {
        latestSequenceReads += 1;
        if (latestSequenceReads === 2) {
          releaseLatestSequenceReads();
        }
        await latestSequenceBarrier;
        return {
          status: 200,
          body: { jsonrpc: "2.0", id: request.body?.id ?? 1, result: "71" },
        };
      }
      assert.equal(request.body?.method, "iota_getCheckpoint");
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: request.body?.id ?? 1,
          result: { digest: "checkpoint-71", sequenceNumber: "71", timestampMs: "1700000000000" },
        },
      };
    },
    "POST /admin/reviewer-selection/shortlist": (request) => {
      shortlistBodies.push(request.body);
      const receiptId = request.body?.receiptId;
      return {
        status: 200,
        body: {
          selectionComplete: true,
          directoryScanTruncated: false,
          receipt: reviewerSelectionReceipt({
            scope: "OPEN",
            receiptId,
            requestBody: request.body,
            reviewers,
            orderId: "order-concurrent",
            milestoneId: "milestone-concurrent",
            checkpointDigest: "checkpoint-71",
            checkpointSequenceNumber: "71",
          }),
          publishTarget: {
            route: "/orders/order-concurrent/milestones/milestone-concurrent/disputes/open",
            requestPatch: {
              invitedReviewerAddresses: reviewers,
              reviewerSelectionReceiptId: receiptId,
            },
          },
          operatorAuthorizationHandoff: reviewerShortlistAuthorizationHandoff({
            scope: "OPEN",
            receiptId,
            reviewers,
            orderId: "order-concurrent",
            milestoneId: "milestone-concurrent",
          }),
        },
      };
    },
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-concurrent-init-"));
  const requestStateFile = path.join(tempDir, "request-state.json");
  const baseArgs = [
    "reviewer-shortlist",
    "--api-base",
    mock.baseUrl,
    "--rpc-url",
    `${mock.baseUrl}/rpc`,
    "--jwt",
    buildReviewerOperatorJwt(),
    "--order-id",
    "order-concurrent",
    "--milestone-id",
    "milestone-concurrent",
    "--buyer-address",
    `0x${"1".repeat(64)}`,
    "--seller-address",
    `0x${"2".repeat(64)}`,
    "--escrow-object-id",
    `0x${"3".repeat(64)}`,
    "--bond-object-id",
    `0x${"4".repeat(64)}`,
    "--request-state-file",
    requestStateFile,
  ];
  const firstReceiptId = "00000000-0000-4000-8000-000000000071";
  const secondReceiptId = "00000000-0000-4000-8000-000000000072";

  try {
    const results = await Promise.all([
      runCli([
        ...baseArgs,
        "--request-receipt-id",
        firstReceiptId,
        "--receipt-out",
        path.join(tempDir, "receipt-a.json"),
        "--publish-body-out",
        path.join(tempDir, "publish-a.json"),
        "--json",
      ]),
      runCli([
        ...baseArgs,
        "--request-receipt-id",
        secondReceiptId,
        "--receipt-out",
        path.join(tempDir, "receipt-b.json"),
        "--publish-body-out",
        path.join(tempDir, "publish-b.json"),
        "--json",
      ]),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [0, 1]);
    const payloads = results.map((result) => JSON.parse(result.stdout));
    const failed = payloads.find((payload) => !payload.ok);
    const succeeded = payloads.find((payload) => payload.ok);
    assert.equal(failed.error, "reviewer_open_request_state_initialized_concurrently");
    assert.ok(succeeded);
    assert.equal(latestSequenceReads, 2);
    assert.equal(shortlistBodies.length, 1);
    assert.equal(shortlistBodies[0].receiptId, succeeded.requestReceiptId);
    const storedState = JSON.parse(readFileSync(requestStateFile, "utf8"));
    assert.equal(storedState.requestBody.receiptId, succeeded.requestReceiptId);
    assert.deepEqual(storedState.requestTarget, { apiBase: mock.baseUrl });
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist never rolls back a concurrently advanced OPEN checkpoint state", async () => {
  const requestReceiptId = "00000000-0000-4000-8000-000000000073";
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-checkpoint-cas-"));
  const requestStateFile = path.join(tempDir, "request-state.json");
  const receiptOut = path.join(tempDir, "must-not-write-receipt.json");
  const publishBodyOut = path.join(tempDir, "must-not-write-publish.json");
  let shortlistCalls = 0;
  const mock = await startMockServer({
    "POST /rpc": (request) => {
      const sequenceNumber = request.body?.params?.[0];
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: request.body?.id ?? 1,
          result:
            request.body?.method === "iota_getLatestCheckpointSequenceNumber"
              ? "71"
              : sequenceNumber === "72"
                ? { digest: "checkpoint-72", sequenceNumber: "72", timestampMs: "1700000001000" }
                : { digest: "checkpoint-71", sequenceNumber: "71", timestampMs: "1700000000000" },
        },
      };
    },
    "POST /admin/reviewer-selection/shortlist": () => {
      shortlistCalls += 1;
      const advancedState = JSON.parse(readFileSync(requestStateFile, "utf8"));
      advancedState.checkpoint = {
        digest: "checkpoint-73",
        sequenceNumber: "73",
        timestampMs: null,
      };
      advancedState.requestBody.checkpointDigest = "checkpoint-73";
      writeFileSync(requestStateFile, `${JSON.stringify(advancedState, null, 2)}\n`, { mode: 0o600 });
      return {
        status: 409,
        body: {
          error: "checkpoint_digest_mismatch",
          latestCheckpointDigest: "checkpoint-72",
          latestCheckpointSequenceNumber: "72",
        },
      };
    },
  });

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--order-id",
      "order-cas",
      "--milestone-id",
      "milestone-cas",
      "--buyer-address",
      `0x${"1".repeat(64)}`,
      "--seller-address",
      `0x${"2".repeat(64)}`,
      "--escrow-object-id",
      `0x${"3".repeat(64)}`,
      "--bond-object-id",
      `0x${"4".repeat(64)}`,
      "--request-receipt-id",
      requestReceiptId,
      "--request-state-file",
      requestStateFile,
      "--receipt-out",
      receiptOut,
      "--publish-body-out",
      publishBodyOut,
      "--json",
    ]);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error, "reviewer_open_request_state_update_conflict");
    assert.equal(shortlistCalls, 1);
    const storedState = JSON.parse(readFileSync(requestStateFile, "utf8"));
    assert.equal(storedState.checkpoint.digest, "checkpoint-73");
    assert.equal(storedState.requestBody.checkpointDigest, "checkpoint-73");
    assert.equal(existsSync(receiptOut), false);
    assert.equal(existsSync(publishBodyOut), false);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist rejects checkpoint digests containing whitespace or control characters", async () => {
  let rejectInitialDigest = true;
  let shortlistCalls = 0;
  const mock = await startMockServer({
    "POST /rpc": (request) => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: request.body?.id ?? 1,
        result:
          request.body?.method === "iota_getLatestCheckpointSequenceNumber"
            ? "81"
            : {
                digest: rejectInitialDigest ? "checkpoint-81 " : "checkpoint-81",
                sequenceNumber: "81",
                timestampMs: "1700000000000",
              },
      },
    }),
    "POST /admin/reviewer-selection/shortlist": () => {
      shortlistCalls += 1;
      return {
        status: 409,
        body: {
          error: "checkpoint_digest_mismatch",
          latestCheckpointDigest: "checkpoint-82\u0001forged",
          latestCheckpointSequenceNumber: "82",
        },
      };
    },
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-checkpoint-digest-"));
  const initialStateFile = path.join(tempDir, "must-not-write-initial-state.json");
  const mismatchStateFile = path.join(tempDir, "mismatch-state.json");
  const receiptOut = path.join(tempDir, "must-not-write-receipt.json");
  const publishBodyOut = path.join(tempDir, "must-not-write-publish.json");
  const baseArgs = [
    "reviewer-shortlist",
    "--api-base",
    mock.baseUrl,
    "--rpc-url",
    `${mock.baseUrl}/rpc`,
    "--jwt",
    buildReviewerOperatorJwt(),
    "--order-id",
    "order-invalid-checkpoint",
    "--milestone-id",
    "milestone-invalid-checkpoint",
    "--buyer-address",
    `0x${"1".repeat(64)}`,
    "--seller-address",
    `0x${"2".repeat(64)}`,
    "--escrow-object-id",
    `0x${"3".repeat(64)}`,
    "--bond-object-id",
    `0x${"4".repeat(64)}`,
    "--receipt-out",
    receiptOut,
    "--publish-body-out",
    publishBodyOut,
  ];

  try {
    const invalidInitial = await runCli([
      ...baseArgs,
      "--request-receipt-id",
      "00000000-0000-4000-8000-000000000081",
      "--request-state-file",
      initialStateFile,
      "--json",
    ]);
    assert.equal(invalidInitial.status, 1);
    assert.equal(JSON.parse(invalidInitial.stdout).error, "invalid_checkpoint_payload");
    assert.equal(shortlistCalls, 0);
    assert.equal(existsSync(initialStateFile), false);
    assert.equal(existsSync(receiptOut), false);
    assert.equal(existsSync(publishBodyOut), false);

    rejectInitialDigest = false;
    const invalidMismatch = await runCli([
      ...baseArgs,
      "--request-receipt-id",
      "00000000-0000-4000-8000-000000000082",
      "--request-state-file",
      mismatchStateFile,
      "--json",
    ]);
    assert.equal(invalidMismatch.status, 1);
    assert.equal(
      JSON.parse(invalidMismatch.stdout).error,
      "invalid_reviewer_checkpoint_mismatch_payload",
    );
    assert.equal(shortlistCalls, 1);
    const storedState = JSON.parse(readFileSync(mismatchStateFile, "utf8"));
    assert.equal(storedState.checkpoint.digest, "checkpoint-81");
    assert.equal(storedState.requestBody.checkpointDigest, "checkpoint-81");
    assert.equal(existsSync(receiptOut), false);
    assert.equal(existsSync(publishBodyOut), false);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist replacement continues when dispute pre-read is forbidden and uses the admin shortlist route", async () => {
  const disputeCaseObjectId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const mock = await startMockServer({
    "GET /policy/fees": () => ({
      status: 200,
      body: buildFreshMarketplacePolicyResponse(),
    }),
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
        }
      }
    }),
    [`GET /disputes/${disputeCaseObjectId}`]: () => ({
      status: 403,
      body: {
        error: "forbidden"
      }
    }),
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getLatestCheckpointSequenceNumber") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: "51"
          }
        };
      }
      if (method === "iota_getCheckpoint") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              digest: "checkpoint-replacement",
              sequenceNumber: "51",
              timestampMs: "1773917000000"
            }
          }
        };
      }
      if (method === "iota_getObject") {
        assert.equal(
          request.body?.params?.[0],
          "0x3333333333333333333333333333333333333333333333333333333333333333"
        );
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              data: {
                objectId: "0x3333333333333333333333333333333333333333333333333333333333333333",
                previousTransaction: "init-reviewer-registry-1",
                content: {
                  fields: {
                    default_required_reviewer_votes: "3",
                    min_required_reviewer_votes: "3",
                    min_dispute_bond_per_side_iota: "500000",
                    reviewer_min_stake_iota: "500000"
                  }
                }
              }
            }
          }
        };
      }
      throw new Error(`unexpected_rpc_method:${String(method)}`);
    },
    "POST /admin/reviewer-selection/shortlist": (request) => {
      assert.equal(request.headers.authorization, `Bearer ${buildReviewerOperatorJwt()}`);
      assert.equal(request.body?.scope, "REPLACEMENT");
      assert.equal(request.body?.receiptId, undefined);
      assert.equal(request.body?.disputeCaseObjectId, disputeCaseObjectId);
      assert.equal(request.body?.reviewerCount, 3);
      return {
        status: 200,
        body: {
          selectionComplete: true,
          directoryScanTruncated: false,
          receipt: reviewerSelectionReceipt({
            scope: "REPLACEMENT",
            receiptId: "00000000-0000-4000-8000-000000000091",
            requestBody: request.body,
            reviewers: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            ],
            disputeCaseObjectId,
            checkpointDigest: "checkpoint-replacement",
            checkpointSequenceNumber: "51",
            checkpointTimestampMs: 1773917000000,
          }),
          publishTarget: {
            route: `/disputes/${disputeCaseObjectId}/reviewers/replace`,
            requestPatch: {
              invitedReviewerAddresses: [
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
              ],
              reviewerSelectionReceiptId: "00000000-0000-4000-8000-000000000091"
            }
          },
          operatorAuthorizationHandoff: reviewerShortlistAuthorizationHandoff({
            scope: "REPLACEMENT",
            receiptId: "00000000-0000-4000-8000-000000000091",
            reviewers: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            ],
            disputeCaseObjectId
          })
        }
      };
    }
  });

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--scope",
      "REPLACEMENT",
      "--dispute-case-id",
      disputeCaseObjectId,
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.scope, "REPLACEMENT");
    assert.equal(payload.receiptId, "00000000-0000-4000-8000-000000000091");
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(
      payload.warnings.some((entry) =>
        /replacement_dispute_pre_read_failed status=403 error=forbidden/.test(entry)
      )
    );
    assert.equal(payload.publishReady, false);
    assert.equal(payload.nextPublishHint, null);
    assert.match(payload.nextPostAuthorizationDryRunHint, /\/disputes\/0x[a-f0-9]+\/reviewers\/replace/);
    const publishBody = JSON.parse(readFileSync(payload.publishBodyOut, "utf8"));
    assert.deepEqual(publishBody, {
      reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
      invitedReviewerAddresses: [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      ],
      reviewerSelectionReceiptId: "00000000-0000-4000-8000-000000000091"
    });
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist replacement retries dispute pre-read with publish auth state when operator auth is forbidden", async () => {
  const disputeCaseObjectId = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  const publishJwt = buildJwtWithExp(4102444800);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-shortlist-replacement-auth-"));
  const publishAuthStateFile = path.join(tempDir, "seller-auth-state.json");

  let disputeReadCount = 0;
  const mock = await startMockServer({
    "GET /policy/fees": () => ({
      status: 200,
      body: buildFreshMarketplacePolicyResponse(),
    }),
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
        }
      }
    }),
    [`GET /disputes/${disputeCaseObjectId}`]: (request) => {
      disputeReadCount += 1;
      if (request.headers.authorization === `Bearer ${buildReviewerOperatorJwt()}`) {
        return {
          status: 403,
          body: {
            error: "forbidden"
          }
        };
      }
      assert.equal(request.headers.authorization, `Bearer ${publishJwt}`);
      return {
        status: 200,
        body: {
          disputeCase: {
            objectId: disputeCaseObjectId,
            state: 1,
            requiredReviewerVotes: 3,
            revealDeadlineMs: 4102444800000
          }
        }
      };
    },
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getLatestCheckpointSequenceNumber") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: "51"
          }
        };
      }
      if (method === "iota_getCheckpoint") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              digest: "checkpoint-replacement",
              sequenceNumber: "51",
              timestampMs: "1773917000000"
            }
          }
        };
      }
      if (method === "iota_getObject") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              data: {
                objectId: "0x3333333333333333333333333333333333333333333333333333333333333333",
                previousTransaction: "init-reviewer-registry-1",
                content: {
                  fields: {
                    default_required_reviewer_votes: "3",
                    min_required_reviewer_votes: "3",
                    min_dispute_bond_per_side_iota: "500000",
                    reviewer_min_stake_iota: "500000"
                  }
                }
              }
            }
          }
        };
      }
      throw new Error(`unexpected_rpc_method:${String(method)}`);
    },
    "POST /admin/reviewer-selection/shortlist": (request) => ({
      status: 200,
      body: {
        selectionComplete: true,
        directoryScanTruncated: false,
        receipt: reviewerSelectionReceipt({
          scope: "REPLACEMENT",
          receiptId: "00000000-0000-4000-8000-000000000093",
          requestBody: request.body,
          reviewers: [
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
          ],
          disputeCaseObjectId,
          checkpointDigest: "checkpoint-replacement",
          checkpointSequenceNumber: "51",
          checkpointTimestampMs: 1773917000000,
        }),
        publishTarget: {
          route: `/disputes/${disputeCaseObjectId}/reviewers/replace`,
          requestPatch: {
            invitedReviewerAddresses: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            ],
            reviewerSelectionReceiptId: "00000000-0000-4000-8000-000000000093"
          }
        },
        operatorAuthorizationHandoff: reviewerShortlistAuthorizationHandoff({
          scope: "REPLACEMENT",
          receiptId: "00000000-0000-4000-8000-000000000093",
          reviewers: [
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
          ],
          disputeCaseObjectId
        })
      }
    })
  });
  writeFileSync(
    publishAuthStateFile,
    JSON.stringify({
      jwt: publishJwt,
      refreshToken: "refresh-token",
      actorAddress: "0xa3679f3684bb2c74e50bf1ca8d1818a112f4e58a5418cbd7856e9d8300e79c1d",
      apiBase: mock.baseUrl
    }),
    "utf8"
  );

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--scope",
      "REPLACEMENT",
      "--dispute-case-id",
      disputeCaseObjectId,
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--publish-auth-state-file",
      publishAuthStateFile,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(disputeReadCount, 2);
    assert.ok(payload.warnings.some((entry) => /replacement_dispute_pre_read_used_publish_auth_state/.test(entry)));
    assert.ok(payload.warnings.some((entry) => /replacement_not_ready state=commit_phase/.test(entry)));
    assert.equal(payload.replacementReadyAtIso, "2100-01-01T00:00:00.000Z");
    assert.equal(payload.requiredReviewerVotes, 3);
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist replacement surfaces wait-until warning when the live round is still in commit phase", async () => {
  const disputeCaseObjectId = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const revealDeadlineMs = 4102444800000;
  const mock = await startMockServer({
    "GET /policy/fees": () => ({
      status: 200,
      body: buildFreshMarketplacePolicyResponse(),
    }),
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
        }
      }
    }),
    [`GET /disputes/${disputeCaseObjectId}`]: () => ({
      status: 200,
      body: {
        disputeCase: {
          objectId: disputeCaseObjectId,
          state: 1,
          requiredReviewerVotes: 3,
          revealDeadlineMs
        }
      }
    }),
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getLatestCheckpointSequenceNumber") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: "51"
          }
        };
      }
      if (method === "iota_getCheckpoint") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              digest: "checkpoint-replacement",
              sequenceNumber: "51",
              timestampMs: "1773917000000"
            }
          }
        };
      }
      if (method === "iota_getObject") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              data: {
                objectId: "0x3333333333333333333333333333333333333333333333333333333333333333",
                previousTransaction: "init-reviewer-registry-1",
                content: {
                  fields: {
                    default_required_reviewer_votes: "3",
                    min_required_reviewer_votes: "3",
                    min_dispute_bond_per_side_iota: "500000",
                    reviewer_min_stake_iota: "500000"
                  }
                }
              }
            }
          }
        };
      }
      throw new Error(`unexpected_rpc_method:${String(method)}`);
    },
    "POST /admin/reviewer-selection/shortlist": (request) => ({
      status: 200,
      body: {
        selectionComplete: true,
        directoryScanTruncated: false,
        receipt: reviewerSelectionReceipt({
          scope: "REPLACEMENT",
          receiptId: "00000000-0000-4000-8000-000000000092",
          requestBody: request.body,
          reviewers: [
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
          ],
          disputeCaseObjectId,
          checkpointDigest: "checkpoint-replacement",
          checkpointSequenceNumber: "51",
          checkpointTimestampMs: 1773917000000,
        }),
        publishTarget: {
          route: `/disputes/${disputeCaseObjectId}/reviewers/replace`,
          requestPatch: {
            invitedReviewerAddresses: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            ],
            reviewerSelectionReceiptId: "00000000-0000-4000-8000-000000000092"
          }
        },
        operatorAuthorizationHandoff: reviewerShortlistAuthorizationHandoff({
          scope: "REPLACEMENT",
          receiptId: "00000000-0000-4000-8000-000000000092",
          reviewers: [
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
          ],
          disputeCaseObjectId
        })
      }
    })
  });

  try {
    const result = await runCli([
      "reviewer-shortlist",
      "--scope",
      "REPLACEMENT",
      "--dispute-case-id",
      disputeCaseObjectId,
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      buildReviewerOperatorJwt(),
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.replacementReadyAtMs, revealDeadlineMs);
    assert.equal(payload.replacementReadyAtIso, "2100-01-01T00:00:00.000Z");
    assert.ok(payload.warnings.some((entry) => /replacement_not_ready state=commit_phase/.test(entry)));
    assert.ok(payload.warnings.some((entry) => /wait_until=2100-01-01T00:00:00.000Z/.test(entry)));
  } finally {
    await mock.close();
  }
});

test("request refreshes one invalid_token response from saved auth state and retries", async () => {
  let protectedReads = 0;
  const mock = await startMockServer({
    "GET /actors/me/capabilities": (request) => {
      protectedReads += 1;
      if (protectedReads === 1) {
        assert.equal(request.headers.authorization, `Bearer ${buildJwtWithExp(1)}`);
        return { status: 401, body: { error: "invalid_token" } };
      }
      assert.equal(request.headers.authorization, `Bearer ${buildJwtWithExp(4102444800)}`);
      return { status: 200, body: { ok: true, actor: { canBid: true } } };
    },
    "POST /auth/refresh": (request) => {
      assert.equal(request.body?.refreshToken, "refresh-token-1");
      return {
        status: 200,
        body: {
          token: buildJwtWithExp(4102444800),
          refreshToken: "refresh-token-2",
          expiresAtMs: 4102444800000
        }
      };
    }
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-request-refresh-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(1),
        refreshToken: "refresh-token-1",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "bot"
      },
      null,
      2
    ),
  );

  try {
    const result = await runCli([
      "request",
      "GET",
      "/actors/me/capabilities",
      "--auth-state-file",
      authStateFile,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.authStateRefreshed, true);
    assert.equal(payload.status, 200);
    const saved = JSON.parse(readFileSync(authStateFile, "utf8"));
    assert.equal(saved.token, buildJwtWithExp(4102444800));
    assert.equal(saved.refreshToken, "refresh-token-2");
  } finally {
    await mock.close();
  }
});

test("request can persist the response body to a file", async () => {
  const mock = await startMockServer({
    "GET /orders/test": () => ({
      status: 200,
      body: {
        order: {
          id: "test",
          status: "IN_PROGRESS"
        }
      }
    })
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-request-response-out-"));
  const envFile = path.join(tempDir, "auth.env");
  const responseOut = path.join(tempDir, "order.json");
  writeFileSync(
    envFile,
    `CLAWNERA_API_BASE_URL=${mock.baseUrl}\nCLAWNERA_API_JWT=${buildJwtWithExp(4102444800)}\n`,
  );

  try {
    const result = await runCli([
      "request",
      "GET",
      "/orders/test",
      "--env-file",
      envFile,
      "--response-out",
      responseOut,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.responseOut, responseOut);
    const saved = JSON.parse(readFileSync(responseOut, "utf8"));
    assert.equal(saved.order.id, "test");
    assert.equal(saved.order.status, "IN_PROGRESS");
  } finally {
    await mock.close();
  }
});

test("request accepts CLAWNERA_AUTH_STATE_FILE from the shell without an explicit flag", async () => {
  const mock = await startMockServer({
    "GET /auth/session": (request) => {
      assert.equal(request.headers.authorization, `Bearer ${buildJwtWithExp(4102444800)}`);
      return {
        status: 200,
        body: {
          ok: true,
          session: {
            refreshAvailable: true,
          },
        },
      };
    },
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-request-auth-state-env-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "bot",
      },
      null,
      2,
    ),
  );

  try {
    const result = await runCli(["request", "GET", "/auth/session", "--json"], {
      CLAWNERA_AUTH_STATE_FILE: authStateFile,
    });
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, 200);
    assert.equal(payload.authStateFile, authStateFile);
    assert.equal(payload.response?.session?.refreshAvailable, true);
  } finally {
    await mock.close();
  }
});

test("request surfaces response headers and recommended poll interval hints", async () => {
  const mock = await startMockServer({
    "GET /reviewers/me/invites": () => ({
      status: 200,
      headers: {
        "x-clawdex-recommended-poll-interval-ms": "30000",
        "retry-after": "5"
      },
      body: {
        invites: [],
        nextPollAfterMs: 45000
      }
    })
  });

  try {
    const result = await runCli([
      "request",
      "GET",
      "/reviewers/me/invites",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.headers["x-clawdex-recommended-poll-interval-ms"], "30000");
    assert.equal(payload.recommendedPollIntervalMs, 30000);
    assert.equal(payload.nextPollAfterMs, 45000);
    assert.equal(payload.retryAfterMs, 5000);
  } finally {
    await mock.close();
  }
});

test("request falls back to body nextPollAfterMs when the response header is absent", async () => {
  const mock = await startMockServer({
    "GET /orders": () => ({
      status: 200,
      body: {
        items: [],
        nextCursor: null,
        nextPollAfterMs: 30000
      }
    })
  });

  try {
    const result = await runCli([
      "request",
      "GET",
      "/orders",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.recommendedPollIntervalMs, 30000);
    assert.equal(payload.nextPollAfterMs, 30000);
  } finally {
    await mock.close();
  }
});

test("reviewer-invites helper surfaces invite counts and poll interval", async () => {
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  const mock = await startMockServer({
    "GET /reviewers/me/invites": () => ({
      status: 200,
      headers: {
        "x-clawdex-recommended-poll-interval-ms": "45000"
      },
      body: {
        invites: [
          {
            reviewerAddress,
            disputeCaseObjectId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            status: "invited"
          },
          {
            reviewerAddress,
            disputeCaseObjectId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            status: "closed"
          }
        ]
      }
    })
  });

  try {
    const result = await runCli([
      "reviewer-invites",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.inviteCount, 2);
    assert.equal(payload.actionableInviteCount, 1);
    assert.equal(payload.closedInviteCount, 1);
    assert.equal(payload.recommendedPollIntervalMs, 45000);
    assert.equal(payload.inviteStates.invited, 1);
    assert.equal(payload.inviteStates.closed, 1);
  } finally {
    await mock.close();
  }
});

test("listing-create infers creator address and posts a canonical body", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const expiresAtMs = 1893456000000;
  const mock = await startMockServer({
    "POST /listings": (request) => ({
      status: 200,
      body: {
        listing: {
          id: "listing-1"
        },
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "OFFER",
      "--title",
      "Two tiny IOTA text tasks",
      "--description",
      "Manual live flow test listing.",
      "--category",
      "ops",
      "--currency",
      "IOTA",
      "--expires-at-ms",
      String(expiresAtMs),
      "--milestones",
      "Milestone 1:500000000;Milestone 2:500000000",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.listingId, "listing-1");
    assert.equal(payload.creatorAddress, creatorAddress);
    assert.equal(payload.budgetAmount, "1000000000");
    assert.deepEqual(payload.response.seen, {
      creatorAddress,
      title: "Two tiny IOTA text tasks",
      description: "Manual live flow test listing.",
      category: "ops",
      listingMode: "OFFER",
      currency: "IOTA",
      budgetAmount: "1000000000",
      expiresAtMs,
      milestones: [
        { title: "Milestone 1", amount: "500000000", dueAtMs: TEST_LISTING_DUE_AT_MS_1 },
        { title: "Milestone 2", amount: "500000000", dueAtMs: TEST_LISTING_DUE_AT_MS_2 }
      ]
    });
  } finally {
    await mock.close();
  }
});

test("listing-create forwards listing deposit binding fields when provided", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-deposit-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const listingDepositObjectId = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const listingDepositTxDigest = "5fW43PjLzWkVhQyWn1H1zFRNctbq2b4pV6x4Up6gYgHk";
  const mock = await startMockServer({
    "POST /listings": (request) => ({
      status: 200,
      body: {
        listing: {
          id: "listing-with-deposit-1"
        },
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "OFFER",
      "--title",
      "Deposit-bound listing",
      "--description",
      "Listing create should forward the on-chain deposit binding.",
      "--category",
      "ops",
      "--currency",
      "IOTA",
      "--expires-at-ms",
      "1893456000000",
      "--listing-deposit-object-id",
      listingDepositObjectId,
      "--listing-deposit-tx-digest",
      listingDepositTxDigest,
      "--milestones",
      "Milestone 1:500000000;Milestone 2:500000000",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.response.seen.listingDepositObjectId, listingDepositObjectId);
    assert.equal(payload.response.seen.listingDepositTxDigest, listingDepositTxDigest);
  } finally {
    await mock.close();
  }
});

test("listing-categories reads canonical category slugs", async () => {
  const mock = await startMockServer({
    "GET /listings/categories": () => ({
      status: 200,
      body: {
        items: [
          { category: "dev", count: 1 },
          { category: "ops", count: 2 },
          { category: "other", count: 0 }
        ]
      }
    })
  });

  try {
    const result = await runCli([
      "listing-categories",
      "--api-base",
      mock.baseUrl,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.validCategories, ["dev", "ops", "other"]);
    assert.equal(payload.items[1].category, "ops");
  } finally {
    await mock.close();
  }
});

test("listing-categories forwards explicit request mode filters", async () => {
  const mock = await startMockServer({
    "GET /listings/categories?listingMode=REQUEST": () => ({
      status: 200,
      body: {
        items: [{ category: "ops", count: 2 }]
      }
    })
  });

  try {
    const result = await runCli([
      "listing-categories",
      "--api-base",
      mock.baseUrl,
      "--listing-mode",
      "REQUEST",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.listingMode, "REQUEST");
    assert.deepEqual(payload.validCategories, ["ops"]);
  } finally {
    await mock.close();
  }
});

test("listing-create converts display values into atomic amounts", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-display-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const mock = await startMockServer({
    "POST /listings": (request) => ({
      status: 200,
      body: {
        listing: {
          id: "listing-display-1"
        },
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "OFFER",
      "--title",
      "Two empty txt files",
      "--description",
      "Human units test.",
      "--category",
      "other",
      "--currency",
      "IOTA",
      "--display-values",
      "--use-default-expiry",
      "--milestones",
      "file1.txt:1;file2.txt:1",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.budgetAmount, "2000000000");
    assert.equal(payload.expiresAtMs, null);
    assert.equal(payload.expiresAt, null);
    assert.equal(payload.explicitExpiry, false);
    assert.equal(Object.hasOwn(payload.response.seen, "expiresAtMs"), false);
    assert.deepEqual(payload.response.seen.milestones, [
      { title: "file1.txt", amount: "1000000000", dueAtMs: TEST_LISTING_DUE_AT_MS_1 },
      { title: "file2.txt", amount: "1000000000", dueAtMs: TEST_LISTING_DUE_AT_MS_2 }
    ]);
  } finally {
    await mock.close();
  }
});

test("listing-create stops early when only one milestone is supplied", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-one-milestone-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "http://127.0.0.1:9",
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "seller"
      },
      null,
      2
    )
  );

  const result = await runCli([
    "listing-create",
    "--auth-state-file",
    authStateFile,
    "--listing-mode",
    "OFFER",
    "--title",
    "One empty txt",
    "--description",
    "Single milestone should stop locally.",
    "--category",
    "other",
    "--currency",
    "IOTA",
    "--display-values",
    "--use-default-expiry",
    "--milestones",
    "empty txt:1",
    "--json"
  ]);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "listing_milestones_count_out_of_range");
});

test("listing-create accepts display values with an explicit currency suffix", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-display-suffix-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const mock = await startMockServer({
    "POST /listings": (request) => ({
      status: 200,
      body: {
        listing: {
          id: "listing-display-2"
        },
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "OFFER",
      "--title",
      "Two empty txt files",
      "--description",
      "Human units with suffix test.",
      "--category",
      "other",
      "--currency",
      "IOTA",
      "--display-values",
      "--use-default-expiry",
      "--milestones",
      "file1.txt:1 IOTA;file2.txt:1 IOTA",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.budgetAmount, "2000000000");
    assert.equal(payload.expiresAtMs, null);
    assert.equal(payload.explicitExpiry, false);
    assert.equal(Object.hasOwn(payload.response.seen, "expiresAtMs"), false);
    assert.deepEqual(payload.response.seen.milestones, [
      { title: "file1.txt", amount: "1000000000", dueAtMs: TEST_LISTING_DUE_AT_MS_1 },
      { title: "file2.txt", amount: "1000000000", dueAtMs: TEST_LISTING_DUE_AT_MS_2 }
    ]);
  } finally {
    await mock.close();
  }
});

test("listing-create warns when atomic milestone amounts are smaller than one display unit", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-atomic-warning-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const mock = await startMockServer({
    "POST /listings": (request) => ({
      status: 200,
      body: {
        listing: {
          id: "listing-atomic-warning-1"
        },
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "OFFER",
      "--title",
      "Atomic units warning listing",
      "--description",
      "This intentionally uses atomic amounts without display-values.",
      "--category",
      "other",
      "--currency",
      "IOTA",
      "--use-default-expiry",
      "--milestones",
      "file1.txt:1;file2.txt:1",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.response.seen.budgetAmount, "2");
    assert.ok(Array.isArray(payload.warnings));
    assert.equal(payload.warnings[0].code, "atomic_amounts_less_than_one_display_unit");
    assert.equal(payload.warnings[0].currency, "IOTA");
    assert.match(payload.warnings[0].fields.join(","), /budgetAmount/);
    assert.match(payload.warnings[0].fields.join(","), /milestones\[0\]\.amount/);
    assert.match(payload.warnings[0].nextHint, /--display-values/);
  } finally {
    await mock.close();
  }
});

test("listing-create forwards explicit request listing mode", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-request-mode-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const mock = await startMockServer({
    "POST /listings": (request) => ({
      status: 201,
      body: {
        item: { id: "listing-request-1" },
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "buyer"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "REQUEST",
      "--title",
      "Need two empty txt files",
      "--description",
      "Buyer-created request listing.",
      "--category",
      "ops",
      "--currency",
      "IOTA",
      "--display-values",
      "--expires-at",
      "2026-04-20T12:00:00Z",
      "--milestones",
      "file1.txt:1;file2.txt:1",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.listingMode, "REQUEST");
    assert.equal(payload.listingId, "listing-request-1");
    assert.equal(payload.response.seen.listingMode, "REQUEST");
  } finally {
    await mock.close();
  }
});

test("listing-create rejects invalid category before posting", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-category-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "http://127.0.0.1:9",
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "seller"
      },
      null,
      2
    )
  );

  const result = await runCli([
    "listing-create",
    "--auth-state-file",
    authStateFile,
    "--listing-mode",
    "OFFER",
    "--title",
    "One empty txt",
    "--description",
    "Category validation test.",
    "--category",
    "docs",
    "--currency",
    "IOTA",
    "--display-values",
    "--milestones",
    "empty txt:1",
    "--json"
  ]);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "invalid_listing_category");
  assert.deepEqual(payload.validCategories, ["dev", "design", "ops", "security", "other"]);
});

test("listing-cancel posts the canonical cancel route", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-cancel-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const mock = await startMockServer({
    "POST /listings/listing-1/cancel": (request) => ({
      status: 200,
      body: {
        listing: {
          id: "listing-1",
          status: "CANCELLED"
        },
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "creator"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-cancel",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.listingId, "listing-1");
    assert.equal(payload.listingStatus, "CANCELLED");
    assert.equal(payload.response.seen, null);
    const mutation = mock.requests.find((request) => request.method === "POST");
    assert.equal(mutation?.url, "/listings/listing-1/cancel");
  } finally {
    await mock.close();
  }
});

test("listing-cancel prints order-progress guidance when the listing is no longer cancelable", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-cancel-not-cancelable-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const mock = await startMockServer({
    "POST /listings/listing-1/cancel": () => ({
      status: 409,
      body: {
        error: "listing_not_cancelable"
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "creator"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-cancel",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1"
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /listing_cancel_error: listing_not_cancelable/);
    assert.match(result.stderr, /cause=listing_already_progressed_or_closed/);
    assert.match(result.stderr, /recipe fund-order --compact/);
  } finally {
    await mock.close();
  }
});

test("listing-renew accepts an ISO timestamp and posts expiresAtMs to the canonical renew route", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-renew-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const renewIso = "2026-04-20T12:00:00Z";
  const renewMs = Date.parse(renewIso);
  const mock = await startMockServer({
    "POST /listings/listing-1/renew": (request) => ({
      status: 200,
      body: {
        listing: {
          id: "listing-1",
          status: "OPEN",
          expiresAt: renewIso
        },
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "creator"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-renew",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1",
      "--expires-at",
      renewIso,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.listingId, "listing-1");
    assert.equal(payload.listingStatus, "OPEN");
    assert.equal(payload.expiresAt, renewIso);
    assert.equal(payload.expiresAtMs, renewMs);
    assert.deepEqual(payload.response.seen, { expiresAtMs: renewMs });
    const mutation = mock.requests.find((request) => request.method === "POST");
    assert.equal(mutation?.url, "/listings/listing-1/renew");
  } finally {
    await mock.close();
  }
});

test("listing-renew rejects unexpected flags before posting", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-renew-unexpected-option-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const mock = await startMockServer({
    "POST /listings/listing-1/renew": () => {
      throw new Error("request should not be sent");
    }
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x1212121212121212121212121212121212121212121212121212121212121212",
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-renew",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1",
      "--expires-at",
      "2026-04-20T12:00:00.000Z",
      "--expres-at",
      "2026-04-21T12:00:00.000Z"
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /listing_renew_error: unexpected_options/);
    assert.match(result.stderr, /unexpected_options=--expres-at/);
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

test("listing-cancel prints exact readback for request listings", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-cancel-request-readback-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const mock = await startMockServer({
    "POST /listings/listing-1/cancel": () => ({
      status: 200,
      body: {
        listing: {
          id: "listing-1",
          status: "CANCELLED",
          listingMode: "REQUEST"
        }
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "creator"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-cancel",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1"
    ]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /listing_cancel_ok listing_id=listing-1/);
    assert.match(result.stdout, /GET \/listings\/listing-1/);
  } finally {
    await mock.close();
  }
});

test("listing-renew prints exact readback for request listings", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-renew-request-readback-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const renewIso = "2026-04-20T12:00:00Z";
  const mock = await startMockServer({
    "POST /listings/listing-1/renew": () => ({
      status: 200,
      body: {
        listing: {
          id: "listing-1",
          status: "OPEN",
          listingMode: "REQUEST",
          expiresAt: renewIso
        }
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "creator"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-renew",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1",
      "--expires-at",
      renewIso
    ]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /listing_renew_ok listing_id=listing-1/);
    assert.match(result.stdout, /GET \/listings\/listing-1/);
  } finally {
    await mock.close();
  }
});

test("listing-create prints exact readback once the listing id is known", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-readback-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const expiresAtMs = 1893456000000;
  const mock = await startMockServer({
    "POST /listings": () => ({
      status: 200,
      body: {
        listing: {
          id: "listing-1",
          listingMode: "REQUEST"
        }
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "buyer"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "REQUEST",
      "--title",
      "Need exact readback",
      "--description",
      "desc",
      "--category",
      "ops",
      "--currency",
      "IOTA",
      "--expires-at-ms",
      String(expiresAtMs),
      "--milestones",
      "Milestone 1:500000000;Milestone 2:500000000",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`
    ]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /listing_create_ok listing_id=listing-1/);
    assert.match(result.stdout, /GET \/listings\/listing-1/);
  } finally {
    await mock.close();
  }
});

test("bid-create infers bidder address and posts a canonical body", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-bid-create-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const bidderAddress = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const mock = await startMockServer({
    "POST /bids": (request) => ({
      status: 200,
      body: {
        bidId: "bid-1",
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: bidderAddress,
        alias: "buyer"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "bid-create",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1",
      "--amount",
      "1000000000",
      "--currency",
      "IOTA",
      "--message",
      "Hello from the wrapper",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.bidId, "bid-1");
    assert.equal(payload.bidderAddress, bidderAddress);
    assert.deepEqual(payload.response.seen, {
      listingId: "listing-1",
      bidderAddress,
      amount: "1000000000",
      currency: "IOTA",
      message: "Hello from the wrapper"
    });
  } finally {
    await mock.close();
  }
});

test("bid-create rejects unexpected flags before posting", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-bid-create-unexpected-option-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const mock = await startMockServer({
    "POST /bids": () => {
      throw new Error("request should not be sent");
    }
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x5656565656565656565656565656565656565656565656565656565656565656",
        alias: "buyer"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "bid-create",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1",
      "--amount",
      "500000000",
      "--currency",
      "IOTA",
      "--ammount",
      "600000000"
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bid_create_error: unexpected_options/);
    assert.match(result.stderr, /unexpected_options=--ammount/);
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

test("listing-create prints compliance guidance for trader-account failures", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-trader-guidance-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const mock = await startMockServer({
    "POST /listings": () => ({
      status: 403,
      body: {
        error: "listing_requires_trader_account"
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "OFFER",
      "--title",
      "Two tiny IOTA text tasks",
      "--description",
      "Manual live flow test listing.",
      "--category",
      "ops",
      "--currency",
      "IOTA",
      "--use-default-expiry",
      "--milestones",
      "Milestone 1:500000000;Milestone 2:500000000",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /listing_create_error: listing_requires_trader_account/);
    assert.match(result.stderr, /detail=public_listing_create_now_requires_reputation_init_plus_current_use_context_onboarding/);
    assert.match(result.stderr, /clawnera-help reputation-init/);
    assert.match(result.stderr, /GET \/compliance\/me/);
    assert.match(result.stderr, /POST \/compliance\/me\/use-context/);
  } finally {
    await mock.close();
  }
});

test("request listing-create prints request-buyer compliance guidance for trader-account failures", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-request-listing-create-trader-guidance-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const mock = await startMockServer({
    "POST /listings": () => ({
      status: 403,
      body: {
        error: "listing_requires_trader_account"
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "request-buyer"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "REQUEST",
      "--title",
      "Need two tiny text files",
      "--description",
      "Manual live flow test request listing.",
      "--category",
      "ops",
      "--currency",
      "IOTA",
      "--use-default-expiry",
      "--milestones",
      "Milestone 1:500000000;Milestone 2:500000000",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /listing_create_error: listing_requires_trader_account/);
    assert.match(result.stderr, /request-buyer-auth-state-file/);
    assert.doesNotMatch(result.stderr, /seller-auth-state-file/);
    assert.match(result.stderr, /POST \/compliance\/me\/use-context/);
  } finally {
    await mock.close();
  }
});

test("request listing-create prints request-buyer verification guidance for trader-verification failures", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-request-listing-create-verification-guidance-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const mock = await startMockServer({
    "POST /listings": () => ({
      status: 403,
      body: {
        error: "trader_verification_required"
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "request-buyer"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "REQUEST",
      "--title",
      "Need two tiny text files",
      "--description",
      "Manual live flow test request listing.",
      "--category",
      "ops",
      "--currency",
      "IOTA",
      "--use-default-expiry",
      "--milestones",
      "Milestone 1:500000000;Milestone 2:500000000",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /listing_create_error: trader_verification_required/);
    assert.match(result.stderr, /detail=re_read_owner_surface_and_complete_canonical_professional_onboarding_before_retrying/);
    assert.match(result.stderr, /request-buyer-auth-state-file/);
    assert.doesNotMatch(result.stderr, /seller-auth-state-file/);
    assert.doesNotMatch(result.stderr, /POST \/compliance\/me\/trader-verification/);
  } finally {
    await mock.close();
  }
});

test("listing-create prints canonical professional onboarding guidance for business onboarding failures", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-business-onboarding-guidance-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const mock = await startMockServer({
    "POST /listings": () => ({
      status: 428,
      body: {
        error: "business_onboarding_required"
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: creatorAddress,
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "OFFER",
      "--title",
      "Two tiny IOTA text tasks",
      "--description",
      "Manual live flow test listing.",
      "--category",
      "ops",
      "--currency",
      "IOTA",
      "--use-default-expiry",
      "--milestones",
      "Milestone 1:500000000;Milestone 2:500000000",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /listing_create_error: business_onboarding_required/);
    assert.match(result.stderr, /cause=protected_listing_write_requires_canonical_professional_onboarding/);
    assert.match(result.stderr, /POST \/compliance\/me\/use-context/);
    assert.doesNotMatch(result.stderr, /POST \/compliance\/me\/account-type/);
  } finally {
    await mock.close();
  }
});

test("listing-create rejects unexpected flags before posting", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-unexpected-option-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const mock = await startMockServer({
    "POST /listings": () => {
      throw new Error("request should not be sent");
    }
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x4444444444444444444444444444444444444444444444444444444444444444",
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "listing-create",
      "--auth-state-file",
      authStateFile,
      "--listing-mode",
      "OFFER",
      "--title",
      "Unexpected option",
      "--description",
      "This should fail locally before a request is sent.",
      "--category",
      "other",
      "--currency",
      "IOTA",
      "--use-default-expiry",
      "--milestones",
      "Milestone 1:500000000;Milestone 2:500000000",
      "--promotion-policy",
      "STANDARD"
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /listing_create_error: unexpected_options/);
    assert.match(result.stderr, /unexpected_options=--promotion-policy/);
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

test("listing-create stops early when expiry choice is missing", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-missing-expiry-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "https://api.clawnera.com",
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: "0x1111111111111111111111111111111111111111111111111111111111111111",
        alias: "seller"
      },
      null,
      2
    )
  );

  const result = await runCli([
    "listing-create",
    "--auth-state-file",
    authStateFile,
    "--listing-mode",
    "OFFER",
    "--title",
    "Missing expiry",
    "--description",
    "desc",
    "--category",
    "ops",
    "--currency",
    "IOTA",
    "--milestones",
    "Milestone 1:1000"
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /listing_create_error: missing_listing_expiry_choice/);
  assert.match(result.stderr, /add --expires-in-days <1-30> to listing-create/);
  assert.match(result.stderr, /--use-default-expiry/);
});

test("milestone-submit-byo prints mailbox-handshake recovery for mailbox-gated submit", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-milestone-submit-mailbox-"));
  const keystoreFile = path.join(tempDir, "iota.keystore");
  const authStateFile = path.join(tempDir, "auth-state.json");
  const payloadFile = path.join(tempDir, "payload.json");
  const bodyOutFile = path.join(tempDir, "submit-body.json");
  const wrappedCek = Buffer.alloc(48, 7).toString("base64url");
  const hpkeEnc = `v1.${Buffer.alloc(32, 9).toString("base64url")}.${Buffer.alloc(24, 11).toString("base64url")}`;

  const initResult = await runCli(["wallet-init", "--alias", "seller", "--keystore-path", keystoreFile, "--json"]);
  assert.equal(initResult.status, 0);
  const createdKeystore = JSON.parse(readFileSync(keystoreFile, "utf8"));
  const sellerAddress = createdKeystore.keys[0].address;

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "http://placeholder.invalid",
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: sellerAddress,
        alias: "seller"
      },
      null,
      2
    )
  );

  writeFileSync(
    payloadFile,
    JSON.stringify(
      {
        orderId: "order-1",
        milestoneId: "m1",
        metadata: {
          plaintextLabel: "deliverable"
        },
        encrypted: {
          blob: {
            nonceB64u: "bm9uY2U",
            ciphertextB64u: "Y2lwaGVydGV4dA",
            plaintextByteLength: 0,
            ciphertextByteLength: 0,
            ciphertextSha256: "a".repeat(64)
          },
          cekWraps: [
            {
              recipientAddress: sellerAddress,
              keyVersion: 1,
              wrappedCek,
              hpkeEnc
            }
          ]
        }
      },
      null,
      2
    )
  );

  const mock = await startMockServer({
    "GET /orders/order-1": () => ({
      status: 200,
      body: {
        order: {
          id: "order-1",
          sellerAddress
        }
      }
    }),
    "POST /orders/order-1/milestones/m1/submit": () => ({
      status: 409,
      body: {
        error: "order_mailbox_required"
      }
    })
  });

  const savedState = JSON.parse(readFileSync(authStateFile, "utf8"));
  savedState.apiBase = mock.baseUrl;
  writeFileSync(authStateFile, JSON.stringify(savedState, null, 2));

  try {
    const result = await runCli([
      "milestone-submit-byo",
      "--auth-state-file",
      authStateFile,
      "--keystore-path",
      keystoreFile,
      "--alias",
      "seller",
      "--order-id",
      "order-1",
      "--milestone-id",
      "m1",
      "--payload-file",
      payloadFile,
      "--manifest-cid",
      "ipfs://bafytestcid123",
      "--body-out",
      bodyOutFile
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /milestone_submit_byo_error: order_mailbox_required/);
    assert.match(result.stderr, /cause=order_mailbox_required/);
    assert.match(result.stderr, /next_hint=clawnera-help recipe mailbox-handshake/);
    assert.match(result.stderr, /next_init=clawnera-help write-gate --auth-state-file <file> && clawnera-help tx-plan-dry-run POST \/orders\/<orderId>\/mailbox\/init-plan/);
    assert.match(result.stderr, /bind_source=execute the reviewed canonical plan in a chain-native client/);
    assert.match(result.stderr, /next_bind=clawnera-help write-gate --auth-state-file <file> && clawnera-help request POST \/orders\/<orderId>\/mailbox/);
  } finally {
    await mock.close();
  }
});

test("bid-create converts display values into atomic amounts", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-bid-create-display-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const bidderAddress = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const mock = await startMockServer({
    "POST /bids": (request) => ({
      status: 200,
      body: {
        bidId: "bid-display-1",
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: bidderAddress,
        alias: "buyer"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "bid-create",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1",
      "--amount",
      "1",
      "--currency",
      "IOTA",
      "--display-values",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.response.seen.amount, "1000000000");
  } finally {
    await mock.close();
  }
});

test("bid-create accepts display values with an explicit currency suffix", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-bid-create-display-suffix-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const bidderAddress = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const mock = await startMockServer({
    "POST /bids": (request) => ({
      status: 200,
      body: {
        bidId: "bid-display-2",
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: bidderAddress,
        alias: "buyer"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "bid-create",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1",
      "--amount",
      "1 IOTA",
      "--currency",
      "IOTA",
      "--display-values",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.response.seen.amount, "1000000000");
  } finally {
    await mock.close();
  }
});

test("bid-create warns when atomic amount is smaller than one display unit", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-bid-create-atomic-warning-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const bidderAddress = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const mock = await startMockServer({
    "POST /bids": (request) => ({
      status: 200,
      body: {
        bidId: "bid-atomic-warning-1",
        seen: request.body
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: bidderAddress,
        alias: "buyer"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "bid-create",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "listing-1",
      "--amount",
      "1",
      "--currency",
      "IOTA",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.ok(Array.isArray(payload.warnings));
    assert.equal(payload.warnings[0].code, "atomic_amounts_less_than_one_display_unit");
    assert.deepEqual(payload.warnings[0].fields, ["amount"]);
    assert.equal(payload.warnings[0].atomicPerDisplayUnit, "1000000000");
    assert.match(payload.warnings[0].nextHint, /--display-values/);
  } finally {
    await mock.close();
  }
});

test("bid-create prints seller-side guidance for request bidder compliance failures", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-bid-create-request-guidance-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const bidderAddress = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const mock = await startMockServer({
    "POST /bids": () => ({
      status: 403,
      body: {
        error: "request_bid_requires_trader_account"
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: bidderAddress,
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "bid-create",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "request-listing-1",
      "--amount",
      "1",
      "--currency",
      "IOTA",
      "--display-values"
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bid_create_error: request_bid_requires_trader_account/);
    assert.match(result.stderr, /cause=request_bidder_becomes_future_seller_and_must_complete_professional_onboarding/);
    assert.match(result.stderr, /GET \/compliance\/me/);
    assert.match(result.stderr, /POST \/compliance\/me\/use-context/);
  } finally {
    await mock.close();
  }
});

test("bid-create prints re-ack guidance for business acknowledgement version mismatch", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-bid-create-business-ack-mismatch-guidance-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const bidderAddress = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const mock = await startMockServer({
    "POST /bids": () => ({
      status: 428,
      body: {
        error: "business_acknowledgement_version_mismatch"
      }
    })
  });

  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: mock.baseUrl,
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: bidderAddress,
        alias: "seller"
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "bid-create",
      "--auth-state-file",
      authStateFile,
      "--listing-id",
      "request-listing-1",
      "--amount",
      "1",
      "--currency",
      "IOTA",
      "--display-values"
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bid_create_error: business_acknowledgement_version_mismatch/);
    assert.match(result.stderr, /cause=stored_professional_acknowledgement_is_outdated/);
    assert.match(result.stderr, /GET \/compliance\/me/);
    assert.match(
      result.stderr,
      /clawnera-help write-gate --auth-state-file <request-seller-auth-state-file> && clawnera-help request POST \/compliance\/me\/use-context --auth-state-file <request-seller-auth-state-file>/,
    );
  } finally {
    await mock.close();
  }
});

test("bid-accept posts the minimal accept body and extracts order id", async () => {
  const mock = await startMockServer({
    "POST /bids/bid-1/accept": (request) => ({
      status: 200,
      body: {
        orderId: "order-1",
        seen: request.body
      }
    })
  });

  try {
    const result = await runCli([
      "bid-accept",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--bid-id",
      "bid-1",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.orderId, "order-1");
    assert.deepEqual(payload.response.seen, {});
  } finally {
    await mock.close();
  }
});

test("bid-accept works unchanged for REQUEST-mode buyer acceptance and preserves returned order parties", async () => {
  const mock = await startMockServer({
    "POST /bids/request-bid-1/accept": (request) => ({
      status: 200,
      body: {
        orderId: "order-request-1",
        order: {
          id: "order-request-1",
          buyerAddress: "0xrequestbuyer",
          sellerAddress: "0xacceptedbidder"
        },
        seen: request.body
      }
    })
  });

  try {
    const result = await runCli([
      "bid-accept",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--bid-id",
      "request-bid-1",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.orderId, "order-request-1");
    assert.equal(payload.response.order.buyerAddress, "0xrequestbuyer");
    assert.equal(payload.response.order.sellerAddress, "0xacceptedbidder");
    assert.deepEqual(payload.response.seen, {});
  } finally {
    await mock.close();
  }
});

test("bid-accept prints structured dispute bond guidance when the API returns it", async () => {
  const mock = await startMockServer({
    "POST /bids/bid-guidance/accept": () => ({
      status: 200,
      body: {
        order: {
          id: "order-guidance-1",
          disputeBondPolicy: "DUAL_BOND_REQUIRED"
        },
        disputeBondGuidance: {
          policy: "DUAL_BOND_REQUIRED",
          selectionMode: "EXPLICIT_RANGE",
          userAmountChoiceRequired: true,
          platformOperatorFunding: false,
          supportedPrincipalAssets: ["iota", "claw"],
          selectedPrincipalAsset: "claw",
          currentMinPerSideAmount: "500000",
          currentMaxPerSideAmount: "5000000",
          defaultRequiredReviewerVotes: 3,
          minRequiredReviewerVotes: 3,
          maxRequiredReviewerVotes: 7,
          selectedRequiredReviewerVotes: null,
          selectedRequiredReviewerVotesFloor: null,
          recommendation: {
            status: "configured",
            source: "runtime_overlay",
            model: "hybrid_target_reviewer_payout_clamped",
            priceDependency: "none",
            requiredReviewerVotesUsed: 3,
            hardMinPerSideAmount: "500000",
            hardMaxPerSideAmount: "5000000",
            recommendedPerSideAmount: "500000",
            warningBelowPerSideAmount: "500000",
            exactLaneCollapsed: false,
            reasonCodes: ["same_asset_only", "default_reviewer_votes"]
          }
        }
      }
    })
  });

  try {
    const result = await runCli([
      "bid-accept",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--bid-id",
      "bid-guidance"
    ]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /bid_accept_ok bid_id=bid-guidance/);
    assert.match(result.stdout, /order_id=order-guidance-1/);
    assert.match(result.stdout, /bond_amount_selection_mode=EXPLICIT_RANGE/);
    assert.match(result.stdout, /user_amount_choice_required=true/);
    assert.match(result.stdout, /platform_operator_funding=false/);
    assert.match(result.stdout, /guidance_supported_principal_assets=iota,claw/);
    assert.match(result.stdout, /guidance_selected_principal_asset=claw/);
    assert.match(result.stdout, /guidance_current_min_dispute_bond_per_side=500000/);
    assert.match(result.stdout, /guidance_current_max_dispute_bond_per_side=5000000/);
    assert.match(result.stdout, /guidance_max_required_reviewer_votes=7/);
    assert.match(result.stdout, /guidance_recommendation_status=configured/);
    assert.match(result.stdout, /guidance_recommendation_model=hybrid_target_reviewer_payout_clamped/);
    assert.match(result.stdout, /guidance_recommendation_recommended_per_side_amount=500000/);
    assert.match(result.stdout, /guidance_recommendation_warning_below_per_side_amount=500000/);
    assert.match(result.stdout, /guidance_recommendation_reason_codes=same_asset_only,default_reviewer_votes/);
  } finally {
    await mock.close();
  }
});

test("request can select a nested body payload from a body file", async () => {
  const mock = await startMockServer({
    "POST /echo": (request) => ({
      status: 200,
      body: {
        seen: request.body,
      }
    })
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-request-body-select-"));
  const bodyFile = path.join(tempDir, "vote.json");
  writeFileSync(
    bodyFile,
    JSON.stringify(
      {
        commitRequestBody: {
          commitHashHex: "aa".repeat(32)
        },
        revealRequestBody: {
          vote: 1,
          nonceHex: "bb".repeat(16)
        }
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "request",
      "POST",
      "/echo",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--body-file",
      bodyFile,
      "--body-select",
      "commitRequestBody",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.response.seen, {
      commitHashHex: "aa".repeat(32)
    });
    const mutation = mock.requests.find((request) => request.method === "POST");
    assert.deepEqual(mutation?.body, {
      commitHashHex: "aa".repeat(32)
    });
  } finally {
    await mock.close();
  }
});

test("bid-accept prints buyer-side guidance on buyer_mismatch", async () => {
  const mock = await startMockServer({
    "POST /bids/bid-1/accept": () => ({
      status: 403,
      body: {
        error: "buyer_mismatch"
      }
    })
  });

  try {
    const result = await runCli([
      "bid-accept",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--bid-id",
      "bid-1"
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bid_accept_error: buyer_mismatch/);
    assert.match(result.stderr, /cause=bid_accept_is_buyer_side/);
    assert.match(
      result.stderr,
      /for OFFER listings, clawnera-help write-gate --auth-state-file <chosen-buyer-auth-state-file> && clawnera-help bid-accept --auth-state-file <chosen-buyer-auth-state-file>/,
    );
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run pre-hydrates reviewer commit routes before the first POST", async () => {
  const caseId = "0x2cb6d1df7a78eb63647728d7cdf7a5098dce8cb4f0693b20fee7641629068ac5";
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  const reviewerEntryObjectId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  let commitCalls = 0;
  const mock = await startMockServer({
    [`POST /disputes/${caseId}/votes/commit`]: (request) => {
      commitCalls += 1;
      assert.deepEqual(request.body, {
        commitHashHex: "cc".repeat(32),
        reviewerEntryObjectId
      });
      return {
        status: 409,
        body: {
          error: "commit_window_closed"
        }
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: reviewerEntryObjectId,
          owner: reviewerAddress
        },
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
        }
      }
    })
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-commit-retry-"));
  const bodyFile = path.join(tempDir, "reviewer-vote.json");
  writeFileSync(
    bodyFile,
    JSON.stringify(
      {
        commitRequestBody: {
          commitHashHex: "cc".repeat(32)
        },
        revealRequestBody: {
          vote: 0,
          nonceHex: "dd".repeat(16)
        }
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      `/disputes/${caseId}/votes/commit`,
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body-file",
      bodyFile,
      "--body-select",
      "commitRequestBody",
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "commit_window_closed");
    assert.equal(payload.status, 409);
    assert.equal(payload.autoHydratedReviewerContext.route, "commit");
    assert.equal(payload.autoHydratedReviewerContext.reviewerEntryObjectId, reviewerEntryObjectId);
    assert.equal(commitCalls, 1);
    assert.match(payload.response.error, /commit_window_closed/);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run retries one transient auth_session_unavailable on reviewer commit fetch", async () => {
  const caseId = "0x3cb6d1df7a78eb63647728d7cdf7a5098dce8cb4f0693b20fee7641629068ac5";
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  const reviewerEntryObjectId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  let commitCalls = 0;
  const mock = await startMockServer({
    [`POST /disputes/${caseId}/votes/commit`]: (request) => {
      commitCalls += 1;
      assert.deepEqual(request.body, {
        commitHashHex: "cc".repeat(32),
        reviewerEntryObjectId
      });
      if (commitCalls === 1) {
        return {
          status: 503,
          body: {
            error: "auth_session_unavailable"
          }
        };
      }
      return {
        status: 409,
        body: {
          error: "commit_window_closed"
        }
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: reviewerEntryObjectId,
          owner: reviewerAddress
        },
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
        }
      }
    })
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-commit-auth-session-"));
  const bodyFile = path.join(tempDir, "reviewer-vote.json");
  writeFileSync(
    bodyFile,
    JSON.stringify(
      {
        commitRequestBody: {
          commitHashHex: "cc".repeat(32)
        },
        revealRequestBody: {
          vote: 0,
          nonceHex: "dd".repeat(16)
        }
      },
      null,
      2
    )
  );

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      `/disputes/${caseId}/votes/commit`,
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body-file",
      bodyFile,
      "--body-select",
      "commitRequestBody",
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "commit_window_closed");
    assert.equal(payload.status, 409);
    assert.equal(payload.autoHydratedReviewerContext.route, "commit");
    assert.equal(payload.autoHydratedReviewerContext.reviewerEntryObjectId, reviewerEntryObjectId);
    assert.equal(commitCalls, 2);
    assert.match(payload.response.error, /commit_window_closed/);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run surfaces top-level reveal wait hints and auto-retries one short route boundary", async () => {
  const caseId = "0x4cb6d1df7a78eb63647728d7cdf7a5098dce8cb4f0693b20fee7641629068ac5";
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  const reviewerEntryObjectId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const commitDeadlineMs = Date.now() + 60_000;
  let revealCalls = 0;
  const mock = await startMockServer({
    [`POST /disputes/${caseId}/votes/reveal`]: (request) => {
      revealCalls += 1;
      assert.deepEqual(request.body, {
        vote: 0,
        nonceHex: "dd".repeat(16),
        reviewerEntryObjectId,
      });
      return {
        status: 409,
        body: {
          error: "dispute_commit_window_open",
          commitDeadlineMs,
          retryAfterMs: 25,
        },
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: reviewerEntryObjectId,
          owner: reviewerAddress,
        },
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333",
        },
      },
    }),
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-reveal-window-"));
  const bodyFile = path.join(tempDir, "reviewer-vote.json");
  writeFileSync(
    bodyFile,
    JSON.stringify(
      {
        revealRequestBody: {
          vote: 0,
          nonceHex: "dd".repeat(16),
        },
      },
      null,
      2,
    ),
  );

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      `/disputes/${caseId}/votes/reveal`,
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body-file",
      bodyFile,
      "--body-select",
      "revealRequestBody",
      "--json",
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "dispute_commit_window_open");
    assert.equal(payload.retryAfterMs, 25);
    assert.equal(payload.autoRetriedRouteFetchCount, 1);
    assert.equal(payload.autoHydratedReviewerContext.route, "reveal");
    assert.equal(payload.autoHydratedReviewerContext.reviewerEntryObjectId, reviewerEntryObjectId);
    assert.equal(payload.waitUntilMs, commitDeadlineMs);
    assert.equal(payload.waitUntilIso, new Date(commitDeadlineMs).toISOString());
    assert.match(payload.nextCommandHint, /tx-plan-dry-run POST '\/disputes\/.*\/votes\/reveal'/);
    assert.equal(revealCalls, 2);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run prints top-level finalize wait hints in non-json mode", async () => {
  const caseId = "0x5cb6d1df7a78eb63647728d7cdf7a5098dce8cb4f0693b20fee7641629068ac5";
  const challengeDeadlineMs = Date.now() + 90_000;
  let finalizeCalls = 0;
  const mock = await startMockServer({
    [`POST /disputes/${caseId}/finalize`]: () => {
      finalizeCalls += 1;
      return {
        status: 409,
        body: {
          error: "dispute_challenge_window_open",
          challengeDeadlineMs,
          retryAfterMs: 30,
        },
      };
    },
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      `/disputes/${caseId}/finalize`,
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tx_plan_dry_run_error: dispute_challenge_window_open/);
    assert.match(result.stderr, new RegExp(`wait_until=${new Date(challengeDeadlineMs).toISOString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(result.stderr, /retry_after_ms=30/);
    assert.match(result.stderr, /next_command=clawnera-help write-gate --api-base .* && clawnera-help tx-plan-dry-run POST '\/disputes\/.*\/finalize'/);
    const nextCommand = result.stderr.match(/^next_command=(.+)$/m)?.[1] || "";
    assert.equal(nextCommand.split(mock.baseUrl).length - 1, 2);
    assert.equal(finalizeCalls, 2);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run can wait through a known finalize challenge window when asked", async () => {
  const caseId = "0x6cb6d1df7a78eb63647728d7cdf7a5098dce8cb4f0693b20fee7641629068ac5";
  const challengeDeadlineMs = Date.now() + 800;
  let finalizeCalls = 0;
  const mock = await startMockServer({
    [`POST /disputes/${caseId}/finalize`]: () => {
      finalizeCalls += 1;
      if (Date.now() < challengeDeadlineMs) {
        return {
          status: 409,
          body: {
            error: "dispute_challenge_window_open",
            challengeDeadlineMs,
            retryAfterMs: 30_000,
          },
        };
      }
      return {
        status: 409,
        body: {
          error: "dispute_not_finalizable",
        },
      };
    },
  });

  const startedAtMs = Date.now();
  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      `/disputes/${caseId}/finalize`,
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--wait-until-ready",
      "--max-ready-wait-ms",
      "1000",
      "--json",
    ]);
    const elapsedMs = Date.now() - startedAtMs;
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "dispute_not_finalizable");
    assert.equal(payload.autoWaitUntilReadyCount, 1);
    assert.equal(payload.autoRetriedRouteFetchCount, 0);
    assert.ok(elapsedMs >= 500, `expected the helper to wait for the challenge window, elapsed=${elapsedMs}`);
    assert.equal(finalizeCalls, 2);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run pre-hydrates reviewer claim-metrics from pendingMetricsClaimContext without invites", async () => {
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  const reviewerEntryObjectId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const reviewerRegistryObjectId = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const disputeQuorumConfigObjectId = "0x3333333333333333333333333333333333333333333333333333333333333333";
  const disputeCaseObjectId = "0x2cb6d1df7a78eb63647728d7cdf7a5098dce8cb4f0693b20fee7641629068ac5";
  let claimCalls = 0;
  let inviteReads = 0;
  const mock = await startMockServer({
    ["POST /reviewers/me/claim-metrics"]: (request) => {
      claimCalls += 1;
      assert.deepEqual(request.body, {
        disputeCaseObjectId,
        reviewerRegistryObjectId,
        reviewerEntryObjectId,
        disputeQuorumConfigObjectId
      });
      return {
        status: 409,
        body: {
          error: "reviewer_metrics_already_claimed"
        }
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: reviewerEntryObjectId,
          owner: reviewerAddress,
          pendingDecisionMetricsClaimRequired: true
        },
        runtime: {
          reviewerRegistryObjectId,
          disputeQuorumConfigObjectId
        },
        pendingMetricsClaimContext: {
          status: "ready",
          disputeCaseObjectId,
          candidates: [
            {
              disputeCaseObjectId,
              orderId: "order-claim-ready-001",
              milestoneId: "milestone-claim-ready-001",
              closedAtMs: 1710000001000
            }
          ]
        }
      }
    }),
    "GET /reviewers/me/invites": () => {
      inviteReads += 1;
      return {
        status: 200,
        body: {
          invites: []
        }
      };
    }
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/reviewers/me/claim-metrics",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body",
      "{}",
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "reviewer_metrics_already_claimed");
    assert.equal(payload.status, 409);
    assert.equal(payload.autoHydratedReviewerContext.route, "claim_metrics");
    assert.equal(payload.autoHydratedReviewerContext.disputeCaseObjectId, disputeCaseObjectId);
    assert.equal(claimCalls, 1);
    assert.equal(inviteReads, 0);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run surfaces pendingMetricsClaimContext ambiguity before invites", async () => {
  const reviewerAddress = "0x4d77e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  const closedCaseA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const closedCaseB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  let claimCalls = 0;
  let inviteReads = 0;
  const mock = await startMockServer({
    ["POST /reviewers/me/claim-metrics"]: () => {
      claimCalls += 1;
      return {
        status: 400,
        body: {
          error: "dispute_case_object_id_required"
        }
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: "0x1111111111111111111111111111111111111111111111111111111111111111",
          owner: reviewerAddress,
          pendingDecisionMetricsClaimRequired: true
        },
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
        },
        pendingMetricsClaimContext: {
          status: "ambiguous",
          candidates: [
            {
              disputeCaseObjectId: closedCaseA,
              closedAtMs: 1710000001000
            },
            {
              disputeCaseObjectId: closedCaseB,
              closedAtMs: 1710000003000
            }
          ]
        }
      }
    }),
    "GET /reviewers/me/invites": () => {
      inviteReads += 1;
      return {
        status: 200,
        body: {
          invites: []
        }
      };
    }
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/reviewers/me/claim-metrics",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body",
      "{}",
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "claim_metrics_dispute_case_ambiguous");
    assert.deepEqual(payload.disputeCaseObjectIds, [closedCaseA, closedCaseB]);
    assert.match(payload.hint, /GET \/reviewers\/me\/metrics/);
    assert.equal(claimCalls, 0);
    assert.equal(inviteReads, 0);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run stops when pendingMetricsClaimContext is unavailable", async () => {
  const reviewerAddress = "0x4d77e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  let claimCalls = 0;
  let inviteReads = 0;
  const mock = await startMockServer({
    ["POST /reviewers/me/claim-metrics"]: () => {
      claimCalls += 1;
      return {
        status: 400,
        body: {
          error: "dispute_case_object_id_required"
        }
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: "0x1111111111111111111111111111111111111111111111111111111111111111",
          owner: reviewerAddress,
          pendingDecisionMetricsClaimRequired: true
        },
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
        },
        pendingMetricsClaimContext: {
          status: "unavailable"
        }
      }
    }),
    "GET /reviewers/me/invites": () => {
      inviteReads += 1;
      return {
        status: 200,
        body: {
          invites: []
        }
      };
    }
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/reviewers/me/claim-metrics",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body",
      "{}",
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "claim_metrics_context_unavailable");
    assert.match(payload.hint, /GET \/reviewers\/me\/metrics/);
    assert.match(payload.hint, /clawnera-help write-gate --auth-state-file <reviewer-auth-state-file> && clawnera-help tx-plan-dry-run POST/);
    assert.equal(claimCalls, 0);
    assert.equal(inviteReads, 0);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run pre-hydrates reviewer claim-metrics with reviewer context and a single closed invite", async () => {
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  const reviewerEntryObjectId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const reviewerRegistryObjectId = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const disputeQuorumConfigObjectId = "0x3333333333333333333333333333333333333333333333333333333333333333";
  const disputeCaseObjectId = "0x2cb6d1df7a78eb63647728d7cdf7a5098dce8cb4f0693b20fee7641629068ac5";
  let claimCalls = 0;
  const mock = await startMockServer({
    ["POST /reviewers/me/claim-metrics"]: (request) => {
      claimCalls += 1;
      assert.deepEqual(request.body, {
        disputeCaseObjectId,
        reviewerRegistryObjectId,
        reviewerEntryObjectId,
        disputeQuorumConfigObjectId
      });
      return {
        status: 409,
        body: {
          error: "reviewer_metrics_already_claimed"
        }
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: reviewerEntryObjectId,
          owner: reviewerAddress,
          pendingDecisionMetricsClaimRequired: true
        },
        runtime: {
          reviewerRegistryObjectId,
          disputeQuorumConfigObjectId
        }
      }
    }),
    "GET /reviewers/me/invites": () => ({
      status: 200,
      body: {
        invites: [
          {
            reviewerAddress,
            disputeCaseObjectId,
            status: "closed",
            invitedAtMs: 1710000000000,
            disputeCase: {
              closedAtMs: 1710000001000
            }
          }
        ]
      }
    })
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/reviewers/me/claim-metrics",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body",
      "{}",
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "reviewer_metrics_already_claimed");
    assert.equal(payload.status, 409);
    assert.equal(payload.autoHydratedReviewerContext.route, "claim_metrics");
    assert.equal(payload.autoHydratedReviewerContext.reviewerEntryObjectId, reviewerEntryObjectId);
    assert.equal(payload.autoHydratedReviewerContext.reviewerRegistryObjectId, reviewerRegistryObjectId);
    assert.equal(payload.autoHydratedReviewerContext.disputeQuorumConfigObjectId, disputeQuorumConfigObjectId);
    assert.equal(payload.autoHydratedReviewerContext.disputeCaseObjectId, disputeCaseObjectId);
    assert.equal(claimCalls, 1);
    assert.match(payload.response.error, /reviewer_metrics_already_claimed/);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run does not infer claim-metrics from stale reviewer invites", async () => {
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  let claimCalls = 0;
  const mock = await startMockServer({
    ["POST /reviewers/me/claim-metrics"]: () => {
      claimCalls += 1;
      return {
        status: 400,
        body: {
          error: "dispute_case_object_id_required"
        }
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: "0x1111111111111111111111111111111111111111111111111111111111111111",
          owner: reviewerAddress,
          pendingDecisionMetricsClaimRequired: true
        },
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
        }
      }
    }),
    "GET /reviewers/me/invites": () => ({
      status: 200,
      body: {
        invites: [
          {
            reviewerAddress,
            disputeCaseObjectId: "0x2cb6d1df7a78eb63647728d7cdf7a5098dce8cb4f0693b20fee7641629068ac5",
            status: "stale",
            invitedAtMs: 1710000000000,
            disputeCase: {
              closedAtMs: 1710000001000
            }
          }
        ]
      }
    })
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/reviewers/me/claim-metrics",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body",
      "{}",
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "claim_metrics_dispute_case_required");
    assert.equal(claimCalls, 0);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run surfaces closed dispute case candidates when claim-metrics is ambiguous", async () => {
  const reviewerAddress = "0x4d77e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  let claimCalls = 0;
  const closedCaseA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const closedCaseB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const mock = await startMockServer({
    ["POST /reviewers/me/claim-metrics"]: () => {
      claimCalls += 1;
      return {
        status: 400,
        body: {
          error: "dispute_case_object_id_required"
        }
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: "0x1111111111111111111111111111111111111111111111111111111111111111",
          owner: reviewerAddress,
          pendingDecisionMetricsClaimRequired: true
        },
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
        }
      }
    }),
    "GET /reviewers/me/invites": () => ({
      status: 200,
      body: {
        invites: [
          {
            reviewerAddress,
            disputeCaseObjectId: closedCaseA,
            status: "closed",
            invitedAtMs: 1710000000000,
            disputeCase: {
              closedAtMs: 1710000001000
            }
          },
          {
            reviewerAddress,
            disputeCaseObjectId: closedCaseB,
            status: "closed",
            invitedAtMs: 1710000002000,
            disputeCase: {
              closedAtMs: 1710000003000
            }
          }
        ]
      }
    })
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/reviewers/me/claim-metrics",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body",
      "{}",
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "claim_metrics_dispute_case_ambiguous");
    assert.deepEqual(payload.disputeCaseObjectIds, [closedCaseA, closedCaseB]);
    assert.match(payload.hint, /GET \/reviewers\/me\/invites/);
    assert.match(payload.hint, new RegExp(closedCaseA));
    assert.match(payload.hint, new RegExp(closedCaseB));
    assert.equal(claimCalls, 0);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run stops claim-metrics retries when reviewer metrics are already clear", async () => {
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  let claimCalls = 0;
  let inviteReads = 0;
  const mock = await startMockServer({
    ["POST /reviewers/me/claim-metrics"]: () => {
      claimCalls += 1;
      return {
        status: 400,
        body: {
          error: "dispute_case_object_id_required"
        }
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: "0x1111111111111111111111111111111111111111111111111111111111111111",
          owner: reviewerAddress,
          pendingDecisionMetricsClaimRequired: false
        },
        runtime: {
          reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
          disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
        }
      }
    }),
    "GET /reviewers/me/invites": () => {
      inviteReads += 1;
      return {
        status: 200,
        body: {
          invites: []
        }
      };
    }
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/reviewers/me/claim-metrics",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body",
      "{}",
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "reviewer_metrics_claim_not_required");
    assert.equal(payload.status, 409);
    assert.equal(payload.response.error, "reviewer_metrics_claim_not_required");
    assert.equal(claimCalls, 0);
    assert.equal(inviteReads, 0);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run stops explicit claim-metrics bodies when reviewer metrics are already clear", async () => {
  const reviewerAddress = "0x4d3bf95fcd3fdbb7d460056d2af7489cbd1fabdd68f0d54b66fc6e7cb0e5d9a1";
  let claimCalls = 0;
  let inviteReads = 0;
  const mock = await startMockServer({
    ["POST /reviewers/me/claim-metrics"]: () => {
      claimCalls += 1;
      return {
        status: 200,
        body: {
          status: "tx_plan_unsigned",
          txBuilder: "disputeQuorum.claimReviewerDecisionMetrics"
        }
      };
    },
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        reviewerAddress,
        reviewer: {
          objectId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          owner: reviewerAddress,
          pendingDecisionMetricsClaimRequired: false
        },
        runtime: {
          reviewerRegistryObjectId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          disputeQuorumConfigObjectId: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
        }
      }
    }),
    "GET /reviewers/me/invites": () => {
      inviteReads += 1;
      return {
        status: 200,
        body: {
          invites: []
        }
      };
    }
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/reviewers/me/claim-metrics",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      buildJwtWithExp(4102444800),
      "--body",
      '{"disputeCaseObjectId":"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}',
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "reviewer_metrics_claim_not_required");
    assert.equal(payload.status, 409);
    assert.equal(payload.response.error, "reviewer_metrics_claim_not_required");
    assert.equal(claimCalls, 0);
    assert.equal(inviteReads, 0);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run rejects retired reviewer address claim-metrics path locally", async () => {
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  const result = await runCli([
    "tx-plan-dry-run",
    "POST",
    `/reviewers/${reviewerAddress}/claim-metrics`,
    "--api-base",
    "https://api.example.test",
    "--jwt",
    buildJwtWithExp(4102444800),
    "--body",
    "{}",
    "--json"
  ]);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error, "reviewer_claim_metrics_path_retired");
  assert.match(payload.hint, /POST \/reviewers\/me\/claim-metrics/);
});

test("key-agreement-upsert stores the default key file under the auth-state home when remote version is absent", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-key-home-"));
  const walletInit = await runCli(["wallet-init", "--alias", "bot", "--json"], { HOME: tempHome });
  assert.equal(walletInit.status, 0);
  const walletPayload = JSON.parse(walletInit.stdout);
  const actorAddress = walletPayload.address;

  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  let mockPublicKey = "";
  let readCount = 0;
  const mock = await startMockServer({
    [`GET /users/${actorAddress}/key-agreement?keyVersion=2`]: (() => {
      return () => {
        readCount += 1;
        if (readCount === 1) {
          return { status: 404, body: { error: "key_agreement_not_found" } };
        }
        return {
          status: 200,
          body: {
            keyAgreement: {
              address: actorAddress,
              publicKeyMultibase: mockPublicKey,
              keyVersion: 2,
              expiresAt: "2099-01-01T00:00:00.000Z",
              createdAt: "2099-01-01T00:00:00.000Z",
              updatedAt: "2099-01-01T00:00:00.000Z",
              isExpired: false
            }
          }
        };
      };
    })(),
    "PUT /users/me/key-agreement": (request) => {
      mockPublicKey = request.body?.publicKeyMultibase || "";
      return { status: 200, body: { ok: true } };
    }
  });
  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: buildJwtWithExp(4102444800),
          refreshToken: "refresh-token-1",
          address: actorAddress,
          alias: "bot"
        },
        null,
        2
      ),
    );
    const result = await runCli([
      "key-agreement-upsert",
      "--auth-state-file",
      authStateFile,
      "--key-version",
      "2",
      "--json"
    ], { HOME: tempHome });
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.match(payload.keyFile, new RegExp(`${tempHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.config/clawnera/key-agreements/`));
    assert.equal(payload.keyVersion, 2);
    assert.equal(payload.publicKeyMultibase, mockPublicKey);
    assert.equal(JSON.stringify(payload).includes("privateKeyMultibase"), false);
    assert.equal(JSON.stringify(payload).includes("privateKeyEnvelope"), false);
    const storedKeyRecord = JSON.parse(readFileSync(payload.keyFile, "utf8"));
    assert.equal(Object.prototype.hasOwnProperty.call(storedKeyRecord, "privateKeyMultibase"), false);
  } finally {
    await mock.close();
  }
});

test("key-agreement-upsert creates no local key unless the initial GET is valid or exactly not found", async (t) => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-key-initial-read-"));
  const walletInit = await runCli(["wallet-init", "--alias", "bot", "--json"], { HOME: tempHome });
  assert.equal(walletInit.status, 0);
  const actorAddress = JSON.parse(walletInit.stdout).address;
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  const keyDirectory = path.join(tempHome, ".config", "clawnera", "key-agreements");
  const keyFile = path.join(keyDirectory, `${actorAddress}.v1.json`);
  const masterKeyFile = path.join(keyDirectory, ".key-agreement-master-key");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  const cases = [
    {
      name: "wrong 404 body",
      response: { status: 404, body: { error: "not_found" } },
      expectedError: "key_agreement_initial_read_failed",
    },
    {
      name: "unauthorized",
      response: { status: 401, body: { error: "unauthorized" } },
      expectedError: "key_agreement_initial_read_failed",
    },
    {
      name: "server failure",
      response: { status: 500, body: { error: "internal_error" } },
      expectedError: "key_agreement_initial_read_failed",
    },
    {
      name: "malformed success",
      response: { status: 200, body: { ok: true } },
      expectedError: "invalid_key_agreement_initial_readback",
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      let putCount = 0;
      const mock = await startMockServer({
        [`GET /users/${actorAddress}/key-agreement?keyVersion=1`]: () => testCase.response,
        "PUT /users/me/key-agreement": () => {
          putCount += 1;
          return { status: 500, body: { error: "should_not_put" } };
        },
      });
      try {
        writeFileSync(
          authStateFile,
          JSON.stringify({
            apiBase: mock.baseUrl,
            token: buildJwtWithExp(4102444800),
            refreshToken: "refresh-token-1",
            address: actorAddress,
            alias: "bot",
          }, null, 2),
        );
        const result = await runCli([
          "key-agreement-upsert",
          "--auth-state-file",
          authStateFile,
          "--json",
        ], { HOME: tempHome });
        assert.equal(result.status, 1);
        assert.equal(JSON.parse(result.stdout).error, testCase.expectedError);
        assert.equal(putCount, 0);
        assert.equal(existsSync(keyFile), false);
        assert.equal(existsSync(masterKeyFile), false);
      } finally {
        await mock.close();
      }
    });
  }
});

test("concurrent key-agreement upserts allow one binding and keep the successful local key aligned", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-key-upsert-race-"));
  const walletInit = await runCli(["wallet-init", "--alias", "bot", "--json"], { HOME: tempHome });
  assert.equal(walletInit.status, 0);
  const actorAddress = JSON.parse(walletInit.stdout).address;
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  let remoteKeyAgreement = null;
  let putCount = 0;
  const mock = await startMockServer({
    [`GET /users/${actorAddress}/key-agreement?keyVersion=1`]: async () => {
      if (!remoteKeyAgreement) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { status: 404, body: { error: "key_agreement_not_found" } };
      }
      return { status: 200, body: { keyAgreement: remoteKeyAgreement } };
    },
    "PUT /users/me/key-agreement": (request) => {
      putCount += 1;
      if (remoteKeyAgreement) {
        return { status: 409, body: { error: "key_agreement_version_conflict" } };
      }
      remoteKeyAgreement = {
        address: actorAddress,
        publicKeyMultibase: request.body?.publicKeyMultibase,
        keyVersion: request.body?.keyVersion,
        expiresAt: new Date(request.body?.expiresAtMs).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isExpired: false,
      };
      return { status: 200, body: { keyAgreement: remoteKeyAgreement } };
    },
  });
  try {
    writeFileSync(authStateFile, JSON.stringify({
      apiBase: mock.baseUrl,
      token: buildJwtWithExp(4102444800),
      refreshToken: "refresh-token-1",
      address: actorAddress,
      alias: "bot",
    }, null, 2));
    const args = ["key-agreement-upsert", "--auth-state-file", authStateFile, "--json"];
    const results = await Promise.all([
      runCli(args, { HOME: tempHome }),
      runCli(args, { HOME: tempHome }),
    ]);
    const successes = results.filter((result) => result.status === 0).map((result) => JSON.parse(result.stdout));
    const failures = results.filter((result) => result.status !== 0).map((result) => JSON.parse(result.stdout));
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].error, "secret_file_write_in_progress");
    assert.equal(putCount, 1);
    assert.equal(successes[0].publicKeyMultibase, remoteKeyAgreement.publicKeyMultibase);
    const localRecord = JSON.parse(readFileSync(successes[0].keyFile, "utf8"));
    assert.equal(localRecord.publicKeyMultibase, remoteKeyAgreement.publicKeyMultibase);
  } finally {
    await mock.close();
  }
});

test("key-agreement-upsert exits nonzero when the PUT succeeded but readback still lags", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-key-pending-"));
  const walletInit = await runCli(["wallet-init", "--alias", "bot", "--json"], { HOME: tempHome });
  assert.equal(walletInit.status, 0);
  const walletPayload = JSON.parse(walletInit.stdout);
  const actorAddress = walletPayload.address;

  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  const mock = await startMockServer({
    [`GET /users/${actorAddress}/key-agreement?keyVersion=1`]: () => ({
      status: 404,
      body: { error: "key_agreement_not_found" }
    }),
    "PUT /users/me/key-agreement": () => ({
      status: 200,
      body: { ok: true }
    })
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: buildJwtWithExp(4102444800),
          refreshToken: "refresh-token-1",
          address: actorAddress,
          alias: "bot"
        },
        null,
        2
      ),
    );
    const result = await runCli([
      "key-agreement-upsert",
      "--auth-state-file",
      authStateFile,
      "--json"
    ], { HOME: tempHome });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "key_agreement_readback_pending");
    assert.equal(payload.writeCommitted, true);
    assert.equal(payload.readbackPending, true);
    assert.equal(payload.warning, "key_agreement_readback_pending");
    assert.match(payload.verifyHint, new RegExp(`/users/${actorAddress}/key-agreement\\?keyVersion=1`));
  } finally {
    await mock.close();
  }
});

test("key-agreement-upsert exits nonzero when GET returns the same expired public key", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-key-readback-expired-"));
  const walletInit = await runCli(["wallet-init", "--alias", "bot", "--json"], { HOME: tempHome });
  assert.equal(walletInit.status, 0);
  const walletPayload = JSON.parse(walletInit.stdout);
  const actorAddress = walletPayload.address;
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  const keyFile = path.join(tempHome, "delivery-key.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "http://127.0.0.1:1",
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: actorAddress,
        alias: "bot"
      },
      null,
      2
    ),
  );

  const deliveryKeys = generateKeyAgreementKeypair("u");
  await saveKeyAgreementRecord({
    address: actorAddress,
    keyVersion: 1,
    publicKeyMultibase: deliveryKeys.publicKeyMultibase,
    privateKeyMultibase: deliveryKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: keyFile
  });

  let readCount = 0;
  const mock = await startMockServer({
    [`GET /users/${actorAddress}/key-agreement?keyVersion=1`]: () => {
      readCount += 1;
      if (readCount === 1) {
        return {
          status: 404,
          body: { error: "key_agreement_not_found" }
        };
      }
      return {
        status: 200,
        body: {
          keyAgreement: {
            address: actorAddress,
            publicKeyMultibase: deliveryKeys.publicKeyMultibase,
            keyVersion: 1,
            expiresAt: "2026-03-20T00:00:00.000Z",
            createdAt: "2026-03-19T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
            isExpired: true
          }
        }
      };
    },
    "PUT /users/me/key-agreement": (request) => ({
      status: 200,
      body: {
        keyAgreement: {
          address: actorAddress,
          publicKeyMultibase: request.body?.publicKeyMultibase,
          keyVersion: request.body?.keyVersion,
          expiresAt: new Date(request.body?.expiresAtMs || Date.now() + 86_400_000).toISOString(),
          updatedAt: "2099-01-01T00:00:00.000Z",
          isExpired: false
        }
      }
    })
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: buildJwtWithExp(4102444800),
          refreshToken: "refresh-token-1",
          address: actorAddress,
          alias: "bot"
        },
        null,
        2
      ),
    );
    const result = await runCli([
      "key-agreement-upsert",
      "--auth-state-file",
      authStateFile,
      "--key-file",
      keyFile,
      "--json"
    ], { HOME: tempHome });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "key_agreement_readback_mismatch");
    assert.equal(payload.writeCommitted, true);
    assert.equal(payload.readbackPending, false);
    assert.equal(payload.warning, "key_agreement_readback_mismatch");
    assert.equal(payload.readback?.isExpired, true);
    assert.equal(payload.writeResponseKeyAgreement?.isExpired, false);
    assert.match(payload.verifyHint, new RegExp(`/users/${actorAddress}/key-agreement\\?keyVersion=1`));
  } finally {
    await mock.close();
  }
});

test("key-agreement-upsert fails clearly when the remote version exists but no matching local private key file is available", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-key-conflict-"));
  const walletInit = await runCli(["wallet-init", "--alias", "bot", "--json"], { HOME: tempHome });
  assert.equal(walletInit.status, 0);
  const walletPayload = JSON.parse(walletInit.stdout);
  const actorAddress = walletPayload.address;
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        apiBase: "http://127.0.0.1:1",
        token: buildJwtWithExp(4102444800),
        refreshToken: "refresh-token-1",
        address: actorAddress,
        alias: "bot"
      },
      null,
      2
    ),
  );

  let putCount = 0;
  const mock = await startMockServer({
    [`GET /users/${actorAddress}/key-agreement?keyVersion=1`]: () => ({
      status: 200,
      body: {
        keyAgreement: {
          address: actorAddress,
          publicKeyMultibase: "uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          keyVersion: 1,
          expiresAt: "2099-01-01T00:00:00.000Z",
          createdAt: "2099-01-01T00:00:00.000Z",
          updatedAt: "2099-01-01T00:00:00.000Z",
          isExpired: false
        }
      }
    }),
    "PUT /users/me/key-agreement": () => {
      putCount += 1;
      return { status: 500, body: { error: "should_not_put" } };
    }
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: buildJwtWithExp(4102444800),
          refreshToken: "refresh-token-1",
          address: actorAddress,
          alias: "bot"
        },
        null,
        2
      ),
    );
    const result = await runCli([
      "key-agreement-upsert",
      "--auth-state-file",
      authStateFile,
      "--json"
    ], { HOME: tempHome });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "existing_remote_key_requires_local_key_file");
    assert.equal(putCount, 0);
  } finally {
    await mock.close();
  }
});

test("reviewer-register stops before plan creation when the transport key readback is not ready", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-register-key-readback-"));
  const walletInit = await runCli(["wallet-init", "--alias", "reviewer", "--json"], { HOME: tempHome });
  assert.equal(walletInit.status, 0);
  const walletPayload = JSON.parse(walletInit.stdout);
  const actorAddress = walletPayload.address;
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  const keyFile = path.join(tempHome, "reviewer-key-agreement.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });

  const reviewerKeys = generateKeyAgreementKeypair("u");
  await saveKeyAgreementRecord({
    address: actorAddress,
    keyVersion: 1,
    publicKeyMultibase: reviewerKeys.publicKeyMultibase,
    privateKeyMultibase: reviewerKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: keyFile,
  });

  let registerCalls = 0;
  const mock = await startMockServer({
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: false,
        runtime: {
          reviewerRegistryObjectId: WRITE_GATE_OBJECT_IDS.reviewerRegistryObjectId,
          disputeQuorumConfigObjectId: WRITE_GATE_OBJECT_IDS.disputeQuorumConfigObjectId,
        },
      },
    }),
    "GET /policy/fees": () => ({
      status: 200,
      body: buildFreshMarketplacePolicyResponse(),
    }),
    [`GET /users/${actorAddress}/key-agreement?keyVersion=1`]: () => ({
      status: 404,
      body: {
        error: "key_agreement_not_found",
      },
    }),
    "POST /reviewers/register": () => {
      registerCalls += 1;
      return {
        status: 500,
        body: {
          error: "should_not_register",
        },
      };
    },
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getObject") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              data: {
                objectId: WRITE_GATE_OBJECT_IDS.disputeQuorumConfigObjectId,
                type: `${WRITE_GATE_PACKAGE_IDS.settlement}::dispute_quorum::DisputeQuorumConfig`,
                previousTransaction: "init-reviewer-registry-1",
                content: {
                  fields: {
                    default_required_reviewer_votes: "3",
                    min_required_reviewer_votes: "3",
                    min_dispute_bond_per_side_iota: "500000",
                    reviewer_min_stake_iota: "500000",
                  },
                },
              },
            },
          },
        };
      }
      if (method === "iotax_getOwnedObjects") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              data: [
                {
                  data: {
                    objectId: "0x4444444444444444444444444444444444444444444444444444444444444444",
                  },
                },
              ],
            },
          },
        };
      }
      throw new Error(`unexpected_rpc_method:${String(method)}`);
    },
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: buildJwtWithExp(4102444800),
          refreshToken: "refresh-token-1",
          address: actorAddress,
          alias: "reviewer",
        },
        null,
        2,
      ),
    );
    const result = await runCli(
      [
        "reviewer-register",
        "--auth-state-file",
        authStateFile,
        "--transport-key-file",
        keyFile,
        "--rpc-url",
        `${mock.baseUrl}/rpc`,
        "--json",
      ],
      { HOME: tempHome },
    );
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "transport_key_agreement_readback_not_ready");
    assert.equal(payload.keyVersion, 1);
    assert.match(payload.verifyPath, new RegExp(`/users/${actorAddress}/key-agreement\\?keyVersion=1`));
    assert.match(payload.hint, /before rerunning reviewer-register/);
    assert.equal(registerCalls, 0);
  } finally {
    await mock.close();
  }
});

test("reviewer-update stops before plan creation when the rotated transport key readback is not ready", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-update-key-readback-"));
  const walletInit = await runCli(["wallet-init", "--alias", "reviewer", "--json"], { HOME: tempHome });
  assert.equal(walletInit.status, 0);
  const walletPayload = JSON.parse(walletInit.stdout);
  const actorAddress = walletPayload.address;
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  const keyFile = path.join(tempHome, "reviewer-key-agreement-v2.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });

  const reviewerKeys = generateKeyAgreementKeypair("u");
  await saveKeyAgreementRecord({
    address: actorAddress,
    keyVersion: 2,
    publicKeyMultibase: reviewerKeys.publicKeyMultibase,
    privateKeyMultibase: reviewerKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: keyFile,
  });

  let updateCalls = 0;
  const mock = await startMockServer({
    [`GET /reviewers/${actorAddress}`]: () => ({
      status: 200,
      body: {
        reviewer: {
          objectId: "0x5555555555555555555555555555555555555555555555555555555555555555",
          owner: actorAddress,
          active: true,
          transportType: 0,
          minCaseRewardIota: "1",
        },
      },
    }),
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        runtime: {
          reviewerRegistryObjectId: WRITE_GATE_OBJECT_IDS.reviewerRegistryObjectId,
          disputeQuorumConfigObjectId: WRITE_GATE_OBJECT_IDS.disputeQuorumConfigObjectId,
        },
      },
    }),
    "GET /policy/fees": () => ({
      status: 200,
      body: buildFreshMarketplacePolicyResponse(),
    }),
    [`GET /users/${actorAddress}/key-agreement?keyVersion=2`]: () => ({
      status: 404,
      body: {
        error: "key_agreement_not_found",
      },
    }),
    "POST /reviewers/update": () => {
      updateCalls += 1;
      return {
        status: 500,
        body: {
          error: "should_not_update",
        },
      };
    },
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getObject") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              data: {
                objectId: WRITE_GATE_OBJECT_IDS.disputeQuorumConfigObjectId,
                type: `${WRITE_GATE_PACKAGE_IDS.settlement}::dispute_quorum::DisputeQuorumConfig`,
                previousTransaction: "init-reviewer-registry-1",
                content: {
                  fields: {
                    default_required_reviewer_votes: "3",
                    min_required_reviewer_votes: "3",
                    min_dispute_bond_per_side_iota: "500000",
                    reviewer_min_stake_iota: "500000",
                  },
                },
              },
            },
          },
        };
      }
      throw new Error(`unexpected_rpc_method:${String(method)}`);
    },
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: buildJwtWithExp(4102444800),
          refreshToken: "refresh-token-1",
          address: actorAddress,
          alias: "reviewer",
        },
        null,
        2,
      ),
    );
    const result = await runCli(
      [
        "reviewer-update",
        "--auth-state-file",
        authStateFile,
        "--transport-key-file",
        keyFile,
        "--transport-key-version",
        "2",
        "--rpc-url",
        `${mock.baseUrl}/rpc`,
        "--json",
      ],
      { HOME: tempHome },
    );
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "transport_key_agreement_readback_not_ready");
    assert.equal(payload.keyVersion, 2);
    assert.match(payload.verifyPath, new RegExp(`/users/${actorAddress}/key-agreement\\?keyVersion=2`));
    assert.match(payload.hint, /before rerunning reviewer-update/);
    assert.equal(updateCalls, 0);
  } finally {
    await mock.close();
  }
});

test("reviewer-register auto-resolves the latest non-expired transport key when transport args are omitted", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-register-latest-key-"));
  const walletInit = await runCli(["wallet-init", "--alias", "reviewer", "--json"], { HOME: tempHome });
  assert.equal(walletInit.status, 0);
  const walletPayload = JSON.parse(walletInit.stdout);
  const actorAddress = walletPayload.address;
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  const keyDir = path.join(tempHome, ".config", "clawnera", "key-agreements");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  mkdirSync(keyDir, { recursive: true });

  const staleKeys = generateKeyAgreementKeypair("u");
  const currentKeys = generateKeyAgreementKeypair("u");
  await saveKeyAgreementRecord({
    address: actorAddress,
    keyVersion: 1,
    publicKeyMultibase: staleKeys.publicKeyMultibase,
    privateKeyMultibase: staleKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: path.join(keyDir, `${actorAddress}.v1.json`),
  });
  await saveKeyAgreementRecord({
    address: actorAddress,
    keyVersion: 2,
    publicKeyMultibase: currentKeys.publicKeyMultibase,
    privateKeyMultibase: currentKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: path.join(keyDir, `${actorAddress}.v3.json`),
  });

  let registerCalls = 0;
  const requestedKeyAgreementPaths = [];
  const currentTransportPubkeyHex = Buffer.from(currentKeys.publicKeyMultibase.slice(1), "base64url").toString("hex");
  const mock = await startMockServer({
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: false,
        runtime: {
          reviewerRegistryObjectId: WRITE_GATE_OBJECT_IDS.reviewerRegistryObjectId,
          disputeQuorumConfigObjectId: WRITE_GATE_OBJECT_IDS.disputeQuorumConfigObjectId,
        },
      },
    }),
    "GET /policy/fees": () => ({
      status: 200,
      body: buildFreshMarketplacePolicyResponse(),
    }),
    [`GET /users/${actorAddress}/key-agreement?keyVersion=1`]: () => {
      requestedKeyAgreementPaths.push(`/users/${actorAddress}/key-agreement?keyVersion=1`);
      return {
        status: 200,
        body: {
          keyAgreement: {
            address: actorAddress,
            publicKeyMultibase: staleKeys.publicKeyMultibase,
            keyVersion: 1,
            expiresAt: "2001-01-01T00:00:00.000Z",
            createdAt: "2000-01-01T00:00:00.000Z",
            updatedAt: "2000-01-01T00:00:00.000Z",
            isExpired: true,
          },
        },
      };
    },
    [`GET /users/${actorAddress}/key-agreement?keyVersion=2`]: () => {
      requestedKeyAgreementPaths.push(`/users/${actorAddress}/key-agreement?keyVersion=2`);
      return {
        status: 200,
        body: {
          keyAgreement: {
            address: actorAddress,
            publicKeyMultibase: currentKeys.publicKeyMultibase,
            keyVersion: 2,
            expiresAt: "2099-01-01T00:00:00.000Z",
            createdAt: "2099-01-01T00:00:00.000Z",
            updatedAt: "2099-01-01T00:00:00.000Z",
            isExpired: false,
          },
        },
      };
    },
    [`GET /users/${actorAddress}/key-agreement?keyVersion=3`]: () => {
      requestedKeyAgreementPaths.push(`/users/${actorAddress}/key-agreement?keyVersion=3`);
      return {
        status: 404,
        body: {
          error: "key_agreement_not_found",
        },
      };
    },
    "POST /reviewers/register": (request) => {
      registerCalls += 1;
      assert.equal(request.body?.transportPubkeyHex, currentTransportPubkeyHex);
      return {
        status: 400,
        body: {
          error: "expected_plan_failure",
        },
      };
    },
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getObject") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              data: {
                objectId: WRITE_GATE_OBJECT_IDS.disputeQuorumConfigObjectId,
                type: `${WRITE_GATE_PACKAGE_IDS.settlement}::dispute_quorum::DisputeQuorumConfig`,
                previousTransaction: "init-reviewer-registry-1",
                content: {
                  fields: {
                    default_required_reviewer_votes: "3",
                    min_required_reviewer_votes: "3",
                    min_dispute_bond_per_side_iota: "500000",
                    reviewer_min_stake_iota: "500000",
                  },
                },
              },
            },
          },
        };
      }
      if (method === "iotax_getOwnedObjects") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              data: [
                {
                  data: {
                    objectId: "0x4444444444444444444444444444444444444444444444444444444444444444",
                  },
                },
              ],
            },
          },
        };
      }
      throw new Error(`unexpected_rpc_method:${String(method)}`);
    },
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: buildJwtWithExp(4102444800),
          refreshToken: "refresh-token-1",
          address: actorAddress,
          alias: "reviewer",
        },
        null,
        2,
      ),
    );
    const result = await runCli(
      [
        "reviewer-register",
        "--auth-state-file",
        authStateFile,
        "--rpc-url",
        `${mock.baseUrl}/rpc`,
        "--json",
      ],
      { HOME: tempHome },
    );
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "expected_plan_failure");
    assert.equal(payload.requestBody.transportPubkeyHex, currentTransportPubkeyHex);
    assert.equal(payload.requestBody.minCaseRewardNative, "1");
    assert.equal(payload.requestBody.minCaseRewardIota, undefined);
    assert.equal(registerCalls, 1);
    assert.ok(requestedKeyAgreementPaths.includes(`/users/${actorAddress}/key-agreement?keyVersion=2`));
  } finally {
    await mock.close();
  }
});

test("reviewer-update auto-resolves the latest non-expired transport key when transport args are omitted", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-reviewer-update-latest-key-"));
  const walletInit = await runCli(["wallet-init", "--alias", "reviewer", "--json"], { HOME: tempHome });
  assert.equal(walletInit.status, 0);
  const walletPayload = JSON.parse(walletInit.stdout);
  const actorAddress = walletPayload.address;
  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  const keyDir = path.join(tempHome, ".config", "clawnera", "key-agreements");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  mkdirSync(keyDir, { recursive: true });

  const staleKeys = generateKeyAgreementKeypair("u");
  const currentKeys = generateKeyAgreementKeypair("u");
  await saveKeyAgreementRecord({
    address: actorAddress,
    keyVersion: 1,
    publicKeyMultibase: staleKeys.publicKeyMultibase,
    privateKeyMultibase: staleKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: path.join(keyDir, `${actorAddress}.v1.json`),
  });
  await saveKeyAgreementRecord({
    address: actorAddress,
    keyVersion: 2,
    publicKeyMultibase: currentKeys.publicKeyMultibase,
    privateKeyMultibase: currentKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: path.join(keyDir, `${actorAddress}.v3.json`),
  });

  let updateCalls = 0;
  const requestedKeyAgreementPaths = [];
  const currentTransportPubkeyHex = Buffer.from(currentKeys.publicKeyMultibase.slice(1), "base64url").toString("hex");
  const mock = await startMockServer({
    [`GET /reviewers/${actorAddress}`]: () => ({
      status: 200,
      body: {
        reviewer: {
          objectId: "0x5555555555555555555555555555555555555555555555555555555555555555",
          owner: actorAddress,
          active: true,
          transportType: 0,
          minCaseRewardIota: "1",
        },
      },
    }),
    "GET /reviewers/me/metrics": () => ({
      status: 200,
      body: {
        registered: true,
        runtime: {
          reviewerRegistryObjectId: WRITE_GATE_OBJECT_IDS.reviewerRegistryObjectId,
          disputeQuorumConfigObjectId: WRITE_GATE_OBJECT_IDS.disputeQuorumConfigObjectId,
        },
      },
    }),
    "GET /policy/fees": () => ({
      status: 200,
      body: buildFreshMarketplacePolicyResponse(),
    }),
    [`GET /users/${actorAddress}/key-agreement?keyVersion=1`]: () => {
      requestedKeyAgreementPaths.push(`/users/${actorAddress}/key-agreement?keyVersion=1`);
      return {
        status: 200,
        body: {
          keyAgreement: {
            address: actorAddress,
            publicKeyMultibase: staleKeys.publicKeyMultibase,
            keyVersion: 1,
            expiresAt: "2001-01-01T00:00:00.000Z",
            createdAt: "2000-01-01T00:00:00.000Z",
            updatedAt: "2000-01-01T00:00:00.000Z",
            isExpired: true,
          },
        },
      };
    },
    [`GET /users/${actorAddress}/key-agreement?keyVersion=2`]: () => {
      requestedKeyAgreementPaths.push(`/users/${actorAddress}/key-agreement?keyVersion=2`);
      return {
        status: 200,
        body: {
          keyAgreement: {
            address: actorAddress,
            publicKeyMultibase: currentKeys.publicKeyMultibase,
            keyVersion: 2,
            expiresAt: "2099-01-01T00:00:00.000Z",
            createdAt: "2099-01-01T00:00:00.000Z",
            updatedAt: "2099-01-01T00:00:00.000Z",
            isExpired: false,
          },
        },
      };
    },
    [`GET /users/${actorAddress}/key-agreement?keyVersion=3`]: () => {
      requestedKeyAgreementPaths.push(`/users/${actorAddress}/key-agreement?keyVersion=3`);
      return {
        status: 404,
        body: {
          error: "key_agreement_not_found",
        },
      };
    },
    "POST /reviewers/update": (request) => {
      updateCalls += 1;
      assert.equal(request.body?.transportPubkeyHex, currentTransportPubkeyHex);
      return {
        status: 400,
        body: {
          error: "expected_plan_failure",
        },
      };
    },
    "POST /rpc": (request) => {
      const method = request.body?.method;
      if (method === "iota_getObject") {
        return {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: request.body?.id ?? 1,
            result: {
              data: {
                objectId: WRITE_GATE_OBJECT_IDS.disputeQuorumConfigObjectId,
                type: `${WRITE_GATE_PACKAGE_IDS.settlement}::dispute_quorum::DisputeQuorumConfig`,
                previousTransaction: "init-reviewer-registry-1",
                content: {
                  fields: {
                    default_required_reviewer_votes: "3",
                    min_required_reviewer_votes: "3",
                    min_dispute_bond_per_side_iota: "500000",
                    reviewer_min_stake_iota: "500000",
                  },
                },
              },
            },
          },
        };
      }
      throw new Error(`unexpected_rpc_method:${String(method)}`);
    },
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: buildJwtWithExp(4102444800),
          refreshToken: "refresh-token-1",
          address: actorAddress,
          alias: "reviewer",
        },
        null,
        2,
      ),
    );
    const result = await runCli(
      [
        "reviewer-update",
        "--auth-state-file",
        authStateFile,
        "--rpc-url",
        `${mock.baseUrl}/rpc`,
        "--json",
      ],
      { HOME: tempHome },
    );
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "expected_plan_failure");
    assert.equal(payload.requestBody.transportPubkeyHex, currentTransportPubkeyHex);
    assert.equal(payload.requestBody.minCaseRewardNative, "1");
    assert.equal(payload.requestBody.minCaseRewardIota, undefined);
    assert.equal(updateCalls, 1);
    assert.ok(requestedKeyAgreementPaths.includes(`/users/${actorAddress}/key-agreement?keyVersion=2`));
  } finally {
    await mock.close();
  }
});

test("deliverable-encrypt retries transient reads and writes the payload beside the plaintext file by default", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-deliverable-encrypt-"));
  const plaintextDir = path.join(tempHome, "artifacts");
  mkdirSync(plaintextDir, { recursive: true });
  const plaintextFile = path.join(plaintextDir, "deliverable.txt");
  writeFileSync(plaintextFile, "hello managed world", "utf8");

  const sellerKeys = generateKeyAgreementKeypair("u");
  const buyerKeys = generateKeyAgreementKeypair("u");
  const sellerAddress = `0x${"8".repeat(64)}`;
  const buyerAddress = `0x${"9".repeat(64)}`;
  const orderId = "11111111-2222-4333-8444-555555555555";
  const milestoneId = "66666666-7777-4888-8999-aaaaaaaaaaaa";

  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token",
        actorAddress: sellerAddress,
        apiBase: "http://127.0.0.1:1"
      },
      null,
      2
    ),
    "utf8"
  );

  const sellerKeyFile = path.join(tempHome, "seller-key-agreement.json");
  await saveKeyAgreementRecord({
    address: sellerAddress,
    keyVersion: 1,
    publicKeyMultibase: sellerKeys.publicKeyMultibase,
    privateKeyMultibase: sellerKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: sellerKeyFile
  });

  let orderReads = 0;
  let sellerKeyReads = 0;
  const mock = await startMockServer({
    [`GET /orders/${orderId}`]: () => {
      orderReads += 1;
      if (orderReads === 1) {
        return {
          status: 504,
          body: { error: "backend_timeout" }
        };
      }
      return {
        status: 200,
        body: {
          order: {
            orderId,
            sellerAddress,
            buyerAddress
          }
        }
      };
    },
    [`GET /users/${sellerAddress}/key-agreement?keyVersion=1`]: () => {
      sellerKeyReads += 1;
      if (sellerKeyReads === 1) {
        return {
          status: 504,
          body: { error: "backend_timeout" }
        };
      }
      return {
        status: 200,
        body: {
          keyAgreement: {
            address: sellerAddress,
            publicKeyMultibase: sellerKeys.publicKeyMultibase,
            keyVersion: 1,
            expiresAt: "2099-01-01T00:00:00.000Z",
            createdAt: "2099-01-01T00:00:00.000Z",
            updatedAt: "2099-01-01T00:00:00.000Z",
            isExpired: false
          }
        }
      };
    },
    [`GET /users/${buyerAddress}/key-agreement?keyVersion=1`]: () => ({
      status: 200,
      body: {
        keyAgreement: {
          address: buyerAddress,
          publicKeyMultibase: buyerKeys.publicKeyMultibase,
          keyVersion: 1,
          expiresAt: "2099-01-01T00:00:00.000Z",
          createdAt: "2099-01-01T00:00:00.000Z",
          updatedAt: "2099-01-01T00:00:00.000Z",
          isExpired: false
        }
      }
    }),
    "GET /policy/storage": () => ({
      status: 200,
      body: {
        policy: {
          modes: {
            managed: {
              enabled: true,
              allowedMimeTypes: ["application/json"]
            }
          }
        }
      }
    })
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
          refreshToken: "refresh-token",
          actorAddress: sellerAddress,
          apiBase: mock.baseUrl
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await runCli(
      [
        "deliverable-encrypt",
        "--order-id",
        orderId,
        "--milestone-id",
        milestoneId,
        "--plaintext-file",
        plaintextFile,
        "--auth-state-file",
        authStateFile,
        "--seller-key-file",
        sellerKeyFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(path.dirname(payload.payloadOut), plaintextDir);
    assert.ok(existsSync(payload.payloadOut));
    assert.equal(orderReads, 2);
    assert.equal(sellerKeyReads, 2);
    assert.match(payload.nextUploadHint, /pinata-upload-json/);
    assert.match(payload.managedStorageHint, /V2 payment proof/);
  } finally {
    await mock.close();
  }
});

test("deliverable-encrypt auto-resolves the latest non-expired key-agreement versions and matching local seller key", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-deliverable-encrypt-rotated-"));
  const plaintextDir = path.join(tempHome, "artifacts");
  mkdirSync(plaintextDir, { recursive: true });
  const plaintextFile = path.join(plaintextDir, "deliverable.txt");
  writeFileSync(plaintextFile, "hello rotated world", "utf8");

  const sellerKeys = generateKeyAgreementKeypair("u");
  const staleSellerKeys = generateKeyAgreementKeypair("u");
  const buyerKeys = generateKeyAgreementKeypair("u");
  const staleBuyerKeys = generateKeyAgreementKeypair("u");
  const sellerAddress = `0x${"a".repeat(64)}`;
  const buyerAddress = `0x${"b".repeat(64)}`;
  const orderId = "99999999-2222-4333-8444-555555555555";
  const milestoneId = "eeeeeeee-7777-4888-8999-aaaaaaaaaaaa";

  const authStateFile = path.join(tempHome, ".config", "clawnera", "auth-state.json");
  mkdirSync(path.dirname(authStateFile), { recursive: true });
  writeFileSync(
    authStateFile,
    JSON.stringify(
      {
        jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
        refreshToken: "refresh-token",
        actorAddress: sellerAddress,
        apiBase: "http://127.0.0.1:1"
      },
      null,
      2
    ),
    "utf8"
  );

  const sellerKeyDir = path.join(tempHome, ".config", "clawnera", "key-agreements");
  mkdirSync(sellerKeyDir, { recursive: true });
  const sellerKeyFile = path.join(sellerKeyDir, `${sellerAddress}.v3.json`);
  await saveKeyAgreementRecord({
    address: sellerAddress,
    keyVersion: 2,
    publicKeyMultibase: sellerKeys.publicKeyMultibase,
    privateKeyMultibase: sellerKeys.privateKeyMultibase,
    expiresAtMs: Date.now() + 86_400_000,
    filePath: sellerKeyFile
  });

  const requestedKeyAgreementPaths = [];
  const mock = await startMockServer({
    [`GET /orders/${orderId}`]: () => ({
      status: 200,
      body: {
        order: {
          orderId,
          sellerAddress,
          buyerAddress
        }
      }
    }),
    [`GET /users/${sellerAddress}/key-agreement?keyVersion=1`]: () => {
      requestedKeyAgreementPaths.push(`/users/${sellerAddress}/key-agreement?keyVersion=1`);
      return {
        status: 200,
        body: {
          keyAgreement: {
            address: sellerAddress,
            publicKeyMultibase: staleSellerKeys.publicKeyMultibase,
            keyVersion: 1,
            expiresAt: "2001-01-01T00:00:00.000Z",
            createdAt: "2000-01-01T00:00:00.000Z",
            updatedAt: "2000-01-01T00:00:00.000Z",
            isExpired: true
          }
        }
      };
    },
    [`GET /users/${sellerAddress}/key-agreement?keyVersion=2`]: () => {
      requestedKeyAgreementPaths.push(`/users/${sellerAddress}/key-agreement?keyVersion=2`);
      return {
        status: 200,
        body: {
          keyAgreement: {
            address: sellerAddress,
            publicKeyMultibase: sellerKeys.publicKeyMultibase,
            keyVersion: 2,
            expiresAt: "2099-01-01T00:00:00.000Z",
            createdAt: "2099-01-01T00:00:00.000Z",
            updatedAt: "2099-01-01T00:00:00.000Z",
            isExpired: false
          }
        }
      };
    },
    [`GET /users/${sellerAddress}/key-agreement?keyVersion=3`]: () => {
      requestedKeyAgreementPaths.push(`/users/${sellerAddress}/key-agreement?keyVersion=3`);
      return {
        status: 404,
        body: {
          error: "key_agreement_not_found"
        }
      };
    },
    [`GET /users/${buyerAddress}/key-agreement?keyVersion=1`]: () => {
      requestedKeyAgreementPaths.push(`/users/${buyerAddress}/key-agreement?keyVersion=1`);
      return {
        status: 200,
        body: {
          keyAgreement: {
            address: buyerAddress,
            publicKeyMultibase: staleBuyerKeys.publicKeyMultibase,
            keyVersion: 1,
            expiresAt: "2001-01-01T00:00:00.000Z",
            createdAt: "2000-01-01T00:00:00.000Z",
            updatedAt: "2000-01-01T00:00:00.000Z",
            isExpired: true
          }
        }
      };
    },
    [`GET /users/${buyerAddress}/key-agreement?keyVersion=2`]: () => {
      requestedKeyAgreementPaths.push(`/users/${buyerAddress}/key-agreement?keyVersion=2`);
      return {
        status: 200,
        body: {
          keyAgreement: {
            address: buyerAddress,
            publicKeyMultibase: buyerKeys.publicKeyMultibase,
            keyVersion: 2,
            expiresAt: "2099-01-01T00:00:00.000Z",
            createdAt: "2099-01-01T00:00:00.000Z",
            updatedAt: "2099-01-01T00:00:00.000Z",
            isExpired: false
          }
        }
      };
    },
    [`GET /users/${buyerAddress}/key-agreement?keyVersion=3`]: () => {
      requestedKeyAgreementPaths.push(`/users/${buyerAddress}/key-agreement?keyVersion=3`);
      return {
        status: 404,
        body: {
          error: "key_agreement_not_found"
        }
      };
    },
    "GET /policy/storage": () => ({
      status: 200,
      body: {
        policy: {
          modes: {
            managed: {
              enabled: true,
              allowedMimeTypes: ["application/json"]
            }
          }
        }
      }
    })
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          jwt: buildJwtWithExp(Math.floor(Date.now() / 1000) + 3600),
          refreshToken: "refresh-token",
          actorAddress: sellerAddress,
          apiBase: mock.baseUrl
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await runCli(
      [
        "deliverable-encrypt",
        "--order-id",
        orderId,
        "--milestone-id",
        milestoneId,
        "--plaintext-file",
        plaintextFile,
        "--auth-state-file",
        authStateFile,
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.sellerKeyVersion, 2);
    assert.equal(payload.buyerKeyVersion, 2);
    assert.ok(existsSync(payload.payloadOut));
    assert.ok(requestedKeyAgreementPaths.includes(`/users/${sellerAddress}/key-agreement?keyVersion=2`));
    assert.ok(requestedKeyAgreementPaths.includes(`/users/${buyerAddress}/key-agreement?keyVersion=2`));
    assert.doesNotMatch(payload.payloadOut, /\.v1\.json/);
  } finally {
    await mock.close();
  }
});

test("request dry-run hint preserves original request body", async () => {
  const mock = await startMockServer({
    "POST /orders/test/dispute-bond/fund": (request) => {
      assert.equal(request.body?.amount, "500000");
      return {
        status: 200,
        body: {
          txBuilder: "fundOrderDisputeBond",
          request: {
            bondObjectId: "0xabc",
            side: "buyer"
          }
        }
      };
    }
  });

  try {
    const result = await runCli([
      "request",
      "POST",
      "/orders/test/dispute-bond/fund",
      "--api-base",
      mock.baseUrl,
      "--body",
      "{\"amount\":\"500000\"}",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.txPlanDetected, true);
    assert.match(payload.nextCommandHint, /tx-plan-dry-run POST '\/orders\/test\/dispute-bond\/fund'/);
    assert.match(payload.nextCommandHint, /--body '\{\"amount\":\"500000\"\}'/);
  } finally {
    await mock.close();
  }
});

test("request marks Sui transaction bytes unverified and offers no execution hint", async () => {
  const mock = await startMockServer({
    "POST /orders/test/escrow/create": () => ({
      status: 200,
      body: {
        chainFamily: "sui",
        chainNetwork: "testnet",
        chainIdentifier: "test-chain",
        status: "sui_order_escrow_create_tx_plan_unsigned",
        transactionBytesBase64: "AQIDBA==",
        sourceGuard: txBytesGuard("AQIDBA=="),
        txPlan: {
          kind: "sui_ptb",
          sender: `0x${"1".repeat(64)}`,
          target: `0x${"2".repeat(64)}::order_escrow::create_order_escrow_sui_entry`
        }
      }
    })
  });

  try {
    const result = await runCli([
      "request",
      "POST",
      "/orders/test/escrow/create",
      "--api-base",
      mock.baseUrl,
      "--body",
      "{\"chainFamily\":\"sui\"}",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.txPlanDetected, false);
    assert.equal(payload.txPlanFamily, "sui");
    assert.equal(payload.rawTransactionBytesUnverified, true);
    assert.equal(payload.nextCommandHint, null);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run never runs or writes Sui transaction bytes", async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-sui-bytes-"));
  const txBytesOut = path.join(tmpDir, "sui.b64");
  const planOut = path.join(tmpDir, "sui-plan.json");
  let rpcCalls = 0;
  const mock = await startMockServer({
    "POST /orders/test/escrow/create": () => ({
      status: 200,
      body: {
        chainFamily: "sui",
        chainNetwork: "testnet",
        chainIdentifier: "test-chain",
        status: "sui_order_escrow_create_tx_plan_unsigned",
        transactionBytesBase64: "AQIDBA==",
        sourceGuard: txBytesGuard("AQIDBA=="),
        txPlan: {
          kind: "sui_ptb",
          sender: `0x${"1".repeat(64)}`,
          target: `0x${"2".repeat(64)}::order_escrow::create_order_escrow_sui_entry`
        }
      }
    }),
    "POST /": (request) => {
      rpcCalls += 1;
      if (request.body?.method === "sui_getChainIdentifier") {
        return {
          status: 200,
          body: { jsonrpc: "2.0", id: request.body?.id, result: "test-chain" }
        };
      }
      assert.equal(request.body?.method, "sui_dryRunTransactionBlock");
      assert.deepEqual(request.body?.params, ["AQIDBA=="]);
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: request.body?.id,
          result: {
            effects: {
              gasUsed: {
                computationCost: "1",
                storageCost: "2",
                storageRebate: "0",
                nonRefundableStorageFee: "0"
              }
            }
          }
        }
      };
    }
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/orders/test/escrow/create",
      "--api-base",
      mock.baseUrl,
      "--sui-rpc-url",
      mock.baseUrl,
      "--body",
      "{\"chainFamily\":\"sui\"}",
      "--plan-out",
      planOut,
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "raw_transaction_bytes_unverified");
    assert.equal(payload.chainFamily, "sui");
    assert.equal(rpcCalls, 0);
    assert.equal(existsSync(txBytesOut), false);
    assert.equal(existsSync(planOut), false);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run rejects untrusted Sui raw transaction plans before dry-run", async (t) => {
  const cases = [
    {
      name: "tampered transaction byte hash",
      topChainIdentifier: "test-chain",
      guardChainIdentifier: "test-chain",
      transactionBytesSha256: "0".repeat(64),
      rpcChainIdentifier: "test-chain",
      expectedError: "sui_transaction_bytes_sha256_mismatch",
      expectedRpcCalls: 0,
    },
    {
      name: "mismatched API and SourceGuard chain identifiers",
      topChainIdentifier: "test-chain",
      guardChainIdentifier: "other-chain",
      rpcChainIdentifier: "test-chain",
      expectedError: "tx_plan_chain_identifier_missing_or_mismatched",
      expectedRpcCalls: 0,
    },
    {
      name: "mismatched local RPC chain identifier",
      topChainIdentifier: "test-chain",
      guardChainIdentifier: "test-chain",
      rpcChainIdentifier: "other-chain",
      expectedError: "tx_plan_rpc_chain_identifier_mismatch",
      expectedRpcCalls: 0,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      let rpcCalls = 0;
      let dryRunCalls = 0;
      const sourceGuard = txBytesGuard("AQIDBA==", testCase.guardChainIdentifier);
      if (testCase.transactionBytesSha256) {
        sourceGuard.transactionBytesSha256 = testCase.transactionBytesSha256;
      }
      const mock = await startMockServer({
        "POST /orders/test/escrow/create": () => ({
          status: 200,
          body: {
            chainFamily: "sui",
            chainNetwork: "testnet",
            chainIdentifier: testCase.topChainIdentifier,
            status: "sui_order_escrow_create_tx_plan_unsigned",
            transactionBytesBase64: "AQIDBA==",
            sourceGuard,
            txPlan: {
              kind: "sui_ptb",
              sender: `0x${"1".repeat(64)}`,
              target: `0x${"2".repeat(64)}::order_escrow::create_order_escrow_sui_entry`,
            },
          },
        }),
        "POST /": (request) => {
          rpcCalls += 1;
          if (request.body?.method === "sui_dryRunTransactionBlock") {
            dryRunCalls += 1;
          }
          return {
            status: 200,
            body: {
              jsonrpc: "2.0",
              id: request.body?.id,
              result: testCase.rpcChainIdentifier,
            },
          };
        },
      });

      try {
        const result = await runCli([
          "tx-plan-dry-run",
          "POST",
          "/orders/test/escrow/create",
          "--api-base",
          mock.baseUrl,
          "--sui-rpc-url",
          mock.baseUrl,
          "--body",
          "{\"chainFamily\":\"sui\"}",
          "--json",
        ]);
        assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.error, "raw_transaction_bytes_unverified");
        assert.equal(rpcCalls, testCase.expectedRpcCalls);
        assert.equal(dryRunCalls, 0);
      } finally {
        await mock.close();
      }
    });
  }
});

test("tx-plan-dry-run rejects Sui private keys in process arguments before fetching a plan", async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-sui-exec-bytes-"));
  const txBytesOut = path.join(tmpDir, "sui.b64");
  const keypair = Ed25519Keypair.generate();
  const signerAddress = keypair.toSuiAddress();
  let executeRpcSeen = false;
  const mock = await startMockServer({
    "POST /orders/test/escrow/release": () => ({
      status: 200,
      body: {
        chainFamily: "sui",
        chainNetwork: "testnet",
        status: "sui_order_escrow_release_tx_plan_unsigned",
        transactionBytesBase64: "BQYHCA==",
        txPlan: {
          kind: "sui_ptb",
          sender: signerAddress,
          target: `0x${"2".repeat(64)}::order_escrow::release_order_escrow_sui_entry`
        }
      }
    }),
    "POST /": (request) => {
      assert.equal(request.body?.method, "sui_executeTransactionBlock");
      assert.equal(request.body?.params?.[0], "BQYHCA==");
      assert.ok(Array.isArray(request.body?.params?.[1]));
      assert.equal(request.body.params[1].length, 1);
      assert.equal(typeof request.body.params[1][0], "string");
      assert.equal(request.body?.params?.[2]?.showEffects, true);
      executeRpcSeen = true;
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: request.body?.id,
          result: {
            digest: "mock-sui-digest",
            effects: {
              status: {
                status: "success"
              }
            }
          }
        }
      };
    }
  });

  try {
    const result = await runCli([
      "tx-plan-dry-run",
      "POST",
      "/orders/test/escrow/release",
      "--api-base",
      mock.baseUrl,
      "--sui-rpc-url",
      mock.baseUrl,
      "--sui-private-key",
      keypair.getSecretKey(),
      "--body",
      "{\"chainFamily\":\"sui\"}",
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "sui_private_key_argv_disabled");
    assert.match(payload.hint, /protected Sui keystore/);
    assert.equal(existsSync(txBytesOut), false);
    assert.equal(executeRpcSeen, false);
  } finally {
    await mock.close();
  }
});

test("tx-plan-dry-run refuses raw Sui transaction bytes even without a signer", async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "clawnera-sui-no-signer-"));
  const mock = await startMockServer({
    "POST /orders/test/escrow/release": () => ({
      status: 200,
      body: {
        chainFamily: "sui",
        chainNetwork: "testnet",
        chainIdentifier: "test-chain",
        status: "sui_order_escrow_release_tx_plan_unsigned",
        transactionBytesBase64: "BQYHCA==",
        sourceGuard: txBytesGuard("BQYHCA=="),
        txPlan: {
          kind: "sui_ptb",
          sender: `0x${"1".repeat(64)}`,
          target: `0x${"2".repeat(64)}::order_escrow::release_order_escrow_sui_entry`
        }
      }
    }),
    "POST /": (request) => ({
      status: 200,
      body: { jsonrpc: "2.0", id: request.body?.id, result: "test-chain" }
    })
  });

  try {
    const result = await runCli(
      [
        "tx-plan-dry-run",
        "POST",
        "/orders/test/escrow/release",
        "--api-base",
        mock.baseUrl,
        "--sui-rpc-url",
        mock.baseUrl,
        "--body",
        "{\"chainFamily\":\"sui\"}",
        "--json"
      ],
      { HOME: tempHome }
    );
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "raw_transaction_bytes_unverified");
    assert.equal(payload.chainFamily, "sui");
    assert.match(payload.hint, /never treated as verified/);
  } finally {
    await mock.close();
  }
});

test("pinata upload rejects argv credentials and unsafe credential files", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-pinata-credentials-"));
  const payloadFile = path.join(tempDir, "payload.json");
  const jwtFile = path.join(tempDir, "pinata.jwt");
  writeFileSync(payloadFile, "{\"encrypted\":true}\n");
  writeFileSync(jwtFile, "secret-token\n", { mode: 0o644 });
  chmodSync(jwtFile, 0o644);

  const argvResult = await runCli([
    "pinata-upload-json",
    "--file",
    payloadFile,
    "--jwt",
    "secret-token",
    "--json",
  ]);
  assert.equal(argvResult.status, 1);
  assert.equal(JSON.parse(argvResult.stdout).error, "pinata_jwt_argv_disabled");

  const fileResult = await runCli([
    "pinata-upload-json",
    "--file",
    payloadFile,
    "--jwt-file",
    jwtFile,
    "--json",
  ]);
  assert.equal(fileResult.status, 1);
  const filePayload = JSON.parse(fileResult.stdout);
  assert.equal(filePayload.error, "invalid_pinata_jwt_file");
  assert.equal(filePayload.detail, "unsafe_secret_file_mode");
});

test("sponsor preflight surfaces runtime failures", async () => {
  const mock = await startMockServer({
    "POST /sponsor/preflight": () => ({
      status: 403,
      body: {
        error: "sponsor_capability_required"
      }
    })
  });

  try {
    const result = await runCli(["sponsor-preflight", "--api-base", mock.baseUrl, "--jwt", "test-jwt", "--json"]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "sponsor_preflight_failed");
    assert.equal(payload.status, 403);
    assert.equal(payload.response.error, "sponsor_capability_required");
  } finally {
    await mock.close();
  }
});

test("sponsor preflight accepts auth state and refreshes one invalid token response", async () => {
  const staleToken = buildJwtWithExp(1);
  const refreshedToken = buildJwtWithExp(4102444800);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-sponsor-preflight-refresh-"));
  const authStateFile = path.join(tempDir, "auth-state.json");

  const mock = await startMockServer({
    "POST /sponsor/preflight": (request) => {
      if (request.headers.authorization === `Bearer ${staleToken}`) {
        return { status: 401, body: { error: "invalid_token" } };
      }
      assert.equal(request.headers.authorization, `Bearer ${refreshedToken}`);
      assert.equal(request.body?.purpose, "marketplace_tx");
      assert.equal(request.body?.paymentCoin, "claw");
      assert.equal(request.body?.orderId, "order-1");
      return {
        status: 200,
        body: {
          paymentCoin: "claw",
          orderId: "order-1",
          txFamily: "marketplace_write",
          strategy: {
            sponsorLikelyAllowed: true,
            selfPayFallbackAvailable: true,
            strictMode: false
          },
          minimumGasBudget: 1000000,
          recommendedGasBudget: 2000000,
          maxGasBudget: 5000000,
          diagnostics: []
        }
      };
    },
    "POST /auth/refresh": (request) => {
      assert.equal(request.body?.refreshToken, "refresh-token-1");
      return {
        status: 200,
        body: {
          token: refreshedToken,
          refreshToken: "refresh-token-2",
          expiresAtMs: 4102444800000
        }
      };
    }
  });

  try {
    writeFileSync(
      authStateFile,
      JSON.stringify(
        {
          apiBase: mock.baseUrl,
          token: staleToken,
          refreshToken: "refresh-token-1",
          address: "0x1111111111111111111111111111111111111111111111111111111111111111",
          alias: "bot"
        },
        null,
        2
      )
    );
    const result = await runCli([
      "sponsor-preflight",
      "--api-base",
      mock.baseUrl,
      "--auth-state-file",
      authStateFile,
      "--order-id",
      "order-1",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.orderId, "order-1");
    assert.equal(payload.txFamily, "marketplace_write");
    const saved = JSON.parse(readFileSync(authStateFile, "utf8"));
    assert.equal(saved.token, refreshedToken);
    assert.equal(saved.refreshToken, "refresh-token-2");
  } finally {
    await mock.close();
  }
});

test("sponsor execute is quarantined before files, builders, reserve, or execute", async () => {
  const mock = await startMockServer({
    "POST /sponsor/reserve": () => ({ status: 500, body: { error: "must_not_reserve" } }),
    "POST /sponsor/execute": () => ({ status: 500, body: { error: "must_not_execute" } }),
  });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-sponsor-quarantine-"));
  const missingAuthState = path.join(tempDir, "missing-auth-state.json");
  const reservationOut = path.join(tempDir, "must-not-write-reservation.json");
  const builderMarker = path.join(tempDir, "must-not-run-builder");

  try {
    for (const command of ["sponsor-execute", "sponsor-run"]) {
      const result = await runCli([
        command,
        "--api-base",
        mock.baseUrl,
        "--auth-state-file",
        missingAuthState,
        "--order-id",
        "order-quarantined",
        "--reservation-out",
        reservationOut,
        "--build-cmd",
        `node -e "require('node:fs').writeFileSync('${builderMarker}', 'ran')"`,
        "--json",
      ]);

      assert.equal(result.status, 78);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.equal(payload.error, "sponsor_execute_quarantined");
      assert.equal(payload.exitCode, 78);
      assert.equal(payload.runtimePosture, "not_queried");
      assert.equal(payload.releaseBaseMode, "self_pay");
      assert.equal(payload.sponsorMode, "deferred");
    }
    assert.equal(mock.requests.length, 0);
    assert.equal(existsSync(missingAuthState), false);
    assert.equal(existsSync(reservationOut), false);
    assert.equal(existsSync(builderMarker), false);
  } finally {
    await mock.close();
  }
});

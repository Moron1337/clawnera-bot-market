import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliFile = path.join(repoRoot, "bin", "clawnera-help.mjs");

function buildJwtWithExp(expSeconds) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp: expSeconds })}.signature`;
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

    const handler = routes[`${request.method} ${request.url}`] || routes[request.url || "/"] || routes.default;
    const response = handler
      ? await handler(request)
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

test("tx-plan-execute rejects absolute URLs before requesting a plan", async () => {
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
    ["tx-plan-execute", "POST", "https://attacker.example/plan", "--auth-state-file", authStateFile, "--json"],
    {}
  );
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error, "absolute_api_url_not_allowed");
});

test("sponsor dry-run surfaces reserve auth failures", async () => {
  const mock = await startMockServer({
    "POST /sponsor/reserve": (request) => {
      assert.equal(request.headers.authorization, "Bearer test-jwt");
      assert.equal(request.body?.purpose, "marketplace_tx");
      return { status: 401, body: { error: "invalid_token" } };
    }
  });

  try {
    const result = await runCli(["sponsor-execute", "--api-base", mock.baseUrl, "--jwt", "test-jwt", "--dry-run", "--json"]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "sponsor_reserve_failed");
    assert.equal(payload.status, 401);
    assert.equal(payload.response.error, "invalid_token");
  } finally {
    await mock.close();
  }
});

test("sponsor preflight returns strategy and diagnostics", async () => {
  const mock = await startMockServer({
    "POST /sponsor/preflight": (request) => {
      assert.equal(request.headers.authorization, "Bearer test-jwt");
      assert.equal(request.body?.purpose, "marketplace_tx");
      assert.equal(request.body?.paymentCoin, "iota");
      assert.equal(request.body?.txFamily, "marketplace_write");
      return {
        status: 200,
        body: {
          actorAddress: "0xabc",
          purpose: "marketplace_tx",
          paymentCoin: "iota",
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
            allowedPaymentCoins: ["iota"],
            paymentCoinOptional: true,
            selfPayFallback: true,
            orderIdMode: "optional",
            reservationTtlSec: 120,
            liveMinimumGasBudget: 1000000,
            maxGasBudget: 12000000,
            reserve: {
              orderIdRequired: false,
              rateLimitPerMin: 30,
              windowSec: 120,
              windowTxCap: 3,
              windowGasCap: 6000000
            },
            execute: {
              idempotencyHeader: true,
              intentSupported: true,
              intentRequiredForPlatformFundedMarketing: true,
              intentSignatureRequiredForPlatformFundedMarketing: true
            },
            platformFundedMarketing: {
              sponsorPreferred: true,
              sponsorRequired: true,
              selfPayFallback: false,
              intentRequired: true,
              intentSignatureRequired: true
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

test("reviewer-shortlist builds a full dispute-open body and warns on stale context status", async () => {
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
      assert.equal(request.headers.authorization, "Bearer test-jwt");
      assert.equal(request.body?.scope, "OPEN");
      assert.equal(request.body?.orderId, "order-1");
      assert.equal(request.body?.milestoneId, "milestone-2");
      assert.equal(request.body?.buyerAddress, "0x1111111111111111111111111111111111111111111111111111111111111111");
      assert.equal(request.body?.sellerAddress, "0x2222222222222222222222222222222222222222222222222222222222222222");
      assert.equal(request.body?.checkpointDigest, "9T4R6r5u2mYk5iVX1q4x8o9cTq1rLp9Y6w9Z2SxQnPz");
      return {
        status: 200,
        body: {
          selectionComplete: true,
          directoryScanTruncated: false,
          receipt: {
            id: "receipt-1",
            shortlistedReviewerAddresses: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            ],
          },
          publishTarget: {
            route: "/orders/order-1/milestones/milestone-2/disputes/open",
            requestPatch: {
              invitedReviewerAddresses: [
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              ],
              reviewerSelectionReceiptId: "receipt-1",
            },
          },
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
    const result = await runCli([
      "reviewer-shortlist",
      "--api-base",
      mock.baseUrl,
      "--rpc-url",
      `${mock.baseUrl}/rpc`,
      "--jwt",
      "test-jwt",
      "--order-id",
      "order-1",
      "--milestone-id",
      "milestone-2",
      "--order-context-file",
      contextFile,
      "--publish-auth-state-file",
      "/tmp/buyer-auth-state.json",
      "--json",
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.receiptId, "receipt-1");
    assert.equal(payload.contextOrderStatus, "IN_PROGRESS");
    assert.equal(payload.contextMilestoneStatus, "SUBMITTED");
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(payload.warnings.some((entry) => /context_milestone_status=SUBMITTED/.test(entry)));
    assert.match(payload.nextPublishHint, /--auth-state-file '\/tmp\/buyer-auth-state\.json'/);
    const publishBody = JSON.parse(readFileSync(payload.publishBodyOut, "utf8"));
    assert.deepEqual(publishBody, {
      escrowObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333",
      bondObjectId: "0x4444444444444444444444444444444444444444444444444444444444444444",
      invitedReviewerAddresses: [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ],
      reviewerSelectionReceiptId: "receipt-1",
    });
  } finally {
    await mock.close();
  }
});

test("reviewer-shortlist retries once when the server reports checkpoint_digest_mismatch", async () => {
  let shortlistCalls = 0;
  const mock = await startMockServer({
    "POST /admin/reviewer-selection/shortlist": (request) => {
      shortlistCalls += 1;
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
          receipt: {
            id: "receipt-open-1",
            shortlistedReviewerAddresses: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            ]
          },
          publishTarget: {
            route: "/orders/order-1/milestones/milestone-1/disputes/open",
            requestPatch: {
              invitedReviewerAddresses: [
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
              ],
              reviewerSelectionReceiptId: "receipt-open-1"
            }
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
            result: "42"
          }
        };
      }
      if (method === "iota_getCheckpoint") {
        assert.equal(request.body?.params?.[0], "42");
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
      buildJwtWithExp(4102444800),
      "--order-id",
      "order-1",
      "--milestone-id",
      "milestone-1",
      "--order-context-file",
      contextFile,
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
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(
      payload.warnings.some((entry) =>
        /checkpoint_digest_advanced_to=checkpoint-new/.test(entry)
      )
    );
    assert.equal(shortlistCalls, 2);
    const publishBody = JSON.parse(readFileSync(publishBodyOut, "utf8"));
    assert.equal(
      publishBody.reviewerSelectionReceiptId,
      "receipt-open-1"
    );
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
    assert.deepEqual(mock.requests[0].body, {
      commitHashHex: "aa".repeat(32)
    });
  } finally {
    await mock.close();
  }
});

test("tx-plan-execute pre-hydrates reviewer commit routes before the first POST", async () => {
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
      "tx-plan-execute",
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

test("tx-plan-execute pre-hydrates reviewer claim-metrics with reviewer context and a single closed invite", async () => {
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  const reviewerEntryObjectId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const reviewerRegistryObjectId = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const disputeQuorumConfigObjectId = "0x3333333333333333333333333333333333333333333333333333333333333333";
  const disputeCaseObjectId = "0x2cb6d1df7a78eb63647728d7cdf7a5098dce8cb4f0693b20fee7641629068ac5";
  let claimCalls = 0;
  const mock = await startMockServer({
    [`POST /reviewers/${reviewerAddress}/claim-metrics`]: (request) => {
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
      "tx-plan-execute",
      "POST",
      `/reviewers/${reviewerAddress}/claim-metrics`,
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

test("tx-plan-execute does not infer claim-metrics from stale reviewer invites", async () => {
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  let claimCalls = 0;
  const mock = await startMockServer({
    [`POST /reviewers/${reviewerAddress}/claim-metrics`]: () => {
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
      "tx-plan-execute",
      "POST",
      `/reviewers/${reviewerAddress}/claim-metrics`,
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

test("tx-plan-execute surfaces closed dispute case candidates when claim-metrics is ambiguous", async () => {
  const reviewerAddress = "0x4d77e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  let claimCalls = 0;
  const closedCaseA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const closedCaseB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const mock = await startMockServer({
    [`POST /reviewers/${reviewerAddress}/claim-metrics`]: () => {
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
      "tx-plan-execute",
      "POST",
      `/reviewers/${reviewerAddress}/claim-metrics`,
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

test("tx-plan-execute stops claim-metrics retries when reviewer metrics are already clear", async () => {
  const reviewerAddress = "0x8212e354d6f2cbe390b95422f1713b83d7962920aff840291b30445b78f3cea7";
  let claimCalls = 0;
  let inviteReads = 0;
  const mock = await startMockServer({
    [`POST /reviewers/${reviewerAddress}/claim-metrics`]: () => {
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
      "tx-plan-execute",
      "POST",
      `/reviewers/${reviewerAddress}/claim-metrics`,
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

test("tx-plan-execute stops explicit claim-metrics bodies when reviewer metrics are already clear", async () => {
  const reviewerAddress = "0x4d3bf95fcd3fdbb7d460056d2af7489cbd1fabdd68f0d54b66fc6e7cb0e5d9a1";
  let claimCalls = 0;
  let inviteReads = 0;
  const mock = await startMockServer({
    [`POST /reviewers/${reviewerAddress}/claim-metrics`]: () => {
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
      "tx-plan-execute",
      "POST",
      `/reviewers/${reviewerAddress}/claim-metrics`,
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
  } finally {
    await mock.close();
  }
});

test("key-agreement-upsert succeeds with readbackPending when the PUT succeeded but readback still lags", async () => {
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
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.readbackPending, true);
    assert.equal(payload.warning, "key_agreement_readback_pending");
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

test("request tx-plan hint preserves original request body", async () => {
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
    assert.match(payload.nextCommandHint, /tx-plan-execute POST '\/orders\/test\/dispute-bond\/fund'/);
    assert.match(payload.nextCommandHint, /--body '\{\"amount\":\"500000\"\}'/);
  } finally {
    await mock.close();
  }
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

test("sponsor execute surfaces execute-side failures after successful reserve", async () => {
  const mock = await startMockServer({
    "POST /sponsor/reserve": (request) => {
      assert.equal(request.body?.gasBudget, 1000000);
      assert.equal(request.body?.paymentCoin, "iota");
      return {
        status: 200,
        body: {
          reservation: {
            reservationId: "resv-1",
            sponsorAddress: "0xabc",
            gasCoins: ["0x1"]
          }
        }
      };
    },
    "POST /sponsor/execute": (request) => {
      assert.equal(request.headers["idempotency-key"]?.length > 0, true);
      assert.equal(request.body?.reservationId, "resv-1");
      return {
        status: 409,
        body: {
          error: "sponsor_reservation_not_active"
        }
      };
    }
  });

  try {
    const result = await runCli([
      "sponsor-execute",
      "--api-base",
      mock.baseUrl,
      "--jwt",
      "test-jwt",
      "--build-cmd",
      `node -e "console.log(JSON.stringify({txBytesB64:'dHhieXRlcw==',userSig:'c2ln'}))"`,
      "--json"
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error, "sponsor_execute_failed");
    assert.equal(payload.status, 409);
    assert.equal(payload.reservationId, "resv-1");
    assert.equal(payload.response.error, "sponsor_reservation_not_active");
  } finally {
    await mock.close();
  }
});

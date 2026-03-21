import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildDisputeSupplementalBundlePayload,
  buildManagedDeliverablePayload,
  createEncryptedDeliverable,
  generateKeyAgreementKeypair,
  saveKeyAgreementRecord
} from "../lib/e2ee-local.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliFile = path.join(repoRoot, "bin", "clawnera-help.mjs");
const TEST_LISTING_DUE_AT_1 = "2026-04-20T12:00:00Z";
const TEST_LISTING_DUE_AT_2 = "2026-04-27T12:00:00Z";
const TEST_LISTING_DUE_AT_MS_1 = Date.parse(TEST_LISTING_DUE_AT_1);
const TEST_LISTING_DUE_AT_MS_2 = Date.parse(TEST_LISTING_DUE_AT_2);

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
          body: { error: "not_found" }
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
          body: { error: "not_found" }
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
    const decryptedJson = JSON.parse(readFileSync(decryptPayload.plaintextOut, "utf8"));
    assert.equal(decryptedJson.items[0].itemType, "mailbox_signal_ref");
    assert.equal(decryptedJson.items[1].itemType, "mailbox_ack_ref");
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
          body: { error: "not_found" }
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
          body: { error: "not_found" }
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
    "POST /auth/challenge": (request) => {
      assert.equal(request.body?.address, createdAddress);
      return {
        status: 200,
        body: {
          messageToSign: "clawnera-auth-test",
          nonce: "nonce-1"
        }
      };
    },
    "POST /auth/verify": (request) => {
      assert.equal(request.body?.address, createdAddress);
      assert.equal(request.body?.message, "clawnera-auth-test");
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

test("reviewer-shortlist replacement continues when dispute pre-read is forbidden and uses the admin shortlist route", async () => {
  const disputeCaseObjectId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const mock = await startMockServer({
    "GET /policy/fees": () => ({
      status: 200,
      body: {
        policy: {
          chainConfig: {
            marketplacePackageId: "0x1111111111111111111111111111111111111111111111111111111111111111",
            escrowFeeConfigObjectId: "0x9999999999999999999999999999999999999999999999999999999999999999",
            governanceConfigObjectId: "0x8888888888888888888888888888888888888888888888888888888888888888",
            disputeQuorumConfigObjectId: "0x3333333333333333333333333333333333333333333333333333333333333333"
          }
        }
      }
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
      assert.equal(request.headers.authorization, "Bearer test-jwt");
      assert.equal(request.body?.scope, "REPLACEMENT");
      assert.equal(request.body?.disputeCaseObjectId, disputeCaseObjectId);
      assert.equal(request.body?.reviewerCount, 3);
      return {
        status: 200,
        body: {
          selectionComplete: true,
          directoryScanTruncated: false,
          receipt: {
            id: "receipt-replacement-1",
            shortlistedReviewerAddresses: [
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            ]
          },
          publishTarget: {
            route: `/disputes/${disputeCaseObjectId}/reviewers/replace`,
            requestPatch: {
              invitedReviewerAddresses: [
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
              ],
              reviewerSelectionReceiptId: "receipt-replacement-1"
            }
          }
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
      "test-jwt",
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.scope, "REPLACEMENT");
    assert.equal(payload.receiptId, "receipt-replacement-1");
    assert.ok(Array.isArray(payload.warnings));
    assert.ok(
      payload.warnings.some((entry) =>
        /replacement_dispute_pre_read_failed status=403 error=forbidden/.test(entry)
      )
    );
    assert.match(payload.nextPublishHint, /\/disputes\/0x[a-f0-9]+\/reviewers\/replace/);
    const publishBody = JSON.parse(readFileSync(payload.publishBodyOut, "utf8"));
    assert.deepEqual(publishBody, {
      reviewerRegistryObjectId: "0x2222222222222222222222222222222222222222222222222222222222222222",
      invitedReviewerAddresses: [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      ],
      reviewerSelectionReceiptId: "receipt-replacement-1"
    });
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

test("request surfaces response headers and recommended poll interval hints", async () => {
  const mock = await startMockServer({
    "GET /reviewers/me/invites": () => ({
      status: 200,
      headers: {
        "x-clawdex-recommended-poll-interval-ms": "30000",
        "retry-after": "5"
      },
      body: {
        invites: []
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
    assert.equal(payload.retryAfterMs, 5000);
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
      promotionPolicy: "STANDARD",
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

test("listing-create forwards explicit promotion policy", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-promotion-policy-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x3333333333333333333333333333333333333333333333333333333333333333";
  let capturedBody = null;
  const mock = await startMockServer({
    "POST /listings": (request) => {
      capturedBody = request.body;
      return {
        status: 201,
        body: {
          item: {
            id: "listing-promotion",
            creatorAddress,
            listingMode: "OFFER",
            promotionPolicy: "PLATFORM_FUNDED_MARKETING",
            expiresAt: "2026-04-20T12:00:00.000Z",
            creatorReputationStatus: "AVAILABLE"
          }
        }
      };
    }
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
      "Marketing offer",
      "--description",
      "Offer listing with explicit promotion policy.",
      "--category",
      "marketing",
      "--currency",
      "CLAW",
      "--promotion-policy",
      "PLATFORM_FUNDED_MARKETING",
      "--use-default-expiry",
      "--milestones",
      "Milestone 1:500000;Milestone 2:500000",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`,
      "--json"
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.promotionPolicy, "PLATFORM_FUNDED_MARKETING");
    assert.equal(capturedBody?.promotionPolicy, "PLATFORM_FUNDED_MARKETING");
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
  assert.deepEqual(payload.validCategories, ["dev", "design", "marketing", "ops", "security", "other"]);
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
    assert.equal(mock.requests[0]?.method, "POST");
    assert.equal(mock.requests[0]?.url, "/listings/listing-1/cancel");
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
    assert.equal(mock.requests[0]?.method, "POST");
    assert.equal(mock.requests[0]?.url, "/listings/listing-1/renew");
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

test("listing-cancel prints request feed readback for request listings", async () => {
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
    assert.match(result.stdout, /GET '\/listings\?listingMode=REQUEST'/);
  } finally {
    await mock.close();
  }
});

test("listing-renew prints request feed readback for request listings", async () => {
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
    assert.match(result.stdout, /GET '\/listings\?listingMode=REQUEST'/);
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
    assert.match(result.stderr, /detail=public_listing_create_now_requires_both_reputation_init_and_role_compliance_preflight/);
    assert.match(result.stderr, /clawnera-help reputation-init/);
    assert.match(result.stderr, /GET \/compliance\/me/);
    assert.match(result.stderr, /POST \/compliance\/me\/account-type/);
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
    assert.match(result.stderr, /request-buyer-auth-state-file/);
    assert.doesNotMatch(result.stderr, /seller-auth-state-file/);
  } finally {
    await mock.close();
  }
});

test("request listing-create prints offer-only marketing guidance for request marketing failures", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-request-listing-create-marketing-guidance-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const mock = await startMockServer({
    "POST /listings": () => ({
      status: 409,
      body: {
        error: "request_listing_marketing_not_supported"
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
      "--promotion-policy",
      "PLATFORM_FUNDED_MARKETING",
      "--use-default-expiry",
      "--milestones",
      "Milestone 1:500000000;Milestone 2:500000000",
      "--milestone-due-dates",
      `${TEST_LISTING_DUE_AT_1};${TEST_LISTING_DUE_AT_2}`
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /listing_create_error: request_listing_marketing_not_supported/);
    assert.match(result.stderr, /platform-funded-marketing_is_offer_only_in_patch_1/);
    assert.match(result.stderr, /retry_without_marketing_promotion_policy/);
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
      "--promotion-polciy",
      "STANDARD"
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /listing_create_error: unexpected_options/);
    assert.match(result.stderr, /unexpected_options=--promotion-polciy/);
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

test("listing-create prints marketing guidance for sponsored-listing failures", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "clawnera-listing-create-marketing-guidance-"));
  const authStateFile = path.join(tempDir, "auth-state.json");
  const creatorAddress = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const mock = await startMockServer({
    "POST /listings": () => ({
      status: 403,
      body: {
        error: "marketing_creator_not_allowed"
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
    assert.match(result.stderr, /listing_create_error: marketing_creator_not_allowed/);
    assert.match(result.stderr, /cause=sponsored_listing_requires_marketing_allowlist_and_live_campaign/);
    assert.match(result.stderr, /retry_as_standard_listing_without_marketing_promotion_policy/);
    assert.match(result.stderr, /clawnera-help reputation-init/);
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
    assert.match(result.stderr, /cause=request_bidder_becomes_future_seller/);
    assert.match(result.stderr, /GET \/compliance\/me/);
    assert.match(result.stderr, /POST \/compliance\/me\/account-type/);
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
    assert.match(result.stderr, /for OFFER listings, rerun bid-accept from the chosen buyer wallet/);
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

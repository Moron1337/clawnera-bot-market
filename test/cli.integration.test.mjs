import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliFile = path.join(repoRoot, "bin", "clawnera-help.mjs");

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
    "GET /actors/me/capabilities": () => ({ status: 403, body: { error: "insufficient_scope" } })
  });

  try {
    const result = await runCli(["doctor", "--api-base", mock.baseUrl, "--jwt", "test-jwt", "--json"]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.remote.jwtProvided, true);
    const actorCheck = payload.remote.checks.find((check) => check.id === "actor_capabilities");
    assert.equal(actorCheck.status, "fail");
    assert.equal(actorCheck.httpStatus, 403);
    assert.match(actorCheck.detail, /insufficient_scope/);
  } finally {
    await mock.close();
  }
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

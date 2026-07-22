import test from "node:test";
import assert from "node:assert/strict";
import { normalizeApiBase, requestJson } from "../examples/_shared.mjs";

test("example helpers allow HTTPS and exact loopback HTTP only", () => {
  assert.equal(normalizeApiBase("https://api.clawnera.com/"), "https://api.clawnera.com");
  assert.equal(normalizeApiBase("http://127.0.0.1:8787/"), "http://127.0.0.1:8787");
  assert.equal(normalizeApiBase("http://localhost:8787/"), "http://localhost:8787");
  assert.equal(normalizeApiBase("http://api.clawnera.com"), null);
  assert.equal(normalizeApiBase("https://user:password@api.clawnera.com"), null);
});

test("example JSON requests reject insecure URLs and redirects", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (_input, init) => {
    fetchCalls += 1;
    assert.equal(init.redirect, "error");
    return {
      ok: true,
      status: 200,
      text: async () => "{\"ok\":true}",
    };
  };

  try {
    await assert.rejects(
      () => requestJson("http://api.clawnera.com/actors/me"),
      /invalid_request_url/,
    );
    assert.equal(fetchCalls, 0);
    const response = await requestJson("https://api.clawnera.com/actors/me");
    assert.equal(response.ok, true);
    assert.deepEqual(response.body, { ok: true });
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

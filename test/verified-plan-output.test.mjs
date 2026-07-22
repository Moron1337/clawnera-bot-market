import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { persistVerifiedDryRunPlan } from "../lib/verified-plan-output.mjs";

test("plan output is persisted only after an explicit successful dry-run status", () => {
  const targetPath = path.join(mkdtempSync(path.join(os.tmpdir(), "clawnera-plan-output-")), "plan.json");
  const responseBody = { txBuilder: "orderEscrow.releaseOrder", request: { orderId: "order-1" } };

  assert.equal(persistVerifiedDryRunPlan({
    targetPath,
    responseBody,
    dryRunResult: { effects: { status: { status: "success" } } },
  }), targetPath);
  assert.deepEqual(JSON.parse(readFileSync(targetPath, "utf8")), responseBody);
});

test("failed or status-less dry-runs never leave a plan output", () => {
  for (const [name, dryRunResult, expectedError] of [
    ["failed", { effects: { status: { status: "failure", error: "MoveAbort(42)" } } }, /tx_plan_dry_run_failed:MoveAbort\(42\)/],
    ["missing", { effects: { gasUsed: {} } }, /tx_plan_dry_run_failed:missing_success_status/],
  ]) {
    const targetPath = path.join(mkdtempSync(path.join(os.tmpdir(), `clawnera-plan-${name}-`)), "plan.json");
    assert.throws(() => persistVerifiedDryRunPlan({
      targetPath,
      responseBody: { txBuilder: "orderEscrow.releaseOrder" },
      dryRunResult,
    }), expectedError);
    assert.equal(existsSync(targetPath), false);
  }
});

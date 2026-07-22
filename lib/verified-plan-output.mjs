import { assertDryRunSuccess } from "./clawdex-onchain.mjs";
import { writePrivateFileAtomicSync } from "./local-security.mjs";

export function persistVerifiedDryRunPlan({ targetPath, responseBody, dryRunResult }) {
  assertDryRunSuccess(dryRunResult, "tx_plan_dry_run_failed");
  if (!targetPath) return null;
  writePrivateFileAtomicSync(targetPath, JSON.stringify(responseBody, null, 2));
  return targetPath;
}

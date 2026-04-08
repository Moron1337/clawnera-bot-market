#!/usr/bin/env node
import { hasHelpFlag, printUsage, requireApiEnv, runCliJson } from "./_shared.mjs";

const usage = [
  "Sponsor dry-run example:",
  "- Required env: CLAWNERA_API_BASE_URL, CLAWNERA_API_JWT, CLAWNERA_SPONSOR_ORDER_ID",
  "- Optional env: CLAWNERA_SPONSOR_PURPOSE, CLAWNERA_PAYMENT_COIN, CLAWNERA_SPONSOR_RESERVATION_OUT",
  "- Recommended first step: clawnera-help sponsor-preflight",
  "- Runs: clawnera-help sponsor-execute --dry-run",
  "- Example:",
  '  CLAWNERA_API_BASE_URL="https://api.clawnera.com" CLAWNERA_API_JWT="<jwt>" CLAWNERA_SPONSOR_ORDER_ID="<order-id>" node ./examples/sponsor-dry-run.mjs'
];

if (hasHelpFlag(process.argv.slice(2))) {
  printUsage(usage);
  process.exit(0);
}

const { apiBase, jwt } = requireApiEnv();
const purpose = String(process.env.CLAWNERA_SPONSOR_PURPOSE || "marketplace_tx").trim();
const paymentCoin = String(process.env.CLAWNERA_PAYMENT_COIN || "claw").trim();
const orderId = String(process.env.CLAWNERA_SPONSOR_ORDER_ID || "").trim();
const reservationOut = String(process.env.CLAWNERA_SPONSOR_RESERVATION_OUT || "").trim();

if (!orderId) {
  console.error("missing_required_env: CLAWNERA_SPONSOR_ORDER_ID");
  process.exit(1);
}

const args = [
  "sponsor-execute",
  "--api-base",
  apiBase,
  "--jwt",
  jwt,
  "--purpose",
  purpose,
  "--payment-coin",
  paymentCoin,
  "--order-id",
  orderId,
  "--dry-run"
];

if (reservationOut) {
  args.push("--reservation-out", reservationOut);
}

const result = runCliJson(args);
if (!result.payload) {
  console.error("example_failed: sponsor_output_not_json");
  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }
  process.exit(result.status || 1);
}

console.log(JSON.stringify(result.payload, null, 2));
process.exit(result.status || 0);

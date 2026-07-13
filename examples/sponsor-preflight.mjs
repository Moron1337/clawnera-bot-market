#!/usr/bin/env node
import {
  hasHelpFlag,
  printUsage,
  requestJson,
  requireApiEnv,
  runCliJson
} from "./_shared.mjs";

const usage = [
  "Sponsor protocol preflight example (future/non-Fresh targets only):",
  "- Required env: CLAWNERA_API_BASE_URL, CLAWNERA_API_JWT, CLAWNERA_SPONSOR_ORDER_ID, CLAWNERA_SPONSOR_PREFLIGHT_TARGET_CONFIRMED=true",
  "- Optional env: CLAWNERA_SPONSOR_PURPOSE, CLAWNERA_PAYMENT_COIN, CLAWNERA_SPONSOR_TX_FAMILY, CLAWNERA_SPONSOR_GAS_BUDGET",
  "- Runs the exact-target write gate before any authenticated request, then requires control-plane source=runtime_db, preset=normal, publicApiWrites=live, and discovery release.marketplaceWrites=live",
  "- Then runs: clawnera-help sponsor-preflight (non-reserving/non-executing, but it may record audit or rate-limit state)",
  "- Live Production is write-frozen and the undeployed Fresh candidate blocks this POST; use the three GET diagnostics there",
  "- Example:",
  '  CLAWNERA_API_BASE_URL="https://compatible-non-fresh.example" CLAWNERA_API_JWT="<jwt>" CLAWNERA_SPONSOR_ORDER_ID="<order-id>" CLAWNERA_SPONSOR_PREFLIGHT_TARGET_CONFIRMED=true node ./examples/sponsor-preflight.mjs'
];

if (hasHelpFlag(process.argv.slice(2))) {
  printUsage(usage);
  process.exit(0);
}

const { apiBase, jwt } = requireApiEnv();
const targetConfirmed =
  String(process.env.CLAWNERA_SPONSOR_PREFLIGHT_TARGET_CONFIRMED || "").trim().toLowerCase() === "true";
const purpose = String(process.env.CLAWNERA_SPONSOR_PURPOSE || "marketplace_tx").trim();
const paymentCoin = String(process.env.CLAWNERA_PAYMENT_COIN || "claw").trim();
const txFamily = String(process.env.CLAWNERA_SPONSOR_TX_FAMILY || "").trim();
const orderId = String(process.env.CLAWNERA_SPONSOR_ORDER_ID || "").trim();
const gasBudget = String(process.env.CLAWNERA_SPONSOR_GAS_BUDGET || "").trim();

if (!orderId) {
  console.error("missing_required_env: CLAWNERA_SPONSOR_ORDER_ID");
  process.exit(1);
}

if (!targetConfirmed) {
  console.error("sponsor_preflight_target_confirmation_required");
  process.exit(78);
}

const mutationGate = runCliJson(
  ["write-gate", "--api-base", apiBase],
  { CLAWNERA_API_JWT: "" }
);
if (mutationGate.status !== 0 || mutationGate.payload?.ok !== true) {
  console.error("sponsor_preflight_write_gate_closed");
  if (mutationGate.stderr.trim()) {
    console.error(mutationGate.stderr.trim());
  }
  process.exit(78);
}

let controlPlane;
let discovery;
let sponsorPolicy;
let actorCapabilities;
try {
  [controlPlane, discovery, sponsorPolicy, actorCapabilities] = await Promise.all([
    requestJson(`${apiBase}/policy/control-plane`),
    requestJson(`${apiBase}/bot/v1/discovery.json`),
    requestJson(`${apiBase}/policy/sponsor`),
    requestJson(`${apiBase}/actors/me/capabilities`, {
      headers: { authorization: `Bearer ${jwt}` }
    })
  ]);
} catch (error) {
  console.error(`sponsor_preflight_runtime_gate_failed: ${error instanceof Error ? error.message : "request_failed"}`);
  process.exit(78);
}

const maintenance = controlPlane.body?.policy?.runtime?.maintenance;
const release = discovery.body?.release;
const sponsorEmergencyMode = discovery.body?.guidance?.sponsor?.emergencyMode;
const sponsorPolicyEmergencyMode = sponsorPolicy.body?.policy?.emergencyMode;
const actorSponsorCapabilities = actorCapabilities.body?.capabilities?.sponsor;
if (
  !controlPlane.ok ||
  !discovery.ok ||
  !sponsorPolicy.ok ||
  !actorCapabilities.ok ||
  maintenance?.preset !== "normal" ||
  maintenance?.publicApiWrites !== "live" ||
  maintenance?.source !== "runtime_db" ||
  release?.marketplaceWrites !== "live" ||
  (sponsorEmergencyMode !== "normal" && sponsorEmergencyMode !== "preflight_only") ||
  sponsorPolicyEmergencyMode !== sponsorEmergencyMode ||
  actorSponsorCapabilities?.canSponsor !== true
) {
  console.error("sponsor_preflight_runtime_not_write_open");
  process.exit(78);
}

const args = [
  "sponsor-preflight",
  "--api-base",
  apiBase,
  "--purpose",
  purpose,
  "--payment-coin",
  paymentCoin,
  "--order-id",
  orderId
];

if (txFamily) {
  args.push("--tx-family", txFamily);
}

if (gasBudget) {
  args.push("--gas-budget", gasBudget);
}

const result = runCliJson(args);
if (!result.payload) {
  console.error("example_failed: sponsor_preflight_output_not_json");
  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }
  process.exit(result.status || 1);
}

console.log(JSON.stringify(result.payload, null, 2));
process.exit(result.status || 0);

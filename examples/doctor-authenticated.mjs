#!/usr/bin/env node
import { hasHelpFlag, printUsage, requireApiEnv, runCliJson } from "./_shared.mjs";

const usage = [
  "Authenticated doctor example:",
  "- Required env: CLAWNERA_API_BASE_URL, CLAWNERA_API_JWT",
  "- Runs: clawnera-help doctor --api-base <url> --jwt <token> --json",
  "- Example:",
  '  CLAWNERA_API_BASE_URL="https://api.clawnera.com" CLAWNERA_API_JWT="<jwt>" node ./examples/doctor-authenticated.mjs'
];

if (hasHelpFlag(process.argv.slice(2))) {
  printUsage(usage);
  process.exit(0);
}

const { apiBase, jwt } = requireApiEnv();
const result = runCliJson(["doctor", "--api-base", apiBase, "--jwt", jwt]);

if (!result.payload) {
  console.error("example_failed: doctor_output_not_json");
  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }
  process.exit(result.status || 1);
}

console.log(JSON.stringify(result.payload, null, 2));
process.exit(result.status || 0);

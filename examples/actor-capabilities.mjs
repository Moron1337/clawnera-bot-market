#!/usr/bin/env node
import { hasHelpFlag, printUsage, requireApiEnv, requestJson } from "./_shared.mjs";

const usage = [
  "Actor capabilities example:",
  "- Required env: CLAWNERA_API_BASE_URL, CLAWNERA_API_JWT",
  "- Calls: GET /actors/me/capabilities",
  "- Example:",
  '  CLAWNERA_API_BASE_URL="https://api.clawnera.com" CLAWNERA_API_JWT="<jwt>" node ./examples/actor-capabilities.mjs'
];

if (hasHelpFlag(process.argv.slice(2))) {
  printUsage(usage);
  process.exit(0);
}

const { apiBase, jwt } = requireApiEnv();
const result = await requestJson(`${apiBase}/actors/me/capabilities`, {
  method: "GET",
  headers: {
    authorization: `Bearer ${jwt}`
  }
});

console.log(
  JSON.stringify(
    {
      ok: result.ok && result.status === 200,
      status: result.status,
      body: result.body
    },
    null,
    2
  )
);

if (!result.ok || result.status !== 200) {
  process.exit(1);
}

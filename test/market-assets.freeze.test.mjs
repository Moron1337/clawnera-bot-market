import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("helper/docs still advertise only the current supported market assets", () => {
  const helper = readRepoFile("bin/clawnera-help.mjs");
  const readme = readRepoFile("README.md");
  const apiReference = readRepoFile("docs/guides/API_REFERENCE.md");
  const onboarding = readRepoFile("docs/guides/BOT_ONBOARDING.md");
  const sdkUsage = readRepoFile("docs/guides/SDK_USAGE.md");

  const all = [helper, readme, apiReference, onboarding, sdkUsage].join("\n\n");

  assert.match(all, /\bIOTA\b/);
  assert.match(all, /\bCLAW\b/);
  assert.doesNotMatch(all, /\bUSDC\b/);
  assert.doesNotMatch(all, /\bSUI\b/);
  assert.doesNotMatch(all, /\barbitrary asset\b/i);
  assert.doesNotMatch(all, /\bgeneric multi-asset\b/i);

  assert.match(helper, /--currency <\$\{SUPPORTED_MARKET_ASSET_SYMBOLS\.join\("\|"\)\}>/);
});

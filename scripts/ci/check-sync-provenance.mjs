import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_SYNC_REMOTE = "github.com/Moron1337/Clawdex";
export const EXPECTED_SYNC_PATHS = Object.freeze([
  "docs/docsources/core/BOT_PROTOCOL_V1.md",
  "docs/docsources/core/BOT_QUICKSTART.md",
  "docs/docsources/core/NEXT_SESSION_STATUS.md",
  "docs/docsources/core/SMART_CONTRACT_ARCHITECTURE_MAP.md",
  "docs/docsources/core/SMART_CONTRACT_ERKLAERUNG_2026-02-25.md",
  "docs/docsources/core/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md",
  "docs/docsources/core/TWO_PARTY_TEST_MATRIX.md",
  "docs/docsources/core/apiContract.json",
  "docs/docsources/core/callable_surface.snapshot",
  "docs/docsources/core/openapi.advanced.yaml",
  "docs/docsources/core/openapi.public.yaml",
  "docs/docsources/core/openapi.reviewer-self.yaml",
  "docs/docsources/core/openapi.yaml",
  "lib/vendor/clawdex-sdk/assetControlPlane.js",
  "lib/vendor/clawdex-sdk/tx/assetCoin.js",
  "lib/vendor/clawdex-sdk/tx/clawCoin.js",
  "lib/vendor/clawdex-sdk/tx/disputeQuorum.js",
  "lib/vendor/clawdex-sdk/tx/listingDeposit.js",
  "lib/vendor/clawdex-sdk/tx/manifestAnchor.js",
  "lib/vendor/clawdex-sdk/tx/orderEscrow.js",
  "lib/vendor/clawdex-sdk/tx/orderMailbox.js",
  "lib/vendor/clawdex-sdk/tx/reputation.js",
  "lib/vendor/clawdex-sdk/validation.js",
]);

export const EXPECTED_PUBLISHED_SYNC_PATHS = Object.freeze([
  "docs/docsources/core/BOT_PROTOCOL_V1.md",
  "docs/docsources/core/BOT_QUICKSTART.md",
  "docs/docsources/core/NEXT_SESSION_STATUS.md",
  "docs/docsources/core/SMART_CONTRACT_ARCHITECTURE_MAP.md",
  "docs/docsources/core/SMART_CONTRACT_ERKLAERUNG_2026-02-25.md",
  "docs/docsources/core/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md",
  "docs/docsources/core/TWO_PARTY_TEST_MATRIX.md",
]);

const EXPECTED_FIELDS = Object.freeze([
  "format",
  "marketplace_source_remote",
  "marketplace_source_commit",
  "marketplace_origin_main_commit",
  "sdk_version",
  "sdk_iota_version",
  "sdk_sui_version",
]);

function sameOrderedValues(actual, expected) {
  return actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);
}

export function parseSyncManifest(manifest) {
  if (typeof manifest !== "string" || !manifest.endsWith("\n")) {
    throw new Error("invalid_sync_manifest_termination");
  }
  const lines = manifest.slice(0, -1).split(/\r?\n/);
  const fields = new Map();
  const hashes = [];
  const hashPaths = new Set();
  for (const line of lines) {
    if (line.startsWith("sha256=")) {
      const match = line.match(/^sha256=([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/);
      if (!match) {
        throw new Error(`invalid_sync_hash_line:${line}`);
      }
      if (hashPaths.has(match[2])) {
        throw new Error(`duplicate_sync_hash_path:${match[2]}`);
      }
      hashPaths.add(match[2]);
      hashes.push({ expected: match[1], relative: match[2] });
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`invalid_sync_manifest_line:${line}`);
    }
    const key = line.slice(0, separator);
    if (fields.has(key)) {
      throw new Error(`duplicate_sync_manifest_field:${key}`);
    }
    fields.set(key, line.slice(separator + 1));
  }
  return { fields, hashes };
}

function assertRegularNoFollow(rootDir, relative) {
  const absolute = path.resolve(rootDir, relative);
  if (!absolute.startsWith(`${rootDir}${path.sep}`)) {
    throw new Error(`invalid_sync_manifest_path:${relative}`);
  }
  let cursor = rootDir;
  for (const segment of relative.split("/")) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error(`symlinked_sync_manifest_path:${relative}`);
    }
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || fs.realpathSync(absolute) !== absolute) {
    throw new Error(`invalid_sync_manifest_path:${relative}`);
  }
  return absolute;
}

function listJavaScriptFiles(directory, rootDir) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlinked_vendor_source:${path.relative(rootDir, absolute).split(path.sep).join("/")}`);
    }
    if (entry.isDirectory()) {
      files.push(...listJavaScriptFiles(absolute, rootDir));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(path.relative(rootDir, absolute).split(path.sep).join("/"));
    }
  }
  return files;
}

export function validateSyncProvenance({ rootDir, manifestText }) {
  const root = path.resolve(rootDir);
  const { fields, hashes } = parseSyncManifest(manifestText);
  const fieldNames = [...fields.keys()].sort();
  if (!sameOrderedValues(fieldNames, [...EXPECTED_FIELDS].sort())) {
    throw new Error("invalid_sync_manifest_field_set");
  }
  if (fields.get("format") !== "clawnera.sync.v3") {
    throw new Error("invalid_sync_manifest_format");
  }
  if (fields.get("marketplace_source_remote") !== EXPECTED_SYNC_REMOTE) {
    throw new Error("invalid_sync_manifest_remote");
  }
  for (const field of ["marketplace_source_commit", "marketplace_origin_main_commit"]) {
    if (!/^[a-f0-9]{40}$/.test(fields.get(field) || "")) {
      throw new Error(`invalid_sync_manifest_${field}`);
    }
  }

  const relativePaths = hashes.map(({ relative }) => relative);
  if (!sameOrderedValues(relativePaths, EXPECTED_SYNC_PATHS)) {
    throw new Error("invalid_sync_manifest_path_set");
  }
  for (const { expected, relative } of hashes) {
    const absolute = assertRegularNoFollow(root, relative);
    const actual = createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    if (actual !== expected) {
      throw new Error(`sync_file_hash_mismatch:${relative}`);
    }
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const [manifestField, dependency] of [
    ["sdk_iota_version", "@iota/iota-sdk"],
    ["sdk_sui_version", "@mysten/sui"],
  ]) {
    if (packageJson.dependencies?.[dependency] !== fields.get(manifestField)) {
      throw new Error(`sdk_dependency_version_mismatch:${dependency}`);
    }
  }

  const publishedSourceFiles = (packageJson.files || [])
    .filter((entry) => typeof entry === "string" && entry.startsWith("docs/docsources/"));
  if (!sameOrderedValues([...publishedSourceFiles].sort(), [...EXPECTED_PUBLISHED_SYNC_PATHS].sort())) {
    throw new Error("published_docsources_path_set_mismatch");
  }

  const actualVendorFiles = listJavaScriptFiles(path.join(root, "lib/vendor/clawdex-sdk"), root).sort();
  const expectedVendorFiles = EXPECTED_SYNC_PATHS.filter((entry) => entry.startsWith("lib/vendor/")).sort();
  if (!sameOrderedValues(actualVendorFiles, expectedVendorFiles)) {
    throw new Error("vendor_source_path_set_mismatch");
  }

  return {
    sourceCommit: fields.get("marketplace_source_commit"),
    fileCount: hashes.length,
  };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const root = path.resolve(path.dirname(modulePath), "../..");
  const manifestPath = path.join(root, "docs/docsources/SYNC_MANIFEST.txt");
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error("invalid_sync_manifest_file");
  }
  const result = validateSyncProvenance({
    rootDir: root,
    manifestText: fs.readFileSync(manifestPath, "utf8"),
  });
  console.log(`sync_provenance_ok source=${result.sourceCommit} files=${result.fileCount}`);
}

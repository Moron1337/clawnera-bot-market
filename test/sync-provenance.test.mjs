import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CURRENT_SYNC_FORMAT,
  EXPECTED_PUBLISHED_SYNC_PATHS,
  EXPECTED_SYNC_PATHS,
  LEGACY_SYNC_PATHS_V3,
  parseSyncManifest,
  validateSyncProvenance,
} from "../scripts/ci/check-sync-provenance.mjs";

const INTERNAL_SESSION_STATUS_PATH = "docs/docsources/core/NEXT_SESSION_STATUS.md";
const INTERNAL_CLAW_OPERATOR_PATHS = [
  "docs/docsources/claw/CLAW_LOCAL_ORACLE_SYNC_RUNBOOK.md",
  "docs/docsources/claw/CLAW_OPERATIONS_CURRENT.md",
  "docs/docsources/claw/CLAW_SWAP_GATEWAY_CURRENT.md",
];
const MARKETPLACE_DEPLOYMENT_MAPPING =
  "docs/security/evidence/iota-fresh-generation/public-helper-deployment.json|config/marketplace-deployments.json";

function buildValidManifest(root, {
  format = "clawnera.sync.v3",
  paths = LEGACY_SYNC_PATHS_V3,
} = {}) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lines = [
    `format=${format}`,
    "marketplace_source_remote=github.com/Moron1337/Clawdex",
    `marketplace_source_commit=${"a".repeat(40)}`,
    `marketplace_origin_main_commit=${"b".repeat(40)}`,
    "sdk_version=0.1.0",
    `sdk_iota_version=${packageJson.dependencies["@iota/iota-sdk"]}`,
    `sdk_sui_version=${packageJson.dependencies["@mysten/sui"]}`,
  ];
  for (const relative of paths) {
    const digest = createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
    lines.push(`sha256=${digest}  ${relative}`);
  }
  return `${lines.join("\n")}\n`;
}

test("sync script uses exact commit blobs and an isolated build snapshot for the exact mapping set", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const source = fs.readFileSync(path.join(root, "scripts", "sync-local-sources.sh"), "utf8");
  for (const fragment of [
    'EXPECTED_REMOTE_ID="github.com/Moron1337/Clawdex"',
    '[[ ! "$MARKETPLACE_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]',
    "fetch --prune --no-tags origin '+refs/heads/*:refs/remotes/origin/*'",
    'for-each-ref --format=\'%(refname)\' --contains "$SOURCE_COMMIT" refs/remotes/origin/',
    'git -C "$MARKETPLACE_SOURCE_ROOT" cat-file blob "$blob_id"',
    'git -C "$MARKETPLACE_SOURCE_ROOT" archive --format=tar "$SOURCE_COMMIT"',
    'corepack pnpm --dir "$SOURCE_SNAPSHOT" install --frozen-lockfile',
    'corepack pnpm --dir "$SOURCE_SNAPSHOT" --filter @clawdex/sdk build',
    'SDK_DEPENDENCY_ROOT="$SOURCE_SNAPSHOT/packages/sdk/node_modules"',
    "--format='%(objectmode)%x09%(objecttype)%x09%(objectname)%x09%(path)'",
    '[[ "$entry_type" != "blob" ]]',
    '[[ "$entry_mode" != "100644" ]]',
    'SOURCE_SNAPSHOT_PARENT="$(mktemp -d "${TMPDIR:-/tmp}/clawnera-runtime-source.XXXXXX")"',
    "trap cleanup EXIT",
    'temporary="$(mktemp "$(dirname "$destination")/.${destination##*/}.XXXXXX")"',
    'mv -fT -- "$temporary" "$destination"',
    'blob_id="$(committed_blob_id "$source_relative")"',
    'atomic_write_committed_blob "$blob_id" "$destination_relative"',
    'atomic_write_generated_file "$source_relative" "$destination_relative"',
    'echo "format=clawnera.sync.v4"',
    'rm -f -- "$retired_destination"',
    'unexpected_package_manifest:',
  ]) {
    assert.ok(source.includes(fragment), `sync hardening fragment missing: ${fragment}`);
  }
  assert.ok(!source.includes('corepack pnpm --dir "$MARKETPLACE_SOURCE_ROOT"'));
  assert.ok(!source.includes('"$MARKETPLACE_SOURCE_ROOT/$source_relative"'));
  assert.ok(!source.includes('install -m 0644 -- "$MARKETPLACE_SOURCE_ROOT/'));
  assert.ok(!source.includes('cp -- "$MARKETPLACE_SOURCE_ROOT/'));
  assert.ok(!source.includes('$MARKETPLACE_SOURCE_ROOT/node_modules/@iota/iota-sdk/package.json'));
  assert.ok(!source.includes('$MARKETPLACE_SOURCE_ROOT/node_modules/@mysten/sui/package.json'));
  const committedBlock = source.match(/COMMITTED_SOURCE_MAPPINGS=\(\n(?<body>[\s\S]*?)\n\)/)?.groups?.body;
  const generatedBlock = source.match(/GENERATED_SOURCE_MAPPINGS=\(\n(?<body>[\s\S]*?)\n\)/)?.groups?.body;
  assert.ok(committedBlock, "committed source mapping block missing");
  assert.ok(generatedBlock, "generated source mapping block missing");
  const parseMappings = (block) =>
    [...block.matchAll(/^\s+"([^"|]+)\|([^"|]+)"$/gm)].map((match) => ({
      source: match[1],
      destination: match[2],
    }));
  const committedMappings = parseMappings(committedBlock);
  const generatedMappings = parseMappings(generatedBlock);
  assert.equal(committedMappings.length, 17);
  assert.equal(generatedMappings.length, 11);
  assert.ok(committedMappings.every(({ source: sourcePath }) => !sourcePath.startsWith("packages/sdk/dist/")));
  assert.ok(generatedMappings.every(({ source: sourcePath }) => sourcePath.startsWith("packages/sdk/dist/")));
  const mappings = [...source.matchAll(/^\s+"([^"|]+)\|([^"|]+)"$/gm)].map((match) => ({
    source: match[1],
    destination: match[2],
  }));
  const mappedDestinations = mappings
    .map(({ destination }) => destination)
    .sort();
  assert.deepEqual(mappedDestinations, [...EXPECTED_SYNC_PATHS].sort());
  assert.ok(
    mappings.some(({ source: sourcePath, destination }) =>
      `${sourcePath}|${destination}` === MARKETPLACE_DEPLOYMENT_MAPPING),
    "runtime-owned deployment registry mapping missing",
  );
  for (const mapping of [
    "contracts/claw_foundation/ci/callable_surface.snapshot|docs/docsources/core/callable-surfaces/iota/foundation.snapshot",
    "contracts/claw_governance/ci/callable_surface.snapshot|docs/docsources/core/callable-surfaces/iota/governance.snapshot",
    "contracts/claw_settlement_v2/ci/callable_surface.snapshot|docs/docsources/core/callable-surfaces/iota/settlement.snapshot",
    "contracts/claw_fulfillment/ci/callable_surface.snapshot|docs/docsources/core/callable-surfaces/iota/fulfillment.snapshot",
    "contracts/claw_ops/ci/callable_surface.snapshot|docs/docsources/core/callable-surfaces/iota/ops.snapshot",
  ]) {
    assert.ok(
      mappings.some(({ source: sourcePath, destination }) => `${sourcePath}|${destination}` === mapping),
      `Fresh callable-surface mapping missing: ${mapping}`,
    );
  }
  assert.doesNotMatch(source, /contracts\/claw_settlement_core\/ci\/callable_surface\.snapshot/);
});

test("operator status and CLAW operations material stay outside public tree, sync, and package surfaces", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const syncSource = fs.readFileSync(path.join(root, "scripts", "sync-local-sources.sh"), "utf8");
  const publishSurfaceSource = fs.readFileSync(
    path.join(root, "scripts", "ci", "check-publish-surface.sh"),
    "utf8",
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.ok(!EXPECTED_SYNC_PATHS.includes(INTERNAL_SESSION_STATUS_PATH));
  assert.ok(!EXPECTED_PUBLISHED_SYNC_PATHS.includes(INTERNAL_SESSION_STATUS_PATH));
  assert.ok(!packageJson.files.includes(INTERNAL_SESSION_STATUS_PATH));
  assert.doesNotMatch(syncSource, /docs\/NEXT_SESSION_STATUS\.md/);
  assert.ok(publishSurfaceSource.includes(`"${INTERNAL_SESSION_STATUS_PATH}"`));
  assert.equal(fs.existsSync(path.join(root, INTERNAL_SESSION_STATUS_PATH)), false);
  for (const relativePath of INTERNAL_CLAW_OPERATOR_PATHS) {
    assert.ok(!EXPECTED_SYNC_PATHS.includes(relativePath));
    assert.ok(!EXPECTED_PUBLISHED_SYNC_PATHS.includes(relativePath));
    assert.ok(!packageJson.files.includes(relativePath));
    assert.ok(publishSurfaceSource.includes(`"${relativePath}"`));
    assert.equal(fs.existsSync(path.join(root, relativePath)), false);
  }
  const internalClawDirectory = path.join(root, "docs", "docsources", "claw");
  assert.deepEqual(
    fs.existsSync(internalClawDirectory) ? fs.readdirSync(internalClawDirectory) : [],
    [],
    "docs/docsources/claw must remain empty so renamed operator material cannot enter the public Git tree",
  );
});

test("checked-in sync provenance has the exact unique source set", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const manifest = fs.readFileSync(path.join(root, "docs/docsources/SYNC_MANIFEST.txt"), "utf8");
  const parsed = parseSyncManifest(manifest);
  assert.deepEqual(parsed.hashes.map(({ relative }) => relative), LEGACY_SYNC_PATHS_V3);
  assert.deepEqual(
    packageJson.files
      .filter(
        (entry) =>
          entry === "config/marketplace-deployments.json" || entry.startsWith("docs/docsources/"),
      )
      .sort(),
    [...EXPECTED_PUBLISHED_SYNC_PATHS].sort(),
  );
  assert.ok(EXPECTED_PUBLISHED_SYNC_PATHS.every((entry) => LEGACY_SYNC_PATHS_V3.includes(entry)));
  assert.ok(EXPECTED_PUBLISHED_SYNC_PATHS.every((entry) => EXPECTED_SYNC_PATHS.includes(entry)));
  const result = validateSyncProvenance({ rootDir: root, manifestText: manifest });
  assert.equal(result.fileCount, 24);
  assert.equal(result.format, "clawnera.sync.v3");
});

test("v4 sync provenance requires all five Fresh IOTA callable-surface roots", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const temporaryRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "clawnera-sync-v4-"));
  try {
    await fsPromises.copyFile(path.join(root, "package.json"), path.join(temporaryRoot, "package.json"));
    for (const relative of EXPECTED_SYNC_PATHS) {
      const source = path.join(root, relative);
      const target = path.join(temporaryRoot, relative);
      await fsPromises.mkdir(path.dirname(target), { recursive: true });
      if (fs.existsSync(source)) {
        await fsPromises.copyFile(source, target);
      } else {
        await fsPromises.writeFile(target, `fixture=${relative}\n`, { mode: 0o600 });
      }
    }
    const manifest = buildValidManifest(temporaryRoot, {
      format: CURRENT_SYNC_FORMAT,
      paths: EXPECTED_SYNC_PATHS,
    });
    const result = validateSyncProvenance({ rootDir: temporaryRoot, manifestText: manifest });
    assert.equal(result.fileCount, 28);
    assert.equal(result.format, CURRENT_SYNC_FORMAT);
    const withoutGovernanceRoot = manifest.replace(
      /^sha256=.*  docs\/docsources\/core\/callable-surfaces\/iota\/governance\.snapshot\n/m,
      "",
    );
    assert.throws(
      () => validateSyncProvenance({ rootDir: temporaryRoot, manifestText: withoutGovernanceRoot }),
      /invalid_sync_manifest_path_set/,
    );

    await fsPromises.writeFile(
      path.join(temporaryRoot, "docs/docsources/core/callable_surface.snapshot"),
      "legacy\n",
    );
    assert.throws(
      () => validateSyncProvenance({ rootDir: temporaryRoot, manifestText: manifest }),
      /retired_sync_path_present/,
    );
  } finally {
    await fsPromises.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("sync manifest rejects duplicate fields, duplicate hashes, and path-set drift", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const manifest = buildValidManifest(root);
  assert.throws(
    () => parseSyncManifest(manifest.replace("format=clawnera.sync.v3\n", "format=clawnera.sync.v3\nformat=clawnera.sync.v3\n")),
    /duplicate_sync_manifest_field/,
  );
  const firstHash = manifest.match(/^sha256=.*$/m)?.[0];
  assert.ok(firstHash);
  assert.throws(() => parseSyncManifest(`${manifest}${firstHash}\n`), /duplicate_sync_hash_path/);
  assert.throws(
    () => validateSyncProvenance({ rootDir: root, manifestText: manifest.replace(`${firstHash}\n`, "") }),
    /invalid_sync_manifest_path_set/,
  );
});

test("sync provenance rejects a symlink even when its content hash matches", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const manifest = buildValidManifest(root);
  const temporaryRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "clawnera-sync-symlink-"));
  try {
    await fsPromises.copyFile(path.join(root, "package.json"), path.join(temporaryRoot, "package.json"));
    for (const sourcePath of LEGACY_SYNC_PATHS_V3) {
      const targetPath = path.join(temporaryRoot, sourcePath);
      await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
      await fsPromises.copyFile(path.join(root, sourcePath), targetPath);
    }
    const relative = LEGACY_SYNC_PATHS_V3[0];
    const target = path.join(temporaryRoot, relative);
    const backup = `${target}.backup`;
    await fsPromises.rename(target, backup);
    await fsPromises.symlink(backup, target);
    assert.throws(
      () => validateSyncProvenance({ rootDir: temporaryRoot, manifestText: manifest }),
      /symlinked_sync_manifest_path/,
    );
  } finally {
    await fsPromises.rm(temporaryRoot, { recursive: true, force: true });
  }
});

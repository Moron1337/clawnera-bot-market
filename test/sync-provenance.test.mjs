import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EXPECTED_PUBLISHED_SYNC_PATHS,
  EXPECTED_SYNC_PATHS,
  parseSyncManifest,
  validateSyncProvenance,
} from "../scripts/ci/check-sync-provenance.mjs";

function buildCurrentValidManifest(root) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lines = [
    "format=clawnera.sync.v3",
    "marketplace_source_remote=github.com/Moron1337/Clawdex",
    `marketplace_source_commit=${"a".repeat(40)}`,
    `marketplace_origin_main_commit=${"b".repeat(40)}`,
    "sdk_version=0.1.0",
    `sdk_iota_version=${packageJson.dependencies["@iota/iota-sdk"]}`,
    `sdk_sui_version=${packageJson.dependencies["@mysten/sui"]}`,
  ];
  for (const relative of EXPECTED_SYNC_PATHS) {
    const digest = createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
    lines.push(`sha256=${digest}  ${relative}`);
  }
  return `${lines.join("\n")}\n`;
}

test("sync script requires remote commit provenance, frozen install, and the exact mapping set", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const source = fs.readFileSync(path.join(root, "scripts", "sync-local-sources.sh"), "utf8");
  for (const fragment of [
    'EXPECTED_REMOTE_ID="github.com/Moron1337/Clawdex"',
    '[[ ! "$MARKETPLACE_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]',
    "fetch --prune --no-tags origin '+refs/heads/*:refs/remotes/origin/*'",
    'for-each-ref --format=\'%(refname)\' --contains "$SOURCE_COMMIT" refs/remotes/origin/',
    'install --frozen-lockfile',
    '[[ -L "$cursor" ]]',
    'SDK_DEPENDENCY_ROOT="$MARKETPLACE_SOURCE_ROOT/packages/sdk/node_modules"',
    'unexpected_package_manifest:',
  ]) {
    assert.ok(source.includes(fragment), `sync hardening fragment missing: ${fragment}`);
  }
  assert.ok(!source.includes('$MARKETPLACE_SOURCE_ROOT/node_modules/@iota/iota-sdk/package.json'));
  assert.ok(!source.includes('$MARKETPLACE_SOURCE_ROOT/node_modules/@mysten/sui/package.json'));
  const mappedDestinations = [...source.matchAll(/^\s+"[^"|]+\|([^"|]+)"$/gm)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(mappedDestinations, [...EXPECTED_SYNC_PATHS].sort());
});

test("checked-in sync provenance has the exact unique source set", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const manifest = fs.readFileSync(path.join(root, "docs/docsources/SYNC_MANIFEST.txt"), "utf8");
  const parsed = parseSyncManifest(manifest);
  assert.deepEqual(parsed.hashes.map(({ relative }) => relative), EXPECTED_SYNC_PATHS);
  assert.deepEqual(
    packageJson.files.filter((entry) => entry.startsWith("docs/docsources/")).sort(),
    [...EXPECTED_PUBLISHED_SYNC_PATHS].sort(),
  );
  assert.ok(EXPECTED_PUBLISHED_SYNC_PATHS.every((entry) => EXPECTED_SYNC_PATHS.includes(entry)));
  const result = validateSyncProvenance({ rootDir: root, manifestText: manifest });
  assert.equal(result.fileCount, 23);
});

test("sync manifest rejects duplicate fields, duplicate hashes, and path-set drift", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const manifest = buildCurrentValidManifest(root);
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
  const manifest = buildCurrentValidManifest(root);
  const temporaryRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "clawnera-sync-symlink-"));
  try {
    await fsPromises.copyFile(path.join(root, "package.json"), path.join(temporaryRoot, "package.json"));
    for (const sourcePath of EXPECTED_SYNC_PATHS) {
      const targetPath = path.join(temporaryRoot, sourcePath);
      await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
      await fsPromises.copyFile(path.join(root, sourcePath), targetPath);
    }
    const relative = EXPECTED_SYNC_PATHS[0];
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

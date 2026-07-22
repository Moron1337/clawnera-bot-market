#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SHA1_HEX = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;

export function assertRegistryArtifactMatches(manifest, registryDist) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("invalid_release_manifest");
  }
  if (!registryDist || typeof registryDist !== "object" || Array.isArray(registryDist)) {
    throw new Error("invalid_registry_dist_metadata");
  }
  if (!SHA256_HEX.test(manifest.sha256 || "")) {
    throw new Error("invalid_release_manifest_sha256");
  }
  if (!SHA1_HEX.test(manifest.sha1 || "") || !SHA512_INTEGRITY.test(manifest.sha512Integrity || "")) {
    throw new Error("invalid_release_manifest_registry_digests");
  }
  if (registryDist.shasum !== manifest.sha1) {
    throw new Error("registry_tarball_sha1_mismatch");
  }
  if (registryDist.integrity !== manifest.sha512Integrity) {
    throw new Error("registry_tarball_sha512_integrity_mismatch");
  }
  return {
    artifact: manifest.artifact,
    sha1: manifest.sha1,
    sha512Integrity: manifest.sha512Integrity,
  };
}

function run() {
  const [manifestPath, registryDistPath] = process.argv.slice(2);
  if (!manifestPath || !registryDistPath) {
    throw new Error("usage: verify-registry-artifact.mjs <release-manifest.json> <registry-dist.json>");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const registryDist = JSON.parse(fs.readFileSync(registryDistPath, "utf8"));
  const verified = assertRegistryArtifactMatches(manifest, registryDist);
  console.log(`registry_artifact_integrity_ok artifact=${verified.artifact} sha1=${verified.sha1}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run();
}

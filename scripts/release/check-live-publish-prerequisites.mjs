#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA_VERSION = "clawnera.npm-publish-live-prerequisites.v1";
const REPOSITORY = "Moron1337/clawnera-bot-market";
const MAX_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function livePublishPrerequisiteFindings(evidence, options = {}) {
  const findings = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return ["invalid_live_publish_evidence"];
  }
  if (evidence.schemaVersion !== SCHEMA_VERSION || evidence.repository !== REPOSITORY) {
    findings.push("live_publish_evidence_identity_mismatch");
  }
  if (evidence.readOnlyObservation !== true) {
    findings.push("live_publish_evidence_must_be_read_only");
  }
  const observedAtMs = Date.parse(evidence.observedAt || "");
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  if (!Number.isFinite(observedAtMs) || observedAtMs > nowMs || nowMs - observedAtMs > MAX_EVIDENCE_AGE_MS) {
    findings.push("live_publish_evidence_missing_or_stale");
  }
  if (!Array.isArray(evidence.evidenceRefs) || evidence.evidenceRefs.length < 2) {
    findings.push("live_publish_evidence_refs_incomplete");
  }
  if (evidence.status !== "ready") {
    findings.push("live_publish_prerequisites_status_blocked");
    return findings;
  }
  if (evidence.live?.mainBranchProtected !== true) {
    findings.push("main_branch_protection_not_verified");
  }
  if (evidence.live?.npmPublishEnvironmentExists !== true) {
    findings.push("npm_publish_environment_not_verified");
  }
  if (!Number.isSafeInteger(evidence.live?.requiredReviewerCount) || evidence.live.requiredReviewerCount < 1) {
    findings.push("npm_publish_required_reviewers_not_verified");
  }
  if (evidence.live?.deploymentPolicy !== "protected-release-tags-only") {
    findings.push("npm_publish_deployment_tag_policy_not_verified");
  }
  if (evidence.live?.npmTrustedPublisherConfigured !== true) {
    findings.push("npm_trusted_publisher_not_verified");
  }
  return findings;
}

function run() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const evidencePath = path.join(root, "docs", "reports", "npm-publish-live-prerequisites.json");
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const findings = livePublishPrerequisiteFindings(evidence);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`release_live_blocker: ${finding}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`release_live_prerequisites_ok observed_at=${evidence.observedAt}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run();
}

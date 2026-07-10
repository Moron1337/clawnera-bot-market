#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseWorkflow } from "./check-workflow-security.mjs";

const CHECKOUT_ACTION = "actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd";
const SETUP_NODE_ACTION = "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444";
const UPLOAD_ACTION = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const DOWNLOAD_ACTION = "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093";
const BUILD_STEP_NAMES = [
  "Checkout",
  "Validate publish source",
  "Require verified live publish protections",
  "Setup Node",
  "Upgrade npm",
  "Install frozen dependencies",
  "Release gate",
  "Revalidate immutable publish source",
  "Resolve package version",
  "Check registry for existing version",
  "Pack immutable artifact",
  "Verify release evidence",
  "Upload immutable release evidence",
];
const PUBLISH_STEP_NAMES = [
  "Setup Node",
  "Download immutable release evidence",
  "Verify downloaded artifact binding",
  "Recheck registry for existing version",
  "Publish exact artifact with provenance",
];
const VERIFY_STEP_NAMES = [
  "Setup Node",
  "Download immutable release evidence",
  "Registry readback",
  "Package-level npx readback",
];

function stepRun(step) {
  return typeof step?.run === "string" ? step.run : "";
}

function exactObject(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    expectedKeys.every((key) => value[key] === expected[key]);
}

function exactStepNames(job, expected) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  return steps.length === expected.length && steps.every((step, index) => step?.name === expected[index]);
}

function namedStep(job, name) {
  return (Array.isArray(job?.steps) ? job.steps : []).find((step) => step?.name === name);
}

function checkoutIsExact(step) {
  return step?.uses === CHECKOUT_ACTION && exactObject(step.with, {
    ref: "${{ github.event.release.tag_name }}",
    "fetch-depth": 0,
    "persist-credentials": false,
  });
}

function allRunStepsFailClosed(job) {
  return (job.steps || [])
    .filter((step) => typeof step?.run === "string")
    .every((step) => step.run.trimStart().startsWith("set -euo pipefail\n"));
}

export function releaseSecurityFindings(workflow, sourceVerifier) {
  const findings = [];
  const triggers = workflow?.on ?? workflow?.[true];
  if (
    !triggers ||
    typeof triggers !== "object" ||
    Array.isArray(triggers) ||
    Object.keys(triggers).length !== 1 ||
    !Array.isArray(triggers.release?.types) ||
    triggers.release.types.length !== 1 ||
    triggers.release.types[0] !== "published"
  ) {
    findings.push("publish_trigger_must_be_release_published_only");
  }
  if (!exactObject(workflow.permissions, { contents: "read" })) {
    findings.push("publish_top_level_permissions_must_be_contents_read_only");
  }
  if (
    !exactObject(workflow.concurrency, {
      group: "publish-${{ github.event.release.tag_name }}",
      "cancel-in-progress": false,
    })
  ) {
    findings.push("publish_concurrency_must_be_tag_scoped_and_non_cancelling");
  }
  if (!workflow.jobs || !exactObject(Object.fromEntries(Object.keys(workflow.jobs).map((key) => [key, key])), {
    build: "build",
    publish: "publish",
    verify: "verify",
  })) {
    findings.push("publish_workflow_must_have_exact_build_publish_and_verify_jobs");
  }

  const build = workflow?.jobs?.build;
  const publish = workflow?.jobs?.publish;
  const verify = workflow?.jobs?.verify;
  if (!build || !publish || !verify) {
    return findings;
  }
  if (
    build["runs-on"] !== "ubuntu-latest" ||
    publish["runs-on"] !== "ubuntu-latest" ||
    verify["runs-on"] !== "ubuntu-latest"
  ) {
    findings.push("publish_jobs_must_use_github_hosted_runners");
  }
  if (!exactObject(build.permissions, { contents: "read" })) {
    findings.push("build_permissions_must_be_contents_read_only");
  }
  if (!exactObject(publish.permissions, { contents: "read", "id-token": "write" })) {
    findings.push("publish_job_permissions_must_be_exact_contents_read_and_id_token_write");
  }
  if (!exactObject(verify.permissions, { contents: "read" }) || verify.environment !== undefined) {
    findings.push("post_publish_verify_permissions_must_be_contents_read_only");
  }
  if (
    build.environment !== undefined ||
    publish.environment !== "npm-publish" ||
    publish.needs !== "build" ||
    !Array.isArray(verify.needs) ||
    verify.needs.length !== 2 ||
    !verify.needs.includes("build") ||
    !verify.needs.includes("publish")
  ) {
    findings.push("oidc_publish_job_must_be_environment_gated_and_depend_on_build");
  }
  if (!exactObject(build.outputs, {
    source_commit: "${{ steps.pack.outputs.source_commit }}",
  })) {
    findings.push("build_outputs_must_bind_source_commit_only");
  }
  if (
    !exactStepNames(build, BUILD_STEP_NAMES) ||
    !exactStepNames(publish, PUBLISH_STEP_NAMES) ||
    !exactStepNames(verify, VERIFY_STEP_NAMES)
  ) {
    findings.push("publish_workflow_step_set_or_order_mismatch");
  }
  if (!allRunStepsFailClosed(build) || !allRunStepsFailClosed(publish) || !allRunStepsFailClosed(verify)) {
    findings.push("publish_run_steps_must_enable_strict_shell_mode");
  }

  if (!checkoutIsExact(namedStep(build, "Checkout"))) {
    findings.push("publish_build_checkout_must_bind_exact_release_tag_without_credentials");
  }
  if (
    namedStep(build, "Setup Node")?.uses !== SETUP_NODE_ACTION ||
    namedStep(publish, "Setup Node")?.uses !== SETUP_NODE_ACTION ||
    namedStep(verify, "Setup Node")?.uses !== SETUP_NODE_ACTION
  ) {
    findings.push("publish_setup_node_action_mismatch");
  }
  if (namedStep(build, "Upload immutable release evidence")?.uses !== UPLOAD_ACTION) {
    findings.push("release_evidence_upload_action_mismatch");
  }
  if (namedStep(publish, "Download immutable release evidence")?.uses !== DOWNLOAD_ACTION) {
    findings.push("release_evidence_download_action_mismatch");
  }
  if (namedStep(verify, "Download immutable release evidence")?.uses !== DOWNLOAD_ACTION) {
    findings.push("release_evidence_verify_download_action_mismatch");
  }

  const installRun = stepRun(namedStep(build, "Install frozen dependencies"));
  const releaseGateRun = stepRun(namedStep(build, "Release gate"));
  if (!/(^|\n)npm ci --ignore-scripts\s*$/m.test(installRun) || !releaseGateRun.includes("npm run release:check")) {
    findings.push("build_must_use_frozen_install_and_full_release_gate");
  }
  const publishRuns = (publish.steps || []).map(stepRun).join("\n");
  const publishUses = (publish.steps || []).map((step) => String(step?.uses || ""));
  if (
    publishUses.some((uses) => uses.startsWith("actions/checkout@") || uses.startsWith("./")) ||
    /(?:^|\s)(?:npm|pnpm|yarn)\s+(?:ci|install|exec)(?:\s|$)/m.test(publishRuns) ||
    /(?:^|\s)(?:node|bash|sh)\s+(?:\.\/)?scripts\//m.test(publishRuns)
  ) {
    findings.push("oidc_publish_job_must_not_execute_repository_or_dependency_code");
  }

  for (const [jobName, job] of Object.entries({ build, publish, verify })) {
    for (const [index, step] of (job.steps || []).entries()) {
      if (stepRun(step).includes("${{")) {
        findings.push(`run_expression_injection_surface:${jobName}:${index}`);
      }
    }
  }

  const buildVerifyRuns = [
    stepRun(namedStep(build, "Validate publish source")),
    stepRun(namedStep(build, "Revalidate immutable publish source")),
  ];
  if (
    buildVerifyRuns.some((run) => !run.includes("verify-publish-source.sh") || !run.includes('"$RELEASE_TAG"'))
  ) {
    findings.push("publish_source_must_be_verified_twice_in_isolated_build");
  }

  const packRun = stepRun(namedStep(build, "Pack immutable artifact"));
  const allRuns = [...(build.steps || []), ...(publish.steps || []), ...(verify.steps || [])].map(stepRun);
  if (
    allRuns.filter((run) => /(^|\s)npm pack(?:\s|$)/m.test(run)).length !== 1 ||
    !packRun.includes("npm pack --json --ignore-scripts") ||
    !packRun.includes("sha256sum") ||
    !packRun.includes("release-manifest.json") ||
    !packRun.includes('source_commit="$(git rev-parse HEAD)"') ||
    !packRun.includes("sha1") ||
    !packRun.includes("sha512Integrity") ||
    !packRun.includes('echo "source_commit=$source_commit" >> "$GITHUB_OUTPUT"')
  ) {
    findings.push("release_tarball_must_be_built_once_with_digest_and_source_manifest");
  }

  const uploadStep = namedStep(build, "Upload immutable release evidence");
  if (
    uploadStep?.with?.path !== ".release-artifacts/" ||
    uploadStep?.with?.["if-no-files-found"] !== "error" ||
    uploadStep?.with?.["include-hidden-files"] !== false
  ) {
    findings.push("release_evidence_upload_must_be_exact");
  }

  const liveRun = stepRun(namedStep(build, "Require verified live publish protections"));
  const downloadedVerifyRun = stepRun(namedStep(publish, "Verify downloaded artifact binding"));
  if (!liveRun.includes("check-live-publish-prerequisites.mjs")) {
    findings.push("publish_workflow_must_enforce_live_protection_evidence");
  }
  for (const fragment of [
    "sha256sum --check SHA256SUMS",
    "release-manifest.json",
    "release_artifact_name_invalid",
    "release_version_invalid",
    "manifest.sourceCommit !== expectedSourceCommit",
    "manifest.tag !== releaseTag",
    "release_artifact_digest_mismatch",
    "release_artifact_set_invalid",
  ]) {
    if (!downloadedVerifyRun.includes(fragment)) {
      findings.push(`downloaded_release_artifact_verification_missing:${fragment}`);
    }
  }

  const publishRun = stepRun(namedStep(publish, "Publish exact artifact with provenance"));
  if (
    allRuns.filter((run) => /(^|\s)npm publish(?:\s|$)/m.test(run)).length !== 1 ||
    !publishRun.includes('npm publish ".release-artifacts/$artifact" --access public --provenance --ignore-scripts') ||
    publish.steps.at(-1)?.name !== "Publish exact artifact with provenance"
  ) {
    findings.push("publish_must_use_exact_downloaded_artifact_with_provenance");
  }
  const registryReadback = stepRun(namedStep(verify, "Registry readback"));
  if (
    !registryReadback.includes("registry-dist.json") ||
    !registryReadback.includes("release-manifest.json") ||
    !registryReadback.includes('npm view "clawnera-bot-market@$version" dist --json') ||
    !registryReadback.includes("registry_artifact_digest_mismatch")
  ) {
    findings.push("registry_readback_must_verify_exact_tarball_digests");
  }

  const requiredVerifierFragments = [
    'TAG="${1:-${GITHUB_REF_NAME:-}}"',
    '"v$VERSION"',
    "git status --porcelain --untracked-files=all",
    "refs/tags/$TAG",
    'TAG_COMMIT="$(git rev-list -n 1 "$TAG")"',
    'HEAD_COMMIT="$(git rev-parse HEAD)"',
    "git fetch --no-tags origin main",
    'git merge-base --is-ancestor "$TAG_COMMIT" "$ORIGIN_MAIN_COMMIT"',
  ];
  for (const fragment of requiredVerifierFragments) {
    if (!sourceVerifier.includes(fragment)) {
      findings.push(`publish_source_verifier_missing:${fragment}`);
    }
  }
  return findings;
}

function run() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const workflowPath = path.join(root, ".github", "workflows", "publish.yml");
  const verifierPath = path.join(root, "scripts", "release", "verify-publish-source.sh");
  const workflow = parseWorkflow(fs.readFileSync(workflowPath, "utf8"), "publish.yml");
  const findings = releaseSecurityFindings(workflow, fs.readFileSync(verifierPath, "utf8"));
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(finding);
    }
    process.exitCode = 1;
    return;
  }
  console.log("release_security_policy_ok");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run();
}

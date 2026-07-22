import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkflow, workflowPolicyFindings } from "../scripts/ci/check-workflow-security.mjs";
import { releaseSecurityFindings } from "../scripts/ci/check-release-security.mjs";
import { assertRegistryArtifactMatches } from "../scripts/release/verify-registry-artifact.mjs";
import { livePublishPrerequisiteFindings } from "../scripts/release/check-live-publish-prerequisites.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workflow policy accepts pinned actions and rejects non-literal PR runners", () => {
  const safe = parseWorkflow(`
name: safe
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd
        with:
          persist-credentials: false
`);
  assert.deepEqual(workflowPolicyFindings("safe.yml", safe), []);

  const unsafe = structuredClone(safe);
  unsafe.jobs.test["runs-on"] = ["self-hosted", "linux"];
  unsafe.jobs.test.steps[0].uses = "actions/checkout@v5";
  unsafe.jobs.test.steps[0].with["persist-credentials"] = true;
  assert.deepEqual(workflowPolicyFindings("unsafe.yml", unsafe), [
    "unsafe.yml:test: pull_request_runner_must_be_literal_github_hosted",
    "unsafe.yml:test:0: mutable_or_invalid_action_ref:actions/checkout@v5",
    "unsafe.yml:test:0: checkout_credentials_must_not_persist",
  ]);
});

test("security workflow scans full history and audits dependencies without lifecycle scripts", () => {
  const workflowSource = fs.readFileSync(
    path.join(root, ".github", "workflows", "security-free.yml"),
    "utf8",
  );
  const installer = fs.readFileSync(path.join(root, "scripts", "ci", "install_gitleaks.sh"), "utf8");
  const ignore = fs.readFileSync(path.join(root, ".gitleaksignore"), "utf8");
  const workflow = parseWorkflow(workflowSource, "security-free.yml");

  assert.deepEqual(workflowPolicyFindings("security-free.yml", workflow), []);
  assert.match(workflowSource, /fetch-depth:\s*0/u);
  assert.match(workflowSource, /gitleaks git --redact --report-format sarif/u);
  assert.match(workflowSource, /npm ci --ignore-scripts/u);
  assert.match(workflowSource, /npm audit --audit-level=high/u);
  assert.match(installer, /GITLEAKS_VERSION:-v8\.24\.2/u);
  assert.match(installer, /fa0500f6b7e41d28791ebc680f5dd9899cd42b58629218a5f041efa899151a8e/u);
  assert.equal(ignore.split("\n").filter((line) => line && !line.startsWith("#")).length, 4);
});

test("workflow policy rejects PR matrix, expression, and reusable workflow runner indirection", () => {
  const base = parseWorkflow(`
name: unsafe-runners
on:
  pull_request:
permissions:
  contents: read
jobs:
  matrix:
    strategy:
      matrix:
        runner: [ubuntu-latest]
    runs-on: \${{ matrix.runner }}
    steps: []
  expression:
    runs-on: \${{ fromJSON('["ubuntu-latest"]') }}
    steps: []
  array:
    runs-on: [ubuntu-latest]
    steps: []
  reusable:
    uses: owner/repository/.github/workflows/ci.yml@0123456789012345678901234567890123456789
`);
  assert.deepEqual(workflowPolicyFindings("indirect.yml", base), [
    "indirect.yml:matrix: pull_request_runner_must_be_literal_github_hosted",
    "indirect.yml:expression: pull_request_runner_must_be_literal_github_hosted",
    "indirect.yml:array: pull_request_runner_must_be_literal_github_hosted",
    "indirect.yml:reusable: pull_request_reusable_job_forbidden",
  ]);
});

test("workflow policy rejects implicit, write-all, and dynamic pull-request permissions", () => {
  const base = {
    on: { pull_request: {} },
    jobs: {
      test: {
        "runs-on": "ubuntu-latest",
        steps: [],
      },
    },
  };

  assert.ok(
    workflowPolicyFindings("implicit.yml", base).some((finding) =>
      finding.includes("pull_request_permissions_must_be_explicit"),
    ),
  );
  assert.ok(
    workflowPolicyFindings("write-all.yml", { ...base, permissions: "write-all" }).some((finding) =>
      finding.includes("pull_request_permissions_must_be_read_only"),
    ),
  );
  assert.ok(
    workflowPolicyFindings("dynamic.yml", {
      ...base,
      permissions: { contents: "${{ inputs.permission }}" },
    }).some((finding) => finding.includes("pull_request_write_or_dynamic_permission:contents")),
  );
  assert.ok(
    workflowPolicyFindings("job-write-all.yml", {
      ...base,
      permissions: { contents: "read" },
      jobs: {
        test: { ...base.jobs.test, permissions: "write-all" },
      },
    }).some((finding) => finding.includes("job:test: pull_request_permissions_must_be_read_only")),
  );
});

test("workflow policy rejects manual dispatch into self-hosted jobs", () => {
  const workflow = parseWorkflow(`
name: unsafe-manual-self-hosted
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  nightly:
    runs-on: [self-hosted, linux]
    steps: []
`);
  assert.deepEqual(workflowPolicyFindings("manual.yml", workflow), [
    "manual.yml:nightly: workflow_dispatch_self_hosted_forbidden",
  ]);
});

test("workflow policy rejects scheduled persistent self-hosted jobs", () => {
  const workflow = parseWorkflow(`
name: unsafe-scheduled-self-hosted
on:
  schedule:
    - cron: "0 0 * * *"
permissions:
  contents: read
jobs:
  nightly:
    runs-on: [self-hosted, linux, hetzner]
    steps: []
`);
  assert.deepEqual(workflowPolicyFindings("scheduled.yml", workflow), [
    "scheduled.yml:nightly: scheduled_persistent_self_hosted_forbidden",
  ]);
});

test("release policy binds one hashed tarball to the tested tag commit", () => {
  const workflowSource = fs.readFileSync(path.join(root, ".github", "workflows", "publish.yml"), "utf8");
  const verifier = fs.readFileSync(path.join(root, "scripts", "release", "verify-publish-source.sh"), "utf8");
  const workflow = parseWorkflow(workflowSource, "publish.yml");
  assert.deepEqual(releaseSecurityFindings(workflow, verifier), []);

  const unsafe = structuredClone(workflow);
  unsafe.jobs.publish.environment = "";
  unsafe.jobs.build.steps = unsafe.jobs.build.steps.filter(
    (step) => step.name !== "Revalidate immutable publish source",
  );
  unsafe.jobs.build.steps = unsafe.jobs.build.steps.filter(
    (step) => step.name !== "Require verified live publish protections",
  );
  const publishStep = unsafe.jobs.publish.steps.find((step) => step.name === "Publish exact artifact with provenance");
  publishStep.run = "npm publish --access public";
  const findings = releaseSecurityFindings(unsafe, verifier);
  assert.ok(findings.includes("oidc_publish_job_must_be_environment_gated_and_depend_on_build"));
  assert.ok(findings.includes("publish_source_must_be_verified_twice_in_isolated_build"));
  assert.ok(findings.includes("publish_workflow_must_enforce_live_protection_evidence"));
  assert.ok(findings.includes("publish_must_use_exact_downloaded_artifact_with_provenance"));
});

test("live publish evidence remains blocked until every external protection is freshly verified", () => {
  const evidence = JSON.parse(
    fs.readFileSync(path.join(root, "docs", "reports", "npm-publish-live-prerequisites.json"), "utf8"),
  );
  const observedAtMs = Date.parse(evidence.observedAt);
  assert.ok(
    livePublishPrerequisiteFindings(evidence, { nowMs: observedAtMs + 1_000 }).includes(
      "live_publish_prerequisites_status_blocked",
    ),
  );

  const ready = structuredClone(evidence);
  ready.status = "ready";
  ready.live = {
    mainBranchProtected: true,
    mainBranchProtectionReadback: "verified",
    npmPublishEnvironmentExists: true,
    requiredReviewerCount: 2,
    deploymentPolicy: "protected-release-tags-only",
    npmTrustedPublisherConfigured: true,
  };
  assert.deepEqual(livePublishPrerequisiteFindings(ready, { nowMs: observedAtMs + 1_000 }), []);
  assert.ok(
    livePublishPrerequisiteFindings(ready, { nowMs: observedAtMs + 8 * 24 * 60 * 60 * 1_000 }).includes(
      "live_publish_evidence_missing_or_stale",
    ),
  );
});

test("release policy rejects GitHub event SHA binding and non-verifying registry readback", () => {
  const workflowSource = fs.readFileSync(path.join(root, ".github", "workflows", "publish.yml"), "utf8");
  const verifier = fs.readFileSync(path.join(root, "scripts", "release", "verify-publish-source.sh"), "utf8");
  const unsafe = parseWorkflow(workflowSource, "publish.yml");
  const packStep = unsafe.jobs.build.steps.find((step) => step.id === "pack");
  packStep.run = packStep.run.replace('source_commit="$(git rev-parse HEAD)"', 'source_commit="$GITHUB_SHA"');
  const registryStep = unsafe.jobs.verify.steps.find((step) => step.name === "Registry readback");
  registryStep.run = 'npm view clawnera-bot-market@"$version" dist --json';
  const findings = releaseSecurityFindings(unsafe, verifier);
  assert.ok(findings.includes("release_tarball_must_be_built_once_with_digest_and_source_manifest"));
  assert.ok(findings.includes("registry_readback_must_verify_exact_tarball_digests"));
});

test("release policy rejects broader top-level, build, and OIDC permissions", () => {
  const workflowSource = fs.readFileSync(path.join(root, ".github", "workflows", "publish.yml"), "utf8");
  const verifier = fs.readFileSync(path.join(root, "scripts", "release", "verify-publish-source.sh"), "utf8");
  const unsafe = parseWorkflow(workflowSource, "publish.yml");
  unsafe.permissions = "write-all";
  unsafe.jobs.build.permissions = { contents: "read", actions: "read" };
  unsafe.jobs.publish.permissions.packages = "write";
  unsafe.jobs.verify.permissions["id-token"] = "write";
  const findings = releaseSecurityFindings(unsafe, verifier);
  assert.ok(findings.includes("publish_top_level_permissions_must_be_contents_read_only"));
  assert.ok(findings.includes("build_permissions_must_be_contents_read_only"));
  assert.ok(findings.includes("publish_job_permissions_must_be_exact_contents_read_and_id_token_write"));
  assert.ok(findings.includes("post_publish_verify_permissions_must_be_contents_read_only"));
});

test("release policy isolates OIDC publish from repository code, installs, expressions, and post-publish execution", () => {
  const workflowSource = fs.readFileSync(path.join(root, ".github", "workflows", "publish.yml"), "utf8");
  const verifier = fs.readFileSync(path.join(root, "scripts", "release", "verify-publish-source.sh"), "utf8");
  const unsafe = parseWorkflow(workflowSource, "publish.yml");
  unsafe.jobs.publish.steps.splice(2, 0, {
    name: "Unsafe checkout and install",
    uses: "actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd",
    run: "set -euo pipefail\nnpm install\nnode ./scripts/release/verify-registry-artifact.mjs\necho ${{ needs.build.outputs.source_commit }}",
  });
  unsafe.jobs.publish.steps.push({
    name: "Unsafe package readback",
    run: "set -euo pipefail\nnpm exec clawnera-bot-market -- --help",
  });

  const findings = releaseSecurityFindings(unsafe, verifier);
  assert.ok(findings.includes("oidc_publish_job_must_not_execute_repository_or_dependency_code"));
  assert.ok(findings.some((finding) => finding.startsWith("run_expression_injection_surface:publish:")));
  assert.ok(findings.includes("publish_must_use_exact_downloaded_artifact_with_provenance"));
});

test("registry artifact verifier requires local SHA1 and SHA512 equality", () => {
  const manifest = {
    artifact: "clawnera-bot-market-0.1.104.tgz",
    sha256: "a".repeat(64),
    sha1: "b".repeat(40),
    sha512Integrity: `sha512-${"A".repeat(86)}==`,
  };
  assert.deepEqual(
    assertRegistryArtifactMatches(manifest, {
      shasum: manifest.sha1,
      integrity: manifest.sha512Integrity,
    }),
    {
      artifact: manifest.artifact,
      sha1: manifest.sha1,
      sha512Integrity: manifest.sha512Integrity,
    },
  );
  assert.throws(
    () => assertRegistryArtifactMatches(manifest, { shasum: "c".repeat(40), integrity: manifest.sha512Integrity }),
    /sha1_mismatch/,
  );
  assert.throws(
    () => assertRegistryArtifactMatches(manifest, { shasum: manifest.sha1, integrity: `sha512-${"B".repeat(86)}==` }),
    /sha512_integrity_mismatch/,
  );
});

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";

const FULL_COMMIT_ACTION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.\/-]+)?@[0-9a-f]{40}$/;
const PINNED_DOCKER_ACTION = /^docker:\/\/[^\s@]+@sha256:[0-9a-f]{64}$/;
const LITERAL_GITHUB_HOSTED_RUNNER = /^(?:ubuntu-(?:latest|[0-9]{2}\.[0-9]{2})|windows-(?:latest|[0-9]{4})|macos-(?:latest|[0-9]{2}(?:-large)?))$/;

function workflowTriggers(workflow) {
  return workflow?.on ?? workflow?.[true] ?? null;
}

function hasTrigger(workflow, trigger) {
  const triggers = workflowTriggers(workflow);
  if (typeof triggers === "string") {
    return triggers === trigger;
  }
  if (Array.isArray(triggers)) {
    return triggers.includes(trigger);
  }
  return Boolean(triggers && typeof triggers === "object" && Object.prototype.hasOwnProperty.call(triggers, trigger));
}

function permissionEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value);
}

function unsafePullRequestPermissionFindings(fileName, location, value, { inherited = false } = {}) {
  if (value === undefined || value === null) {
    return inherited ? [] : [`${fileName}: pull_request_permissions_must_be_explicit`];
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "read-all"
      ? []
      : [`${fileName}:${location}: pull_request_permissions_must_be_read_only`];
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return [`${fileName}:${location}: pull_request_permissions_invalid`];
  }
  return permissionEntries(value)
    .filter(([, permission]) => !["read", "none"].includes(String(permission).trim().toLowerCase()))
    .map(([scope]) => `${fileName}:${location}: pull_request_write_or_dynamic_permission:${scope}`);
}

export function workflowPolicyFindings(fileName, workflow) {
  const findings = [];
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    return [`${fileName}: invalid_workflow_document`];
  }
  if (hasTrigger(workflow, "pull_request_target")) {
    findings.push(`${fileName}: pull_request_target_forbidden`);
  }
  const handlesPullRequests = hasTrigger(workflow, "pull_request") || hasTrigger(workflow, "pull_request_target");
  const handlesManualDispatch = hasTrigger(workflow, "workflow_dispatch");
  const handlesSchedule = hasTrigger(workflow, "schedule");
  if (handlesPullRequests) {
    findings.push(...unsafePullRequestPermissionFindings(fileName, "top-level", workflow.permissions));
  }

  for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
    const runners = Array.isArray(job?.["runs-on"]) ? job["runs-on"] : [job?.["runs-on"]];
    if (handlesManualDispatch && runners.includes("self-hosted")) {
      findings.push(`${fileName}:${jobName}: workflow_dispatch_self_hosted_forbidden`);
    }
    if (handlesSchedule && runners.includes("self-hosted")) {
      findings.push(`${fileName}:${jobName}: scheduled_persistent_self_hosted_forbidden`);
    }
    if (handlesPullRequests && typeof job?.uses === "string") {
      findings.push(`${fileName}:${jobName}: pull_request_reusable_job_forbidden`);
    } else if (
      handlesPullRequests &&
      (typeof job?.["runs-on"] !== "string" || !LITERAL_GITHUB_HOSTED_RUNNER.test(job["runs-on"]))
    ) {
      findings.push(`${fileName}:${jobName}: pull_request_runner_must_be_literal_github_hosted`);
    }
    if (handlesPullRequests) {
      findings.push(
        ...unsafePullRequestPermissionFindings(fileName, `job:${jobName}`, job?.permissions, { inherited: true }),
      );
    }
    for (const [stepIndex, step] of (Array.isArray(job?.steps) ? job.steps : []).entries()) {
      if (!step || typeof step !== "object" || typeof step.uses !== "string") {
        continue;
      }
      const action = step.uses.trim();
      if (
        !action.startsWith("./") &&
        !FULL_COMMIT_ACTION.test(action) &&
        !PINNED_DOCKER_ACTION.test(action)
      ) {
        findings.push(`${fileName}:${jobName}:${stepIndex}: mutable_or_invalid_action_ref:${action}`);
      }
      if (action.startsWith("actions/checkout@") && step.with?.["persist-credentials"] !== false) {
        findings.push(`${fileName}:${jobName}:${stepIndex}: checkout_credentials_must_not_persist`);
      }
    }
  }
  return findings;
}

export function parseWorkflow(source, fileName = "workflow.yml") {
  const parsed = yaml.load(source, { filename: fileName });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fileName}: invalid_workflow_document`);
  }
  return parsed;
}

export function checkWorkflowDirectory(directory) {
  const findings = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    findings.push(...workflowPolicyFindings(entry.name, parseWorkflow(fs.readFileSync(filePath, "utf8"), entry.name)));
  }
  return findings;
}

function run() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const findings = checkWorkflowDirectory(path.join(root, ".github", "workflows"));
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(finding);
    }
    process.exitCode = 1;
    return;
  }
  console.log("workflow_security_policy_ok");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run();
}

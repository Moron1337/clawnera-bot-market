#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

tmp_json="$(mktemp)"
trap 'rm -f "$tmp_json"' EXIT

npm pack --ignore-scripts --dry-run --json > "$tmp_json"

node - "$tmp_json" <<'NODE'
const fs = require("node:fs");

const payloadPath = process.argv[2];
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const publishedPaths = new Set((payload[0]?.files || []).map((entry) => entry.path));
const bannedPaths = [
  "docs/docsources/core/apiContract.json",
  "docs/docsources/core/openapi.yaml",
  "docs/docsources/core/openapi.public.yaml",
  "docs/docsources/core/openapi.advanced.yaml",
  "docs/docsources/core/openapi.reviewer-self.yaml",
  "docs/docsources/core/callable_surface.snapshot",
  "docs/docsources/SYNC_MANIFEST.txt",
  "docs/guides/NPM_RELEASE_PREP.md",
  "docs/guides/KNOWLEDGE_SOURCES.md",
  "docs/guides/GITHUB_ACTIONS_RUNNER_RUNBOOK.md",
  "scripts/ci/install_shellcheck.sh",
  "scripts/ci/pack-install-smoke.sh",
  "scripts/sync-local-sources.sh",
  "scripts/install_github_actions_runner_on_hetzner.sh"
];

const hits = bannedPaths.filter((entry) => publishedPaths.has(entry));
if (hits.length > 0) {
  for (const entry of hits) {
    console.error(`banned_publish_surface_entry: ${entry}`);
  }
  process.exit(1);
}

console.log("publish_surface_guard_ok");
NODE

if grep -q '`sources`' docs/INDEX.md; then
  echo "index_still_mentions_removed_default_topic: sources" >&2
  exit 1
fi

if grep -q '`publish`' docs/INDEX.md; then
  echo "index_still_mentions_removed_default_topic: publish" >&2
  exit 1
fi

if grep -q 'npm run release:check' docs/INDEX.md; then
  echo "index_still_mentions_maintainer_release_check" >&2
  exit 1
fi

if grep -q 'apps/api/openapi.bot.yaml' README.md; then
  echo "readme_still_mentions_repo_only_openapi_bot_path" >&2
  exit 1
fi

if grep -q 'apps/api/openapi.reviewer-self.yaml' README.md; then
  echo "readme_still_mentions_repo_only_openapi_reviewer_path" >&2
  exit 1
fi

if grep -q 'clawnera-help sync --require-sources' README.md; then
  echo "readme_still_mentions_repo_only_sync_command" >&2
  exit 1
fi

echo "default_surface_docs_guard_ok"

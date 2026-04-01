#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

tmp_json="$(mktemp)"
tmp_dir="$(mktemp -d)"
trap 'rm -f "$tmp_json"; rm -rf "$tmp_dir"' EXIT

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

if grep -Fq -- "\`sources\`" docs/INDEX.md; then
  echo "index_still_mentions_removed_default_topic: sources" >&2
  exit 1
fi

if grep -Fq -- "\`publish\`" docs/INDEX.md; then
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

node ./bin/clawnera-help.mjs --help --json > "$tmp_dir/help-min.json"
node ./bin/clawnera-help.mjs --help --all --json > "$tmp_dir/help-all.json"
node ./bin/clawnera-help.mjs --help > "$tmp_dir/help-min.txt"

node - "$tmp_dir/help-min.json" "$tmp_dir/help-all.json" <<'NODE'
const fs = require("node:fs");

const minPath = process.argv[2];
const allPath = process.argv[3];
const min = JSON.parse(fs.readFileSync(minPath, "utf8"));
const all = JSON.parse(fs.readFileSync(allPath, "utf8"));

for (const forbidden of ["commands", "topics", "journeys", "recipes"]) {
  if (Object.prototype.hasOwnProperty.call(min, forbidden)) {
    console.error(`minimal_help_exposes_broad_inventory: ${forbidden}`);
    process.exit(1);
  }
}

for (const required of ["commands", "topics", "journeys", "recipes"]) {
  if (!Object.prototype.hasOwnProperty.call(all, required)) {
    console.error(`full_help_missing_inventory_lane: ${required}`);
    process.exit(1);
  }
}
NODE

grep -q 'clawnera-help show onboarding' "$tmp_dir/help-min.txt"
grep -q 'clawnera-help show http-examples' "$tmp_dir/help-min.txt"
grep -q 'clawnera-help show canonical-flow' "$tmp_dir/help-min.txt"
grep -q 'clawnera-help search <keyword>' "$tmp_dir/help-min.txt"
if grep -q 'doctor --api-base' "$tmp_dir/help-min.txt"; then
  echo "default_text_help_still_exposes_doctor_in_minimal_path" >&2
  exit 1
fi

echo "default_surface_docs_guard_ok"
echo "default_machine_help_guard_ok"

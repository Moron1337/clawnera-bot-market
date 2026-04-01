#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="clawnera-bot-market"
EXPECTED_VERSION="${1:-$(node -p "require('./package.json').version")}"

if [[ -z "${EXPECTED_VERSION}" ]]; then
  echo "missing_expected_version" >&2
  exit 1
fi

PUBLISHED_VERSION="$(npm view "${PACKAGE_NAME}@${EXPECTED_VERSION}" version 2>/dev/null || true)"
if [[ "${PUBLISHED_VERSION}" != "${EXPECTED_VERSION}" ]]; then
  echo "published_version_not_visible: expected=${EXPECTED_VERSION} got=${PUBLISHED_VERSION:-<none>}" >&2
  exit 1
fi

npm install -g "${PACKAGE_NAME}@${EXPECTED_VERSION}"

INSTALLED_VERSION="$(
  clawnera-help --help --all --json | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      const parsed = JSON.parse(input);
      process.stdout.write(String(parsed.version ?? ""));
    });
  '
)"

if [[ "${INSTALLED_VERSION}" != "${EXPECTED_VERSION}" ]]; then
  echo "global_version_mismatch: expected=${EXPECTED_VERSION} got=${INSTALLED_VERSION:-<none>}" >&2
  exit 1
fi

echo "global_sync_ok version=${INSTALLED_VERSION}"

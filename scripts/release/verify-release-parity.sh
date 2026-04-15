#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

resolve_version() {
  node -e 'const fs=require("fs"); const path=require("path"); const pkg=JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")); process.stdout.write(String(pkg.version || "").trim());'
}

VERSION="${1:-$(resolve_version)}"
if [[ -z "$VERSION" ]]; then
  echo "release_parity_error missing_version"
  exit 1
fi

TAG="v$VERSION"
PACKAGE_VERSION="$(npm view "clawnera-bot-market@$VERSION" version 2>/dev/null || true)"
if [[ "$PACKAGE_VERSION" != "$VERSION" ]]; then
  echo "release_parity_error npm_registry_missing version=$VERSION"
  exit 1
fi

git rev-parse --verify "$TAG^{tag}" >/dev/null
git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null
gh release view "$TAG" --json tagName,url >/dev/null

GLOBAL_VERSION="missing"
if command -v clawnera-help >/dev/null 2>&1; then
  GLOBAL_VERSION="$(clawnera-help --help --all --json | node -e 'let data=""; process.stdin.on("data", (chunk) => data += chunk); process.stdin.on("end", () => { try { const parsed = JSON.parse(data); process.stdout.write(String(parsed.version || "unknown")); } catch { process.stdout.write("invalid_json"); process.exitCode = 1; } });')"
fi

echo "release_parity_ok version=$VERSION tag=$TAG global=$GLOBAL_VERSION"

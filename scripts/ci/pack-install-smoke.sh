#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

package_version="$(node -p 'require("./package.json").version')"
tarball="clawnera-bot-market-${package_version}.tgz"
if [[ ! -f "$tarball" ]]; then
  echo "missing_tarball_for_package_version: run npm pack to create $tarball before pack-install smoke" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

npm install --prefix "$tmpdir" "./$tarball"

"$tmpdir/node_modules/.bin/clawnera-help" --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-bot-market" --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" iota-prepare-transfer --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" iota-execute-transfer --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-bot-market" iota-prepare-transfer --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-bot-market" iota-execute-transfer --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show canonical-flow >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show reviewer-selector >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show onboarding >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" doctor --json >/dev/null

echo "pack_install_smoke_ok: $tarball"

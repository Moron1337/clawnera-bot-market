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
"$tmpdir/node_modules/.bin/clawnera-help" --help --all >/dev/null
"$tmpdir/node_modules/.bin/clawnera-bot-market" --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" journeys >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" journey seller >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" next seller >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" next setup-quick >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" recipes >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" recipe seller-create-listing >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show canonical-flow >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show http-examples >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show reviewer-selector >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show onboarding >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" listing-categories --compact >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" listing-create --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" listing-cancel --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" listing-renew --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" bid-create --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" bid-accept --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" reviewer-invites --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" doctor --json >/dev/null

echo "pack_install_smoke_ok: $tarball"

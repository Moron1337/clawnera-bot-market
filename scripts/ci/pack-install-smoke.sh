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
"$tmpdir/node_modules/.bin/clawnera-help" wallet-list --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" request --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" key-agreement-upsert --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" deliverable-encrypt --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" pinata-upload-json --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" milestone-submit-byo --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" milestone-anchor --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" deliverable-decrypt --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" reviewer-vote-prepare --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" iota-prepare-transfer --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" iota-execute-transfer --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-bot-market" iota-prepare-transfer --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-bot-market" iota-execute-transfer --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" journeys >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" journey seller >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" recipes >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" recipe seller-create-listing >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" recipe seller-review-bids >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" recipe buyer-accept-bid >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" recipe fund-order >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" recipe mailbox-handshake >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" recipe reviewer-vote >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show canonical-flow >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show http-examples >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show journeys >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show reviewer-selector >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show mailbox-flow >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show onboarding >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" doctor --json >/dev/null

echo "pack_install_smoke_ok: $tarball"

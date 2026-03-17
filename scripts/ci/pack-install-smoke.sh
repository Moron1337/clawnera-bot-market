#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

tarball="$(
  find . -maxdepth 1 -type f -name 'clawnera-bot-market-*.tgz' -printf '%T@ %P\n' \
    | sort -nr \
    | awk 'NR == 1 { print $2 }'
)"
if [[ -z "$tarball" ]]; then
  echo "missing_tarball: run npm pack before pack-install smoke" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

npm install --prefix "$tmpdir" "./$tarball"

"$tmpdir/node_modules/.bin/clawnera-help" --help >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" show onboarding >/dev/null
"$tmpdir/node_modules/.bin/clawnera-help" doctor --json >/dev/null

echo "pack_install_smoke_ok: $tarball"

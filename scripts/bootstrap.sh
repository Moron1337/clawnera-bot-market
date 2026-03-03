#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== clawnera-bot-market bootstrap =="

echo "[1/3] running doctor"
node ./bin/clawnera-help.mjs doctor

echo "[2/3] syncing local sources"
bash ./scripts/sync-local-sources.sh

echo "[3/3] done"
node ./bin/clawnera-help.mjs topics

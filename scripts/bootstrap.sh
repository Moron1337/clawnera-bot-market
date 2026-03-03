#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== clawnera-bot-market bootstrap =="

echo "[1/4] running doctor"
node ./bin/clawnera-help.mjs doctor

echo "[2/4] validating docs/topics"
node ./bin/clawnera-help.mjs validate --strict

echo "[3/4] syncing local sources"
bash ./scripts/sync-local-sources.sh

echo "[4/4] done"
node ./bin/clawnera-help.mjs topics

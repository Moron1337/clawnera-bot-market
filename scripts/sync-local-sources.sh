#!/usr/bin/env bash
set -euo pipefail

# Copies selected local source docs from active workspace repos into this knowledge repo.
# Safe to run repeatedly.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/docs/docsources"

MARKETPLACE_SOURCE_ROOT="${MARKETPLACE_SOURCE_ROOT:-}"
CLAW_ROOT="${CLAW_ROOT:-}"

if [[ -z "$MARKETPLACE_SOURCE_ROOT" ]]; then
  for candidate in "$ROOT_DIR/.." "$HOME"/*; do
    if [[ -f "$candidate/apps/api/openapi.yaml" ]] && [[ -f "$candidate/contracts/claw_marketplace/ci/callable_surface.snapshot" ]]; then
      MARKETPLACE_SOURCE_ROOT="$candidate"
      break
    fi
  done
fi

if [[ -z "$MARKETPLACE_SOURCE_ROOT" ]]; then
  echo "missing_marketplace_source_root: set MARKETPLACE_SOURCE_ROOT=/path/to/marketplace-core-repo"
  exit 1
fi

if [[ -z "$CLAW_ROOT" ]]; then
  for candidate in "$ROOT_DIR/../claw" "$HOME/claw" "$HOME"/*; do
    if [[ -f "$candidate/docs/CLAW_OPERATIONS_CURRENT.md" ]] && [[ -f "$candidate/docs/CLAW_SWAP_GATEWAY_CURRENT.md" ]]; then
      CLAW_ROOT="$candidate"
      break
    fi
  done
fi

mkdir -p "$OUT_DIR/core" "$OUT_DIR/claw"

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp -f "$src" "$dst"
    echo "copied: $src -> $dst"
  else
    echo "missing: $src"
  fi
}

normalize_claw_buy_worker_snapshot() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 0
  fi

  perl -0pi -e 's/- Live URL:\n  - `https:\/\/buy-claw-coin\.specdrops\.workers\.dev`\n//g' "$file"
}

# Core marketplace docs
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/docs/BOT_QUICKSTART.md" "$OUT_DIR/core/BOT_QUICKSTART.md"
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/docs/BOT_PROTOCOL_V1.md" "$OUT_DIR/core/BOT_PROTOCOL_V1.md"
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/docs/TWO_PARTY_TEST_MATRIX.md" "$OUT_DIR/core/TWO_PARTY_TEST_MATRIX.md"
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/docs/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md" "$OUT_DIR/core/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md"
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/docs/SMART_CONTRACT_ERKLAERUNG_2026-02-25.md" "$OUT_DIR/core/SMART_CONTRACT_ERKLAERUNG_2026-02-25.md"
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/docs/NEXT_SESSION_STATUS.md" "$OUT_DIR/core/NEXT_SESSION_STATUS.md"

# API + contract machine-readable references
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/apps/api/openapi.yaml" "$OUT_DIR/core/openapi.yaml"
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/apps/api/openapi.public.yaml" "$OUT_DIR/core/openapi.public.yaml"
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/apps/api/openapi.advanced.yaml" "$OUT_DIR/core/openapi.advanced.yaml"
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/apps/api/openapi.reviewer-self.yaml" "$OUT_DIR/core/openapi.reviewer-self.yaml"
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/packages/sdk/src/generated/apiContract.json" "$OUT_DIR/core/apiContract.json"
copy_if_exists "$MARKETPLACE_SOURCE_ROOT/contracts/claw_marketplace/ci/callable_surface.snapshot" "$OUT_DIR/core/callable_surface.snapshot"

# CLAW ecosystem docs
if [[ -n "$CLAW_ROOT" ]]; then
  copy_if_exists "$CLAW_ROOT/docs/CLAW_OPERATIONS_CURRENT.md" "$OUT_DIR/claw/CLAW_OPERATIONS_CURRENT.md"
  copy_if_exists "$CLAW_ROOT/docs/CLAW_SWAP_GATEWAY_CURRENT.md" "$OUT_DIR/claw/CLAW_SWAP_GATEWAY_CURRENT.md"
  copy_if_exists "$CLAW_ROOT/docs/CLAW_LOCAL_ORACLE_SYNC_RUNBOOK.md" "$OUT_DIR/claw/CLAW_LOCAL_ORACLE_SYNC_RUNBOOK.md"
  normalize_claw_buy_worker_snapshot "$OUT_DIR/claw/CLAW_OPERATIONS_CURRENT.md"
else
  echo "missing_claw_root: set CLAW_ROOT=/path/to/claw-repo (continuing with core sources only)"
fi

MANIFEST="$OUT_DIR/SYNC_MANIFEST.txt"
{
  echo "synced_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "marketplace_source_root=$MARKETPLACE_SOURCE_ROOT"
  echo "claw_root=$CLAW_ROOT"
} > "$MANIFEST"

echo "done: $MANIFEST"

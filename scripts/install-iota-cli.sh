#!/usr/bin/env bash
set -euo pipefail

# Lightweight helper for Linux hosts.
# Usage:
#   bash scripts/install-iota-cli.sh
#   bash scripts/install-iota-cli.sh v1.16.2

VERSION="${1:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
REPO="iotaledger/iota"

mkdir -p "$INSTALL_DIR"

if command -v iota >/dev/null 2>&1; then
  echo "iota_cli_already_present: $(iota --version 2>/dev/null || echo unknown)"
fi

if [[ "$VERSION" == "latest" ]]; then
  RELEASE_URL="https://api.github.com/repos/${REPO}/releases/latest"
else
  RELEASE_URL="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
fi

echo "fetching_release_metadata: ${RELEASE_URL}"
JSON="$(curl -fsSL "$RELEASE_URL")"

ASSET_URL="$(printf '%s' "$JSON" \
  | grep -Eo 'https://[^\"]+' \
  | grep -E '/download/.*(linux|Linux).*(x86_64|amd64).*(\.tar\.gz|\.tgz|\.zip)$' \
  | head -n 1 || true)"

if [[ -z "$ASSET_URL" ]]; then
  echo "failed_to_find_linux_asset"
  echo "manual_fallback: https://github.com/${REPO}/releases"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
ASSET_FILE="$TMP_DIR/asset"

echo "downloading: $ASSET_URL"
curl -fsSL "$ASSET_URL" -o "$ASSET_FILE"

if file "$ASSET_FILE" | grep -qi 'zip'; then
  unzip -q "$ASSET_FILE" -d "$TMP_DIR/unpack"
else
  tar -xf "$ASSET_FILE" -C "$TMP_DIR" || tar -xzf "$ASSET_FILE" -C "$TMP_DIR"
fi

CANDIDATE="$(find "$TMP_DIR" -type f -name iota | head -n 1 || true)"
if [[ -z "$CANDIDATE" ]]; then
  echo "missing_iota_binary_in_release_asset"
  exit 1
fi

install -m 0755 "$CANDIDATE" "$INSTALL_DIR/iota"

echo "installed: $INSTALL_DIR/iota"
"$INSTALL_DIR/iota" --version || true

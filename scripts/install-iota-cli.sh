#!/usr/bin/env bash
set -euo pipefail

# Lightweight helper for Linux hosts.
# Usage:
#   bash scripts/install-iota-cli.sh
#   bash scripts/install-iota-cli.sh v1.16.2

VERSION="${1:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
REPO="iotaledger/iota"

# --- pre-flight checks ---
if ! command -v curl >/dev/null 2>&1; then
  echo "preflight_failed: curl is required but not found"
  echo "install_hint: sudo apt-get install -y curl  (Debian/Ubuntu) | apk add curl  (Alpine)"
  exit 1
fi

HAS_TAR=0; HAS_UNZIP=0; HAS_PY3=0
command -v tar     >/dev/null 2>&1 && HAS_TAR=1
command -v unzip   >/dev/null 2>&1 && HAS_UNZIP=1
command -v python3 >/dev/null 2>&1 && HAS_PY3=1
if [[ "$HAS_TAR" == "0" && "$HAS_UNZIP" == "0" && "$HAS_PY3" == "0" ]]; then
  echo "preflight_failed: at least one of tar, unzip, or python3 is required to extract the release asset"
  echo "install_hint: sudo apt-get install -y tar  (Debian/Ubuntu) | apk add tar  (Alpine)"
  exit 1
fi

mkdir -p "$INSTALL_DIR"

print_missing_shared_libs() {
  local binary_path="$1"
  if ! command -v ldd >/dev/null 2>&1; then
    return 0
  fi

  local missing_libs
  missing_libs="$(ldd "$binary_path" 2>&1 | awk '/not found/ {print $1}' | paste -sd ',' -)"
  if [[ -n "$missing_libs" ]]; then
    echo "missing_shared_libraries: $missing_libs"
    echo "fix_debian_ubuntu: sudo apt-get install -y libpq5"
    echo "fix_alpine: apk add libpq"
    echo "fix_fedora: dnf install libpq"
    echo "alternative: skip the CLI and use clawnera-help wallet-init --alias <name>"
  fi
}

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

if [[ "$ASSET_URL" == *.zip ]]; then
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$ASSET_FILE" -d "$TMP_DIR/unpack"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$ASSET_FILE" "$TMP_DIR/unpack" <<'PY'
import sys
import zipfile

archive = sys.argv[1]
target = sys.argv[2]

with zipfile.ZipFile(archive) as zf:
    zf.extractall(target)
PY
  else
    echo "zip_asset_requires_unzip_or_python3"
    exit 1
  fi
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
VERIFY_OUTPUT="$("$INSTALL_DIR/iota" --version 2>&1)" || {
  echo "iota_binary_verification_failed"
  print_missing_shared_libs "$INSTALL_DIR/iota"
  printf '%s\n' "$VERIFY_OUTPUT"
  exit 1
}
printf '%s\n' "$VERIFY_OUTPUT"

# warn if install dir is not on PATH
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "path_warning: $INSTALL_DIR is not on PATH"
    echo "fix_now: export PATH=\"$INSTALL_DIR:\$PATH\""
    echo "fix_permanent: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
    ;;
esac

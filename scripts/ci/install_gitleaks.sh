#!/usr/bin/env bash
set -euo pipefail

GITLEAKS_VERSION_RAW="${GITLEAKS_VERSION:-v8.24.2}"
INSTALL_DIR="${GITLEAKS_INSTALL_DIR:-$HOME/.local/bin}"
PLATFORM="${GITLEAKS_PLATFORM:-linux}"
ARCH="${GITLEAKS_ARCH:-x64}"
EXPECTED_SHA256="${GITLEAKS_EXPECTED_SHA256:-}"
CURL_BASE_ARGS=(
  --fail
  --show-error
  --location
  --retry 5
  --retry-delay 2
  --retry-all-errors
  --connect-timeout 20
  --proto '=https'
  --tlsv1.2
)
GITHUB_HEADERS=(-H "User-Agent: clawnera-ci-install-gitleaks")

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  GITHUB_HEADERS+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

normalize_version() {
  local raw="${1:-}"
  if [[ -z "$raw" ]]; then
    echo "v8.24.2"
    return 0
  fi
  if [[ "$raw" == v* ]]; then
    echo "$raw"
  else
    echo "v$raw"
  fi
}

if ! command -v curl >/dev/null 2>&1; then
  echo "[install-gitleaks] curl is required" >&2
  exit 1
fi
if ! command -v tar >/dev/null 2>&1; then
  echo "[install-gitleaks] tar is required" >&2
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1; then
  echo "[install-gitleaks] sha256sum is required" >&2
  exit 1
fi

version="$(normalize_version "$GITLEAKS_VERSION_RAW")"
asset="gitleaks_${version#v}_${PLATFORM}_${ARCH}.tar.gz"
url="https://github.com/gitleaks/gitleaks/releases/download/${version}/${asset}"
if [[ -z "$EXPECTED_SHA256" && "$version/$PLATFORM/$ARCH" == "v8.24.2/linux/x64" ]]; then
  EXPECTED_SHA256="fa0500f6b7e41d28791ebc680f5dd9899cd42b58629218a5f041efa899151a8e"
fi
[[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]] || {
  echo "[install-gitleaks] no reviewed SHA-256 for $version/$PLATFORM/$ARCH" >&2
  exit 1
}

mkdir -p "$INSTALL_DIR"
target="$INSTALL_DIR/gitleaks"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

archive_path="$tmp_dir/$asset"
extract_dir="$tmp_dir/extract"
mkdir -p "$extract_dir"

echo "[install-gitleaks] downloading $url"
curl "${CURL_BASE_ARGS[@]}" "${GITHUB_HEADERS[@]}" --max-time 900 "$url" -o "$archive_path"
printf '%s  %s\n' "$EXPECTED_SHA256" "$archive_path" | sha256sum --check --status || {
  echo "[install-gitleaks] checksum mismatch for $asset" >&2
  exit 1
}
tar -xzf "$archive_path" -C "$extract_dir"

binary_path="$(find "$extract_dir" -maxdepth 2 -type f -name gitleaks | head -n 1 || true)"
if [[ -z "$binary_path" ]]; then
  echo "[install-gitleaks] extracted archive did not contain gitleaks binary" >&2
  exit 1
fi

install -m 0755 "$binary_path" "$target"
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "$INSTALL_DIR" >> "$GITHUB_PATH"
fi

echo "[install-gitleaks] installed ${version} to $target"
"$target" version

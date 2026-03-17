#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_SCRIPT="$ROOT_DIR/scripts/install-iota-cli.sh"

AUTO_INSTALL_FLAG="${IOTA_HELPER_AUTO_INSTALL_CLI:-1}"
INIT_WALLET_FLAG="${IOTA_HELPER_INIT_WALLET:-0}"
SET_MAINNET_FLAG="${IOTA_HELPER_SET_MAINNET:-1}"
CLI_PATH="${IOTA_CLI_PATH:-iota}"

resolve_cli_binary() {
  command -v "$CLI_PATH" 2>/dev/null || true
}

describe_cli_runtime_failure() {
  local binary_path="$1"
  local version_output
  version_output="$("$binary_path" --version 2>&1 || true)"
  if [[ -n "$version_output" ]]; then
    echo "iota_cli_not_usable: $version_output" >&2
  else
    echo "iota_cli_not_usable: version_check_failed" >&2
  fi

  if command -v ldd >/dev/null 2>&1; then
    local missing_libs
    missing_libs="$(ldd "$binary_path" 2>&1 | awk '/not found/ {print $1}' | paste -sd ',' -)"
    if [[ -n "$missing_libs" ]]; then
      echo "missing_shared_libraries: $missing_libs" >&2
    fi
  fi
}

cli_is_usable() {
  local binary_path="$1"
  "$binary_path" --version >/dev/null 2>&1
}

for arg in "$@"; do
  case "$arg" in
    --no-auto-install)
      AUTO_INSTALL_FLAG="0"
      ;;
    --init-wallet)
      INIT_WALLET_FLAG="1"
      ;;
    --no-mainnet-switch)
      SET_MAINNET_FLAG="0"
      ;;
    --help|-h)
      cat <<'USAGE'
Usage: bash scripts/bootstrap-iota-first-steps.sh [options]

Options:
  --init-wallet        create first wallet address when keystore is empty
  --no-auto-install    do not auto-install IOTA CLI when missing
  --no-mainnet-switch  skip switching active env to mainnet
  --help               show this help

Env overrides:
  IOTA_CLI_PATH              CLI binary path (default: iota)
  IOTA_HELPER_AUTO_INSTALL_CLI=0|1
  IOTA_HELPER_INIT_WALLET=0|1
  IOTA_HELPER_SET_MAINNET=0|1
USAGE
      exit 0
      ;;
    *)
      echo "unknown_arg: $arg" >&2
      exit 1
      ;;
  esac
done

ensure_cli_available() {
  local resolved_cli
  resolved_cli="$(resolve_cli_binary)"
  if [[ -n "$resolved_cli" ]]; then
    if cli_is_usable "$resolved_cli"; then
      return 0
    fi
    describe_cli_runtime_failure "$resolved_cli"
  fi

  if [[ "$AUTO_INSTALL_FLAG" == "0" ]]; then
    echo "missing_iota_cli_and_auto_install_disabled" >&2
    return 1
  fi

  if [[ ! -x "$INSTALL_SCRIPT" ]]; then
    echo "missing_install_script: $INSTALL_SCRIPT" >&2
    return 1
  fi

  echo "iota_cli_missing_attempting_install"
  bash "$INSTALL_SCRIPT"

  resolved_cli="$(resolve_cli_binary)"
  if [[ -n "$resolved_cli" ]] && cli_is_usable "$resolved_cli"; then
    return 0
  fi

  if [[ -n "$resolved_cli" ]]; then
    describe_cli_runtime_failure "$resolved_cli"
  fi
  echo "iota_cli_still_missing_after_install" >&2
  return 1
}

count_addresses() {
  local json
  json="$("$CLI_PATH" client addresses --json 2>/dev/null || true)"
  if [[ -z "$json" ]]; then
    echo 0
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq 'length' 2>/dev/null || echo 0
  else
    printf '%s' "$json" | grep -c '"address"' || true
  fi
}

ensure_cli_available

echo "iota_version: $("$CLI_PATH" --version 2>/dev/null || echo unknown)"

if [[ "$SET_MAINNET_FLAG" == "1" ]]; then
  echo "switching_active_env_to_mainnet_if_available"
  "$CLI_PATH" client switch --env mainnet >/dev/null 2>&1 || true
fi

echo "active_env: $("$CLI_PATH" client active-env 2>/dev/null || echo unknown)"
echo "active_address: $("$CLI_PATH" client active-address 2>/dev/null || echo unknown)"

if [[ "$INIT_WALLET_FLAG" == "1" ]]; then
  existing_count="$(count_addresses)"
  if [[ "${existing_count:-0}" == "0" ]]; then
    echo "creating_first_wallet_address"
    "$CLI_PATH" client new-address --json >/dev/null 2>&1 || true
  fi
  echo "active_address_after_init: $("$CLI_PATH" client active-address 2>/dev/null || echo unknown)"
fi

echo "first_steps_done"

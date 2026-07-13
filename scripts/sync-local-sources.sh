#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUT_DIR="$ROOT_DIR/docs/docsources"
MARKETPLACE_SOURCE_ROOT="${MARKETPLACE_SOURCE_ROOT:-${1:-}}"
MARKETPLACE_SOURCE_COMMIT="${MARKETPLACE_SOURCE_COMMIT:-}"
EXPECTED_REMOTE_ID="github.com/Moron1337/Clawdex"
SOURCE_SNAPSHOT_PARENT=""
SOURCE_SNAPSHOT=""
TEMP_OUTPUTS=()

cleanup() {
  local temporary
  for temporary in "${TEMP_OUTPUTS[@]}"; do
    rm -f -- "$temporary" 2>/dev/null || true
  done
  if [[ -n "$SOURCE_SNAPSHOT_PARENT" ]]; then
    rm -rf -- "$SOURCE_SNAPSHOT_PARENT"
  fi
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -z "$MARKETPLACE_SOURCE_ROOT" ]]; then
  echo "missing_marketplace_source_root: set MARKETPLACE_SOURCE_ROOT=/path/to/clawdex"
  exit 1
fi
if [[ ! "$MARKETPLACE_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "invalid_marketplace_source_commit: set MARKETPLACE_SOURCE_COMMIT to the reviewed full lowercase 40-character SHA"
  exit 1
fi
MARKETPLACE_SOURCE_ROOT="$(cd "$MARKETPLACE_SOURCE_ROOT" && pwd -P)"

normalize_github_remote() {
  local remote="${1%.git}"
  case "$remote" in
    git@github.com:*) printf 'github.com/%s\n' "${remote#git@github.com:}" ;;
    https://github.com/*) printf 'github.com/%s\n' "${remote#https://github.com/}" ;;
    ssh://git@github.com/*) printf 'github.com/%s\n' "${remote#ssh://git@github.com/}" ;;
    *) printf '%s\n' "$remote" ;;
  esac
}

git -C "$MARKETPLACE_SOURCE_ROOT" rev-parse --is-inside-work-tree >/dev/null
ACTUAL_REMOTE_ID="$(normalize_github_remote "$(git -C "$MARKETPLACE_SOURCE_ROOT" remote get-url origin)")"
if [[ "$ACTUAL_REMOTE_ID" != "$EXPECTED_REMOTE_ID" ]]; then
  echo "unexpected_marketplace_source_remote: expected=$EXPECTED_REMOTE_ID actual=$ACTUAL_REMOTE_ID"
  exit 1
fi

git -C "$MARKETPLACE_SOURCE_ROOT" fetch --prune --no-tags origin '+refs/heads/*:refs/remotes/origin/*'
git -C "$MARKETPLACE_SOURCE_ROOT" cat-file -e "$MARKETPLACE_SOURCE_COMMIT^{commit}"

SOURCE_COMMIT="$(git -C "$MARKETPLACE_SOURCE_ROOT" rev-parse HEAD)"
ORIGIN_MAIN_COMMIT="$(git -C "$MARKETPLACE_SOURCE_ROOT" rev-parse refs/remotes/origin/main)"
if [[ "$SOURCE_COMMIT" != "$MARKETPLACE_SOURCE_COMMIT" ]]; then
  echo "marketplace_source_commit_mismatch: expected=$MARKETPLACE_SOURCE_COMMIT actual=$SOURCE_COMMIT"
  exit 1
fi
REMOTE_CONTAINING_REFS="$(
  git -C "$MARKETPLACE_SOURCE_ROOT" for-each-ref --format='%(refname)' --contains "$SOURCE_COMMIT" refs/remotes/origin/ \
    | grep -Ev '/HEAD$' || true
)"
if [[ -z "$REMOTE_CONTAINING_REFS" ]]; then
  echo "marketplace_source_commit_not_on_origin: $SOURCE_COMMIT"
  exit 1
fi
if ! git -C "$MARKETPLACE_SOURCE_ROOT" merge-base --is-ancestor "$ORIGIN_MAIN_COMMIT" "$SOURCE_COMMIT"; then
  echo "marketplace_source_not_based_on_origin_main: source=$SOURCE_COMMIT origin_main=$ORIGIN_MAIN_COMMIT"
  exit 1
fi
if [[ -n "$(git -C "$MARKETPLACE_SOURCE_ROOT" status --porcelain --untracked-files=all)" ]]; then
  echo "marketplace_source_not_clean: $MARKETPLACE_SOURCE_ROOT"
  exit 1
fi

COMMITTED_SOURCE_MAPPINGS=(
  "docs/security/evidence/iota-fresh-generation/public-helper-deployment.json|config/marketplace-deployments.json"
  "docs/BOT_QUICKSTART.md|docs/docsources/core/BOT_QUICKSTART.md"
  "docs/BOT_PROTOCOL_V1.md|docs/docsources/core/BOT_PROTOCOL_V1.md"
  "docs/TWO_PARTY_TEST_MATRIX.md|docs/docsources/core/TWO_PARTY_TEST_MATRIX.md"
  "docs/SMART_CONTRACT_ARCHITECTURE_MAP.md|docs/docsources/core/SMART_CONTRACT_ARCHITECTURE_MAP.md"
  "docs/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md|docs/docsources/core/SMART_CONTRACT_FUNCTION_INVENTORY_AND_USER_TEST_MATRIX.md"
  "docs/SMART_CONTRACT_ERKLAERUNG_2026-02-25.md|docs/docsources/core/SMART_CONTRACT_ERKLAERUNG_2026-02-25.md"
  "apps/api/openapi.yaml|docs/docsources/core/openapi.yaml"
  "apps/api/openapi.public.yaml|docs/docsources/core/openapi.public.yaml"
  "apps/api/openapi.advanced.yaml|docs/docsources/core/openapi.advanced.yaml"
  "apps/api/openapi.reviewer-self.yaml|docs/docsources/core/openapi.reviewer-self.yaml"
  "packages/sdk/src/generated/apiContract.json|docs/docsources/core/apiContract.json"
  "contracts/claw_settlement_core/ci/callable_surface.snapshot|docs/docsources/core/callable_surface.snapshot"
)

GENERATED_SOURCE_MAPPINGS=(
  "packages/sdk/dist/validation.js|lib/vendor/clawdex-sdk/validation.js"
  "packages/sdk/dist/assetControlPlane.js|lib/vendor/clawdex-sdk/assetControlPlane.js"
  "packages/sdk/dist/tx/assetCoin.js|lib/vendor/clawdex-sdk/tx/assetCoin.js"
  "packages/sdk/dist/tx/reputation.js|lib/vendor/clawdex-sdk/tx/reputation.js"
  "packages/sdk/dist/tx/clawCoin.js|lib/vendor/clawdex-sdk/tx/clawCoin.js"
  "packages/sdk/dist/tx/orderEscrow.js|lib/vendor/clawdex-sdk/tx/orderEscrow.js"
  "packages/sdk/dist/tx/disputeQuorum.js|lib/vendor/clawdex-sdk/tx/disputeQuorum.js"
  "packages/sdk/dist/tx/listingDeposit.js|lib/vendor/clawdex-sdk/tx/listingDeposit.js"
  "packages/sdk/dist/tx/manifestAnchor.js|lib/vendor/clawdex-sdk/tx/manifestAnchor.js"
  "packages/sdk/dist/suiMilestoneManifestTx.js|lib/vendor/clawdex-sdk/suiMilestoneManifestTx.js"
  "packages/sdk/dist/tx/orderMailbox.js|lib/vendor/clawdex-sdk/tx/orderMailbox.js"
)

SOURCE_MAPPINGS=("${COMMITTED_SOURCE_MAPPINGS[@]}" "${GENERATED_SOURCE_MAPPINGS[@]}")
if [[ "${#COMMITTED_SOURCE_MAPPINGS[@]}" -ne 13 ]] \
  || [[ "${#GENERATED_SOURCE_MAPPINGS[@]}" -ne 11 ]] \
  || [[ "${#SOURCE_MAPPINGS[@]}" -ne 24 ]]; then
  echo "invalid_sync_mapping_count: committed=${#COMMITTED_SOURCE_MAPPINGS[@]} generated=${#GENERATED_SOURCE_MAPPINGS[@]} total=${#SOURCE_MAPPINGS[@]}"
  exit 1
fi

committed_blob_id() {
  local relative="$1"
  local entry
  local entry_mode
  local entry_type
  local entry_object
  local entry_path
  entry="$(
    git -C "$MARKETPLACE_SOURCE_ROOT" ls-tree \
      --format='%(objectmode)%x09%(objecttype)%x09%(objectname)%x09%(path)' \
      "$SOURCE_COMMIT" -- "$relative"
  )"
  IFS=$'\t' read -r entry_mode entry_type entry_object entry_path <<< "$entry"
  if [[ "$entry_path" != "$relative" ]] \
    || [[ "$entry_type" != "blob" ]] \
    || { [[ "$entry_mode" != "100644" ]] && [[ "$entry_mode" != "100755" ]]; } \
    || [[ ! "$entry_object" =~ ^[0-9a-f]{40,64}$ ]]; then
    echo "missing_or_nonregular_committed_sync_source: $relative mode=${entry_mode:-missing} type=${entry_type:-missing}" >&2
    return 1
  fi
  printf '%s\n' "$entry_object"
}

assert_commit_tree_regular_blobs() {
  local entry
  local entry_mode
  local entry_type
  local entry_object
  local entry_path
  while IFS= read -r -d '' entry; do
    IFS=$'\t' read -r entry_mode entry_type entry_object entry_path <<< "$entry"
    if [[ "$entry_type" != "blob" ]] \
      || { [[ "$entry_mode" != "100644" ]] && [[ "$entry_mode" != "100755" ]]; } \
      || [[ ! "$entry_object" =~ ^[0-9a-f]{40,64}$ ]]; then
      printf 'nonregular_committed_snapshot_entry: mode=%s type=%s path=%q\n' \
        "$entry_mode" "$entry_type" "$entry_path" >&2
      return 1
    fi
  done < <(
    git -C "$MARKETPLACE_SOURCE_ROOT" ls-tree -rz \
      --format='%(objectmode)%x09%(objecttype)%x09%(objectname)%x09%(path)' \
      "$SOURCE_COMMIT"
  )
}

assert_snapshot_regular_no_follow() {
  local relative="$1"
  local cursor="$SOURCE_SNAPSHOT"
  local segment
  local -a segments=()
  IFS='/' read -r -a segments <<< "$relative"
  for segment in "${segments[@]}"; do
    cursor="$cursor/$segment"
    if [[ -L "$cursor" ]]; then
      echo "symlinked_generated_sync_source_rejected: $relative"
      exit 1
    fi
  done
  if [[ ! -f "$cursor" ]] || [[ "$(stat -c '%F' -- "$cursor")" != "regular file" ]]; then
    echo "missing_or_nonregular_generated_sync_source: $relative"
    exit 1
  fi
}

ensure_destination_parent() {
  local relative="$1"
  local parent
  local cursor="$ROOT_DIR"
  local segment
  parent="$(dirname "$relative")"
  IFS='/' read -r -a segments <<< "$parent"
  for segment in "${segments[@]}"; do
    [[ "$segment" == "." ]] && continue
    cursor="$cursor/$segment"
    if [[ -L "$cursor" ]]; then
      echo "symlinked_sync_destination_rejected: $relative"
      exit 1
    fi
    if [[ -e "$cursor" ]] && [[ ! -d "$cursor" ]]; then
      echo "non_directory_sync_destination_parent: $relative"
      exit 1
    fi
    if [[ ! -e "$cursor" ]]; then
      mkdir "$cursor"
    fi
  done
}

prepare_destination() {
  local destination_relative="$1"
  local destination
  ensure_destination_parent "$destination_relative"
  destination="$ROOT_DIR/$destination_relative"
  if [[ -L "$destination" ]] || { [[ -e "$destination" ]] && [[ ! -f "$destination" ]]; }; then
    echo "unsafe_sync_destination: $destination_relative"
    exit 1
  fi
  printf '%s\n' "$destination"
}

atomic_write_committed_blob() {
  local blob_id="$1"
  local destination_relative="$2"
  local destination
  local temporary
  destination="$(prepare_destination "$destination_relative")"
  temporary="$(mktemp "$(dirname "$destination")/.${destination##*/}.XXXXXX")"
  TEMP_OUTPUTS+=("$temporary")
  git -C "$MARKETPLACE_SOURCE_ROOT" cat-file blob "$blob_id" > "$temporary"
  if [[ "$(git -C "$MARKETPLACE_SOURCE_ROOT" hash-object "$temporary")" != "$blob_id" ]]; then
    echo "committed_blob_copy_verification_failed: $destination_relative"
    exit 1
  fi
  chmod 0644 "$temporary"
  mv -fT -- "$temporary" "$destination"
  if [[ -L "$destination" ]] || [[ ! -f "$destination" ]] || [[ "$(stat -c '%F' -- "$destination")" != "regular file" ]]; then
    echo "invalid_copied_sync_destination: $destination_relative"
    exit 1
  fi
}

atomic_write_generated_file() {
  local source_relative="$1"
  local destination_relative="$2"
  local destination
  local temporary
  assert_snapshot_regular_no_follow "$source_relative"
  destination="$(prepare_destination "$destination_relative")"
  temporary="$(mktemp "$(dirname "$destination")/.${destination##*/}.XXXXXX")"
  TEMP_OUTPUTS+=("$temporary")
  install -m 0644 -- "$SOURCE_SNAPSHOT/$source_relative" "$temporary"
  mv -fT -- "$temporary" "$destination"
  if [[ -L "$destination" ]] || [[ ! -f "$destination" ]] || [[ "$(stat -c '%F' -- "$destination")" != "regular file" ]]; then
    echo "invalid_copied_sync_destination: $destination_relative"
    exit 1
  fi
}

assert_commit_tree_regular_blobs
for mapping in "${COMMITTED_SOURCE_MAPPINGS[@]}"; do
  committed_blob_id "${mapping%%|*}" >/dev/null
done

SOURCE_SNAPSHOT_PARENT="$(mktemp -d "${TMPDIR:-/tmp}/clawnera-runtime-source.XXXXXX")"
chmod 0700 "$SOURCE_SNAPSHOT_PARENT"
SOURCE_SNAPSHOT="$SOURCE_SNAPSHOT_PARENT/source"
mkdir -m 0700 "$SOURCE_SNAPSHOT"
git -C "$MARKETPLACE_SOURCE_ROOT" archive --format=tar "$SOURCE_COMMIT" \
  | tar --extract --file=- --directory="$SOURCE_SNAPSHOT" --no-same-owner --no-same-permissions

corepack pnpm --dir "$SOURCE_SNAPSHOT" install --frozen-lockfile
corepack pnpm --dir "$SOURCE_SNAPSHOT" --filter @clawdex/sdk build

if [[ "$(git -C "$MARKETPLACE_SOURCE_ROOT" rev-parse HEAD)" != "$SOURCE_COMMIT" ]]; then
  echo "marketplace_source_head_changed_during_sync: expected=$SOURCE_COMMIT actual=$(git -C "$MARKETPLACE_SOURCE_ROOT" rev-parse HEAD)"
  exit 1
fi
if [[ -n "$(git -C "$MARKETPLACE_SOURCE_ROOT" status --porcelain --untracked-files=all)" ]]; then
  echo "marketplace_source_changed_during_snapshot_sync: $MARKETPLACE_SOURCE_ROOT"
  exit 1
fi

declare -A DESTINATION_SEEN=()
SYNCED_PATHS=()
register_destination() {
  local destination_relative="$1"
  if [[ -n "${DESTINATION_SEEN[$destination_relative]:-}" ]]; then
    echo "duplicate_sync_destination: $destination_relative"
    exit 1
  fi
  DESTINATION_SEEN[$destination_relative]=1
  SYNCED_PATHS+=("$destination_relative")
}

for mapping in "${COMMITTED_SOURCE_MAPPINGS[@]}"; do
  source_relative="${mapping%%|*}"
  destination_relative="${mapping#*|}"
  register_destination "$destination_relative"
  blob_id="$(committed_blob_id "$source_relative")"
  atomic_write_committed_blob "$blob_id" "$destination_relative"
done

for mapping in "${GENERATED_SOURCE_MAPPINGS[@]}"; do
  source_relative="${mapping%%|*}"
  destination_relative="${mapping#*|}"
  register_destination "$destination_relative"
  atomic_write_generated_file "$source_relative" "$destination_relative"
done

read_package_version() {
  node - "$1" "$2" <<'NODE'
const fs = require("node:fs");
const [manifestPath, expectedName] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (expectedName && manifest.name !== expectedName) {
  throw new Error(`unexpected_package_manifest:${expectedName}:${manifest.name ?? "missing"}`);
}
if (typeof manifest.version !== "string" || !manifest.version) {
  throw new Error(`invalid_package_version:${expectedName || manifestPath}`);
}
process.stdout.write(manifest.version);
NODE
}

SDK_DEPENDENCY_ROOT="$SOURCE_SNAPSHOT/packages/sdk/node_modules"
SDK_VERSION="$(read_package_version "$SOURCE_SNAPSHOT/packages/sdk/package.json" "@clawdex/sdk")"
SDK_IOTA_VERSION="$(read_package_version "$SDK_DEPENDENCY_ROOT/@iota/iota-sdk/package.json" "@iota/iota-sdk")"
SDK_SUI_VERSION="$(read_package_version "$SDK_DEPENDENCY_ROOT/@mysten/sui/package.json" "@mysten/sui")"
MANIFEST="$OUT_DIR/SYNC_MANIFEST.txt"
ensure_destination_parent "docs/docsources/SYNC_MANIFEST.txt"
if [[ -L "$MANIFEST" ]] || { [[ -e "$MANIFEST" ]] && [[ ! -f "$MANIFEST" ]]; }; then
  echo "unsafe_sync_manifest_destination: $MANIFEST"
  exit 1
fi
MANIFEST_TEMP="$(mktemp "$OUT_DIR/.SYNC_MANIFEST.txt.XXXXXX")"
TEMP_OUTPUTS+=("$MANIFEST_TEMP")
{
  echo "format=clawnera.sync.v3"
  echo "marketplace_source_remote=$EXPECTED_REMOTE_ID"
  echo "marketplace_source_commit=$SOURCE_COMMIT"
  echo "marketplace_origin_main_commit=$ORIGIN_MAIN_COMMIT"
  echo "sdk_version=$SDK_VERSION"
  echo "sdk_iota_version=$SDK_IOTA_VERSION"
  echo "sdk_sui_version=$SDK_SUI_VERSION"
  printf '%s\n' "${SYNCED_PATHS[@]}" | LC_ALL=C sort | while IFS= read -r relative; do
    printf 'sha256=%s  %s\n' "$(sha256sum "$ROOT_DIR/$relative" | awk '{print $1}')" "$relative"
  done
} > "$MANIFEST_TEMP"
chmod 0644 "$MANIFEST_TEMP"
mv -fT -- "$MANIFEST_TEMP" "$MANIFEST"

node "$ROOT_DIR/scripts/ci/check-sync-provenance.mjs"
echo "sync_complete source=$SOURCE_COMMIT remote=$EXPECTED_REMOTE_ID manifest=$MANIFEST"

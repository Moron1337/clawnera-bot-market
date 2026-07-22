#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(node -p 'require("./package.json").version')"
TAG="${1:-${GITHUB_REF_NAME:-}}"
if [[ -z "$TAG" ]] || [[ "$TAG" != "v$VERSION" ]]; then
  echo "publish_source_tag_version_mismatch: tag=${TAG:-missing} version=$VERSION" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "publish_source_worktree_not_clean" >&2
  exit 1
fi

git rev-parse --verify "refs/tags/$TAG" >/dev/null
TAG_COMMIT="$(git rev-list -n 1 "$TAG")"
HEAD_COMMIT="$(git rev-parse HEAD)"
if [[ "$TAG_COMMIT" != "$HEAD_COMMIT" ]]; then
  echo "publish_source_head_tag_mismatch: head=$HEAD_COMMIT tag_commit=$TAG_COMMIT" >&2
  exit 1
fi

git fetch --no-tags origin main
ORIGIN_MAIN_COMMIT="$(git rev-parse origin/main)"
if ! git merge-base --is-ancestor "$TAG_COMMIT" "$ORIGIN_MAIN_COMMIT"; then
  echo "publish_source_tag_not_on_origin_main: tag_commit=$TAG_COMMIT origin_main=$ORIGIN_MAIN_COMMIT" >&2
  exit 1
fi

echo "publish_source_ok version=$VERSION tag=$TAG commit=$TAG_COMMIT origin_main=$ORIGIN_MAIN_COMMIT"

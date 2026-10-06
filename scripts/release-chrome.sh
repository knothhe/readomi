#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPOSITORY_ROOT"

usage() {
  cat <<'EOF'
Build the Chrome extension ZIP and upload it to a GitHub Release.

Usage:
  pnpm release:chrome

The working tree must be clean and HEAD must match the v<version> tag read from
package.json. The GitHub Release must already exist; use pnpm release to manage
versions and tags. This command only builds and uploads the Chrome ZIP. The
target repository is resolved by GitHub CLI from the current git remote.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 0 ]]; then
  usage >&2
  exit 2
fi

for command_name in git node pnpm gh; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: required command '$command_name' was not found." >&2
    exit 1
  fi
done

PACKAGE_VERSION="$(node -p "require('./package.json').version")"
TAG="v$PACKAGE_VERSION"

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "Error: working tree must be clean before building a release asset." >&2
  exit 1
fi

git check-ref-format "refs/tags/$TAG"
if ! TAG_COMMIT="$(git rev-parse --verify "refs/tags/$TAG^{commit}" 2>/dev/null)" || [[ "$TAG_COMMIT" != "$(git rev-parse HEAD)" ]]; then
  echo "Error: HEAD must match the existing $TAG tag. Use 'pnpm release' to release a new version." >&2
  exit 1
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "Error: GitHub CLI is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

if ! gh release view "$TAG" --repo "$REPOSITORY" >/dev/null 2>&1; then
  echo "Error: GitHub Release '$TAG' is not available. Wait for Release Extension CI, or inspect its failure before uploading." >&2
  exit 1
fi

echo "Building Chrome extension version $PACKAGE_VERSION..."
pnpm zip

CHROME_ZIP=".output/readomi-$PACKAGE_VERSION-chrome.zip"
if [[ ! -f "$CHROME_ZIP" ]]; then
  echo "Error: expected Chrome ZIP '$CHROME_ZIP' was not generated." >&2
  exit 1
fi

echo "Uploading '$CHROME_ZIP' to $REPOSITORY release $TAG..."
gh release upload "$TAG" "$CHROME_ZIP" --repo "$REPOSITORY" --clobber

echo "Uploaded: https://github.com/$REPOSITORY/releases/tag/$TAG"

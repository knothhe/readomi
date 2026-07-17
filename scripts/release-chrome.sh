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

The version is read from package.json and uploaded to the matching v<version>
release, which is created automatically if it does not exist. The target
repository is resolved by GitHub CLI from the current repository's git remote.
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

for command_name in node pnpm gh; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: required command '$command_name' was not found." >&2
    exit 1
  fi
done

PACKAGE_VERSION="$(node -p "require('./package.json').version")"
TAG="v$PACKAGE_VERSION"

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "Error: GitHub CLI is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

echo "Building Chrome extension version $PACKAGE_VERSION..."
pnpm zip

shopt -s nullglob
chrome_zips=(.output/*-"$PACKAGE_VERSION"-chrome.zip)
shopt -u nullglob

if [[ ${#chrome_zips[@]} -ne 1 ]]; then
  echo "Error: expected exactly one Chrome ZIP for version $PACKAGE_VERSION in .output, found ${#chrome_zips[@]}." >&2
  exit 1
fi

CHROME_ZIP="${chrome_zips[0]}"

if ! gh release view "$TAG" --repo "$REPOSITORY" >/dev/null 2>&1; then
  echo "Release '$TAG' does not exist in '$REPOSITORY'; creating it..."
  gh release create "$TAG" \
    --repo "$REPOSITORY" \
    --title "$TAG" \
    --generate-notes
fi

echo "Uploading '$CHROME_ZIP' to $REPOSITORY release $TAG..."
gh release upload "$TAG" "$CHROME_ZIP" --repo "$REPOSITORY" --clobber

echo "Uploaded: https://github.com/$REPOSITORY/releases/tag/$TAG"

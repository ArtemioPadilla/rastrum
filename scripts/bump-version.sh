#!/usr/bin/env bash
# Usage: ./scripts/bump-version.sh 2026.6.0
#
# Updates package.json version (used as local dev fallback when PUBLIC_VERSION
# is not set). In CI/production, the deploy workflow generates the version
# automatically from git history (YYYY.M.patch), and scripts/inject-version.js
# patches manifest.webmanifest + sw.js at build time.
#
# Run this script only when you want to pin a specific baseline version.
set -euo pipefail
VERSION="$1"
# Update package.json
npm version "$VERSION" --no-git-tag-version
echo "Done. package.json is now $VERSION."
echo "manifest.webmanifest and sw.js are updated automatically at build time via scripts/inject-version.js"

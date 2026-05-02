#!/usr/bin/env bash
# Usage: ./scripts/bump-version.sh 2026.6.0
set -euo pipefail
VERSION="$1"
# Update package.json
npm version "$VERSION" --no-git-tag-version
# Update manifest.webmanifest
jq --arg v "$VERSION" '.version = $v' public/manifest.webmanifest > /tmp/manifest.tmp && mv /tmp/manifest.tmp public/manifest.webmanifest
# Update sw.js VERSION constant
sed -i "s/const VERSION = .*/const VERSION = 'rastrum-shell-${VERSION}';/" public/sw.js
# Commit + tag
git add package.json public/manifest.webmanifest public/sw.js
git commit -m "chore(release): bump version to ${VERSION}"
git tag "v${VERSION}"
echo "Done. Push with: git push && git push origin v${VERSION}"

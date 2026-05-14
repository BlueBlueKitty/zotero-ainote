#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT_DIR/web-extension"
DIST_DIR="$ROOT_DIR/dist"
VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  VERSION=$(node -e "console.log(require('$EXT_DIR/package.json').version)")
fi

OUT_FILE="$DIST_DIR/ainote-web-extension-v${VERSION}-edge.zip"
mkdir -p "$DIST_DIR"

cd "$EXT_DIR"
zip -r "$OUT_FILE" . \
  -x "*.DS_Store" \
  -x "*/.DS_Store" \
  -x "node_modules/*" \
  -x "store-assets/*" \
  -x "tsconfig.json" \
  -x "chrome.d.ts"

echo "Packaged: $OUT_FILE"

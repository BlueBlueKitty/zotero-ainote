#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT_DIR/web-extension"
DIST_DIR="$ROOT_DIR/dist"
VERSION="${1:-}"
RAW_BRANCH="${RAW_BRANCH:-main}"
RAW_BASE_URL="https://raw.githubusercontent.com/BlueBlueKitty/zotero-ainote/${RAW_BRANCH}/dist"
VERSION_INFO_FILE="$ROOT_DIR/web-version.json"

if [[ -z "$VERSION" ]]; then
  CURRENT_VERSION=$(node -e "console.log(require('$EXT_DIR/package.json').version)")
  echo "Please input extension version (example: 1.1.1)."
  read -r -p "Extension version [${CURRENT_VERSION}]: " INPUT_VERSION
  VERSION="${INPUT_VERSION:-$CURRENT_VERSION}"
fi

OUT_FILE="$DIST_DIR/ainote-web-extension-v${VERSION}-edge.zip"
RAW_URL="${RAW_BASE_URL}/ainote-web-extension-v${VERSION}-edge.zip"
README_CN="$ROOT_DIR/README.md"
README_EN="$ROOT_DIR/doc/README_en-US.md"

update_readme_link() {
  local file="$1"
  perl -i -pe "s#https://raw\\.githubusercontent\\.com/BlueBlueKitty/zotero-ainote/.*/dist/ainote-web-extension-v[0-9A-Za-z._-]+-edge\\.zip#${RAW_URL}#g" "$file"
}

node -e "
const fs = require('fs');
const path = require('path');
const root = process.argv[1];
const version = process.argv[2];
const rawUrl = process.argv[3];
const extPkgPath = path.join(root, 'web-extension', 'package.json');
const manifestPath = path.join(root, 'web-extension', 'manifest.json');
const versionInfoPath = path.join(root, 'web-version.json');

const extPkg = JSON.parse(fs.readFileSync(extPkgPath, 'utf8'));
extPkg.version = version;
fs.writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + '\n');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

let versionInfo = {};
if (fs.existsSync(versionInfoPath)) {
  versionInfo = JSON.parse(fs.readFileSync(versionInfoPath, 'utf8'));
}
versionInfo.extension = { ...(versionInfo.extension || {}), latestVersion: version };
versionInfo.extensionDownloadUrl = rawUrl;
fs.writeFileSync(versionInfoPath, JSON.stringify(versionInfo, null, 2) + '\n');
" "$ROOT_DIR" "$VERSION" "$RAW_URL"

mkdir -p "$DIST_DIR"

cd "$EXT_DIR"
zip -r "$OUT_FILE" . \
  -x "*.DS_Store" \
  -x "*/.DS_Store" \
  -x "node_modules/*" \
  -x "store-assets/*" \
  -x "tsconfig.json" \
  -x "chrome.d.ts"

update_readme_link "$README_CN"
update_readme_link "$README_EN"

echo "Packaged: $OUT_FILE"
echo "Updated raw link: $RAW_URL"
echo "Updated version files: web-extension/package.json, web-extension/manifest.json, web-version.json"

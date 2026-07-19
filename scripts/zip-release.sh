#!/usr/bin/env bash
#
# Build and package the extension into a ZIP suitable for the Chrome Web Store.
# The archive contains the *contents* of dist/ (manifest.json at the root),
# as required by the Chrome Web Store.
#
# Usage: ./scripts/zip-release.sh [version]
#   version  - optional version label used in the output filename
#              (defaults to the version in manifest.json)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
OUT_DIR="$ROOT_DIR/release"

mkdir -p "$OUT_DIR"

# Build first so dist/ is up to date.
echo "Building extension..."
( cd "$ROOT_DIR" && npm run build )

if [ ! -f "$DIST_DIR/manifest.json" ]; then
  echo "ERROR: dist/manifest.json not found. Build may have failed." >&2
  exit 1
fi

# Determine version from manifest.json (or from the first argument).
if [ $# -ge 1 ]; then
  VERSION="$1"
else
  # Read the manifest version via fs/JSON.parse to avoid require() path issues
  # (backslashes in Windows paths are interpreted as escape sequences in require).
  MANIFEST_NODE_PATH="$DIST_DIR/manifest.json"
  if command -v cygpath >/dev/null 2>&1; then
    MANIFEST_NODE_PATH="$(cygpath -w "$MANIFEST_NODE_PATH")"
  fi
  VERSION="$(node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(m.version||'0.0.0')" "$MANIFEST_NODE_PATH")"
fi

ZIP_NAME="llm-page-translator-$VERSION.zip"
ZIP_PATH="$OUT_DIR/$ZIP_NAME"

# Remove any previous archive with the same name.
rm -f "$ZIP_PATH"

# Zip the contents of dist/ (so manifest.json sits at the archive root).
if command -v zip >/dev/null 2>&1; then
  ( cd "$DIST_DIR" && zip -r -q -X "$ZIP_PATH" . -x '*.DS_Store' -x '__MACOSX/*' )
else
  # Fallback for systems without `zip` (e.g. Windows): delegate to PowerShell's
  # Compress-Archive, which zips the directory contents directly.
  ZIP_DIR_NATIVE="$OUT_DIR"
  DIST_NATIVE="$DIST_DIR"
  if command -v cygpath >/dev/null 2>&1; then
    ZIP_DIR_NATIVE="$(cygpath -w "$OUT_DIR")"
    DIST_NATIVE="$(cygpath -w "$DIST_DIR")"
  fi
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Path (Join-Path '$DIST_NATIVE' '*') -DestinationPath '$ZIP_DIR_NATIVE/$ZIP_NAME' -Force"
fi

echo "Created release archive: $ZIP_PATH"

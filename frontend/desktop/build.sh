#!/usr/bin/env bash
# Build the AirQ Competition Helpers desktop app (.exe) for Windows
# Run from frontend/desktop/ directory
#
# Prerequisites: pnpm install from frontend/ root
#
# Usage:
#   ./build.sh          # Build unpacked app (always works)
#   ./build.sh portable # Build portable .exe (needs Developer Mode or CI)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Building sub-apps ==="
cd "$FRONTEND_DIR/map-corridors"
VITE_DESKTOP_BUILD=true npm run build

cd "$FRONTEND_DIR/photo-helper"
VITE_DESKTOP_BUILD=true npm run build

echo "=== Detecting Electron version ==="
ELECTRON_VERSION=$(node -e "console.log(require('electron/package.json').version)")
echo "Electron version: $ELECTRON_VERSION"

cd "$SCRIPT_DIR"

if [ "$1" = "portable" ]; then
  echo "=== Packaging portable .exe ==="
  npx electron-builder --win -c.electronVersion="$ELECTRON_VERSION"
  echo "=== Output: dist/*.exe ==="
  ls -lh dist/*.exe 2>/dev/null || echo "(check dist/ for output)"
else
  echo "=== Packaging unpacked directory ==="
  npx electron-builder --win --dir -c.electronVersion="$ELECTRON_VERSION"
  echo "=== Output: dist/win-unpacked/ ==="
  ls -lh "dist/win-unpacked/AirQ Competition Helpers.exe" 2>/dev/null || echo "(check dist/win-unpacked/ for output)"
fi

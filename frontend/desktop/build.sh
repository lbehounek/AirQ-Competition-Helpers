#!/usr/bin/env bash
# Build the AirQ Competition Helpers desktop app (.exe) for Windows
# Run from frontend/desktop/ directory
#
# Prerequisites: pnpm install from frontend/ root
#
# Usage:
#   ./build.sh          # Build unpacked app (always works)
#   ./build.sh package  # Build NSIS installer + portable .exe (needs Developer Mode or CI)
set -e

# Validate the argument BEFORE the sub-app builds: they take ~25 s, and the
# accepted token was renamed from `portable` to `package` when the NSIS target
# landed, so a stale invocation should fail immediately rather than after them.
MODE="${1:-dir}"
case "$MODE" in
  dir|package) ;;
  *)
    echo "usage: $0 [dir|package]" >&2
    echo "  dir      (default) build the unpacked app directory" >&2
    echo "  package  build the NSIS installer + portable .exe" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Building sub-apps ==="
cd "$FRONTEND_DIR/map-corridors"
VITE_DESKTOP_BUILD=true pnpm run build

cd "$FRONTEND_DIR/photo-helper"
VITE_DESKTOP_BUILD=true pnpm run build

echo "=== Detecting Electron version ==="
ELECTRON_VERSION=$(node -e "console.log(require('electron/package.json').version)")
echo "Electron version: $ELECTRON_VERSION"

cd "$SCRIPT_DIR"

# $MODE was validated at the top of the script, so only the two known modes
# reach this point.
case "$MODE" in
  package)
    # No target flag: package.json's build.win.target is the single source of
    # truth, and it lists both nsis and portable.
    echo "=== Packaging NSIS installer + portable .exe ==="
    pnpm exec electron-builder --win -c.electronVersion="$ELECTRON_VERSION"
    echo "=== Output: dist/*.exe ==="
    ls -lh dist/*.exe 2>/dev/null || echo "(check dist/ for output)"
    ;;
  dir)
    echo "=== Packaging unpacked directory ==="
    pnpm exec electron-builder --win --dir -c.electronVersion="$ELECTRON_VERSION"
    echo "=== Output: dist/win-unpacked/ ==="
    ls -lh "dist/win-unpacked/AirQ Competition Helpers.exe" 2>/dev/null || echo "(check dist/win-unpacked/ for output)"
    ;;
esac

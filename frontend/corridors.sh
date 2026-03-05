#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT_DIR"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  pnpm install --silent
fi

echo "Starting dev server (Vite)..."
echo "App: $ROOT_DIR/map-corridors"
echo "URL: http://localhost:5173"

# Pass through any extra args to Vite (e.g., --open)
pnpm --filter @airq/map-corridors dev -- "$@"

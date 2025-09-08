#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/frontend/map-corridors"

if [ ! -d "$APP_DIR" ]; then
  echo "Error: app directory not found: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install --silent
fi

echo "Starting dev server (Vite)..."
echo "App: $APP_DIR"
echo "URL: http://localhost:5173"

# Pass through any extra args to Vite (e.g., --open)
npm run dev -- "$@"



#!/usr/bin/env bash
# Build all web-deployable parts and assemble them into `public/` for Firebase Hosting.
#
# Usage:
#   bash scripts/build-web.sh
#
# Output:
#   public/                       — landing SPA at root
#   public/photo-helper/          — Photo Editor SPA under /photo-helper/
#   public/map-corridors/         — Map Corridors SPA under /map-corridors/
#
# Prerequisites:
#   - pnpm installed
#   - `pnpm install --frozen-lockfile` has run (or `pnpm install` for local dev)
#   - `frontend/.env` at the repo root provides VITE_MAPBOX_TOKEN / VITE_MAPYCZ_TOKEN
#     (loaded by each sub-app's Vite config via envDir)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Building @airq/competitions CJS output (needed by dependents) ==="
pnpm --dir frontend --filter @airq/competitions run build

echo "=== Building sub-apps (photo-helper, map-corridors, landing) ==="
pnpm --dir frontend --filter @airq/photo-helper build
pnpm --dir frontend --filter @airq/map-corridors build
pnpm --dir frontend --filter @airq/landing build

echo "=== Assembling public/ tree ==="
rm -rf public
mkdir -p public
cp -a frontend/landing/dist/.        public/
cp -a frontend/photo-helper/dist     public/photo-helper
cp -a frontend/map-corridors/dist    public/map-corridors

echo "=== Web bundle ready at $REPO_ROOT/public ==="
du -sh public/* 2>/dev/null | sort

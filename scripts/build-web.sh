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
#   - Map tokens: intentionally NOT supplied for a public web build. Vite inlines
#     `import.meta.env.VITE_*` at build time, so anything set here ends up
#     readable in the shipped JS. Built without them, Map Corridors renders no
#     base map until the user supplies their own token at runtime (UI pending).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Output directory. Defaults to `public`, which is what firebase.json serves.
#
# It is overridable for one specific reason: cleaning `public` needs `rm -rf`,
# and a Claude Code session is forbidden from running that (see
# .claude/skills/web-deploy). Pointing WEB_OUT at a path that does not exist yet
# gives a guaranteed-clean tree with no deletion, which matters because a stale
# file left behind can make the artifact guards below pass for the wrong reason
# — a leftover worker chunk would satisfy the worker check while the current
# build had failed to emit one.
WEB_OUT="${WEB_OUT:-public}"

# @airq/competitions has no build step: it is an ESM workspace package that
# exports ./src/index.ts directly, like @airq/shared-discipline. The CJS `dist`
# output only ever existed to feed Electron's main.js, which this web bundle
# does not involve.

# Map tokens are stripped from the build environment, not merely "not set".
# Vite substitutes `import.meta.env.VITE_*` with the literal value at build
# time, so a token present in the shell or in any .env the configured `envDir`
# picks up ends up as plain text in the shipped JS. Desktop builds legitimately
# carry a token; this web build must never inherit it just because the machine
# happens to be set up for desktop work.
export VITE_MAPBOX_TOKEN=
export VITE_MAPYCZ_TOKEN=

echo "=== Building sub-apps (photo-helper, map-corridors, landing) ==="
pnpm --dir frontend --filter @airq/photo-helper build
pnpm --dir frontend --filter @airq/map-corridors build
pnpm --dir frontend --filter @airq/landing build

echo "=== Assembling $WEB_OUT/ tree ==="
if [ "$WEB_OUT" = "public" ]; then
  # The normal path: wipe and rebuild, so no stale asset can survive.
  rm -rf public
elif [ -e "$WEB_OUT" ]; then
  # A custom WEB_OUT exists only to AVOID a delete, so merging into an existing
  # one would defeat the point and risk stale files masking a guard.
  echo "REFUSING TO CONTINUE — WEB_OUT='$WEB_OUT' already exists." >&2
  echo "Point it at a path that does not exist yet, or remove that directory" >&2
  echo "yourself and re-run." >&2
  exit 1
fi
mkdir -p "$WEB_OUT"
cp -a frontend/landing/dist/.        "$WEB_OUT"/
cp -a frontend/photo-helper/dist     "$WEB_OUT"/photo-helper
cp -a frontend/map-corridors/dist    "$WEB_OUT"/map-corridors

# Belt and braces: verify the ARTIFACT, not the intent. The export above can be
# defeated — someone edits this script, adds a .env.production, or Vite changes
# precedence — and the failure is silent and public. This check does not care how
# a token got in; it refuses to let one leave the machine. Only file NAMES are
# printed; the matched value is never echoed.
echo "=== Checking the bundle for leaked map tokens ==="
# Mapbox public (pk.) and secret (sk.) tokens are JWTs with a fixed prefix.
LEAKED=$(grep -rlE '(pk|sk)\.ey[A-Za-z0-9_.-]{20,}' "$WEB_OUT" 2>/dev/null || true)
if [ -n "$LEAKED" ]; then
  echo "REFUSING TO CONTINUE — a Mapbox token is present in the built bundle." >&2
  echo "Anything in $WEB_OUT/ is world-readable once deployed. Affected files:" >&2
  echo "$LEAKED" | sed 's/^/  /' >&2
  echo "Rebuild in a shell without VITE_MAPBOX_TOKEN / VITE_MAPYCZ_TOKEN set," >&2
  echo "and check for a .env the sub-apps' envDir may be loading." >&2
  exit 1
fi
echo "No map tokens found in $WEB_OUT/."
# NOTE: this only detects MAPBOX-shaped tokens. It is not a general secret
# scanner — a Firebase API key or anything else would pass. Widen the pattern
# here if the web build ever starts carrying other credentials.

# Verify the MapLibre worker asset actually shipped.
#
# MapLibre v6 splits into entry + shared + worker and locates the worker at RUNTIME
# with `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Rollup cannot follow a
# constructed string, so before src/config/initMapWorker.ts re-declared it with
# `?worker&url`, the chunk was simply never emitted. The failure was invisible:
# Firebase's SPA rewrite answers a missing asset with index.html, so the worker
# "loaded" as HTML, died silently, and the map rendered a grey canvas having
# requested ZERO tiles. No console error, no build warning, full green test suite.
#
# Checking the ARTIFACT is the only thing that catches this — a unit test cannot see
# the bundle, and the tile providers looked healthy the whole time.
echo "=== Checking the MapLibre worker asset shipped ==="
if ! ls "$WEB_OUT"/map-corridors/assets/maplibre-gl-worker-*.js >/dev/null 2>&1; then
  echo "REFUSING TO CONTINUE — no MapLibre worker asset in $WEB_OUT/map-corridors/assets." >&2
  echo "Without it the map renders a grey canvas and requests no tiles, silently." >&2
  echo "Check that src/config/maplibreWorkerUrl.web.ts still imports the worker with" >&2
  echo "'?worker&url', and that vite.config.ts aliases virtual:maplibre-worker-url to it." >&2
  exit 1
fi
echo "MapLibre worker asset present."

echo "=== Web bundle ready at $REPO_ROOT/$WEB_OUT ==="
du -sh "$WEB_OUT"/* 2>/dev/null | sort

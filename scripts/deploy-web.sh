#!/usr/bin/env bash
# Manual web deploy to Firebase Hosting, run from a developer machine.
#
# CI deliberately does NOT deploy. The GitHub workflow builds and runs the
# artifact guards, but publishing happens from here, by hand. That was a
# deliberate call: the only GitHub-native options were a long-lived service
# account JSON in a repo secret (which FirebaseExtended/action-hosting-deploy
# requires — `firebaseServiceAccount` is a required input, and it has no OIDC
# support at all) or standing up Workload Identity Federation. Neither was worth
# it for a project that ships on a human's say-so.
# See .claude/skills/web-deploy/SKILL.md for the reasoning and the runbook.
#
# Usage:
#   bash scripts/deploy-web.sh                 # -> web-preview channel, 7d
#   bash scripts/deploy-web.sh web-preview     # -> named preview channel
#   bash scripts/deploy-web.sh live            # -> production
#
# Environment:
#   WEB_OUT   output dir (default `public`). Point this at a path that does NOT
#             exist yet when the caller cannot clean `public` — see build-web.sh.
#   EXPIRES   preview channel lifetime (default 7d). Ignored for `live`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

CHANNEL="${1:-web-preview}"
PROJECT="airq-competition-helpers"
WEB_OUT="${WEB_OUT:-public}"
EXPIRES="${EXPIRES:-7d}"
FIREBASE="pnpm dlx firebase-tools"

# direnv/.envrc may carry gcloud or firebase context. Tolerate its absence.
# shellcheck disable=SC1091
source .envrc 2>/dev/null || true

echo "=== Building (channel: $CHANNEL, out: $WEB_OUT) ==="
WEB_OUT="$WEB_OUT" bash scripts/build-web.sh

# firebase.json hard-codes `"public": "public"`, and this CLI has no `--public`
# flag (verified: `firebase deploy --help` offers only --only / --config /
# --message). So a non-default WEB_OUT needs a generated config. It is written
# beside firebase.json because Hosting resolves `public` relative to the config
# file's own directory.
CONFIG_ARG=()
GENERATED_CONFIG=""
if [ "$WEB_OUT" != "public" ]; then
  GENERATED_CONFIG=".firebase-deploy.generated.json"
  node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
    cfg.hosting.public = process.argv[1];
    fs.writeFileSync(process.argv[2], JSON.stringify(cfg, null, 2) + "\n");
  ' "$WEB_OUT" "$GENERATED_CONFIG"
  CONFIG_ARG=(--config "$GENERATED_CONFIG")
  echo "=== Generated $GENERATED_CONFIG (public -> $WEB_OUT) ==="
fi

if [ "$CHANNEL" = "live" ]; then
  echo "=== DEPLOYING TO PRODUCTION ($PROJECT) ==="
  $FIREBASE deploy --only hosting --project "$PROJECT" "${CONFIG_ARG[@]}" \
    --message "manual deploy from $(git rev-parse --short HEAD)"
  BASE="https://${PROJECT}.web.app"
else
  echo "=== Deploying to preview channel '$CHANNEL' ($PROJECT, expires $EXPIRES) ==="
  $FIREBASE hosting:channel:deploy "$CHANNEL" --project "$PROJECT" \
    "${CONFIG_ARG[@]}" --expires "$EXPIRES"
  # The channel URL carries a per-site hash, so read it back rather than guess.
  BASE=$($FIREBASE hosting:channel:list --project "$PROJECT" 2>/dev/null \
    | grep -F "$CHANNEL " | grep -oE 'https://[a-z0-9.-]+\.web\.app' | head -1)
fi

# ---------------------------------------------------------------------------
# Post-deploy verification against what the ORIGIN actually serves.
#
# Every web defect this project hit was invisible to a local build check and
# visible only in the served bytes: a worker chunk that Hosting's SPA rewrite
# answered with index.html, map tiles watermarked "API KEY REQUIRED" behind a
# perfectly healthy HTTP 200, and a renderer that threw on the first zoom.
# A green local build is not evidence. This re-checks the deployed origin.
# ---------------------------------------------------------------------------
if [ -z "${BASE:-}" ]; then
  echo "Deployed, but could not determine the URL to verify. Check manually." >&2
  exit 0
fi

echo "=== Verifying $BASE ==="
FAIL=0
check_code() {  # <path> <label>
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$1")
  printf '  %-34s HTTP %s\n' "$2" "$CODE"
  [ "$CODE" = "200" ] || FAIL=1
}
check_code "/" "landing"
check_code "/map-corridors/" "map-corridors"
check_code "/photo-helper/" "photo-helper"

# The worker must come back as real JavaScript. When it is missing, Hosting's
# SPA rewrite returns index.html with a 200 and text/html; the worker then dies
# silently and the map renders a grey canvas having requested zero tiles.
WORKER=$(ls "$WEB_OUT"/map-corridors/assets/maplibre-gl-worker-*.js | head -1 | xargs -n1 basename)
CT=$(curl -s -o /dev/null -w '%{content_type}' "$BASE/map-corridors/assets/$WORKER")
printf '  %-34s %s\n' "maplibre worker content-type" "$CT"
case "$CT" in
  *javascript*) ;;
  *) echo "  FAIL: worker is not being served as JavaScript" >&2; FAIL=1 ;;
esac

# Last line of defence on the public origin: no Mapbox token may be served.
VENDOR=$(curl -s "$BASE/map-corridors/" | grep -oE 'assets/vendor-map-[A-Za-z0-9_-]+\.js' | head -1)
if [ -n "$VENDOR" ]; then
  LEAK=$(curl -s "$BASE/map-corridors/$VENDOR" | grep -cE '(pk|sk)\.ey[A-Za-z0-9_.-]{20,}' || true)
  printf '  %-34s %s (must be 0)\n' "map tokens in served bundle" "$LEAK"
  [ "$LEAK" = "0" ] || FAIL=1
fi

# Single generated file, safe to remove; it is regenerated on every run.
if [ -n "$GENERATED_CONFIG" ]; then
  rm -f "$GENERATED_CONFIG"
fi

[ "$FAIL" = "0" ] || { echo "=== VERIFICATION FAILED — investigate before announcing ===" >&2; exit 1; }
echo "=== Deployed and verified: $BASE ==="

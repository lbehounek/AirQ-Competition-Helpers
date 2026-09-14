---
name: web-deploy
description: Build and deploy the web bundle (landing + Photo Helper + Map Corridors) to Firebase Hosting, manually, from a developer machine. Use when publishing a preview channel or production, or when diagnosing a deployed-only defect.
---

# Web Deploy

The web bundle ships to Firebase Hosting **manually, from a developer machine**.
CI builds and guards it; CI does **not** publish.

```
public/                  landing SPA at /
public/photo-helper/     Photo Editor at /photo-helper/
public/map-corridors/    Map Corridors at /map-corridors/
```

Project: `airq-competition-helpers` · Live: https://airq-competition-helpers.web.app

## Commands

```bash
bash scripts/deploy-web.sh                 # -> web-preview channel, expires 7d
bash scripts/deploy-web.sh live            # -> production
bash scripts/build-web.sh                  # build + guards only, no deploy
```

`deploy-web.sh` builds, deploys, then **verifies the deployed origin** and exits
non-zero if that verification fails. Do not announce a deploy it did not pass.

## Why deploying is manual

Not an oversight. `FirebaseExtended/action-hosting-deploy` declares
`firebaseServiceAccount` as a **required** input and supports no OIDC
alternative, so CI deployment meant one of:

- a long-lived service-account JSON key sitting in a GitHub secret, or
- standing up Workload Identity Federation (pool, provider, attribute condition
  pinned to the repo, an impersonated service account).

WIF is the better of the two — the firebase CLI supports it, since
`firebase-tools` depends on `google-auth-library` ^9, which ships the
`external_account` clients, and its `autoAuth()` is plain ADC. It was rejected
on cost, not on merit: this project ships when a human says so, and there is no
release cadence that a keyless CI pipeline would pay for.

A deploy step that fails forever for want of a secret is worse than no deploy
step, which is why the workflow was reduced to building.

## The `rm -rf` constraint (read this before scripting around it)

`build-web.sh` cleans `public/` with `rm -rf` so no stale asset can survive.
**Claude Code sessions are forbidden from running that**, so a session cannot
run the script on its default path.

The escape hatch is `WEB_OUT`, pointing at a directory that **does not exist
yet**:

```bash
WEB_OUT=public-deploy-1 bash scripts/deploy-web.sh
```

The script refuses to reuse an existing custom `WEB_OUT`. That refusal is
load-bearing, not fussiness: merging a new build into a directory holding an old
one leaves stale files that can satisfy the artifact guards while the current
build has actually failed to produce them — a leftover worker chunk would pass
the worker check for the wrong reason.

`firebase.json` hard-codes `"public": "public"` and this CLI has **no
`--public` flag**, so a non-default `WEB_OUT` makes the script generate a
temporary config beside `firebase.json` (Hosting resolves `public` relative to
the config file's own directory) and delete it afterwards.

Those `WEB_OUT` directories accumulate and only a human can remove them.

## Verify the origin, never the local build

Every web defect this project has hit was invisible locally and visible only in
what the origin served. The pattern repeats, so distrust green local builds:

| Symptom | What it actually was | What a local check said |
|---|---|---|
| Grey canvas, **zero** tile requests | MapLibre's worker chunk was never emitted; Hosting's SPA rewrite answered the 404 with `index.html`, so the worker "loaded" as HTML and died silently | build succeeded, full suite green |
| "carto says it needs api keys" | CARTO withdrew keyless access and enforces it by painting **"API KEY REQUIRED" into the tile image** | `curl` returned HTTP 200, a valid PNG, and `Access-Control-Allow-Origin: *` |
| Map vanished on first zoom | maplibre-gl v6 removed `map.transform`; the react wrapper still read it | tests green — the peer range `>=4.0.0` admitted the broken pairing |

Rules that follow from that:

- **Check the pixels, not the status code**, when judging a tile provider.
- **Check the `content-type`**, not just the status, for any asset: a missing
  file returns `200 text/html` under the SPA rewrite, never a 404.
- Decode a minified stack against the **real sourcemap for the deployed bytes**.
  Rebuilding with `--sourcemap true` does not change the emitted JS, so the
  chunk hash stays identical and the map decodes exactly what the user ran.

## Guards that must never be weakened

`build-web.sh` refuses to finish if either fails:

1. **No map token in the artifact.** The build strips `VITE_MAPBOX_TOKEN` /
   `VITE_MAPYCZ_TOKEN`, then greps the built files for a `pk.`/`sk.` JWT. It
   checks the artifact rather than the intent, because the export can be
   defeated by an edited script or a stray `.env`. It only ever prints file
   *names*, never a matched value.
2. **MapLibre worker asset present.** Only an artifact check can catch its
   absence; no unit test can see the bundle.

`deploy-web.sh` adds post-deploy checks against the live origin: all three entry
points return 200, the worker is served as JavaScript, and no token appears in
the served vendor chunk.

## Renderer split (why the web build differs from desktop)

`vite.config.ts` aliases `mapbox-gl` → `maplibre-gl` and
`react-map-gl/mapbox` → `react-map-gl/maplibre` for **web only**. Mapbox GL v2+
runs a billing handshake on every render and throws without a token, which would
kill a tokenless public build even on keyless raster styles. Desktop keeps real
Mapbox GL — it has a token and needs Mapbox's own `mapbox://` resolver.

Consequences worth remembering:

- `vitest.config.ts` **shadows** `vite.config.ts`, so none of those aliases
  apply under test. A test meaning to exercise the web renderer must import
  `react-map-gl/maplibre` explicitly, or it silently tests the desktop wrapper.
- These three packages are pinned **exactly** (`maplibre-gl`, `mapbox-gl`,
  `react-map-gl`). A caret range is what let an untested major in.
- maplibre-gl must stay **>= 6.4.1**: GHSA-jrc7-96c5-q579 is a critical
  `DOM.sanitize()` XSS affecting <= 6.4.0.

## Tokens and custom domains

The public build carries **no** Mapbox token, by decision. Users supply their
own at runtime; Firebase Auth / Google SSO is deferred. Until that UI exists the
keyless ESRI styles are the only base maps in the browser.

Custom domain: Firebase Console → Hosting → Add custom domain. Adding one does
**not** authorise it for Firebase Auth — that needs Authentication → Settings →
Authorized domains as well.

Preview channels live on a different origin from live, so OPFS data does not
carry across. `hosting:channel:deploy` warns "Unable to sync Firebase Auth
state" when the channel domain cannot be registered; pass
`--no-authorized-domains` to silence it deliberately.

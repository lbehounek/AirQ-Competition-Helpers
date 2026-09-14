/**
 * Point MapLibre at the worker asset Vite actually emitted.
 *
 * WHY THIS EXISTS — the deployed web build rendered a grey canvas and issued
 * ZERO tile requests. The cause was not the tile providers (CARTO and ESRI both
 * answer 200 with `Access-Control-Allow-Origin: *` and need no key) and not the
 * access token: MapLibre asked for `assets/maplibre-gl-worker.mjs`, a file the
 * build never emitted (see maplibreWorkerUrl.web.ts), and Firebase Hosting's
 * SPA rewrite answered with `index.html` instead of a 404. Constructing a
 * module Worker from HTML fails, MapLibre's dispatcher never comes up, and no
 * source ever gets as far as requesting a tile. Nothing is logged, which is why
 * this looked like a provider problem for several rounds.
 *
 * Must run BEFORE any Map is constructed, so it is imported for side effects
 * from `main.tsx` — the app entry, ahead of both <Map> and mapCapture's
 * off-screen `new gl.Map`.
 */
import * as glNamespace from 'mapbox-gl'
import workerUrl from 'virtual:maplibre-worker-url'

// Same interop dance as mapProviders: mapbox-gl has a default export, maplibre
// (ESM) has named exports only, and the web build aliases one specifier to the
// other. See mapProviders.ts for the full explanation.
const gl = ((glNamespace as unknown as { default?: unknown }).default ?? glNamespace) as Record<string, unknown>

/**
 * Apply the worker-URL override, if this renderer wants one.
 *
 * Guarded on both sides rather than assumed: `setWorkerUrl` is a MapLibre-only
 * export (Mapbox GL has no such function), and `workerUrl` is empty in the
 * desktop build. Either being absent means there is nothing to do — not an
 * error — so this stays silent instead of throwing during module init and
 * taking the app down the way an unguarded renderer write once did.
 *
 * @returns true if the override was applied, false if it did not apply here.
 */
export function initMapWorker(): boolean {
  const setWorkerUrl = gl.setWorkerUrl
  if (!workerUrl || typeof setWorkerUrl !== 'function') return false
  ;(setWorkerUrl as (value: string) => void)(workerUrl)
  return true
}

initMapWorker()

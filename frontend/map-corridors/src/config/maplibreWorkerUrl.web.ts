/**
 * The web build's MapLibre worker URL.
 *
 * MapLibre GL v6 ships as three ES modules — entry, shared, and worker — and
 * locates the worker at RUNTIME with `new URL('./maplibre-gl-worker.mjs',
 * import.meta.url)`. That string is constructed, never statically imported, so
 * Rollup cannot see it: the worker chunk is simply never emitted. In dev the
 * file still resolves out of node_modules, which is why this only ever broke in
 * a built deployment.
 *
 * `?worker&url` makes the dependency explicit — Vite bundles the worker entry
 * together with the shared chunk it imports, emits it as a hashed asset, and
 * hands back its final URL, which `initMapWorker` feeds to `setWorkerUrl()`.
 *
 * @returns the emitted worker asset's URL, resolved against the build `base`.
 */
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

export default workerUrl

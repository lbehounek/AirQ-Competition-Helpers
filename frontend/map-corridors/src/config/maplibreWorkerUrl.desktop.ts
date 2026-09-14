/**
 * The desktop build's MapLibre worker URL: there isn't one.
 *
 * Desktop keeps real Mapbox GL (see vite.config.ts), which inlines its worker
 * rather than fetching a sibling file, so it needs no override. This stub is
 * aliased in place of the web module so an Electron build never pulls
 * maplibre-gl — and its ~530 kB worker asset — into the bundle just to reach a
 * call that would no-op anyway.
 *
 * @returns an empty string, which `initMapWorker` treats as "nothing to set".
 */
export default ''

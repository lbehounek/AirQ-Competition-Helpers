/**
 * Guards the MapLibre worker-URL override.
 *
 * THE BUG THIS EXISTS FOR: the deployed web build rendered a grey canvas and
 * made ZERO tile requests. MapLibre v6 locates its worker at runtime with
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)` — a constructed
 * string Rollup cannot follow — so the chunk was never emitted, Firebase's SPA
 * rewrite answered with index.html, and building a module Worker out of HTML
 * failed silently. Nothing was logged; it looked like a tile-provider problem
 * for several rounds. `initMapWorker` points MapLibre at the asset Vite really
 * emitted.
 *
 * A unit test cannot see the emitted bundle, so the artifact itself is checked
 * by scripts/build-web.sh. What IS worth pinning here is the wiring: that the
 * override is actually applied, and that it stays inert on the desktop build
 * rather than throwing during module init the way an earlier unguarded
 * renderer write did (see providerTokenSealedModule.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const setWorkerUrl = vi.fn()

describe('initMapWorker', () => {
  beforeEach(() => {
    vi.resetModules()
    setWorkerUrl.mockClear()
  })

  it('hands MapLibre the emitted worker URL', async () => {
    vi.doMock('mapbox-gl', () => ({ default: { setWorkerUrl } }))
    vi.doMock('virtual:maplibre-worker-url', () => ({ default: '/map-corridors/assets/maplibre-gl-worker-abc123.js' }))
    const { initMapWorker } = await import('../config/initMapWorker')
    // The module applies it on import; calling again must be idempotent.
    expect(initMapWorker()).toBe(true)
    expect(setWorkerUrl).toHaveBeenCalledWith('/map-corridors/assets/maplibre-gl-worker-abc123.js')
  })

  it('stays inert on a renderer with no setWorkerUrl (desktop keeps Mapbox GL)', async () => {
    vi.doMock('mapbox-gl', () => ({ default: { accessToken: '' } }))
    vi.doMock('virtual:maplibre-worker-url', () => ({ default: '' }))
    const { initMapWorker } = await import('../config/initMapWorker')
    expect(initMapWorker()).toBe(false)
    expect(setWorkerUrl).not.toHaveBeenCalled()
  })

  it('does not call setWorkerUrl with an empty url', async () => {
    // The desktop stub exports ''. Passing that through would override
    // MapLibre's own resolver with nothing, which is worse than not calling.
    vi.doMock('mapbox-gl', () => ({ default: { setWorkerUrl } }))
    vi.doMock('virtual:maplibre-worker-url', () => ({ default: '' }))
    const { initMapWorker } = await import('../config/initMapWorker')
    expect(initMapWorker()).toBe(false)
    expect(setWorkerUrl).not.toHaveBeenCalled()
  })

  it('SHOUTS when it has a worker asset but the renderer will not take it', async () => {
    // The dangerous case, and previously indistinguishable from the benign one:
    // a real emitted worker URL plus a renderer with no setWorkerUrl reproduces
    // the exact grey-canvas / zero-tiles failure this module exists to prevent.
    // Nothing else catches it — build-web.sh checks the chunk was EMITTED, not
    // that the override was APPLIED — so a maplibre bump that renamed the
    // setter would pass the build, the artifact guard and the whole suite.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.doMock('mapbox-gl', () => ({ default: { /* no setWorkerUrl */ } }))
    vi.doMock('virtual:maplibre-worker-url', () => ({ default: '/assets/maplibre-gl-worker-abc.js' }))
    const { initMapWorker } = await import('../config/initMapWorker')
    expect(initMapWorker()).toBe(false)
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0][0])).toContain('grey canvas')
    spy.mockRestore()
  })

  it('stays QUIET on the desktop stub, where there is genuinely nothing to do', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.doMock('mapbox-gl', () => ({ default: { accessToken: '' } }))
    vi.doMock('virtual:maplibre-worker-url', () => ({ default: '' }))
    const { initMapWorker } = await import('../config/initMapWorker')
    expect(initMapWorker()).toBe(false)
    // Desktop must not log an error on every start.
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('survives a sealed module namespace without setWorkerUrl', async () => {
    // maplibre-gl has no default export, so the interop shim falls back to the
    // frozen ES module namespace. Reading a missing property off it is fine;
    // this pins that the guard reads rather than writes.
    vi.doMock('mapbox-gl', () => ({ default: Object.freeze({}) }))
    vi.doMock('virtual:maplibre-worker-url', () => ({ default: '/assets/w.js' }))
    const { initMapWorker } = await import('../config/initMapWorker')
    expect(() => initMapWorker()).not.toThrow()
    expect(initMapWorker()).toBe(false)
  })
})

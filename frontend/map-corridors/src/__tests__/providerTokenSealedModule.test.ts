/**
 * The web build aliases `mapbox-gl` to `maplibre-gl` (see vite.config.ts),
 * because Mapbox GL v2+ runs a billing handshake on every render and throws
 * without a token — which killed the tokenless web build even on the OSM and
 * ESRI raster styles that need no token at all.
 *
 * That alias has a sharp edge this file guards. `maplibre-gl` has no default
 * export, so the interop shim in mapProviders falls back to the ES MODULE
 * NAMESPACE object — which is sealed. `setProviderToken` used to write
 * `accessToken` onto it unconditionally, which throws
 *
 *   TypeError: Attempting to define property on object that is not extensible
 *
 * from inside a React effect, unmounting the tree and serving a blank white
 * page. That is strictly worse than the bug it was fixing, and no build-time
 * check caught it: the bundle looked correct and the whole suite passed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A stand-in for maplibre's namespace: frozen, and with NO `accessToken`,
// exactly like the real module object the alias resolves to.
// NOTE on shape: vitest intercepts a missing `.default` on a mock and throws its
// own error, so the namespace-without-default case cannot be reproduced here
// directly. It does not need to be — the condition the guard actually tests is
// that the resolved renderer object is NON-EXTENSIBLE, which a frozen `default`
// reproduces exactly.
vi.mock('mapbox-gl', () => ({ default: Object.freeze({ Map: class {} }) }))

describe('setProviderToken against a sealed renderer module', () => {
  beforeEach(() => { vi.resetModules() })

  it('does not throw when the renderer module cannot take a property', async () => {
    const { setProviderToken } = await import('../config/mapProviders')
    // Without the isExtensible guard this throws and takes the app down.
    expect(() => setProviderToken('mapbox', 'some-token')).not.toThrow()
    expect(() => setProviderToken('mapbox', null)).not.toThrow()
  })

  it('still records the token internally so style availability is unaffected', async () => {
    const { setProviderToken, getProviderToken, getAvailableStyles } = await import('../config/mapProviders')
    setProviderToken('mapbox', 'some-token')
    // The module-scoped state is what drives the UI; only the renderer
    // singleton write is skipped.
    expect(getProviderToken('mapbox')).toBe('some-token')
    expect(getAvailableStyles().some(s => s.id === 'mapbox-streets')).toBe(true)
  })

  it('offers the tokenless styles when no token is set at all', async () => {
    const { setProviderToken, getAvailableStyles, getStyleForId } = await import('../config/mapProviders')
    setProviderToken('mapbox', null)
    setProviderToken('mapy', null)
    const ids = getAvailableStyles().map(s => s.id)
    expect(ids).toContain('esri-streets')
    expect(ids).toContain('esri-satellite')
    // And a stale persisted Mapbox id must resolve to something renderable
    // rather than a mapbox:// URL the tokenless renderer cannot load.
    expect(getStyleForId('mapbox-streets')).not.toBe('mapbox://styles/mapbox/streets-v12')
  })
})

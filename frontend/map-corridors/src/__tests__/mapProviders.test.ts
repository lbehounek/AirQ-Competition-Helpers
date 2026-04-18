import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MAP_STYLES,
  MAP_STYLE_IDS,
  setProviderToken,
  getProviderToken,
  getAvailableStyles,
  getStyleForId,
  getMapboxAccessToken,
  isMapStyleId,
  isStyleAvailable,
  normalizeStyleId,
  subscribeToProvider,
  getProviderSnapshot,
} from '../config/mapProviders'
import mapboxgl from 'mapbox-gl'

describe('mapProviders', () => {
  beforeEach(() => {
    // Clear both tokens so each test starts from a known baseline.
    setProviderToken('mapbox', null)
    setProviderToken('mapy', null)
  })

  it('exposes a non-empty style registry with both categories', () => {
    expect(MAP_STYLES.length).toBeGreaterThan(0)
    expect(MAP_STYLES.some(s => s.category === 'Streets')).toBe(true)
    expect(MAP_STYLES.some(s => s.category === 'Aerial')).toBe(true)
  })

  it('MAP_STYLE_IDS covers every entry in MAP_STYLES (no drift)', () => {
    const registryIds = MAP_STYLES.map(s => s.id).sort()
    const constIds = [...MAP_STYLE_IDS].sort()
    expect(constIds).toEqual(registryIds)
  })

  it('filters out styles whose required token is absent', () => {
    const avail = getAvailableStyles().map(s => s.id)
    // Token-free styles must always be present.
    expect(avail).toContain('osm-classic')
    expect(avail).toContain('esri-satellite')
    // Token-gated styles must be hidden when no token is configured.
    expect(avail).not.toContain('mapbox-streets')
    expect(avail).not.toContain('mapbox-satellite')
    expect(avail).not.toContain('mapy-basic')
    expect(avail).not.toContain('mapy-aerial')
  })

  it('re-enables token-gated styles when the token arrives', () => {
    setProviderToken('mapy', 'test-mapy-key')
    const avail = getAvailableStyles().map(s => s.id)
    expect(avail).toContain('mapy-basic')
    expect(avail).toContain('mapy-aerial')
    expect(avail).not.toContain('mapbox-streets')
  })

  it('resolves legacy "streets"/"satellite" ids to mapbox defaults', () => {
    setProviderToken('mapbox', 'pk.test')
    expect(getStyleForId('streets')).toBe('mapbox://styles/mapbox/streets-v12')
    expect(getStyleForId('satellite')).toBe('mapbox://styles/mapbox/satellite-v9')
  })

  it('falls back to the first available style for unknown ids', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = getStyleForId('definitely-not-a-real-id')
    // Result is a raster style object, not a mapbox URL
    expect(typeof result === 'object' && result !== null).toBe(true)
    // And unknown ids must be logged — distinguishing them from the silent
    // "token pending async" fallback.
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toContain('Unknown style id')
    warn.mockRestore()
  })

  it('known-id-with-missing-token fallback is silent (token arrives async)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = getStyleForId('mapy-basic')
    expect(result).not.toBe('mapbox://styles/mapbox/streets-v12')
    // Must NOT warn — this is the expected boot path while tokens load.
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('URL-encodes the Mapy.cz API key in tile URLs', () => {
    setProviderToken('mapy', 'key with spaces & ampersand')
    const style = getStyleForId('mapy-basic')
    expect(typeof style).toBe('object')
    const tiles = (style as any)?.sources?.['mapy-basic']?.tiles?.[0]
    // `&` and spaces must be encoded — otherwise they'd inject query params.
    expect(tiles).toContain('apikey=key%20with%20spaces%20%26%20ampersand')
    expect(tiles).not.toContain('apikey=key with spaces & ampersand')
  })

  it('embeds the plain Mapy.cz API key when it has no special chars', () => {
    setProviderToken('mapy', 'my-secret-key')
    const style = getStyleForId('mapy-basic')
    const tiles = (style as any)?.sources?.['mapy-basic']?.tiles?.[0]
    expect(tiles).toContain('apikey=my-secret-key')
  })

  it('isStyleAvailable tracks token state', () => {
    expect(isStyleAvailable('osm-classic')).toBe(true)
    expect(isStyleAvailable('mapy-basic')).toBe(false)
    setProviderToken('mapy', 'key')
    expect(isStyleAvailable('mapy-basic')).toBe(true)
  })

  describe('Mapbox URL shape', () => {
    it('never embeds the Mapbox token in the style URL (auth is via SDK singleton)', () => {
      setProviderToken('mapbox', 'pk.my.secret.token')
      const streets = getStyleForId('mapbox-streets')
      const satellite = getStyleForId('mapbox-satellite')
      expect(typeof streets).toBe('string')
      expect(typeof satellite).toBe('string')
      expect(streets as string).not.toContain('pk.')
      expect(streets as string).not.toContain('accessToken')
      expect(satellite as string).not.toContain('pk.')
      expect(satellite as string).not.toContain('accessToken')
    })
  })

  describe('isMapStyleId / normalizeStyleId', () => {
    it('isMapStyleId narrows only known ids', () => {
      expect(isMapStyleId('mapy-basic')).toBe(true)
      expect(isMapStyleId('mapbox-streets')).toBe(true)
      expect(isMapStyleId('streets')).toBe(false)     // legacy form, not canonical
      expect(isMapStyleId('')).toBe(false)
      expect(isMapStyleId(null)).toBe(false)
      expect(isMapStyleId(undefined)).toBe(false)
      expect(isMapStyleId(42)).toBe(false)
      expect(isMapStyleId({})).toBe(false)
    })

    it('normalizeStyleId accepts canonical and legacy ids', () => {
      expect(normalizeStyleId('mapbox-streets')).toBe('mapbox-streets')
      expect(normalizeStyleId('streets')).toBe('mapbox-streets')
      expect(normalizeStyleId('satellite')).toBe('mapbox-satellite')
    })

    it('normalizeStyleId returns undefined for unknown / invalid values', () => {
      expect(normalizeStyleId('unknown')).toBeUndefined()
      expect(normalizeStyleId('')).toBeUndefined()
      expect(normalizeStyleId(null)).toBeUndefined()
      expect(normalizeStyleId(42)).toBeUndefined()
    })
  })

  describe('setProviderToken token-clearing paths', () => {
    it('empty string clears the token (treats as unset)', () => {
      setProviderToken('mapbox', 'pk.test')
      expect(getProviderToken('mapbox')).toBe('pk.test')
      setProviderToken('mapbox', '')
      expect(getProviderToken('mapbox')).toBeNull()
    })

    it('undefined clears the token', () => {
      setProviderToken('mapbox', 'pk.test')
      setProviderToken('mapbox', undefined)
      expect(getProviderToken('mapbox')).toBeNull()
    })

    it('clearing mapbox token also clears mapboxgl.accessToken singleton', () => {
      setProviderToken('mapbox', 'pk.real')
      expect(mapboxgl.accessToken).toBe('pk.real')
      setProviderToken('mapbox', null)
      expect(mapboxgl.accessToken).toBe('')
    })
  })

  describe('getMapboxAccessToken', () => {
    it('returns undefined (not null, not empty) when unset', () => {
      expect(getMapboxAccessToken()).toBeUndefined()
    })
    it('returns the configured token', () => {
      setProviderToken('mapbox', 'pk.real')
      expect(getMapboxAccessToken()).toBe('pk.real')
    })
  })

  describe('subscribeToProvider / _notify', () => {
    it('fires subscribers on every setProviderToken call, including same-value writes', () => {
      const fn = vi.fn()
      const unsub = subscribeToProvider(fn)
      setProviderToken('mapbox', 'a')
      setProviderToken('mapbox', 'a') // same value — still bump so React re-resolves
      setProviderToken('mapy', 'b')
      expect(fn).toHaveBeenCalledTimes(3)
      unsub()
    })

    it('returned disposer removes the listener (no leak across component lifetimes)', () => {
      const fn = vi.fn()
      const unsub = subscribeToProvider(fn)
      unsub()
      setProviderToken('mapbox', 'x')
      expect(fn).not.toHaveBeenCalled()
    })

    it('snapshot increments monotonically — useSyncExternalStore sees a new value each time', () => {
      const before = getProviderSnapshot()
      setProviderToken('mapbox', 'a')
      const after1 = getProviderSnapshot()
      setProviderToken('mapbox', 'b')
      const after2 = getProviderSnapshot()
      expect(after1).toBeGreaterThan(before)
      expect(after2).toBeGreaterThan(after1)
    })
  })
})

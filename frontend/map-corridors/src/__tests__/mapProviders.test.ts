import { describe, it, expect, beforeEach } from 'vitest'
import {
  MAP_STYLES,
  setProviderToken,
  getAvailableStyles,
  getStyleForId,
  isStyleAvailable,
} from '../config/mapProviders'

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
    // No tokens — only OSM / ESRI are available; either is acceptable.
    const result = getStyleForId('definitely-not-a-real-id')
    // Result is a raster style object, not a mapbox URL
    expect(typeof result === 'object' && result !== null).toBe(true)
  })

  it('falls back when the requested style needs a missing token', () => {
    // Mapy is gated; without the key, asking for mapy-basic must not leak
    // a broken raster spec missing the apikey — fallback kicks in instead.
    const result = getStyleForId('mapy-basic')
    // Must not be the legacy URL string; must fall back to an available style
    expect(result).not.toBe('mapbox://styles/mapbox/streets-v12')
  })

  it('embeds the Mapy.cz API key in tile URLs when token is set', () => {
    setProviderToken('mapy', 'my-secret-key')
    const style = getStyleForId('mapy-basic')
    expect(typeof style).toBe('object')
    const tiles = (style as any)?.sources?.['mapy-basic']?.tiles?.[0]
    expect(tiles).toContain('apikey=my-secret-key')
  })

  it('isStyleAvailable tracks token state', () => {
    expect(isStyleAvailable('osm-classic')).toBe(true)
    expect(isStyleAvailable('mapy-basic')).toBe(false)
    setProviderToken('mapy', 'key')
    expect(isStyleAvailable('mapy-basic')).toBe(true)
  })
})

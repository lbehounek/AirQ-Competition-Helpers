/**
 * Map provider abstraction — supports multiple tile styles from several
 * providers. Ported from the sibling AirQ-Sports repo.
 *
 * Tokens are set at runtime via `setProviderToken()`. Styles whose required
 * token is missing are filtered out by `getAvailableStyles()`, so the UI
 * only offers what will actually render.
 */

import mapboxgl, { type StyleSpecification } from 'mapbox-gl'

// ---------------------------------------------------------------------------
// Token state (module-scoped; shared across all consumers of this module)
// ---------------------------------------------------------------------------

type ProviderId = 'mapbox' | 'mapy'

const _tokens: Record<ProviderId, string | null> = { mapbox: null, mapy: null }

let _tokenVersion = 0
const _listeners = new Set<() => void>()

function _notify(): void {
  _tokenVersion++
  _listeners.forEach(fn => fn())
}

/** `useSyncExternalStore` subscribe/snapshot pair so hooks re-render on token change. */
export function subscribeToProvider(callback: () => void): () => void {
  _listeners.add(callback)
  return () => {
    _listeners.delete(callback)
  }
}
export function getProviderSnapshot(): number {
  return _tokenVersion
}

/** Set any provider token at runtime. Pass `null`/empty to clear. */
export function setProviderToken(providerId: ProviderId, token: string | null | undefined): void {
  const value = token && token.length > 0 ? token : null
  _tokens[providerId] = value
  // Mapbox GL JS reads `mapboxgl.accessToken` as a module-level singleton from
  // inside `setStyle('mapbox://…')`. react-map-gl mirrors the prop into that
  // singleton, but the assignment lags one microtask behind a `mapStyle` prop
  // update, which causes `setStyle` to fire before the new token is visible
  // and throw "An API access token is required". Writing the singleton here
  // — synchronously, in the same call that flips `_tokens.mapbox` — closes
  // that race: any subsequent `getStyleForId` that returns a `mapbox://`
  // URL is guaranteed to have the matching token in place.
  if (providerId === 'mapbox') {
    mapboxgl.accessToken = value || ''
  }
  _notify()
}

export function getProviderToken(providerId: ProviderId): string | null {
  return _tokens[providerId]
}

// ---------------------------------------------------------------------------
// Raster style specs for providers that don't serve their own style.json
// ---------------------------------------------------------------------------

// Free glyph PBFs for raster styles that don't bring their own. Without this,
// Mapbox GL rejects any symbol layer that uses `text-field` (the map-corridors
// app adds one for waypoint + exact-point labels). MapLibre's demo server is
// public, CORS-friendly and safe for light use.
const FREE_GLYPHS_URL = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'

const esriSatelliteStyle: StyleSpecification = {
  version: 8,
  glyphs: FREE_GLYPHS_URL,
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles \u00A9 Esri',
    },
  },
  layers: [{ id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite' }],
}

// CARTO Voyager: OSM-derived tiles served via basemaps.cartocdn.com. Works
// without a Referer header so it's safe for Electron's `app://` origin,
// unlike tile.openstreetmap.org which enforces OSM's tile usage policy and
// returns 403 "Access blocked" from browsers that don't send a sensible
// Referer. Same underlying data, CC-BY attribution required.
const osmClassicStyle: StyleSpecification = {
  version: 8,
  glyphs: FREE_GLYPHS_URL,
  sources: {
    'osm-classic': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '\u00A9 OpenStreetMap contributors, \u00A9 CARTO',
    },
  },
  layers: [{ id: 'osm-classic-layer', type: 'raster', source: 'osm-classic' }],
}

const mapyBasicStyle = (): StyleSpecification => ({
  version: 8,
  glyphs: FREE_GLYPHS_URL,
  sources: {
    'mapy-basic': {
      type: 'raster',
      tiles: [`https://api.mapy.cz/v1/maptiles/basic/256/{z}/{x}/{y}?apikey=${_tokens.mapy ?? ''}`],
      tileSize: 256,
      attribution: '\u00A9 Seznam.cz, a.s.',
    },
  },
  layers: [{ id: 'mapy-basic-layer', type: 'raster', source: 'mapy-basic' }],
})

const mapyAerialStyle = (): StyleSpecification => ({
  version: 8,
  glyphs: FREE_GLYPHS_URL,
  sources: {
    'mapy-aerial': {
      type: 'raster',
      tiles: [`https://api.mapy.cz/v1/maptiles/aerial/256/{z}/{x}/{y}?apikey=${_tokens.mapy ?? ''}`],
      tileSize: 256,
      attribution: '\u00A9 Seznam.cz, a.s.',
    },
  },
  layers: [{ id: 'mapy-aerial-layer', type: 'raster', source: 'mapy-aerial' }],
})

// ---------------------------------------------------------------------------
// Public style registry
// ---------------------------------------------------------------------------

export type MapStyleCategory = 'Streets' | 'Aerial'
export type MapStyleId =
  | 'mapy-basic'
  | 'mapbox-streets'
  | 'osm-classic'
  | 'mapbox-satellite'
  | 'mapy-aerial'
  | 'esri-satellite'

export type MapStyleDef = {
  id: MapStyleId
  label: string
  category: MapStyleCategory
  /** Which provider token must be present for this style to be usable. */
  requiredToken: ProviderId | null
  getStyle: () => string | StyleSpecification
}

/**
 * Ordered by preference within each category. Mapy.com goes first in Streets
 * because its Czech city/town labels are much denser than Mapbox defaults —
 * which is the whole reason this selector exists (feedback 2026-04-18).
 */
export const MAP_STYLES: MapStyleDef[] = [
  // Streets
  { id: 'mapy-basic', label: 'Mapy.com', category: 'Streets', requiredToken: 'mapy', getStyle: () => mapyBasicStyle() },
  { id: 'mapbox-streets', label: 'Mapbox Streets', category: 'Streets', requiredToken: 'mapbox', getStyle: () => 'mapbox://styles/mapbox/streets-v12' },
  { id: 'osm-classic', label: 'OpenStreetMap', category: 'Streets', requiredToken: null, getStyle: () => osmClassicStyle },
  // Aerial
  { id: 'mapbox-satellite', label: 'Mapbox Satellite', category: 'Aerial', requiredToken: 'mapbox', getStyle: () => 'mapbox://styles/mapbox/satellite-v9' },
  { id: 'mapy-aerial', label: 'Mapy.com Aerial', category: 'Aerial', requiredToken: 'mapy', getStyle: () => mapyAerialStyle() },
  { id: 'esri-satellite', label: 'ESRI Satellite', category: 'Aerial', requiredToken: null, getStyle: () => esriSatelliteStyle },
]

/** Styles whose required token is present (or that need none). */
export function getAvailableStyles(): MapStyleDef[] {
  return MAP_STYLES.filter(s => !s.requiredToken || _tokens[s.requiredToken])
}

/** Legacy aliases from the old `baseStyle: 'streets' | 'satellite'` schema. */
const LEGACY_IDS: Record<string, MapStyleId | undefined> = {
  streets: 'mapbox-streets',
  satellite: 'mapbox-satellite',
}

/**
 * Resolve a style id (including legacy 'streets'/'satellite') to a usable
 * style URL or style object. Falls back to the first available style if the
 * requested one doesn't exist or needs a token that isn't configured.
 */
export function getStyleForId(styleId: string): string | StyleSpecification {
  const resolved: MapStyleId | undefined =
    (MAP_STYLES.some(s => s.id === styleId) ? (styleId as MapStyleId) : undefined)
    ?? LEGACY_IDS[styleId]
  const def = resolved ? MAP_STYLES.find(s => s.id === resolved) : undefined
  if (def && (!def.requiredToken || _tokens[def.requiredToken])) {
    return def.getStyle()
  }
  const fallback = getAvailableStyles()[0]
  return fallback ? fallback.getStyle() : osmClassicStyle
}

/** True iff the given id matches a known style that's currently usable. */
export function isStyleAvailable(styleId: string): boolean {
  return getAvailableStyles().some(s => s.id === styleId)
}

/**
 * Convenience reader used by `<MapProviderView>` to feed
 * react-map-gl's `mapboxAccessToken` prop. Reads the same module-scoped
 * token state that `getStyleForId` checks, so the token can never lag
 * behind the style — they're consistent within one React render.
 */
export function getMapboxAccessToken(): string | undefined {
  return _tokens.mapbox ?? undefined
}

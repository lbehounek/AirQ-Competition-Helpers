/**
 * Map provider abstraction — supports multiple tile styles from several
 * providers. Ported from the sibling AirQ-Sports repo.
 *
 * Tokens are set at runtime via `setProviderToken()`. Styles whose required
 * token is missing are filtered out by `getAvailableStyles()`, so the UI
 * only offers what will actually render.
 */

import type { StyleSpecification } from 'mapbox-gl'
// Interop: mapbox-gl ships a DEFAULT export, maplibre-gl (v6, ESM) does not —
// it exposes named exports only. The web build aliases this specifier to
// maplibre-gl (see vite.config.ts), so a plain default import breaks there with
// '"default" is not exported'. Reading `.default ?? namespace` works against
// both without changing which renderer is bundled.
import * as glNamespace from 'mapbox-gl'
const gl = ((glNamespace as unknown as { default?: unknown }).default ?? glNamespace) as typeof glNamespace

/**
 * Set the renderer's module-level access-token singleton, if it has one.
 *
 * Mapbox GL JS reads `mapboxgl.accessToken` from inside `setStyle('mapbox://…')`,
 * and react-map-gl's mirroring of the prop lags one microtask behind a
 * `mapStyle` update — so this must be written synchronously in the same call
 * that flips `_tokens.mapbox`, or `setStyle` fires before the token is visible
 * and throws "An API access token is required".
 *
 * MapLibre has no such singleton, and in the web build `gl` resolves to
 * maplibre's ES MODULE NAMESPACE, which is sealed. Assigning to it throws
 * "Attempting to define property on object that is not extensible" — during a
 * React effect, which took the whole app down to a blank page. `isExtensible`
 * is the precise distinction: a namespace object is not, a plain module export
 * object is.
 */
function setRendererAccessToken(value: string): void {
  if (!Object.isExtensible(gl)) return
  ;(gl as unknown as { accessToken?: string }).accessToken = value
}


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
  if (providerId === 'mapbox') {
    setRendererAccessToken(value || '')
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

// Esri World Street Map — the keyless street basemap.
//
// This was CARTO Voyager until 2026-09-14, when CARTO closed keyless access to
// basemaps.cartocdn.com. Note HOW it closed, because it defeats the obvious
// check: CARTO still answers 200 with a valid PNG and `Access-Control-Allow-
// Origin: *`. The refusal is painted INTO THE IMAGE — every tile carries an
// "API KEY REQUIRED" watermark. Status codes and headers look perfectly
// healthy; only the pixels show it. Verify a tile provider by LOOKING at a
// rendered tile, not by curl-ing its status.
//
// Why Esri and not tile.openstreetmap.org, which is keyless and serves clean
// tiles from every origin tested — including an Electron-like `app://` origin
// with no Referer, contrary to the 403 this comment used to claim: OSM's Tile
// Usage Policy specifically forbids distributing an app that draws its basemap
// from their servers, and this ships as a downloadable Electron app. Every
// other OSM-derived raster CDN (Stadia, MapTiler, Thunderforest) needs a key.
//
// Esri's legacy ArcGIS Online MapServer endpoints need no key and ignore
// Referer/Origin — already proven in production by the satellite style above,
// which has always worked inside Electron. One less provider to depend on.
const esriStreetsStyle: StyleSpecification = {
  version: 8,
  glyphs: FREE_GLYPHS_URL,
  sources: {
    'esri-streets': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles © Esri',
    },
  },
  layers: [{ id: 'esri-streets-layer', type: 'raster', source: 'esri-streets' }],
}

// URL-encode the API key when embedding in a query string so a token that
// happens to contain `&`, `#`, `?`, or whitespace cannot escape the `apikey`
// parameter or corrupt the URL. Mapy.cz keys are alphanumeric in practice but
// defense-in-depth is cheap here.
const mapyTilesUrl = (kind: 'basic' | 'aerial'): string =>
  `https://api.mapy.cz/v1/maptiles/${kind}/256/{z}/{x}/{y}?apikey=${encodeURIComponent(_tokens.mapy ?? '')}`

const mapyBasicStyle = (): StyleSpecification => ({
  version: 8,
  glyphs: FREE_GLYPHS_URL,
  sources: {
    'mapy-basic': {
      type: 'raster',
      tiles: [mapyTilesUrl('basic')],
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
      tiles: [mapyTilesUrl('aerial')],
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

/** Source of truth for the set of valid style ids. Derive the literal union
 *  from the const array so adding an id in `MAP_STYLES` forces the type to
 *  widen (or the compiler to complain).
 */
export const MAP_STYLE_IDS = [
  'mapy-basic',
  'mapbox-streets',
  'esri-streets',
  'mapy-aerial',
  'mapbox-satellite',
  'esri-satellite',
] as const

export type MapStyleId = typeof MAP_STYLE_IDS[number]

export type MapStyleDef = {
  id: MapStyleId
  label: string
  category: MapStyleCategory
  /** Which provider token must be present for this style to be usable. */
  requiredToken: ProviderId | null
  getStyle: () => string | StyleSpecification
}

/**
 * Ordered by preference within each category. Mapy.com goes first in both
 * categories — its Czech labels are much denser than the alternatives, and
 * users asked for consistent positioning across the Map/Satellite menus
 * (feedback 2026-04-23). Mapbox is the universal second choice.
 */
export const MAP_STYLES: MapStyleDef[] = [
  // Streets
  { id: 'mapy-basic', label: 'Mapy.com', category: 'Streets', requiredToken: 'mapy', getStyle: () => mapyBasicStyle() },
  { id: 'mapbox-streets', label: 'Mapbox Streets', category: 'Streets', requiredToken: 'mapbox', getStyle: () => 'mapbox://styles/mapbox/streets-v12' },
  { id: 'esri-streets', label: 'ESRI Streets', category: 'Streets', requiredToken: null, getStyle: () => esriStreetsStyle },
  // Aerial
  { id: 'mapy-aerial', label: 'Mapy.com Aerial', category: 'Aerial', requiredToken: 'mapy', getStyle: () => mapyAerialStyle() },
  { id: 'mapbox-satellite', label: 'Mapbox Satellite', category: 'Aerial', requiredToken: 'mapbox', getStyle: () => 'mapbox://styles/mapbox/satellite-v9' },
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
  // Sessions saved before the keyless street basemap moved from CARTO to Esri
  // persist this id. Healing it here keeps those sessions on a street map
  // instead of silently dropping them to whatever happens to sort first.
  'osm-classic': 'esri-streets',
}

/** Runtime type guard: is this an id we recognise? */
export function isMapStyleId(value: unknown): value is MapStyleId {
  return typeof value === 'string' && (MAP_STYLE_IDS as readonly string[]).includes(value)
}

/**
 * Resolve an arbitrary string (possibly stale, possibly a legacy 'streets'/
 * 'satellite' key) to a known `MapStyleId` or `undefined`. Does NOT check
 * token availability — that's a concern of `getAvailableStyles()`.
 *
 * Returning `undefined` lets callers heal persisted state by writing back
 * a valid id the next time the user interacts with the selector.
 */
export function normalizeStyleId(value: unknown): MapStyleId | undefined {
  if (isMapStyleId(value)) return value
  if (typeof value === 'string') return LEGACY_IDS[value]
  return undefined
}

/**
 * Resolve a style id (including legacy 'streets'/'satellite') to a usable
 * style URL or style object. Falls back to the first available style if the
 * requested one doesn't exist or needs a token that isn't configured.
 *
 * Distinguishes two fallback reasons and logs only the bug case:
 *  - Unknown style id → `console.warn` (stale persistence / typo)
 *  - Known id but required token not yet loaded → silent (tokens arrive async)
 */
export function getStyleForId(styleId: string): string | StyleSpecification {
  const resolved = normalizeStyleId(styleId)
  if (resolved === undefined) {
    console.warn(`[mapProviders] Unknown style id "${styleId}" — falling back to first available style`)
  }
  const def = resolved ? MAP_STYLES.find(s => s.id === resolved) : undefined
  if (def && (!def.requiredToken || _tokens[def.requiredToken])) {
    return def.getStyle()
  }
  const fallback = getAvailableStyles()[0]
  return fallback ? fallback.getStyle() : esriStreetsStyle
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

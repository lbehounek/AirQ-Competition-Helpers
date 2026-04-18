import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  getAvailableStyles,
  subscribeToProvider,
  getProviderSnapshot,
  type MapStyleDef,
  type MapStyleId,
} from '../config/mapProviders'

/**
 * Map-style selection hook with simple persistence.
 *
 * The selected style id is persisted externally (via the `session` / OPFS
 * store) — callers pass it in and write it back through `onChange`. That
 * keeps the style coupled to the competition rather than to the browser.
 *
 * Returns `[mapStyleId, setMapStyleId, availableStyles]`. Re-validates the
 * id whenever provider tokens change (tokens arrive async on Electron
 * start) so a previously-chosen Mapy.com style will be re-selected once
 * the Mapy API key lands.
 *
 * Ported from `AirQ-Sports/frontend/shared/src/hooks/useMapStyle.js`,
 * adapted to externally-owned state.
 */
type UseMapStyleArgs = {
  preferredId: string | null | undefined
  onChange: (id: MapStyleId) => void
}

export function useMapStyle({ preferredId, onChange }: UseMapStyleArgs): [MapStyleId, (id: MapStyleId) => void, MapStyleDef[]] {
  // Re-run on any token change (subscribeToProvider fires on setProviderToken)
  const tokenSnapshot = useSyncExternalStore(subscribeToProvider, getProviderSnapshot, getProviderSnapshot)

  const availableStyles = getAvailableStyles()
  const availableIds = new Set(availableStyles.map(s => s.id))

  const pickDefault = useCallback((): MapStyleId => {
    if (preferredId && availableIds.has(preferredId as MapStyleId)) return preferredId as MapStyleId
    if (availableStyles.length > 0) return availableStyles[0].id
    return 'osm-classic'
  }, [availableIds, availableStyles, preferredId])

  const [mapStyleId, _setMapStyleId] = useState<MapStyleId>(() => pickDefault())
  const preferredRef = useRef<string | null | undefined>(preferredId)

  // When tokens change (Mapbox/Mapy key arrives async) or the stored
  // preference updates, re-resolve. Intentionally narrow deps so we re-run
  // on token bump — not on every render.
  useEffect(() => {
    preferredRef.current = preferredId
    if (preferredId && availableIds.has(preferredId as MapStyleId)) {
      _setMapStyleId(preferredId as MapStyleId)
    } else if (!availableIds.has(mapStyleId)) {
      _setMapStyleId(pickDefault())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenSnapshot, preferredId])

  const setMapStyleId = useCallback((id: MapStyleId) => {
    preferredRef.current = id
    _setMapStyleId(id)
    onChange(id)
  }, [onChange])

  return [mapStyleId, setMapStyleId, availableStyles]
}

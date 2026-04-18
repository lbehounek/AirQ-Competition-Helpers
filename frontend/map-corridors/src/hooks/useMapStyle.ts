import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  getAvailableStyles,
  normalizeStyleId,
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

  // Normalize the raw preferred id once (may coerce legacy 'streets'/'satellite'
  // to a real MapStyleId). `undefined` means "no valid preference known yet".
  const normalizedPreferred = normalizeStyleId(preferredId)

  const pickDefault = useCallback((): MapStyleId => {
    if (normalizedPreferred && availableIds.has(normalizedPreferred)) return normalizedPreferred
    if (availableStyles.length > 0) return availableStyles[0].id
    return 'osm-classic'
  }, [availableIds, availableStyles, normalizedPreferred])

  const [mapStyleId, _setMapStyleId] = useState<MapStyleId>(() => pickDefault())
  const preferredRef = useRef<string | null | undefined>(preferredId)
  const healedRef = useRef<string | null>(null)

  // When tokens change (Mapbox/Mapy key arrives async) or the stored
  // preference updates, re-resolve. If the raw persisted id was legacy or
  // unknown but normalization recovered a valid id, persist the normalized
  // form back to storage so the session heals on first interaction.
  useEffect(() => {
    preferredRef.current = preferredId
    if (normalizedPreferred && availableIds.has(normalizedPreferred)) {
      _setMapStyleId(normalizedPreferred)
      // Heal persisted state if the raw form differed from the normalized form
      // (e.g. legacy 'streets' → 'mapbox-streets'). Guard with `healedRef` so
      // we don't loop when `preferredId` hasn't actually changed but tokens
      // bumped the snapshot.
      if (preferredId && preferredId !== normalizedPreferred && healedRef.current !== preferredId) {
        healedRef.current = preferredId
        onChange(normalizedPreferred)
      }
    } else if (!availableIds.has(mapStyleId)) {
      _setMapStyleId(pickDefault())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenSnapshot, preferredId, normalizedPreferred])

  const setMapStyleId = useCallback((id: MapStyleId) => {
    preferredRef.current = id
    _setMapStyleId(id)
    onChange(id)
  }, [onChange])

  return [mapStyleId, setMapStyleId, availableStyles]
}

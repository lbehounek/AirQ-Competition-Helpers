// React hook that drives the auto-fan of overlapping photo markers.
//
// It projects each visible marker to screen pixels, hands the points to the
// pure `computeMarkerFan` clusterer, and exposes:
//   • `offsets`  — markerId → [dx,dy] pixel offset, applied via the
//                  react-map-gl `<Marker offset>` prop (anchor stays at the
//                  true lng/lat, so drag still reports the real coords).
//   • `leaders`  — a GeoJSON LineString FeatureCollection (centroid → fanned
//                  dot) for a thin GL line layer that ties each cluster to its
//                  place. Endpoints are unprojected back to lng/lat so the GL
//                  layer tracks the map natively between recomputes.
//
// Overlap depends on zoom, so the fan recomputes on `moveend`/`zoomend` (the
// settle events — not `move`/`zoom`, which fire every frame). It also
// recomputes when the marker set changes or when a marker enters/leaves drag
// (the dragged marker is excluded so its dot snaps cleanly to the cursor).

import { useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import type { MapRef } from 'react-map-gl/mapbox'
import type { FeatureCollection, LineString } from 'geojson'
import type { PhotoMarker } from '../../types/markers'
import { isPhotoMarkerVisible } from './markerVisibility'
import { computeMarkerFan, type ScreenPoint } from './markerFan'

/** A fanned cluster surfaced to the map: members (markerIds), the centroid in
 *  lng/lat (so the "Compare N" pill can be a <Marker>), and the member count. */
export interface FanCluster {
  ids: string[]
  centroidLngLat: [number, number]
  count: number
}

export interface UseMarkerFanResult {
  offsets: Map<string, [number, number]>
  leaders: FeatureCollection<LineString>
  clusters: FanCluster[]
}

const EMPTY: UseMarkerFanResult = {
  offsets: new Map(),
  leaders: { type: 'FeatureCollection', features: [] },
  clusters: [],
}

export function useMarkerFan(params: {
  mapRef: RefObject<MapRef | null>
  isMapLoaded: boolean
  markers: readonly PhotoMarker[] | undefined
  /** Marker currently being dragged — excluded from fanning so it tracks the cursor. */
  draggingMarkerId: string | null
  thresholdPx?: number
}): UseMarkerFanResult {
  const { mapRef, isMapLoaded, markers, draggingMarkerId, thresholdPx } = params

  // Bumped on every map settle so the memo below re-projects against the new
  // viewport. A counter (not the camera state) keeps the dependency cheap.
  const [settleTick, setSettleTick] = useState(0)
  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return
    const map = mapRef.current.getMap()
    const bump = () => setSettleTick(t => t + 1)
    map.on('moveend', bump)
    map.on('zoomend', bump)
    // Initial compute once the map is ready (no settle event fires on load).
    bump()
    return () => {
      map.off('moveend', bump)
      map.off('zoomend', bump)
    }
  }, [isMapLoaded, mapRef])

  return useMemo<UseMarkerFanResult>(() => {
    if (!isMapLoaded || !mapRef.current || !markers) return EMPTY
    const visible = markers.filter(m => isPhotoMarkerVisible(m) && m.id !== draggingMarkerId)
    if (visible.length < 2) return EMPTY

    const map = mapRef.current.getMap()
    const points: ScreenPoint[] = visible.map(m => {
      const p = map.project([m.lng, m.lat])
      return { id: m.id, x: p.x, y: p.y }
    })

    const fan = computeMarkerFan(points, thresholdPx ? { thresholdPx } : undefined)
    if (fan.offsets.size === 0) return EMPTY

    const features: FeatureCollection<LineString>['features'] = fan.leaders.map(l => {
      const from = map.unproject(l.from)
      const to = map.unproject(l.to)
      return {
        type: 'Feature',
        id: l.id,
        geometry: {
          type: 'LineString',
          coordinates: [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
        },
        properties: {},
      }
    })

    const clusters: FanCluster[] = fan.clusters.map(c => {
      const ll = map.unproject(c.centroid)
      return { ids: c.ids, centroidLngLat: [ll.lng, ll.lat], count: c.ids.length }
    })

    return { offsets: fan.offsets, leaders: { type: 'FeatureCollection', features }, clusters }
    // settleTick intentionally in deps: it's the signal that the viewport
    // moved and projections must be recomputed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMapLoaded, mapRef, markers, draggingMarkerId, thresholdPx, settleTick])
}

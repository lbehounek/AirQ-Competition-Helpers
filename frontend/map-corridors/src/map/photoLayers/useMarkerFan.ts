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
// Overlap depends on zoom, so the fan recomputes on `moveend`/`zoomend` AND on
// the per-frame `zoom` event — the offset is a SCREEN-PIXEL vector, valid only
// at the zoom it was projected at, so it must keep up with a zoom in flight or
// the dot rides a stale offset and slides off its true point until the gesture
// settles. A pure pan (`move`) is deliberately NOT subscribed: translation
// preserves the markers' relative screen positions, so the offsets stay valid.
// It also recomputes when the marker set changes or when a marker enters/leaves
// drag (the dragged marker is excluded so its dot snaps cleanly to the cursor).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { MapRef } from 'react-map-gl/mapbox'
import type { FeatureCollection, LineString } from 'geojson'
import type { PhotoMarker } from '../../types/markers'
import { isPhotoMarkerVisible } from './markerVisibility'
import { computeMarkerFan, type ScreenPoint } from './markerFan'

/** A fanned cluster surfaced to the map: its members (markerIds) and the
 *  centroid in lng/lat (so the "Compare N" pill can be a <Marker>). The member
 *  count is just `ids.length` — not stored, to avoid a field that can drift out
 *  of sync. Centroid is `{lng, lat}` (not a bare tuple) so it can't be mixed up
 *  with the screen-pixel `MarkerCluster.centroid` it's unprojected from. */
export interface FanCluster {
  ids: readonly string[]
  centroidLngLat: { lng: number; lat: number }
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

// A fan point above the horizon makes `unproject` throw (or return a non-finite
// LngLat); that is an expected, recoverable case (we just drop the leader line
// or cluster pill), so we must NOT rethrow — doing so during render is the
// white-screen bug this hook guards against. But silently swallowing every
// failure hides genuinely unexpected ones, so warn once in dev. Module-level
// latch keeps it to a single line instead of one per dropped point per recompute
// (which fires on every map settle).
let unprojectWarned = false
function warnUnprojectOnce(err: unknown): void {
  if (unprojectWarned || !import.meta.env.DEV) return
  unprojectWarned = true
  console.warn('[useMarkerFan] unproject failed for a fan point (leader endpoint or cluster centroid); dropping it.', err)
}

/**
 * The slice of the map API the fan needs: project lng/lat → screen pixels and
 * back. Declared structurally (a mapbox `Map` satisfies it) so the projection
 * boundary can be unit-tested with a plain fake — no live map, no jsdom.
 */
export interface ProjectionMap {
  project(lngLat: [number, number]): { x: number; y: number }
  unproject(pt: [number, number]): { lng: number; lat: number }
}

/**
 * Pure projection boundary for the fan: screen-project the visible markers,
 * cluster them, and unproject the leader segments back to lng/lat. Split out of
 * the hook's `useMemo` so it carries no React/map-instance dependency and can be
 * tested directly. Guards the two ways a pitched map produces non-finite
 * geometry:
 *
 *  1. Markers above the horizon (or behind the camera) `project()` to NaN/Inf.
 *     Feeding those into the clusterer poisons the fan and the downstream
 *     `unproject` throws on NaN via the LngLat constructor — and because the
 *     caller runs this during render, an uncaught throw blanks the whole app
 *     (white screen). Drop non-finite points up front.
 *  2. Belt-and-suspenders: even from finite inputs an `unproject` can land above
 *     the horizon and throw, so `safeUnproject` skips any leader endpoint it
 *     can't resolve instead of propagating.
 */
export function buildMarkerFan(
  map: ProjectionMap,
  visible: readonly PhotoMarker[],
  thresholdPx?: number,
): UseMarkerFanResult {
  if (visible.length < 2) return EMPTY

  const points: ScreenPoint[] = visible.flatMap(m => {
    const p = map.project([m.lng, m.lat])
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? [{ id: m.id, x: p.x, y: p.y }] : []
  })
  if (points.length < 2) return EMPTY

  const fan = computeMarkerFan(points, thresholdPx ? { thresholdPx } : undefined)
  if (fan.offsets.size === 0) return EMPTY

  const safeUnproject = (pt: [number, number]): [number, number] | null => {
    try {
      const ll = map.unproject(pt)
      if (Number.isFinite(ll.lng) && Number.isFinite(ll.lat)) return [ll.lng, ll.lat]
      // unproject succeeded but produced NaN/Inf — same off-horizon case as a
      // throw, just surfaced differently. Drop it, and warn so a silent
      // regression in the guard stays diagnosable.
      warnUnprojectOnce(new Error(`unproject returned a non-finite LngLat (${ll.lng}, ${ll.lat})`))
      return null
    } catch (err) {
      warnUnprojectOnce(err)
      return null
    }
  }

  const features = fan.leaders.flatMap<FeatureCollection<LineString>['features'][number]>(l => {
    const from = safeUnproject(l.from)
    const to = safeUnproject(l.to)
    if (!from || !to) return []
    return [{
      type: 'Feature',
      id: l.id,
      geometry: { type: 'LineString', coordinates: [from, to] },
      properties: {},
    }]
  })

  // Same off-horizon guard as the leaders: a cluster whose centroid can't
  // unproject (above the horizon on a pitched map) is dropped rather than
  // thrown — feeding NaN to a <Marker> would otherwise blank the app.
  const clusters = fan.clusters.flatMap<FanCluster>(c => {
    const ll = safeUnproject(c.centroid)
    return ll ? [{ ids: c.ids, centroidLngLat: { lng: ll[0], lat: ll[1] } }] : []
  })

  return { offsets: fan.offsets, leaders: { type: 'FeatureCollection', features }, clusters }
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

  // Edge-pan marker drag calls `map.panBy({ duration: 0 })` every animation
  // frame, and mapbox emits a `moveend` per call — so without this guard the
  // fan would re-project every visible marker at ~60fps while a marker is held
  // against a viewport edge (the exact per-frame work this `moveend`-vs-`move`
  // choice was made to avoid). Skip the bump mid-drag; the memo recomputes once
  // on drag end via its `draggingMarkerId` dependency. A ref (not a dep of the
  // subscribe effect) so the listener isn't re-bound on every drag transition.
  const draggingRef = useRef(draggingMarkerId)
  useEffect(() => { draggingRef.current = draggingMarkerId }, [draggingMarkerId])

  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return
    const map = mapRef.current.getMap()
    const bump = () => { if (draggingRef.current == null) setSettleTick(t => t + 1) }
    map.on('moveend', bump)
    map.on('zoomend', bump)
    // Per-frame during a continuous/animated zoom (wheel, pinch, +/- buttons,
    // flyTo/fitBounds). Without this the fanned dot keeps its pre-zoom pixel
    // offset layered on the (correctly re-projected) geo-anchor and visibly
    // drifts relative to the basemap until the gesture settles — the "placed
    // photo doesn't stay put on zoom" report. The `draggingRef` guard keeps it a
    // no-op during an edge-pan marker drag, preserving the ~60fps optimisation
    // that motivated the settle-only choice. Pan (`move`) stays unsubscribed
    // because translation doesn't change markers' relative screen positions.
    map.on('zoom', bump)
    // Initial compute once the map is ready (no settle event fires on load).
    bump()
    return () => {
      map.off('moveend', bump)
      map.off('zoomend', bump)
      map.off('zoom', bump)
    }
  }, [isMapLoaded, mapRef])

  return useMemo<UseMarkerFanResult>(() => {
    if (!isMapLoaded || !mapRef.current || !markers) return EMPTY
    const visible = markers.filter(m => isPhotoMarkerVisible(m) && m.id !== draggingMarkerId)
    return buildMarkerFan(mapRef.current.getMap(), visible, thresholdPx)
    // settleTick intentionally in deps: it's the signal that the viewport
    // moved and projections must be recomputed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMapLoaded, mapRef, markers, draggingMarkerId, thresholdPx, settleTick])
}

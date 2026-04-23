import { booleanPointInPolygon, point as turfPoint, polygon as turfPolygon } from '@turf/turf'
import { calculateDistance } from './segments'

export type CorridorPolygon = {
  name: string
  ring: [number, number][]
  bbox: [number, number, number, number]
  startName: string
  startCoord?: [number, number]
}

export type PointForMatching = { id: string; lng: number; lat: number }
export type CorridorMatch = { startCoord?: [number, number]; startName: string }

/**
 * Maximum haversine distance (metres) from a marker to the chosen
 * fallback corridor's startCoord. Beyond this, "no attribution" is
 * preferred over "plausible but wrong attribution" — a marker 60 km
 * from every corridor almost certainly belongs to none of them, and
 * surfacing a blank cell is less harmful to the competitor than
 * printing a spurious "From TP" on the answer sheet.
 */
export const NEAREST_CORRIDOR_MAX_METERS = 50_000

/**
 * For each point, return the corridor that contains it. When no polygon
 * contains the point, fall back to the corridor whose `startCoord` is
 * closest — otherwise markers that drift outside the polygon by a metre
 * would leave the answer sheet distance column blank (feedback 2026-04-23).
 *
 * Distance is measured in latitude-scaled degrees (`Δlng · cos(lat)`) so
 * a marker at 50° N is not biased toward eastward corridors: 1° lng there
 * is ~71 km while 1° lat is ~111 km. A naive `Δlng² + Δlat²` misattributes
 * markers by ~35% in Central-European latitudes.
 *
 * Polygon evaluation errors are logged (not swallowed). A malformed ring
 * coming out of `buildPreciseCorridorsAndGates` is a real bug — silent
 * swallow is the exact pattern the 2026-04-23 feedback round fixed at the
 * upload path; we apply the same discipline here.
 */
export function matchPointsToCorridors(
  pts: ReadonlyArray<PointForMatching>,
  corridorPolygons: ReadonlyArray<CorridorPolygon>,
): Record<string, CorridorMatch | null> {
  const out: Record<string, CorridorMatch | null> = {}
  for (const m of pts) {
    let match: CorridorPolygon | null = null
    for (const c of corridorPolygons) {
      const [minLng, minLat, maxLng, maxLat] = c.bbox
      if (m.lng < minLng || m.lng > maxLng || m.lat < minLat || m.lat > maxLat) continue
      try {
        const pt = turfPoint([m.lng, m.lat])
        const poly = turfPolygon([c.ring])
        if (booleanPointInPolygon(pt, poly)) { match = c; break }
      } catch (err) {
        console.error('[matchPointsToCorridors] polygon eval failed for corridor', c.startName, err)
      }
    }
    if (!match && corridorPolygons.length) {
      const cosLat = Math.cos((m.lat * Math.PI) / 180) || 1e-9
      let nearest: CorridorPolygon | null = null
      let bestD2 = Infinity
      for (const c of corridorPolygons) {
        if (!c.startCoord) continue
        const dx = (c.startCoord[0] - m.lng) * cosLat
        const dy = c.startCoord[1] - m.lat
        const d2 = dx * dx + dy * dy
        if (d2 < bestD2) { bestD2 = d2; nearest = c }
      }
      // Accept the nearest only if it's within the sanity cap. Scaled-square
      // distance is fine for picking the minimum, but the cap must be in
      // real metres — haversine on the winner, not an approximation.
      if (nearest && nearest.startCoord) {
        const meters = calculateDistance(
          [nearest.startCoord[0], nearest.startCoord[1], 0],
          [m.lng, m.lat, 0],
        )
        if (meters <= NEAREST_CORRIDOR_MAX_METERS) match = nearest
      }
    }
    out[m.id] = match ? { startCoord: match.startCoord, startName: match.startName } : null
  }
  return out
}

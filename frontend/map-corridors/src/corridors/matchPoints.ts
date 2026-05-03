import { booleanPointInPolygon, point as turfPoint, polygon as turfPolygon, lineString as turfLineString, pointToLineDistance } from '@turf/turf'
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
 * Ordered route waypoints (SP, TP1, TP2, …, TPn, FP). When supplied, the
 * fallback path projects unmatched markers onto adjacent waypoint legs and
 * attributes them to the leg's PRECEDING waypoint — fixing the dashed/scenic
 * leg case (feedback 2026-05-03): when the corridor between TPn and TPn+1 is
 * dropped because the leg is a chain of dashed connectors, photos in the gap
 * fall back to "nearest startCoord" and get attributed to TPn+1 (the next
 * leg's start), which the rules dictate must be TPn (the preceding TP of the
 * leg the photo is actually on).
 */
export type RouteWaypoint = { name: string; coord: [number, number] }

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
/**
 * Set of "{from}→{to}" leg keys that are already covered by a corridor.
 * The leg-projection fallback skips these so a marker outside any
 * polygon only attaches to a SCENIC leg (one whose corridor was dropped
 * because the leg is a chain of dashed connectors). Without this
 * filter, a marker that just barely overshoots a corridor's polygon
 * would still snap back onto that corridor's leg via projection — but
 * the user's rule (feedback 2026-05-03 follow-up) is "outside corridor
 * → assigned to nearest leg WITHOUT a corridor". The set lets the
 * matcher honour that rule without having to re-derive corridor
 * geometry here.
 *
 * Build keys as `${from}→${to}` (no spaces, exactly as written in the
 * corridor segment name template at preciseCorridor.ts:281,292,376).
 */
export type CoveredLegKey = `${string}→${string}`

export function legKey(fromName: string, toName: string): CoveredLegKey {
  return `${fromName}→${toName}` as CoveredLegKey
}

export function matchPointsToCorridors(
  pts: ReadonlyArray<PointForMatching>,
  corridorPolygons: ReadonlyArray<CorridorPolygon>,
  waypoints?: ReadonlyArray<RouteWaypoint>,
  coveredLegs?: ReadonlySet<string>,
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
    if (match) {
      out[m.id] = { startCoord: match.startCoord, startName: match.startName }
      continue
    }

    // Leg-projection fallback (preferred when ordered waypoints are
    // available). Project the marker onto each adjacent-waypoint leg,
    // pick the leg with smallest perpendicular distance, attribute to
    // its PRECEDING waypoint. Handles the dashed/scenic-leg gap case
    // (feedback 2026-05-03): markers between TPn and TPn+1 on a leg
    // whose corridor was dropped (chain of dashed connectors) used to
    // fall through the legacy nearest-startCoord branch and lock onto
    // TPn+1 (the start of the NEXT corridor) because that startCoord
    // happened to be the closest. Projecting onto the leg geometry
    // instead picks the actual leg the marker is on, regardless of
    // which endpoint the marker is geographically nearer to.
    if (waypoints && waypoints.length >= 2) {
      const legMatch = matchByLegProjection(m, waypoints, coveredLegs)
      if (legMatch) {
        out[m.id] = legMatch
        continue
      }
    }

    if (corridorPolygons.length) {
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

/**
 * Project the marker onto each adjacent leg `waypoints[i] → waypoints[i+1]`
 * that is NOT covered by an existing corridor, pick the leg with smallest
 * perpendicular distance, return its preceding waypoint as the match.
 * Honors `NEAREST_CORRIDOR_MAX_METERS` so a marker 60+ km from every
 * scenic leg returns null instead of a spurious attribution.
 *
 * Filtering by `coveredLegs` enforces the user's "outside corridor →
 * assigned to nearest leg WITHOUT a corridor" rule (feedback 2026-05-03
 * follow-up). When `coveredLegs` is undefined or empty, every leg is
 * considered — keeps the function usable without corridor context (e.g.
 * unit tests that only exercise the projection geometry).
 *
 * `pointToLineDistance` measures perpendicular distance to the segment
 * (clamped at endpoints), which is exactly the "which leg is the marker
 * on" question we want to answer.
 */
function matchByLegProjection(
  m: PointForMatching,
  waypoints: ReadonlyArray<RouteWaypoint>,
  coveredLegs?: ReadonlySet<string>,
): CorridorMatch | null {
  let bestIdx = -1
  let bestKm = Infinity
  const pt = turfPoint([m.lng, m.lat])
  for (let i = 0; i < waypoints.length - 1; i++) {
    const fromName = waypoints[i].name
    const toName = waypoints[i + 1].name
    if (coveredLegs && coveredLegs.has(legKey(fromName, toName))) continue
    const a = waypoints[i].coord
    const b = waypoints[i + 1].coord
    let km: number
    try {
      const seg = turfLineString([[a[0], a[1]], [b[0], b[1]]])
      km = pointToLineDistance(pt, seg, { units: 'kilometers' })
    } catch (err) {
      console.error('[matchPointsToCorridors] leg projection failed for', fromName, '→', toName, err)
      continue
    }
    if (km < bestKm) { bestKm = km; bestIdx = i }
  }
  if (bestIdx < 0) return null
  if (bestKm * 1000 > NEAREST_CORRIDOR_MAX_METERS) return null
  const leading = waypoints[bestIdx]
  return { startName: leading.name, startCoord: leading.coord }
}

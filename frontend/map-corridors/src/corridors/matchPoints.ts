// Individual @turf subpackages rather than the `@turf/turf` barrel (see
// setSplit/partitionPicksBySet.ts) — same modules, no phantom dependency.
import { point as turfPoint, polygon as turfPolygon, lineString as turfLineString } from '@turf/helpers'
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon'
import { pointToLineDistance } from '@turf/point-to-line-distance'
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
 *
 * WHAT THIS MEANS NOW: a *tie-break preference only*. When two legs are
 * exactly equidistant from a marker, the one WITHOUT a corridor wins —
 * because a marker inside a covered leg's corridor would already have
 * been attributed by the polygon-containment pass, so a marker reaching
 * the projection fallback at equal distance is more plausibly on the
 * uncovered (scenic) leg. It can never make a leg unreachable.
 *
 * WHY IT IS NOT A HARD EXCLUSION ANY MORE — do not reinstate that (this
 * cost 6 of 18 en-route photos on the real MZB 2026 course, misattributed
 * by up to 25.9 km): the set used to be a `continue` in the projection
 * loop, encoding the user's shorthand rule "outside corridor → assigned
 * to nearest leg WITHOUT a corridor" (feedback 2026-05-03 follow-up).
 * But a rally corridor is only 300 m left + 300 m right. A photo that
 * misses its own leg's corridor by 42 m is still unambiguously ON that
 * leg — yet the exclusion permanently forbade that leg as an answer and
 * handed the marker to the nearest leg that happened to have NO corridor,
 * which on a real course is 10-26 km away. The failure got WORSE the more
 * corridors were built successfully: with all 8 MZB legs covered, 11 of 18
 * photos landed on whichever single leg was left uncovered.
 *
 * The real intent behind the rule is preserved by ORDER, not exclusion:
 * polygon containment runs first, so a photo inside a corridor is always
 * attributed by that corridor and never re-derived by projection. The
 * projection fallback is only ever reached by photos outside every
 * corridor, and for those the governing invariant is: a photo must never
 * be attributed to a leg further away than the geometrically nearest leg.
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
    // No-GPS / malformed coordinates: a photo whose EXIF carried no
    // position (or an unparseable one) reaches the marker list with a
    // non-finite lng/lat. Bail out explicitly instead of letting NaN
    // flow into turf — `booleanPointInPolygon` on a NaN point throws
    // (logged once per corridor, noise), and NaN comparisons silently
    // evaluate false in every "is this closer" test below, so the point
    // would fall through to `null` anyway but by accident rather than
    // by contract. Answer sheet shows a blank cell, which is correct:
    // an unpositioned photo belongs to no leg.
    if (!Number.isFinite(m.lng) || !Number.isFinite(m.lat)) { out[m.id] = null; continue }

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
    // available). Project the marker onto EVERY adjacent-waypoint leg,
    // pick the leg with smallest perpendicular distance, attribute to
    // its PRECEDING waypoint. Every leg, covered or not — a photo that
    // overshoots its own corridor by a few dozen metres is still on that
    // leg (see the `CoveredLegKey` doc-comment).
    //
    // Handles the dashed/scenic-leg gap case
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
 * Width (kilometres) within which two legs count as "the same distance"
 * from the marker, so the `coveredLegs` preference may pick between them.
 *
 * 1 cm. Wide enough to absorb turf's own numerical noise — measured:
 * `pointToLineDistance` for a marker that clamps onto a vertex SHARED by
 * two adjacent legs returns values ~0.2 mm apart depending on which way
 * the segment runs from that vertex, though geometrically the marker is
 * the same distance from both. Narrow enough to be meaningless geographically: a good
 * civilian GPS fix is ±5 m, so a 1 cm band can never mask a real
 * difference between two legs and the coverage preference can never
 * override actual geometry. Anything materially wider would re-open the
 * defect the `CoveredLegKey` comment documents.
 */
const LEG_TIE_EPSILON_KM = 1e-5

/**
 * Project the marker onto every adjacent leg `waypoints[i] → waypoints[i+1]`,
 * pick the leg with smallest perpendicular distance, and return that leg's
 * PRECEDING waypoint as the match. Returns null when there is no usable leg
 * or the winner is beyond `NEAREST_CORRIDOR_MAX_METERS` — "no attribution"
 * beats a spurious one on the answer sheet.
 *
 * The guaranteed floor is the invariant that makes this function correct:
 * the returned leg is never further from the marker than the geometrically
 * nearest leg. `coveredLegs` is consulted ONLY to settle exact ties (see
 * `CoveredLegKey` above for why it must never exclude a leg again). When
 * `coveredLegs` is undefined or empty every leg is simply equally eligible,
 * which is also what unit tests that exercise pure projection geometry get.
 *
 * `pointToLineDistance` measures perpendicular distance to the segment
 * (clamped at the endpoints), which is exactly the "which leg is the marker
 * on" question we want to answer — and the clamping is what gives sensible
 * answers for photos taken before SP (they clamp onto SP, so the SP→TP1 leg
 * wins) or after FP (they clamp onto FP, so the TPn→FP leg wins).
 */
function matchByLegProjection(
  m: PointForMatching,
  waypoints: ReadonlyArray<RouteWaypoint>,
  coveredLegs?: ReadonlySet<string>,
): CorridorMatch | null {
  let bestIdx = -1
  let bestKm = Infinity
  // Coverage of the current best leg. Seeded `true` so the very first
  // candidate always wins outright regardless of its own coverage.
  let bestCovered = true
  const pt = turfPoint([m.lng, m.lat])
  for (let i = 0; i < waypoints.length - 1; i++) {
    const fromName = waypoints[i].name
    const toName = waypoints[i + 1].name
    const a = waypoints[i].coord
    const b = waypoints[i + 1].coord
    let km: number
    try {
      if (a[0] === b[0] && a[1] === b[1]) {
        // Zero-length leg: two consecutive waypoints share a coordinate
        // (duplicate point in the KML, or an FP authored on top of the SP).
        // `turfLineString` accepts it but the projection of a point onto a
        // degenerate segment is undefined — measure to the single point
        // instead. Such a leg can only ever tie, never beat, a real leg
        // through the same coordinate, so keeping it costs nothing and
        // preserves the nearest-overall floor.
        km = calculateDistance([a[0], a[1], 0], [m.lng, m.lat, 0]) / 1000
      } else {
        const seg = turfLineString([[a[0], a[1]], [b[0], b[1]]])
        km = pointToLineDistance(pt, seg, { units: 'kilometers' })
      }
    } catch (err) {
      console.error('[matchPointsToCorridors] leg projection failed for', fromName, '→', toName, err)
      continue
    }
    if (!Number.isFinite(km)) continue
    const covered = !!coveredLegs?.has(legKey(fromName, toName))
    // Strictly nearer wins. Otherwise, on an exact tie, an uncovered
    // (scenic) leg takes precedence over a covered one — a marker at equal
    // distance from both has already failed the covered leg's polygon test,
    // so the scenic leg is the better explanation.
    const strictlyNearer = km < bestKm - LEG_TIE_EPSILON_KM
    const tiedButUncovered = Math.abs(km - bestKm) <= LEG_TIE_EPSILON_KM && bestCovered && !covered
    if (strictlyNearer || tiedButUncovered) {
      bestKm = Math.min(km, bestKm)
      bestIdx = i
      bestCovered = covered
    }
  }
  if (bestIdx < 0) return null
  if (bestKm * 1000 > NEAREST_CORRIDOR_MAX_METERS) return null
  const leading = waypoints[bestIdx]
  return { startName: leading.name, startCoord: leading.coord }
}

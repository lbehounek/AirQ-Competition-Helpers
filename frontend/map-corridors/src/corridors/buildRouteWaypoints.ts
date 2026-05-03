import type { RouteWaypoint } from './matchPoints'

/**
 * Build the ordered route-waypoint list (SP, TP1, TP2, …, TPn, FP) used by
 * the leg-projection fallback in `matchPointsToCorridors` (feedback
 * 2026-05-03). Extracted from `App.tsx` so the ordering rule and the
 * NaN-coord filter are unit-testable without mounting the React tree.
 *
 * Input is whatever shape `session.exactPoints` carries — typically a
 * GeoJSON `FeatureCollection`, but the call site historically casts it
 * through `as any` so we accept `unknown` and defensively pull out the
 * `features` array.
 *
 * Filters dropped on each feature:
 *   • `properties.role` must be `'exact'`
 *   • `properties.name` must be a non-empty string
 *   • `geometry.coordinates[0..1]` must coerce to finite numbers — round-5
 *     fix: `Number("abc")` → NaN was previously pushed straight through to
 *     `pointToLineDistance`, which propagates NaN silently and excluded the
 *     bad leg from leg-projection without any signal to the user. With the
 *     filter we drop the malformed waypoint and `console.warn` so the
 *     issue is visible during a KML import that has bad coords.
 *
 * Sort: SP first, FP last, TPs sorted numerically in between (so "TP10"
 * sorts after "TP9", not lex-sorted). Names that don't fit the pattern
 * (rare authoring quirk) fall after the numeric block — leg projection
 * skips unknown adjacency anyway because perpendicular distances will be
 * larger than to the real legs.
 */
export function buildRouteWaypoints(exactPoints: unknown): RouteWaypoint[] {
  const out: RouteWaypoint[] = []
  const features = (exactPoints as { features?: unknown })?.features
  if (!Array.isArray(features)) return out
  for (const f of features) {
    const role = (f as { properties?: { role?: unknown } })?.properties?.role
    const name = (f as { properties?: { name?: unknown } })?.properties?.name
    const coords = (f as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates
    if (role !== 'exact' || typeof name !== 'string' || !name) continue
    if (!Array.isArray(coords) || coords.length < 2) continue
    const lng = Number(coords[0])
    const lat = Number(coords[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      console.warn('[buildRouteWaypoints] dropping waypoint with non-finite coords:', name, coords)
      continue
    }
    out.push({ name, coord: [lng, lat] })
  }
  const tpNum = (s: string) => {
    const m = s.match(/(\d+)/)
    return m ? parseInt(m[1], 10) : NaN
  }
  out.sort((a, b) => {
    if (a.name === b.name) return 0
    if (a.name === 'SP') return -1
    if (b.name === 'SP') return 1
    if (a.name === 'FP') return 1
    if (b.name === 'FP') return -1
    const an = tpNum(a.name)
    const bn = tpNum(b.name)
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
    return a.name.localeCompare(b.name)
  })
  return out
}

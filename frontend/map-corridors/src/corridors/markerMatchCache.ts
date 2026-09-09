// Incremental wrapper around corridor matching (WP2f).
//
// WHY: App re-matches EVERY marker against the corridor polygons whenever the
// `markers` array identity changes — and it changes on every flag toggle,
// label edit and rename, none of which move a point. Matching is turf work
// (pointInPolygon per corridor + a nearestPointOnLine leg projection), measured
// at ~11 ms for 120 markers × 20 corridors on a dev machine and several times
// that on the target laptops. Caching per point makes those edits free and
// reduces a drag-end — the core workflow — to re-matching one marker.

import type { CorridorMatch, PointForMatching } from './matchPoints'

/** The matching function App hands in — its own `useCallback` over the corridor set. */
export type MatchFn = (pts: ReadonlyArray<PointForMatching>) => Record<string, CorridorMatch | null>

type Entry = { lng: number; lat: number; match: CorridorMatch | null }

// Keyed by the MATCHER's identity, not by a corridor signature. App's
// `matchPointsToCorridors` is a useCallback over (corridorPolygons,
// routeWaypoints, coveredLegs), so a changed corridor set IS a new function —
// which starts a fresh cache and lets the old one be collected along with the
// old closure. A WeakMap at module scope (rather than a ref) means nothing here
// reads mutable state during render, keeping the react-hooks `refs` rule happy
// without an eslint-disable.
//
// The inner map is keyed by CALL SITE, because one matcher serves several
// independent point sets: App passes the same `matchPointsToCorridors` for
// `markers` and for `groundMarkers`. With a single map per matcher each call
// rebuilt the cache from its own input alone, so the two sites wiped each
// other — every ground-marker edit forced a full re-match of all photo markers
// on the next photo edit, which is exactly the pass this cache exists to skip.
const cacheByMatcher = new WeakMap<MatchFn, Map<string, Map<string, Entry>>>()

/**
 * Corridor-match a set of points, calling `matchFn` only for the ones whose
 * (id, lng, lat) differ from the previous call with the SAME `matchFn` AND the
 * same `siteKey`.
 *
 * `siteKey` names the caller's own point set (e.g. `'photo-markers'` vs
 * `'ground-markers'`). It is required rather than optional so a new call site
 * cannot silently share — and therefore clobber — another site's cache.
 *
 * Returns exactly what `matchFn(pts)` would: a record of id → match (or null),
 * with one key per point in `pts`. When ids repeat, the last one wins — same as
 * the underlying matcher, which builds its output the same way.
 *
 * Edge cases: the cache is rebuilt from the current ids on every call, so
 * deleted ids do not linger and a re-added id is re-matched. A `null` match is
 * cached like any other result. Coordinates are compared with `===`, so a NaN
 * position is re-matched every call — harmless, since the matcher returns null
 * for it anyway. An empty input returns `{}` without calling `matchFn` (and
 * empties that site's cache, leaving other sites untouched).
 */
export function matchPointsIncremental(
  matchFn: MatchFn,
  pts: ReadonlyArray<PointForMatching>,
  siteKey: string,
): Record<string, CorridorMatch | null> {
  let bySite = cacheByMatcher.get(matchFn)
  if (!bySite) {
    bySite = new Map<string, Map<string, Entry>>()
    cacheByMatcher.set(matchFn, bySite)
  }
  const prev = bySite.get(siteKey)
  const next = new Map<string, Entry>()
  const stale: PointForMatching[] = []

  for (const p of pts) {
    const e = prev?.get(p.id)
    if (e && e.lng === p.lng && e.lat === p.lat) next.set(p.id, e)
    // Copied rather than kept by reference: `pts` entries are full PhotoMarker
    // objects, and holding one alive in the cache would retain the whole marker.
    else stale.push({ id: p.id, lng: p.lng, lat: p.lat })
  }

  if (stale.length > 0) {
    const fresh = matchFn(stale)
    for (const s of stale) next.set(s.id, { lng: s.lng, lat: s.lat, match: fresh[s.id] ?? null })
  }
  bySite.set(siteKey, next)

  const out: Record<string, CorridorMatch | null> = {}
  for (const p of pts) out[p.id] = next.get(p.id)!.match
  return out
}

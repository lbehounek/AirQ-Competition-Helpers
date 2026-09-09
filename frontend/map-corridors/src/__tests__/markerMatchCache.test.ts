// The per-point corridor-match cache (WP2f). Every case uses its OWN matchFn:
// the cache is module-level and keyed by matcher identity, so a shared function
// would leak state between cases (and that isolation is itself case 5).
//
// The second key is the CALL SITE. App drives two point sets (photo markers and
// ground markers) through one matcher, so the "two sets, one matcher" case below
// mirrors that call order — it is the pattern the single-map cache thrashed.

import { describe, expect, it, vi } from 'vitest'
import { matchPointsIncremental, type MatchFn } from '../corridors/markerMatchCache'
import type { PointForMatching } from '../corridors/matchPoints'

/** A matcher that encodes each point's longitude into its result, so a stale
 *  cache entry is visible in the output rather than merely uncounted. */
function makeMatcher() {
  return vi.fn<MatchFn>(pts =>
    Object.fromEntries(pts.map(p => [p.id, { startName: `S${p.lng}` }])),
  )
}

const P: readonly PointForMatching[] = [
  { id: 'a', lng: 1, lat: 10 },
  { id: 'b', lng: 2, lat: 20 },
  { id: 'c', lng: 3, lat: 30 },
]

/** The disjoint second set, standing in for App's ground markers (FAI signs). */
const G: readonly PointForMatching[] = [
  { id: 'g1', lng: 4, lat: 40 },
  { id: 'g2', lng: 5, lat: 50 },
]

// Site keys are arbitrary strings; these mirror App's two call sites.
const PHOTO = 'photo-markers'
const GROUND = 'ground-markers'

describe('matchPointsIncremental', () => {
  it('matches everything on the first call and returns what matchFn would', () => {
    const matchFn = makeMatcher()
    const out = matchPointsIncremental(matchFn, P, PHOTO)
    expect(matchFn).toHaveBeenCalledTimes(1)
    expect(matchFn.mock.calls[0][0].map(p => p.id)).toEqual(['a', 'b', 'c'])
    expect(out).toEqual({ a: { startName: 'S1' }, b: { startName: 'S2' }, c: { startName: 'S3' } })
  })

  it('does no turf work when only non-positional fields changed', () => {
    // The common case: a flag toggle / label / rename mints new marker objects
    // at the same coordinates.
    const matchFn = makeMatcher()
    const first = matchPointsIncremental(matchFn, P, PHOTO)
    const relabelled = P.map(p => ({ ...p, flag: 'reject' as const, label: 'A' }))
    const second = matchPointsIncremental(matchFn, relabelled, PHOTO)
    expect(matchFn).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('re-matches only the point that moved (drag-end)', () => {
    const matchFn = makeMatcher()
    matchPointsIncremental(matchFn, P, PHOTO)
    const moved = P.map(p => (p.id === 'b' ? { ...p, lng: p.lng + 1e-9 } : p))
    const out = matchPointsIncremental(matchFn, moved, PHOTO)

    expect(matchFn).toHaveBeenCalledTimes(2)
    expect(matchFn.mock.calls[1][0]).toEqual([{ id: 'b', lng: 2 + 1e-9, lat: 20 }])
    expect(out.b).toEqual({ startName: `S${2 + 1e-9}` })
    // The untouched points keep their cached matches.
    expect(out.a).toEqual({ startName: 'S1' })
    expect(out.c).toEqual({ startName: 'S3' })
  })

  it('drops removed ids without re-matching, and re-matches one that comes back', () => {
    const matchFn = makeMatcher()
    matchPointsIncremental(matchFn, P, PHOTO)

    const withoutB = P.filter(p => p.id !== 'b')
    const out = matchPointsIncremental(matchFn, withoutB, PHOTO)
    expect(matchFn).toHaveBeenCalledTimes(1)
    expect(Object.keys(out)).toEqual(['a', 'c'])

    // 'b' is gone from the cache, so re-adding it costs exactly one match.
    matchPointsIncremental(matchFn, P, PHOTO)
    expect(matchFn).toHaveBeenCalledTimes(2)
    expect(matchFn.mock.calls[1][0].map(p => p.id)).toEqual(['b'])
  })

  it('keeps a separate cache per matcher identity (a changed corridor set)', () => {
    const first = makeMatcher()
    matchPointsIncremental(first, P, PHOTO)
    const second = makeMatcher()
    matchPointsIncremental(second, P, PHOTO)
    expect(second).toHaveBeenCalledTimes(1)
    expect(second.mock.calls[0][0].map(p => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns {} for an empty input without calling matchFn', () => {
    const matchFn = makeMatcher()
    expect(matchPointsIncremental(matchFn, [], PHOTO)).toEqual({})
    expect(matchFn).not.toHaveBeenCalled()
  })

  it('caches a null match (a point outside every corridor)', () => {
    const matchFn = vi.fn<MatchFn>(pts => Object.fromEntries(pts.map(p => [p.id, null])))
    expect(matchPointsIncremental(matchFn, P, PHOTO)).toEqual({ a: null, b: null, c: null })
    expect(matchPointsIncremental(matchFn, P.map(p => ({ ...p })), PHOTO)).toEqual({ a: null, b: null, c: null })
    expect(matchFn).toHaveBeenCalledTimes(1)
  })

  it('treats a missing key in the matcher output as null', () => {
    // Defensive: the matcher is expected to key every point, but a partial
    // record must not surface `undefined` where callers expect `| null`.
    const matchFn = vi.fn<MatchFn>(() => ({}))
    expect(matchPointsIncremental(matchFn, [P[0]], PHOTO)).toEqual({ a: null })
  })

  it('keeps independent caches for two point sets that share one matcher', () => {
    // App's exact call order: `markers` and `groundMarkers` both go through the
    // SAME `matchPointsToCorridors` useCallback (App.tsx). With one cache per
    // matcher the second call rebuilt the map from its own input, so each site
    // wiped the other and the next edit re-matched everything.
    const matchFn = makeMatcher()
    matchPointsIncremental(matchFn, P, PHOTO)
    matchPointsIncremental(matchFn, G, GROUND)
    expect(matchFn).toHaveBeenCalledTimes(2)

    // A flag toggle on the photo markers: new objects, same coordinates.
    const out = matchPointsIncremental(matchFn, P.map(p => ({ ...p })), PHOTO)
    expect(matchFn).toHaveBeenCalledTimes(2)
    expect(out).toEqual({ a: { startName: 'S1' }, b: { startName: 'S2' }, c: { startName: 'S3' } })

    // …and the ground pass is still warm too, so alternating stays free.
    expect(matchPointsIncremental(matchFn, G.map(g => ({ ...g })), GROUND))
      .toEqual({ g1: { startName: 'S4' }, g2: { startName: 'S5' } })
    expect(matchFn).toHaveBeenCalledTimes(2)
  })

  it('does not let one site\'s empty input evict another site\'s cache', () => {
    // The mount case: a session with photos but no FAI signs calls the ground
    // site with `[]`. That must not cost the photo site its entries.
    const matchFn = makeMatcher()
    matchPointsIncremental(matchFn, P, PHOTO)
    expect(matchPointsIncremental(matchFn, [], GROUND)).toEqual({})
    matchPointsIncremental(matchFn, P.map(p => ({ ...p })), PHOTO)
    expect(matchFn).toHaveBeenCalledTimes(1)
  })
})

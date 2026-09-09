import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  matchPointsToCorridors,
  legKey,
  NEAREST_CORRIDOR_MAX_METERS,
  type CorridorPolygon,
} from '../corridors/matchPoints'
import { extractStartName } from '../corridors/extractStartName'

// A unit-sized square polygon centered at (lng, lat).
function squareCorridor(
  lng: number,
  lat: number,
  halfWidth: number,
  startName: string,
  startCoord: [number, number] = [lng, lat],
  name = startName,
): CorridorPolygon {
  const ring: [number, number][] = [
    [lng - halfWidth, lat - halfWidth],
    [lng + halfWidth, lat - halfWidth],
    [lng + halfWidth, lat + halfWidth],
    [lng - halfWidth, lat + halfWidth],
    [lng - halfWidth, lat - halfWidth],
  ]
  return {
    name,
    ring,
    bbox: [lng - halfWidth, lat - halfWidth, lng + halfWidth, lat + halfWidth],
    startName,
    startCoord,
  }
}

describe('matchPointsToCorridors', () => {
  it('matches a point inside a polygon to that corridor (containment wins)', () => {
    const corridors = [
      squareCorridor(14.0, 50.0, 0.05, 'SP'),
      squareCorridor(15.0, 50.0, 0.05, 'TP1'),
    ]
    const out = matchPointsToCorridors([{ id: 'a', lng: 14.01, lat: 50.01 }], corridors)
    expect(out.a?.startName).toBe('SP')
  })

  // Regression for the "from following point" rally feedback (2026-04-26).
  // Verifies the FULL chain: extractStartName parses the production-shaped
  // corridor name into the preceding TP, the matcher contains the marker
  // in the right polygon, and the echoed startName matches the parser's
  // output. The original 2026-04-26 test built `startName: 'TP1'` by hand
  // and only verified the matcher's pass-through — bypassing the actual
  // parser the bug lived in. This version runs every corridor name
  // through `extractStartName` so a regression in the parser would surface
  // here too.
  it('attributes a marker inside the TP1→TP2 corridor to TP1 (preceding), not TP2 (following)', () => {
    // Build corridor objects the way `App.tsx` does in production: the
    // segment name is parsed by `extractStartName` to derive the
    // preceding-TP startName. NO hand-fabricated startName — the test
    // exercises the real parser.
    const buildCorridor = (
      lng: number,
      lat: number,
      halfWidth: number,
      startCoord: [number, number],
      name: string,
    ) => squareCorridor(lng, lat, halfWidth, extractStartName(name), startCoord, name)

    const corridors = [
      buildCorridor(14.0, 50.0, 0.05, [14.0, 50.0], '5NM-after-SP→TP1'),
      // Corridor BETWEEN TP1 and TP2: name follows the preciseCorridor.ts
      // template (`{tpAfterNm}NM-after-{prevTP}→{nextTP}`). startName is
      // derived by the parser, NOT by the test, so a parser regression
      // would propagate to a matcher-result regression and fail here.
      buildCorridor(15.0, 50.0, 0.05, [14.95, 50.0], '1NM-after-TP1→TP2'),
      buildCorridor(16.0, 50.0, 0.05, [16.0, 50.0], '1NM-after-TP2→FP'),
    ]
    // Marker placed roughly mid-leg between TP1 and TP2 — clearly inside
    // the middle corridor's polygon.
    const out = matchPointsToCorridors([{ id: 'enroute', lng: 15.0, lat: 50.0 }], corridors)
    expect(out.enroute?.startName).toBe('TP1')
    expect(out.enroute?.startCoord).toEqual([14.95, 50.0])
  })

  it('returns null for containment AND empty corridor list', () => {
    const out = matchPointsToCorridors([{ id: 'a', lng: 14.0, lat: 50.0 }], [])
    expect(out.a).toBeNull()
  })

  it('falls back to the nearest startCoord when no polygon contains the point', () => {
    const corridors = [
      squareCorridor(14.0, 50.0, 0.05, 'SP'),
      squareCorridor(15.0, 50.0, 0.05, 'TP1'),
    ]
    // Far outside every polygon but closer to TP1
    const out = matchPointsToCorridors([{ id: 'far', lng: 14.95, lat: 50.0 }], corridors)
    expect(out.far?.startName).toBe('TP1')
  })

  // Regression for the dashed/scenic-leg gap (feedback 2026-05-03).
  // When the corridor between TPn and TPn+1 is dropped because the leg
  // is a chain of dashed connectors, markers in the gap have no polygon
  // match. The legacy nearest-startCoord fallback locks onto whichever
  // endpoint is geographically closer — usually the FOLLOWING TP — and
  // the answer sheet shows the wrong "Od TP". The leg-projection
  // fallback fixes this by attributing markers to the leg they actually
  // lie on, regardless of which endpoint they're closer to.
  it('attributes a marker on a missing-corridor leg to the PRECEDING waypoint', () => {
    // Only TP7→TP8 and TP9→TP10 corridors exist; TP8→TP9 is the scenic
    // leg, dropped by the dashed-connector logic. The marker sits
    // between TP8 and TP9 but is geographically closer to TP9.
    const corridors = [
      squareCorridor(14.0, 50.0, 0.001, 'TP7', [14.0, 50.0], '1NM-after-TP7→TP8'),
      squareCorridor(16.0, 50.0, 0.001, 'TP9', [16.0, 50.0], '1NM-after-TP9→TP10'),
    ]
    const waypoints = [
      { name: 'TP7', coord: [14.0, 50.0] as [number, number] },
      { name: 'TP8', coord: [14.5, 50.0] as [number, number] },
      { name: 'TP9', coord: [16.0, 50.0] as [number, number] },
      { name: 'TP10', coord: [17.0, 50.0] as [number, number] },
    ]
    // Covered legs: TP7→TP8 and TP9→TP10. The TP8→TP9 leg is the
    // scenic leg with no corridor — leg-projection can pick it.
    const covered = new Set<string>([legKey('TP7', 'TP8'), legKey('TP9', 'TP10')])
    // Marker at lng=15.4, slightly off the leg axis. It's closer to TP9
    // (15.4 → 16.0 is 0.6° lng) than to TP8 (15.4 → 14.5 is 0.9° lng),
    // so the legacy nearest-startCoord fallback would pick TP9. Leg
    // projection attributes it to TP8 (preceding waypoint of the
    // TP8→TP9 leg the marker is actually on).
    const out = matchPointsToCorridors(
      [{ id: 'scenic', lng: 15.4, lat: 50.001 }],
      corridors,
      waypoints,
      covered,
    )
    expect(out.scenic?.startName).toBe('TP8')
  })

  // BEHAVIOUR CHANGE, deliberate — this test previously asserted the
  // opposite (that `coveredLegs` made a leg unreachable), which is the
  // defect measured on the real MZB 2026 course: 6 of 18 en-route photos
  // attributed to the wrong turning point, by up to 25.9 km. A rally
  // corridor is 300 m left + 300 m right; a photo that misses it by 42 m
  // is still unambiguously ON that leg, but the hard exclusion forbade
  // that leg for good and handed the photo to the nearest leg that
  // happened to have NO corridor — 10-26 km away. The rule it encoded
  // ("outside corridor → nearest leg WITHOUT a corridor") is honoured by
  // ORDER instead: polygon containment runs first, so anything inside a
  // corridor is still attributed by that corridor.
  it('a marker that overshoots its own corridor still resolves to that leg (no hard exclusion)', () => {
    const waypoints = [
      { name: 'TP7', coord: [14.0, 50.0] as [number, number] },
      { name: 'TP8', coord: [15.0, 50.0] as [number, number] },
      { name: 'TP9', coord: [17.0, 50.0] as [number, number] },
    ]
    // TP7→TP8 is covered (has corridor); TP8→TP9 is the scenic leg.
    // Polygon is intentionally tiny so the marker is NOT inside it,
    // forcing the fallback chain — the synthetic twin of MZB's s2,7.
    const corridors = [
      squareCorridor(14.5, 50.0, 0.001, 'TP7', [14.0, 50.0], '1NM-after-TP7→TP8'),
    ]
    const covered = new Set<string>([legKey('TP7', 'TP8')])
    // Marker at lng=14.7 sits on the TP7→TP8 leg axis (perpendicular
    // distance ~5.5 km at lat 50.05) and far off the TP8→TP9 axis. It
    // must be attributed to TP7 — the preceding waypoint of the leg it
    // is actually on — not to TP8 just because TP8→TP9 has no corridor.
    const out = matchPointsToCorridors(
      [{ id: 'overshoot', lng: 14.7, lat: 50.05 }],
      corridors,
      waypoints,
      covered,
    )
    expect(out.overshoot?.startName).toBe('TP7')
  })

  // The invariant, stated directly: coverage may reorder equals, never
  // reach past geometry. Mirrors MZB's s2,7/s2,9 at toy scale — the
  // covered leg is 100x closer than the uncovered one.
  it('coveredLegs never makes a leg unreachable — the nearest leg always wins', () => {
    const waypoints = [
      { name: 'TP1', coord: [14.0, 50.0] as [number, number] },
      { name: 'TP2', coord: [15.0, 50.0] as [number, number] },
      { name: 'TP3', coord: [15.0, 50.3] as [number, number] },
    ]
    // Every leg covered except TP2→TP3, which runs due north away from
    // the marker. Under the old exclusion the marker was forced onto it.
    const covered = new Set<string>([legKey('TP1', 'TP2')])
    const out = matchPointsToCorridors(
      [{ id: 'onLeg', lng: 14.2, lat: 50.0005 }],
      [],
      waypoints,
      covered,
    )
    expect(out.onLeg?.startName).toBe('TP1')
  })

  it('without waypoints, retains the legacy nearest-startCoord fallback', () => {
    // Same corridor setup, no waypoints arg — verifies callers that
    // don't supply ordered waypoints still get the old behaviour. The
    // old fallback picks TP9 because its startCoord is closer.
    const corridors = [
      squareCorridor(14.0, 50.0, 0.001, 'TP7'),
      squareCorridor(16.0, 50.0, 0.001, 'TP9'),
    ]
    const out = matchPointsToCorridors(
      [{ id: 'scenic', lng: 15.4, lat: 50.001 }],
      corridors,
    )
    expect(out.scenic?.startName).toBe('TP9')
  })

  it('without coveredLegs, leg-projection treats every leg as eligible', () => {
    // Backward-compat: tests that don't care about coverage filtering
    // can omit `coveredLegs` and the projector keeps its pre-filter
    // behaviour (every leg considered).
    const waypoints = [
      { name: 'TP1', coord: [14.0, 50.0] as [number, number] },
      { name: 'TP2', coord: [15.0, 50.0] as [number, number] },
      { name: 'TP3', coord: [16.0, 50.0] as [number, number] },
    ]
    const out = matchPointsToCorridors(
      [{ id: 'p', lng: 14.5, lat: 50.0 }],
      [],
      waypoints,
    )
    // Marker mid-leg between TP1 and TP2 — projects onto TP1→TP2,
    // attributed to TP1.
    expect(out.p?.startName).toBe('TP1')
  })

  // Round-5 follow-up: the leg-projection fallback's 50 km cap was
  // untested. Without this guard, a marker far from every scenic leg
  // would silently snap to whichever leg happened to be closest,
  // producing a wildly wrong "Od TP" answer-sheet entry. The cap
  // shares NEAREST_CORRIDOR_MAX_METERS with the legacy nearest-startCoord
  // fallback so both branches honour the same "no attribution" rule.
  it('returns null when the marker is farther than NEAREST_CORRIDOR_MAX_METERS from every leg', () => {
    // Single uncovered leg from (14, 50) to (15, 50), ~71 km long at 50°N.
    // Place the marker > 50 km north of the leg (50.5°N → 0.5° lat = ~55 km
    // perpendicular distance, beyond the cap).
    const waypoints = [
      { name: 'TP1', coord: [14.0, 50.0] as [number, number] },
      { name: 'TP2', coord: [15.0, 50.0] as [number, number] },
    ]
    const out = matchPointsToCorridors(
      [{ id: 'far', lng: 14.5, lat: 50.5 }],
      [],
      waypoints,
    )
    // Sanity-pin the cap against the exported constant so a future change
    // to NEAREST_CORRIDOR_MAX_METERS makes this test surface intentionally.
    expect(NEAREST_CORRIDOR_MAX_METERS).toBe(50_000)
    expect(out.far).toBeNull()
  })

  // BEHAVIOUR CHANGE, deliberate — the twin of the test above. This one
  // used to assert that with EVERY leg covered the projection branch
  // gives up and the legacy nearest-startCoord branch answers instead.
  // That fall-through is precisely what made the defect scale with
  // success: the more corridors the track repair managed to build, the
  // more photos were excluded from their own leg (on MZB, 11 of 18 wrong
  // once all 8 legs were covered, versus 6 with 3 legs uncovered).
  // Projection now answers from the leg the marker is on, whatever its
  // coverage; the legacy branch remains for callers with no waypoints.
  it('resolves by leg projection even when every leg is covered', () => {
    const waypoints = [
      { name: 'TP1', coord: [14.0, 50.0] as [number, number] },
      { name: 'TP2', coord: [15.0, 50.0] as [number, number] },
    ]
    // Polygons are intentionally tiny (0.001°) so the marker at lng=14.95
    // is OUTSIDE every polygon, forcing the fallback chain. The marker is
    // dead on the TP1→TP2 axis, so TP1 (the leg's preceding waypoint) is
    // the right answer — the legacy branch would have said TP2 merely
    // because its startCoord is 5 km nearer than TP1's.
    const corridors = [
      squareCorridor(14.5, 50.0, 0.001, 'TP1', [14.0, 50.0], '1NM-after-TP1→TP2'),
      squareCorridor(15.0, 50.0, 0.001, 'TP2', [15.0, 50.0], 'TP2'),
    ]
    const covered = new Set<string>([legKey('TP1', 'TP2')])
    const out = matchPointsToCorridors(
      [{ id: 'fallthrough', lng: 14.95, lat: 50.0 }],
      corridors,
      waypoints,
      covered,
    )
    expect(out.fallthrough?.startName).toBe('TP1')
  })

  // The legacy branch is still reachable — it is what callers without
  // ordered waypoints get, and what a route of fewer than two waypoints
  // degrades to. Pin it so the projection rewrite above cannot quietly
  // delete a code path that App.tsx relies on before a KML is loaded.
  it('a single-waypoint route cannot form a leg and falls through to nearest-startCoord', () => {
    const corridors = [
      squareCorridor(14.5, 50.0, 0.001, 'TP1', [14.0, 50.0], '1NM-after-TP1→TP2'),
      squareCorridor(15.0, 50.0, 0.001, 'TP2', [15.0, 50.0], 'TP2'),
    ]
    const out = matchPointsToCorridors(
      [{ id: 'p', lng: 14.95, lat: 50.0 }],
      corridors,
      [{ name: 'TP1', coord: [14.0, 50.0] }],
      new Set<string>([legKey('TP1', 'TP2')]),
    )
    expect(out.p?.startName).toBe('TP2')
  })

  describe('coverage as a tie-break only', () => {
    // Symmetric geometry: the marker is exactly equidistant from two
    // legs that fan out from the same point. Coverage decides — the
    // uncovered (scenic) leg wins, because a marker inside the covered
    // leg's corridor would already have been answered by containment.
    const forkWaypoints = [
      { name: 'A', coord: [14.0, 50.0] as [number, number] },
      { name: 'B', coord: [14.0, 50.1] as [number, number] },
      { name: 'C', coord: [14.0, 50.2] as [number, number] },
    ]

    it('prefers the uncovered leg when two legs are exactly equidistant', () => {
      // The marker sits due east of the shared waypoint B, so its
      // perpendicular distance to A→B and to B→C is the same value
      // (both clamp to B). A→B is covered, B→C is not.
      const out = matchPointsToCorridors(
        [{ id: 'tie', lng: 14.05, lat: 50.1 }],
        [],
        forkWaypoints,
        new Set<string>([legKey('A', 'B')]),
      )
      expect(out.tie?.startName).toBe('B')
    })

    it('prefers the uncovered leg regardless of leg order', () => {
      // Same tie, opposite coverage: now B→C is covered and A→B is not,
      // so the EARLIER leg must win. Guards against the preference
      // degenerating into "last leg wins" or "first leg wins".
      const out = matchPointsToCorridors(
        [{ id: 'tie', lng: 14.05, lat: 50.1 }],
        [],
        forkWaypoints,
        new Set<string>([legKey('B', 'C')]),
      )
      expect(out.tie?.startName).toBe('A')
    })

    it('with no coverage information an exact tie goes to the earlier leg', () => {
      // Deterministic ordering matters more than which leg is picked:
      // the same course + same photo must always produce the same
      // answer sheet across runs and machines.
      const out = matchPointsToCorridors(
        [{ id: 'tie', lng: 14.05, lat: 50.1 }],
        [],
        forkWaypoints,
      )
      expect(out.tie?.startName).toBe('A')
      const withEmptySet = matchPointsToCorridors(
        [{ id: 'tie', lng: 14.05, lat: 50.1 }],
        [],
        forkWaypoints,
        new Set<string>(),
      )
      expect(withEmptySet.tie?.startName).toBe('A')
    })
  })

  describe('photos outside the SP…FP span', () => {
    const waypoints = [
      { name: 'SP', coord: [14.0, 50.0] as [number, number] },
      { name: 'TP1', coord: [15.0, 50.0] as [number, number] },
      { name: 'FP', coord: [16.0, 50.0] as [number, number] },
    ]

    it('a photo taken before SP belongs to the SP→TP1 leg', () => {
      // Projection clamps at the segment endpoints, so a marker behind
      // SP is nearest to the SP end of the first leg — attributed to SP.
      const out = matchPointsToCorridors(
        [{ id: 'preSP', lng: 13.9, lat: 50.0 }],
        [],
        waypoints,
      )
      expect(out.preSP?.startName).toBe('SP')
    })

    it('a photo taken after FP belongs to the TP1→FP leg', () => {
      const out = matchPointsToCorridors(
        [{ id: 'postFP', lng: 16.1, lat: 50.0 }],
        [],
        waypoints,
      )
      expect(out.postFP?.startName).toBe('TP1')
    })

    it('a photo beyond the 50 km cap before SP gets no attribution', () => {
      // 1° lng at 50° N is ~71 km, so 13.0 is ~71 km behind SP.
      const out = matchPointsToCorridors(
        [{ id: 'wayOff', lng: 13.0, lat: 50.0 }],
        [],
        waypoints,
      )
      expect(out.wayOff).toBeNull()
    })
  })

  describe('degenerate route geometry', () => {
    it('a zero-length leg does not break matching of the real legs', () => {
      // TP2 authored twice at the same coordinate (a duplicated KML
      // point, or an FP dropped on top of a TP). The degenerate TP2→TP2b
      // leg measures point distance and can only tie — never beat — the
      // real leg the marker lies on.
      const waypoints = [
        { name: 'TP1', coord: [14.0, 50.0] as [number, number] },
        { name: 'TP2', coord: [15.0, 50.0] as [number, number] },
        { name: 'TP2b', coord: [15.0, 50.0] as [number, number] },
        { name: 'TP3', coord: [15.0, 50.5] as [number, number] },
      ]
      const out = matchPointsToCorridors(
        [{ id: 'onFirstLeg', lng: 14.5, lat: 50.001 }],
        [],
        waypoints,
      )
      expect(out.onFirstLeg?.startName).toBe('TP1')
    })

    it('a route whose every waypoint shares one coordinate still answers by point distance', () => {
      // Pathological but reachable (a KML where every placemark landed on
      // the same spot). Every leg is degenerate; the marker 11 km north
      // is inside the 50 km cap, so it resolves rather than returning
      // null on a divide-by-zero NaN.
      const waypoints = [
        { name: 'SP', coord: [14.0, 50.0] as [number, number] },
        { name: 'TP1', coord: [14.0, 50.0] as [number, number] },
        { name: 'FP', coord: [14.0, 50.0] as [number, number] },
      ]
      const out = matchPointsToCorridors(
        [{ id: 'p', lng: 14.0, lat: 50.1 }],
        [],
        waypoints,
      )
      expect(out.p?.startName).toBe('SP')
    })

    it('a degenerate route farther than the cap returns null, not a spurious match', () => {
      const waypoints = [
        { name: 'SP', coord: [14.0, 50.0] as [number, number] },
        { name: 'FP', coord: [14.0, 50.0] as [number, number] },
      ]
      const out = matchPointsToCorridors(
        [{ id: 'p', lng: 14.0, lat: 50.6 }],
        [],
        waypoints,
      )
      expect(out.p).toBeNull()
    })
  })

  describe('photos without usable GPS', () => {
    // A photo whose EXIF carried no position reaches the matcher with a
    // non-finite lng/lat. It must produce a blank answer-sheet cell, and
    // must not spray polygon-evaluation errors into the console on the
    // way there (turf throws on a NaN point).
    let err: ReturnType<typeof vi.spyOn>
    beforeEach(() => { err = vi.spyOn(console, 'error').mockImplementation(() => {}) })
    afterEach(() => { err.mockRestore() })

    it('returns null for NaN / Infinity coordinates without touching turf', () => {
      const corridors = [squareCorridor(14.0, 50.0, 0.05, 'SP')]
      const waypoints = [
        { name: 'SP', coord: [14.0, 50.0] as [number, number] },
        { name: 'TP1', coord: [15.0, 50.0] as [number, number] },
      ]
      const out = matchPointsToCorridors(
        [
          { id: 'noGps', lng: NaN, lat: NaN },
          { id: 'halfGps', lng: 14.0, lat: NaN },
          { id: 'infinite', lng: Infinity, lat: 50.0 },
          { id: 'good', lng: 14.01, lat: 50.01 },
        ],
        corridors,
        waypoints,
        new Set<string>([legKey('SP', 'TP1')]),
      )
      expect(out.noGps).toBeNull()
      expect(out.halfGps).toBeNull()
      expect(out.infinite).toBeNull()
      // The positioned photo in the same batch is unaffected.
      expect(out.good?.startName).toBe('SP')
      expect(err).not.toHaveBeenCalled()
    })
  })

  it('lat-aware distance: at 50° N a point 0.05° east-of-TP is closer than 0.05° north-of-SP', () => {
    // Naive Δlng²+Δlat² (degrees) would tie. With cos(50°) ≈ 0.643 scaling on
    // Δlng, the east-of-TP candidate wins because 0.05° lng at 50° N is only
    // ~3.6 km versus 0.05° lat = 5.5 km.
    const corridors = [
      squareCorridor(14.0, 50.0, 0.001, 'SP'),
      squareCorridor(15.0, 50.0, 0.001, 'TP1'),
    ]
    // Point just above SP by 0.05°, and 0.95° east of SP (0.05° east of TP1)
    const out = matchPointsToCorridors([{ id: 'p', lng: 15.05, lat: 50.0 }], corridors)
    expect(out.p?.startName).toBe('TP1')
  })

  it('skips corridors without startCoord in the fallback loop', () => {
    // TP1 at (14.6, 50) is ~28.6 km east of the probed point (14.05, 50),
    // well inside the 50 km fallback cap. SP has no startCoord so it is
    // silently skipped by the fallback loop.
    const withStart = squareCorridor(14.6, 50.0, 0.01, 'TP1')
    const withoutStart: CorridorPolygon = { ...squareCorridor(14.0, 50.0, 0.01, 'SP'), startCoord: undefined }
    const out = matchPointsToCorridors([{ id: 'p', lng: 14.05, lat: 50.0 }], [withStart, withoutStart])
    expect(out.p?.startName).toBe('TP1')
  })

  it('returns null when every corridor lacks startCoord AND no polygon contains the point', () => {
    const c: CorridorPolygon = { ...squareCorridor(14.0, 50.0, 0.01, 'SP'), startCoord: undefined }
    const out = matchPointsToCorridors([{ id: 'p', lng: 20.0, lat: 50.0 }], [c])
    expect(out.p).toBeNull()
  })

  it('bbox-outside fast path keeps nearest-fallback usable (no polygon evaluated)', () => {
    // Both corridors' bboxes exclude the point, so the containment loop
    // never calls booleanPointInPolygon; result comes from the fallback.
    const corridors = [
      squareCorridor(14.0, 50.0, 0.001, 'SP'),
      squareCorridor(15.0, 50.0, 0.001, 'TP1'),
    ]
    const out = matchPointsToCorridors([{ id: 'p', lng: 15.5, lat: 50.0 }], corridors)
    expect(out.p?.startName).toBe('TP1')
  })

  describe('error logging on malformed rings (no silent swallow)', () => {
    let err: ReturnType<typeof vi.spyOn>
    beforeEach(() => { err = vi.spyOn(console, 'error').mockImplementation(() => {}) })
    afterEach(() => { err.mockRestore() })

    it('logs console.error when a ring is too small for turfPolygon to parse', () => {
      // A 2-point ring inside the bbox forces turfPolygon to throw.
      const bad: CorridorPolygon = {
        name: 'bad',
        ring: [[14.0, 50.0], [14.01, 50.01]],
        bbox: [14.0, 50.0, 14.01, 50.01],
        startName: 'SP',
        startCoord: [14.0, 50.0],
      }
      matchPointsToCorridors([{ id: 'p', lng: 14.005, lat: 50.005 }], [bad])
      expect(err).toHaveBeenCalled()
      const firstArgs = err.mock.calls[0]
      expect(firstArgs[0]).toMatch(/matchPointsToCorridors/)
      expect(firstArgs[1]).toBe('SP')
    })

    it('falls back to nearest-start after a ring throws, not silently null', () => {
      const bad: CorridorPolygon = {
        name: 'bad',
        ring: [[14.0, 50.0], [14.01, 50.01]],
        bbox: [13.9, 49.9, 14.1, 50.1],
        startName: 'SP',
        startCoord: [14.0, 50.0],
      }
      const good = squareCorridor(15.0, 50.0, 0.05, 'TP1')
      const out = matchPointsToCorridors(
        [{ id: 'p', lng: 14.0, lat: 50.0 }],
        [bad, good],
      )
      // Containment throws and is logged; fallback picks the nearest startCoord.
      // Both corridors have startCoords; the `bad` one's is right at the point.
      expect(err).toHaveBeenCalled()
      expect(out.p?.startName).toBe('SP')
    })
  })

  it('returns a result for every input point in input order', () => {
    // Three close points (inside / near) plus one wildly far point that
    // exceeds the 50 km fallback cap and should therefore return null.
    const corridors = [squareCorridor(14.0, 50.0, 0.05, 'SP')]
    const out = matchPointsToCorridors(
      [
        { id: 'a', lng: 14.01, lat: 50.01 },
        { id: 'b', lng: 14.02, lat: 50.02 },
        { id: 'far', lng: 20.0, lat: 60.0 },
      ],
      corridors,
    )
    expect(Object.keys(out).sort()).toEqual(['a', 'b', 'far'])
    expect(out.a?.startName).toBe('SP')
    expect(out.b?.startName).toBe('SP')
    expect(out.far).toBeNull()
  })

  describe('50 km sanity cap on the nearest-startCoord fallback', () => {
    it('exposes the cap constant as 50 000 metres', () => {
      expect(NEAREST_CORRIDOR_MAX_METERS).toBe(50_000)
    })

    it('accepts a fallback match 30 km away', () => {
      // Point 30 km due north of SP startCoord (0.27° lat ≈ 30.0 km).
      const corridors = [squareCorridor(14.0, 50.0, 0.001, 'SP')]
      const out = matchPointsToCorridors(
        [{ id: 'p', lng: 14.0, lat: 50.27 }],
        corridors,
      )
      expect(out.p?.startName).toBe('SP')
    })

    it('rejects a fallback match 60 km away — returns null, not a wrong attribution', () => {
      // Point 60 km due north of SP startCoord (0.54° lat ≈ 60.1 km).
      const corridors = [squareCorridor(14.0, 50.0, 0.001, 'SP')]
      const out = matchPointsToCorridors(
        [{ id: 'p', lng: 14.0, lat: 50.54 }],
        corridors,
      )
      expect(out.p).toBeNull()
    })

    it('containing polygon wins regardless of distance — cap only applies to fallback', () => {
      // 200 km × 200 km polygon centered on (14, 50). A marker inside this
      // massive polygon must match even if its center startCoord is >50 km
      // from some other reference — the cap only kicks in for fallback.
      const big = squareCorridor(14.0, 50.0, 1.0, 'SP')
      const out = matchPointsToCorridors(
        [{ id: 'inside', lng: 14.9, lat: 50.9 }],
        [big],
      )
      expect(out.inside?.startName).toBe('SP')
    })
  })
})

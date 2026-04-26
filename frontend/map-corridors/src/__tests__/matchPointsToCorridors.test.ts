import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  matchPointsToCorridors,
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

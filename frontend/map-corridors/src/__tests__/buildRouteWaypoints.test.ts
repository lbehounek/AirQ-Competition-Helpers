import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildRouteWaypoints } from '../corridors/buildRouteWaypoints'

// Minimal GeoJSON-feature shape that satisfies the helper's narrow lookups.
function feature(role: string, name: unknown, coords: unknown) {
  return {
    type: 'Feature',
    properties: { role, name },
    geometry: { type: 'Point', coordinates: coords },
  }
}

describe('buildRouteWaypoints', () => {
  // Silence the NaN-coord warning so test output stays clean. Restored
  // after each test so a real warning in unrelated code still surfaces.
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('returns empty array on null/undefined input', () => {
    expect(buildRouteWaypoints(null)).toEqual([])
    expect(buildRouteWaypoints(undefined)).toEqual([])
    expect(buildRouteWaypoints({})).toEqual([])
  })

  it('returns empty array when features is not an array', () => {
    expect(buildRouteWaypoints({ features: 'not-an-array' })).toEqual([])
    expect(buildRouteWaypoints({ features: 42 })).toEqual([])
  })

  it('returns SP, TP1..TPn, FP in the documented order', () => {
    // Intentionally shuffled input so the sort logic does work.
    const features = [
      feature('exact', 'TP3', [16.0, 50.0]),
      feature('exact', 'FP', [17.0, 50.0]),
      feature('exact', 'TP1', [14.5, 50.0]),
      feature('exact', 'SP', [14.0, 50.0]),
      feature('exact', 'TP2', [15.0, 50.0]),
    ]
    const out = buildRouteWaypoints({ features })
    expect(out.map((w) => w.name)).toEqual(['SP', 'TP1', 'TP2', 'TP3', 'FP'])
    expect(out[0].coord).toEqual([14.0, 50.0])
    expect(out[4].coord).toEqual([17.0, 50.0])
  })

  it('sorts TPs numerically (TP10 after TP9, not lex-sorted)', () => {
    // TP10 sorts AFTER TP9 numerically. A future refactor to plain
    // localeCompare would lex-sort TP10 before TP2 — surface here.
    const features = [
      feature('exact', 'TP10', [16.0, 50.0]),
      feature('exact', 'TP2', [15.0, 50.0]),
      feature('exact', 'TP9', [15.5, 50.0]),
    ]
    const out = buildRouteWaypoints({ features })
    expect(out.map((w) => w.name)).toEqual(['TP2', 'TP9', 'TP10'])
  })

  it('drops features with role !== "exact"', () => {
    const features = [
      feature('start', 'SP', [14.0, 50.0]),
      feature('exact', 'TP1', [15.0, 50.0]),
      feature('photo_marker', 'TPx', [15.5, 50.0]),
      feature('exact', 'FP', [17.0, 50.0]),
    ]
    const out = buildRouteWaypoints({ features })
    expect(out.map((w) => w.name)).toEqual(['TP1', 'FP'])
  })

  it('drops features with non-string or empty name', () => {
    const features = [
      feature('exact', '', [14.0, 50.0]),
      feature('exact', null, [15.0, 50.0]),
      feature('exact', 42, [16.0, 50.0]),
      feature('exact', 'TP1', [17.0, 50.0]),
    ]
    const out = buildRouteWaypoints({ features })
    expect(out.map((w) => w.name)).toEqual(['TP1'])
  })

  it('drops features whose coordinates array has fewer than 2 entries', () => {
    const features = [
      feature('exact', 'SP', [14.0]),
      feature('exact', 'TP1', []),
      feature('exact', 'TP2', null),
      feature('exact', 'TP3', [15.0, 50.0]),
    ]
    const out = buildRouteWaypoints({ features })
    expect(out.map((w) => w.name)).toEqual(['TP3'])
  })

  // Round-5 fix for the silent NaN-attribution bug. A malformed KML with
  // non-numeric coords used to push `[NaN, NaN]` straight to
  // pointToLineDistance, which silently excluded the leg from leg-
  // projection without any user-visible signal. The filter drops the
  // bad waypoint AND warns.
  it('drops features with non-finite coords and emits a console.warn', () => {
    const features = [
      feature('exact', 'SP', ['abc', 50.0]),
      feature('exact', 'TP1', [14.0, NaN]),
      feature('exact', 'TP2', [Infinity, 50.0]),
      feature('exact', 'TP3', [-Infinity, 50.0]),
      feature('exact', 'FP', [17.0, 50.0]),
    ]
    const out = buildRouteWaypoints({ features })
    expect(out.map((w) => w.name)).toEqual(['FP'])
    // One warn per dropped waypoint — verifies the user gets visibility.
    expect(warnSpy).toHaveBeenCalledTimes(4)
  })

  it('coerces numeric-string coords (real-world Number() semantics) — finite is OK', () => {
    // GeoJSON parsers sometimes produce coords as numeric strings. The
    // helper's `Number(coords[0])` accepts those because Number("14.5")
    // is 14.5. Only NaN/Infinity are rejected.
    const features = [
      feature('exact', 'SP', ['14.0', '50.0']),
      feature('exact', 'TP1', ['15.5', '50.0']),
    ]
    const out = buildRouteWaypoints({ features })
    expect(out).toEqual([
      { name: 'SP', coord: [14.0, 50.0] },
      { name: 'TP1', coord: [15.5, 50.0] },
    ])
  })

  it('places non-SP, non-FP, non-numeric names after numeric TPs', () => {
    // "Other names (rare authoring quirk)" — they fall after numeric TPs
    // via localeCompare. This pins the documented behaviour.
    const features = [
      feature('exact', 'TP1', [14.5, 50.0]),
      feature('exact', 'XPoint', [15.0, 50.0]),
      feature('exact', 'SP', [14.0, 50.0]),
    ]
    const out = buildRouteWaypoints({ features })
    expect(out.map((w) => w.name)).toEqual(['SP', 'TP1', 'XPoint'])
  })

  it('returns empty array when no features match', () => {
    const features = [
      feature('photo_marker', 'M1', [14.0, 50.0]),
      feature('ground_marker', 'G1', [15.0, 50.0]),
    ]
    expect(buildRouteWaypoints({ features })).toEqual([])
  })
})

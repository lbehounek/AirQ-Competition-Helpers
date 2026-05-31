import { describe, it, expect, vi, afterAll } from 'vitest'
import { buildMarkerFan, type ProjectionMap } from './useMarkerFan'
import type { PhotoMarker } from '../../types/markers'

// Regression coverage for the tilt white-screen crash (PR #92). When the map is
// pitched, photo markers above the horizon (or behind the camera) project to
// non-finite screen pixels; feeding those into the clusterer and the downstream
// `unproject` makes the LngLat constructor throw. Because the fan runs in a
// useMemo DURING RENDER, an uncaught throw unmounts the React tree → blank app.
// `buildMarkerFan` is the pure projection boundary extracted from the hook so
// both guards can be exercised here with a fake map — no live map, no jsdom.
// The clustering/layout maths themselves live in markerFan.test.ts.

// `safeUnproject` warns once in dev when it swallows an unexpected error —
// silence it so a passing run has clean output.
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
afterAll(() => warnSpy.mockRestore())

function photo(id: string, lng: number, lat = 0): PhotoMarker {
  return { id, lng, lat, name: `${id}.JPG`, photoId: `p-${id}` }
}

function fakeMap(overrides: Partial<ProjectionMap>): ProjectionMap {
  return {
    project: ([lng]) => ({ x: lng, y: 0 }),
    unproject: () => ({ lng: 0, lat: 0 }),
    ...overrides,
  }
}

// a@x0 and b@x5 sit within the 20px default overlap threshold → one fanned group.
const overlappingProject = ([lng]: [number, number]) => ({ x: lng === 10 ? 0 : 5, y: 0 })

describe('buildMarkerFan — projection guards', () => {
  it('fans two overlapping markers and emits finite leader coordinates', () => {
    const map = fakeMap({
      project: overlappingProject,
      unproject: ([x, y]) => ({ lng: x / 100, lat: y / 100 }),
    })
    const res = buildMarkerFan(map, [photo('a', 10), photo('b', 11)])

    expect(res.offsets.size).toBe(2)
    expect(res.leaders.features).toHaveLength(2)
    for (const f of res.leaders.features) {
      for (const [lng, lat] of f.geometry.coordinates) {
        expect(Number.isFinite(lng)).toBe(true)
        expect(Number.isFinite(lat)).toBe(true)
      }
    }
  })

  it('drops a marker whose project() is NaN (above horizon) without throwing', () => {
    // c projects to NaN; a,b stay finite & overlapping. The NaN point must never
    // reach the clusterer.
    const map = fakeMap({
      project: ([lng]) => (lng === 99 ? { x: NaN, y: NaN } : overlappingProject([lng, 0])),
      unproject: ([x, y]) => ({ lng: x / 100, lat: y / 100 }),
    })

    let res!: ReturnType<typeof buildMarkerFan>
    expect(() => { res = buildMarkerFan(map, [photo('a', 10), photo('b', 11), photo('c', 99)]) }).not.toThrow()
    expect(res.offsets.has('c')).toBe(false)
    expect(res.offsets.size).toBe(2)
  })

  it('does not throw when unproject() throws on an above-horizon leader endpoint', () => {
    const map = fakeMap({
      project: overlappingProject,
      unproject: () => { throw new Error('Invalid LngLat object: (NaN, NaN)') },
    })

    let res!: ReturnType<typeof buildMarkerFan>
    expect(() => { res = buildMarkerFan(map, [photo('a', 10), photo('b', 11)]) }).not.toThrow()
    // Markers still fan (offsets are screen-space); only the leader lines drop.
    expect(res.offsets.size).toBe(2)
    expect(res.leaders.features).toHaveLength(0)
  })

  it('drops a leader whose unproject() yields non-finite lng/lat', () => {
    const map = fakeMap({
      project: overlappingProject,
      unproject: () => ({ lng: NaN, lat: NaN }),
    })
    const res = buildMarkerFan(map, [photo('a', 10), photo('b', 11)])

    expect(res.leaders.features).toHaveLength(0)
  })

  it('returns no fan for fewer than two visible markers', () => {
    const res = buildMarkerFan(fakeMap({}), [photo('a', 10)])
    expect(res.offsets.size).toBe(0)
    expect(res.leaders.features).toHaveLength(0)
  })
})

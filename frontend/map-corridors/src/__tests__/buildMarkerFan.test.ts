import { describe, it, expect } from 'vitest'
import { buildMarkerFan, type ProjectionMap } from '../map/photoLayers/useMarkerFan'
import type { PhotoMarker } from '../types/markers'

// Tests the projection boundary `buildMarkerFan` — specifically the cluster
// surface (centroid → lng/lat) and its off-horizon guard. The pure clustering
// maths live in markerFan.test.ts; here we only care that screen-space clusters
// are unprojected safely and dropped (never thrown) when a centroid can't
// resolve, which is the white-screen crash class the hook guards against.

// Minimal PhotoMarker — buildMarkerFan only reads id/lng/lat.
const pm = (id: string, lng: number, lat: number): PhotoMarker =>
  ({ id, lng, lat } as unknown as PhotoMarker)

// A linear fake map: screen px = deg * 10 (and back). `throwAt` lets a test
// simulate an above-the-horizon unproject for a specific screen point.
function fakeMap(throwAt?: [number, number]): ProjectionMap {
  return {
    project: ([lng, lat]) => ({ x: lng * 10, y: lat * 10 }),
    unproject: ([x, y]) => {
      if (throwAt && x === throwAt[0] && y === throwAt[1]) {
        throw new Error('Invalid LngLat object: above the horizon')
      }
      return { lng: x / 10, lat: y / 10 }
    },
  }
}

describe('buildMarkerFan clusters', () => {
  it('surfaces one cluster per fanned group with lng/lat centroid and members', () => {
    // a(100,100) and b(108,100) are 8px apart → one cluster; solo is far away.
    const r = buildMarkerFan(
      fakeMap(),
      [pm('a', 10, 10), pm('b', 10.8, 10), pm('solo', 40, 40)],
    )
    expect(r.clusters).toHaveLength(1)
    expect(r.clusters[0].ids).toHaveLength(2)
    expect([...r.clusters[0].ids].sort()).toEqual(['a', 'b'])
    // Centroid screen point (104,100) unprojects to (10.4, 10).
    expect(r.clusters[0].centroidLngLat.lng).toBeCloseTo(10.4, 5)
    expect(r.clusters[0].centroidLngLat.lat).toBeCloseTo(10, 5)
  })

  it('drops a cluster whose centroid cannot unproject instead of throwing', () => {
    // Centroid of a(100,100)+b(108,100) is (104,100); make that unproject throw.
    const build = () => buildMarkerFan(
      fakeMap([104, 100]),
      [pm('a', 10, 10), pm('b', 10.8, 10)],
    )
    expect(build).not.toThrow()
    expect(build().clusters).toHaveLength(0)
  })

  it('drops a cluster whose centroid unprojects to a non-finite LngLat (no throw)', () => {
    // The other off-horizon shape: `unproject` returns NaN rather than throwing.
    // The centroid guard must still drop it — feeding NaN to a <Marker> blanks
    // the app just as a thrown error would.
    const nanMap: ProjectionMap = {
      project: ([lng, lat]) => ({ x: lng * 10, y: lat * 10 }),
      unproject: ([x, y]) =>
        x === 104 && y === 100 ? { lng: NaN, lat: NaN } : { lng: x / 10, lat: y / 10 },
    }
    const r = buildMarkerFan(nanMap, [pm('a', 10, 10), pm('b', 10.8, 10)])
    expect(r.clusters).toHaveLength(0)
  })
})

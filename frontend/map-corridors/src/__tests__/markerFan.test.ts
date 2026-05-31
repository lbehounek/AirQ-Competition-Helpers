import { describe, it, expect } from 'vitest'
import { clusterByProximity, computeMarkerFan, type ScreenPoint } from '../map/photoLayers/markerFan'

// Pure screen-space maths behind the auto-fan of overlapping photo markers.
// No map needed — points are already projected to pixels.

const sp = (id: string, x: number, y: number): ScreenPoint => ({ id, x, y })

describe('clusterByProximity', () => {
  it('keeps far-apart points in singleton groups', () => {
    const groups = clusterByProximity([sp('a', 0, 0), sp('b', 100, 100)], 20)
    expect(groups.map(g => g.length).sort()).toEqual([1, 1])
  })

  it('groups two points within the threshold', () => {
    const groups = clusterByProximity([sp('a', 0, 0), sp('b', 10, 0)], 20)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })

  it('does not group points exactly beyond the threshold', () => {
    const groups = clusterByProximity([sp('a', 0, 0), sp('b', 21, 0)], 20)
    expect(groups).toHaveLength(2)
  })

  it('chains transitively via single-link (a~b, b~c ⇒ one group)', () => {
    const groups = clusterByProximity([sp('a', 0, 0), sp('b', 15, 0), sp('c', 30, 0)], 20)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })
})

describe('computeMarkerFan', () => {
  it('returns no offsets when nothing overlaps', () => {
    const r = computeMarkerFan([sp('a', 0, 0), sp('b', 200, 0)], { thresholdPx: 20 })
    expect(r.offsets.size).toBe(0)
    expect(r.leaders).toHaveLength(0)
  })

  it('fans an overlapping pair: both get an offset and a leader', () => {
    const r = computeMarkerFan([sp('a', 100, 100), sp('b', 105, 100)], { thresholdPx: 20 })
    expect(r.offsets.size).toBe(2)
    expect(r.offsets.has('a')).toBe(true)
    expect(r.offsets.has('b')).toBe(true)
    expect(r.leaders).toHaveLength(2)
  })

  it('places each fanned dot on a circle of the fan radius around the centroid', () => {
    // Two coincident points → centroid is the shared point; each dot sits at
    // exactly `radius` px from it. N=2 → radius = baseRadiusPx (16).
    const r = computeMarkerFan([sp('a', 100, 100), sp('b', 100, 100)], {
      thresholdPx: 20,
      baseRadiusPx: 16,
    })
    for (const [, [dx, dy]] of r.offsets) {
      const dist = Math.sqrt(dx * dx + dy * dy)
      expect(dist).toBeCloseTo(16, 5)
    }
    // Leader endpoints: `from` = centroid (the shared point), `to` = the dot.
    for (const l of r.leaders) {
      expect(l.from[0]).toBeCloseTo(100, 5)
      expect(l.from[1]).toBeCloseTo(100, 5)
      const r2 = Math.hypot(l.to[0] - 100, l.to[1] - 100)
      expect(r2).toBeCloseTo(16, 5)
    }
  })

  it('assigns a stable slot per id regardless of input order', () => {
    const a = computeMarkerFan([sp('a', 0, 0), sp('b', 5, 0), sp('c', 0, 5)], { thresholdPx: 20 })
    const b = computeMarkerFan([sp('c', 0, 5), sp('a', 0, 0), sp('b', 5, 0)], { thresholdPx: 20 })
    // Offsets are derived from each marker's own point, so for identical inputs
    // in different order the same id must land at the same target slot.
    for (const id of ['a', 'b', 'c']) {
      const oa = a.offsets.get(id)!
      const ob = b.offsets.get(id)!
      expect(oa[0]).toBeCloseTo(ob[0], 5)
      expect(oa[1]).toBeCloseTo(ob[1], 5)
    }
  })

  it('reports clusters with member ids and centroid for each fanned group', () => {
    // One overlapping pair + one solitary marker far away.
    const r = computeMarkerFan(
      [sp('a', 100, 100), sp('b', 108, 100), sp('solo', 400, 400)],
      { thresholdPx: 20 },
    )
    expect(r.clusters).toHaveLength(1)
    expect([...r.clusters[0].ids].sort()).toEqual(['a', 'b'])
    // Centroid is the average of the two members' screen points.
    expect(r.clusters[0].centroid[0]).toBeCloseTo(104, 5)
    expect(r.clusters[0].centroid[1]).toBeCloseTo(100, 5)
  })

  it('has no clusters when nothing overlaps', () => {
    const r = computeMarkerFan([sp('a', 0, 0), sp('b', 300, 0)], { thresholdPx: 20 })
    expect(r.clusters).toHaveLength(0)
  })

  it('grows the fan radius with group size (clamped)', () => {
    const pts = Array.from({ length: 8 }, (_, i) => sp(`p${i}`, 100, 100))
    const r = computeMarkerFan(pts, {
      thresholdPx: 20,
      baseRadiusPx: 16,
      radiusStepPx: 2,
      maxRadiusPx: 40,
    })
    // N=8 → 16 + 2*(8-2) = 28 px, under the 40 cap.
    for (const [, [dx, dy]] of r.offsets) {
      expect(Math.hypot(dx, dy)).toBeCloseTo(28, 5)
    }
  })
})

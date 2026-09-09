/**
 * Regression tests for the MZB 2026 rally corridor failure and the defects
 * found alongside it.
 *
 * Reported symptom: "between TP 4 and TP 6 the app showed a straight corridor
 * connecting these, skipping TP 5 at all", plus wrong distances.
 *
 * `fixtures/MZB_2026_RED.kml` is the real course from that competition — the
 * first failing file ever obtained for this class of bug. Five of its eight
 * legs are drawn as *dashed* polylines (13 separate 2-point LineStrings each),
 * which the pipeline used to destroy: dashes under 500 m were deleted outright
 * and the survivors were welded together with a straight 11.6 km chord running
 * from TP 4 to TP 6.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FeatureCollection, GeoJSON } from 'geojson'
import { parseTextToGeoJSON } from '../parsers/detect'
import {
  buildContinuousTrackWithSources,
  calculateDistance,
  extractAllSegments,
  mergeDashRuns,
  type LonLatAlt,
  type Segment,
} from '../corridors/segments'
import {
  buildPreciseCorridorsAndGates,
  findNamedPoints,
  turningPointNumber,
  DISCIPLINE_CONFIGS,
} from '../corridors/preciseCorridor'

const loadFixture = (name: string): GeoJSON =>
  parseTextToGeoJSON(readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8'), name)

const legNames = (out: { leftSegments: Array<{ properties: unknown }> }) =>
  out.leftSegments.map(s => String((s.properties as Record<string, unknown>)?.segment))

/** Metres → degrees of latitude, for building synthetic fixtures. */
const M_LAT = 1 / 111_320

/** A straight run of `count` dashes of `dashM`, separated by `gapM`, heading north. */
function dashRun(startLon: number, startLat: number, count: number, dashM: number, gapM: number): Segment[] {
  const segs: Segment[] = []
  let lat = startLat
  for (let i = 0; i < count; i++) {
    const end = lat + dashM * M_LAT
    segs.push({ index: i, coordinates: [[startLon, lat], [startLon, end]] })
    lat = end + gapM * M_LAT
  }
  return segs
}

const featureCollection = (features: FeatureCollection['features']): GeoJSON =>
  ({ type: 'FeatureCollection', features }) as GeoJSON

const lineFeature = (coordinates: number[][]) =>
  ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } })

const pointFeature = (name: string, coordinates: number[]) =>
  ({ type: 'Feature' as const, properties: { name }, geometry: { type: 'Point' as const, coordinates } })

describe('MZB 2026 — the reported failure', () => {
  const gj = loadFixture('MZB_2026_RED.kml')

  it('builds all eight legs instead of five', () => {
    const out = buildPreciseCorridorsAndGates(gj, DISCIPLINE_CONFIGS.rally)
    expect(legNames(out)).toEqual([
      '5NM-after-SP→TP 1',
      '1NM-after-TP 1→TP 2',
      '1NM-after-TP 2→TP 3',
      '1NM-after-TP 3→TP 4',
      '1NM-after-TP 4→TP 5',
      '1NM-after-TP 5→TP 6',
      '1NM-after-TP 6→TP 7',
      '1NM-after-TP 7→FP',
    ])
  })

  it('no longer skips TP 5 — every turning point snaps to its own label', () => {
    const out = buildPreciseCorridorsAndGates(gj, DISCIPLINE_CONFIGS.rally)
    const named = findNamedPoints(gj)
    // The KML label is drawn 71 m east of the track on purpose; anything much
    // beyond that means the point was snapped onto unrelated geometry. TP 5
    // used to land 6 437 m away, on the straight TP 4 → TP 6 chord.
    for (const pt of out.exactPoints) {
      const name = String((pt.properties as Record<string, unknown>)?.name)
      const label = named.tps.find(t => t.name === name)
      if (!label) continue
      const offset = calculateDistance(label.coord, pt.geometry.coordinates as LonLatAlt)
      expect(offset, `${name} snapped ${offset.toFixed(0)} m from its label`).toBeLessThan(100)
    }
  })

  it('measures the course at its true length, with no chords welded across it', () => {
    const { track, gapAfterIndex } = buildContinuousTrackWithSources(gj)
    let length = 0
    for (let i = 1; i < track.length; i++) length += calculateDistance(track[i - 1], track[i])
    // 106.90 km before the fix — 13.41 km short, because an 11.6 km straight
    // chord replaced the real TP 4 → TP 5 → TP 6 path and TP 7 → FP was gone.
    expect(length / 1000).toBeCloseTo(120.31, 1)
    expect(gapAfterIndex.filter(Boolean)).toHaveLength(0)
  })

  it('reconstructs exactly the five dashed legs, and says so', () => {
    const { diagnostics } = buildContinuousTrackWithSources(gj)
    expect(diagnostics.mergedDashRuns.map(r => Math.round(r.dashLengthMinM))).toEqual([1267, 524, 387, 308, 305])
    // The dashes within a run are near-identical but NOT exactly equal (the
    // last run spans 305-306 m), which is why the range is reported rather
    // than the first dash quoted as if it described all thirteen.
    expect(diagnostics.mergedDashRuns.every(r => r.dashLengthMaxM - r.dashLengthMinM < 2)).toBe(true)
    expect(diagnostics.mergedDashRuns.every(r => r.dashes === 13)).toBe(true)
    // The two isolated 200 m decorations near FP are still discarded.
    expect(diagnostics.droppedShortSegments).toBe(2)

    const out = buildPreciseCorridorsAndGates(gj, DISCIPLINE_CONFIGS.rally)
    expect(out.warnings.filter(w => w.includes('Reconstructed a leg'))).toHaveLength(5)
  })
})

describe('shipped fixtures are unaffected', () => {
  // The investigation's baseline: both files were already correct and must stay
  // correct — 6 legs each, decorations still excluded.
  it.each([
    ['RED.kml', 6, 2],
    ['RED_SC.kml', 6, 2],
  ])('%s keeps %i legs', (file, legs, dropped) => {
    const gj = loadFixture(file)
    const out = buildPreciseCorridorsAndGates(gj, DISCIPLINE_CONFIGS.rally)
    expect(out.leftSegments).toHaveLength(legs)
    expect(buildContinuousTrackWithSources(gj).diagnostics.droppedShortSegments).toBe(dropped)
    expect(out.warnings.filter(w => w.startsWith('No corridor '))).toHaveLength(0)
  })
})

describe('mergeDashRuns — what counts as a dashed leg', () => {
  it('merges a run of three or more and keeps every endpoint in order', () => {
    const { segments, merged } = mergeDashRuns(dashRun(14, 50, 4, 300, 300))
    expect(segments).toHaveLength(1)
    expect(merged).toHaveLength(1)
    expect(merged[0].dashes).toBe(4)
    // 4 dashes, none coincident, so 8 vertices survive.
    expect(segments[0].coordinates).toHaveLength(8)
  })

  it('leaves a pair alone — two isolated marks are decoration, not a leg', () => {
    const { segments, merged } = mergeDashRuns(dashRun(14, 50, 2, 200, 200))
    expect(segments).toHaveLength(2)
    expect(merged).toHaveLength(0)
  })

  it('leaves a single short line alone', () => {
    const { segments, merged } = mergeDashRuns(dashRun(14, 50, 1, 200, 0))
    expect(segments).toHaveLength(1)
    expect(merged).toHaveLength(0)
  })

  it('does not join two decorations that merely sit near each other', () => {
    // Same length, but pointing in unrelated directions — the MZB dashes all
    // continue one another's heading, decoration does not.
    const segs: Segment[] = [
      { index: 0, coordinates: [[14, 50], [14, 50 + 200 * M_LAT]] },
      { index: 1, coordinates: [[14.01, 50], [14.01 + 200 * M_LAT, 50]] },
      { index: 2, coordinates: [[14.02, 50], [14.02, 50 - 200 * M_LAT]] },
    ]
    expect(mergeDashRuns(segs).merged).toHaveLength(0)
  })

  it('breaks the run when a dash doubles back on the previous one', () => {
    const segs = dashRun(14, 50, 3, 300, 300)
    segs.push({ index: 3, coordinates: [segs[2].coordinates[1], [14, 50]] })
    const { merged } = mergeDashRuns(segs)
    expect(merged).toHaveLength(1)
    expect(merged[0].dashes).toBe(3)
  })

  it('breaks the run when the gap is far larger than the dash', () => {
    const segs = [...dashRun(14, 50, 3, 300, 300), ...dashRun(14, 51, 3, 300, 300)]
    segs.forEach((s, i) => { s.index = i })
    const { merged } = mergeDashRuns(segs)
    expect(merged).toHaveLength(2)
  })

  it('breaks the run on a length change', () => {
    const segs = [...dashRun(14, 50, 3, 300, 300), ...dashRun(14, 50.02, 3, 1200, 300)]
    segs.forEach((s, i) => { s.index = i })
    expect(mergeDashRuns(segs).merged.map(m => m.dashes)).toEqual([3, 3])
  })

  it('follows a dashed leg around a curve instead of chording it', () => {
    // Each dash turns 10° from the last — inside tolerance, so one run, but the
    // merged geometry must keep the bend rather than collapse to a chord.
    const segs: Segment[] = []
    let lon = 14, lat = 50
    for (let i = 0; i < 5; i++) {
      const bearing = (i * 10) * Math.PI / 180
      const endLon = lon + Math.sin(bearing) * 300 * M_LAT / Math.cos(lat * Math.PI / 180)
      const endLat = lat + Math.cos(bearing) * 300 * M_LAT
      segs.push({ index: i, coordinates: [[lon, lat], [endLon, endLat]] })
      lon = endLon + Math.sin(bearing) * 300 * M_LAT / Math.cos(lat * Math.PI / 180)
      lat = endLat + Math.cos(bearing) * 300 * M_LAT
    }
    const { segments, merged } = mergeDashRuns(segs)
    expect(merged).toHaveLength(1)
    expect(segments[0].coordinates.length).toBeGreaterThan(2)
  })

  it('ignores zero-length dashes rather than dividing by them', () => {
    const segs: Segment[] = [
      { index: 0, coordinates: [[14, 50], [14, 50]] },
      { index: 1, coordinates: [[14, 50], [14, 50]] },
      { index: 2, coordinates: [[14, 50], [14, 50]] },
    ]
    expect(() => mergeDashRuns(segs)).not.toThrow()
    expect(mergeDashRuns(segs).merged).toHaveLength(0)
  })

  it('does not duplicate a vertex when pieces already touch', () => {
    const { segments } = mergeDashRuns(dashRun(14, 50, 3, 300, 0))
    expect(segments[0].coordinates).toHaveLength(4)
  })

  it('leaves polylines with more than two vertices untouched', () => {
    const segs: Segment[] = [{ index: 0, coordinates: [[14, 50], [14, 50.1], [14, 50.2]] }]
    expect(mergeDashRuns(segs).segments).toEqual(segs)
  })

  it('handles an empty input', () => {
    expect(mergeDashRuns([])).toEqual({ segments: [], merged: [] })
  })

  it('leaves a normally-authored course alone instead of calling it a dashed leg', () => {
    // Three 11 km legs drawn as touching 2-point LineStrings with 20° turns —
    // an ordinary course. Merging changes nothing here; the defect was the
    // banner announcing a "reconstruction", which spends its credibility on
    // every file that genuinely needs one.
    const segs: Segment[] = []
    let lon = 14, lat = 50
    for (let i = 0; i < 3; i++) {
      const bearing = (i * 20) * Math.PI / 180
      const endLon = lon + Math.sin(bearing) * 11_000 * M_LAT / Math.cos(lat * Math.PI / 180)
      const endLat = lat + Math.cos(bearing) * 11_000 * M_LAT
      segs.push({ index: i, coordinates: [[lon, lat], [endLon, endLat]] })
      lon = endLon; lat = endLat
    }
    expect(mergeDashRuns(segs).merged).toHaveLength(0)
    expect(mergeDashRuns(segs).segments).toHaveLength(3)
  })

  it('does not weld a discontinuity wider than the dash spacing', () => {
    // Real MZB spacing is gap/dash = 1.00 exactly. A 2.75x jump is a genuine
    // break in the source and must survive as a gap chord, or isSpanOnMain
    // loses the guarantee it exists to provide and draws a corridor across it.
    const first = dashRun(14, 50, 3, 400, 400)
    const afterJump = 50 + (3 * 800 - 400 + 1100) * M_LAT
    const second = dashRun(14, afterJump, 3, 400, 400)
    const segs = [...first, ...second].map((seg, index) => ({ ...seg, index }))
    const { merged, segments } = mergeDashRuns(segs)
    // Two separate dashed legs, not one welded run.
    expect(merged).toHaveLength(2)
    const { gapAfterIndex } = buildContinuousTrackWithSources(
      featureCollection(segments.map(seg => lineFeature(seg.coordinates as number[][]))) as GeoJSON,
    )
    expect(gapAfterIndex.filter(Boolean).length).toBeGreaterThan(0)
  })
})

describe('extractAllSegments — geometry shapes that used to render nothing', () => {
  it('reads a MultiLineString, as a paused GPS recording produces', () => {
    const gj = featureCollection([
      {
        type: 'Feature', properties: {},
        geometry: { type: 'MultiLineString', coordinates: [[[14, 50], [14, 50.1]], [[14, 50.1], [14, 50.2]]] },
      },
    ] as FeatureCollection['features'])
    expect(extractAllSegments(gj)).toHaveLength(2)
  })

  it('reads a GeometryCollection, as KML MultiGeometry produces', () => {
    const gj = featureCollection([
      {
        type: 'Feature', properties: {},
        geometry: {
          type: 'GeometryCollection',
          geometries: [
            { type: 'LineString', coordinates: [[14, 50], [14, 50.1]] },
            { type: 'LineString', coordinates: [[14, 50.1], [14, 50.2]] },
          ],
        },
      },
    ] as FeatureCollection['features'])
    expect(extractAllSegments(gj)).toHaveLength(2)
  })

  it('skips a degenerate one-point line rather than emitting it', () => {
    const gj = featureCollection([lineFeature([[14, 50]])] as FeatureCollection['features'])
    expect(extractAllSegments(gj)).toHaveLength(0)
  })
})

describe('corridors are never drawn across a gap', () => {
  it('rejects a span that lies entirely on the welded chord', () => {
    // Two track pieces 20 km apart. The chord between them is the only segment
    // both the gate and the next turning point can land on, so fromIdx === toIdx
    // — the branch that used to skip the gap check entirely.
    const gj = featureCollection([
      lineFeature([[14, 50], [14, 50.05]]),
      lineFeature([[14.3, 50.2], [14.3, 50.25]]),
      pointFeature('SP', [14, 50]),
      pointFeature('TP 1', [14, 50.05]),
      pointFeature('TP 2', [14.3, 50.2]),
      pointFeature('FP', [14.3, 50.25]),
    ] as FeatureCollection['features'])
    const out = buildPreciseCorridorsAndGates(gj, DISCIPLINE_CONFIGS.rally)
    expect(legNames(out)).not.toContain('1NM-after-TP 1→TP 2')
    expect(out.warnings.some(w => w.includes('TP 1 → TP 2') && w.includes('interrupted'))).toBe(true)
  })
})

describe('a leg shorter than its gate offset', () => {
  it('clamps the gate onto the leg instead of overshooting it', () => {
    // TP 1 → TP 2 is ~600 m, a third of the 1 NM gate offset. The gate used to
    // land past TP 2 entirely: start and end snapped to the same segment and
    // the corridor came out as a two-point stub running BACKWARDS.
    const gj = featureCollection([
      lineFeature([[14, 50], [14, 50.2], [14, 50.2054], [14, 50.3]]),
      pointFeature('SP', [14, 50]),
      pointFeature('TP 1', [14, 50.2]),
      pointFeature('TP 2', [14, 50.2054]),
      pointFeature('FP', [14, 50.3]),
    ] as FeatureCollection['features'])
    const out = buildPreciseCorridorsAndGates(gj, DISCIPLINE_CONFIGS.rally)

    const leg = out.leftSegments.find(s => (s.properties as Record<string, unknown>)?.segment === '1NM-after-TP 1→TP 2')
    expect(leg, 'the short leg must still get a corridor').toBeDefined()
    const coords = leg!.geometry.coordinates as number[][]
    // Runs forward along the course (northwards here), not back on itself.
    expect(coords[coords.length - 1][1]).toBeGreaterThan(coords[0][1])
    // And it stays inside its own leg rather than spilling past TP 2.
    expect(coords[coords.length - 1][1]).toBeLessThanOrEqual(50.2054 + 1e-6)

    // Neither neighbour may be collateral damage.
    expect(legNames(out)).toContain('1NM-after-TP 2→FP')
    expect(legNames(out)).toContain('5NM-after-SP→TP 1')

    // And the move is announced. A clamped gate is NOT at the rule-defined
    // distance, while the gate feature and the corridor label both still say
    // it is — moving it quietly is the defect this whole change exists to end.
    expect(out.warnings.some(w => w.includes('TP 1 → TP 2') && w.includes('moved to'))).toBe(true)
  })

  it('warns when the leg cannot hold a gate at all', () => {
    // ~111 m: shorter than the margin the gate needs before the next turn.
    const gj = featureCollection([
      lineFeature([[14, 50], [14, 50.2], [14, 50.201], [14, 50.3]]),
      pointFeature('SP', [14, 50]),
      pointFeature('TP 1', [14, 50.2]),
      pointFeature('TP 2', [14, 50.201]),
      pointFeature('FP', [14, 50.3]),
    ] as FeatureCollection['features'])
    const out = buildPreciseCorridorsAndGates(gj, DISCIPLINE_CONFIGS.rally)
    expect(out.warnings.some(w => w.includes('TP 1 → TP 2') && w.includes('too short'))).toBe(true)
    // One impossible hop may not silently delete the legs around it.
    expect(legNames(out)).toContain('1NM-after-TP 2→FP')
  })
})

describe('turning-point names', () => {
  it.each([
    ['TP1', 1], ['TP 1', 1], ['TP-3', 3], ['CP_15', 15], ['CP 1 A', 1], ['TP 10', 10],
  ])('%s reads as number %i', (name, expected) => {
    expect(turningPointNumber(name)).toBe(expected)
  })

  it('sorts TP 10 after TP 9, and does not let a suffix inflate the key', () => {
    const gj = featureCollection([
      lineFeature([[14, 50], [14, 51]]),
      pointFeature('TP 10', [14, 50.9]),
      pointFeature('TP 9', [14, 50.5]),
      pointFeature('CP 1 A', [14, 50.1]),
    ] as FeatureCollection['features'])
    expect(findNamedPoints(gj).tps.map(t => t.name)).toEqual(['CP 1 A', 'TP 9', 'TP 10'])
  })

  it('reports a placemark that looks like a turning point but is not named like one', () => {
    const gj = featureCollection([
      lineFeature([[14, 50], [14, 51]]),
      pointFeature('SP', [14, 50]),
      pointFeature('OT 4', [14, 50.5]),
      pointFeature('TP 1', [14, 50.7]),
    ] as FeatureCollection['features'])
    const named = findNamedPoints(gj)
    expect(named.unrecognised).toEqual(['OT 4'])
    expect(buildPreciseCorridorsAndGates(gj, DISCIPLINE_CONFIGS.rally).warnings
      .some(w => w.includes('not recognised') && w.includes('OT 4'))).toBe(true)
  })

  it('does not report scenic points, which are excluded on purpose', () => {
    const gj = featureCollection([
      lineFeature([[14, 50], [14, 51]]),
      pointFeature('SC 1', [14, 50.5]),
      pointFeature('TP 1', [14, 50.7]),
    ] as FeatureCollection['features'])
    expect(findNamedPoints(gj).unrecognised).toEqual([])
  })
})

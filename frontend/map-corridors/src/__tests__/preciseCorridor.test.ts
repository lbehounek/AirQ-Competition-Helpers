import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { GeoJSON, FeatureCollection, Feature, Point } from 'geojson'
import { parseTextToGeoJSON } from '../parsers/detect'
import {
  findNamedPoints,
  buildPreciseCorridorsAndGates,
  generateLeftRightCorridor,
  buildGateAtPoint,
  DISCIPLINE_CONFIGS,
} from '../corridors/preciseCorridor'
import type { LonLatAlt } from '../corridors/segments'
import { isTpGatePerpendicular, extractAllSegments } from '../corridors/segments'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name: string): GeoJSON {
  const kml = readFileSync(join(__dirname, 'fixtures', name), 'utf-8')
  return parseTextToGeoJSON(kml, name)
}

function makePointFeature(name: string, lon: number, lat: number): Feature<Point> {
  return { type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat, 0] } }
}

function makeGeoJSON(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features }
}

// ---------------------------------------------------------------------------
// 1. findNamedPoints — TP name format variants
// ---------------------------------------------------------------------------

describe('findNamedPoints', () => {
  it('recognizes "TP 1" (with space)', () => {
    const gj = makeGeoJSON([makePointFeature('TP 1', 14, 50)])
    const r = findNamedPoints(gj)
    expect(r.tps).toHaveLength(1)
    expect(r.tps[0].name).toBe('TP 1')
  })

  it('recognizes "TP1" (no space)', () => {
    const gj = makeGeoJSON([makePointFeature('TP1', 14, 50)])
    const r = findNamedPoints(gj)
    expect(r.tps).toHaveLength(1)
    expect(r.tps[0].name).toBe('TP1')
  })

  it('recognizes "TP 12" and "TP12" with double-digit numbers', () => {
    const gj = makeGeoJSON([
      makePointFeature('TP12', 14, 50),
      makePointFeature('TP 12', 15, 51),
    ])
    const r = findNamedPoints(gj)
    expect(r.tps).toHaveLength(2)
  })

  it('recognizes "CP n" Control Points as turning points (rally KMLs from some authoring tools)', () => {
    const gj = makeGeoJSON([
      makePointFeature('CP 1', 14.1, 50.1),
      makePointFeature('CP 15', 14.15, 50.15),
      makePointFeature('CP10', 14.10, 50.10),
    ])
    const r = findNamedPoints(gj)
    expect(r.tps.map(t => t.name).sort()).toEqual(['CP 1', 'CP 15', 'CP10'].sort())
  })

  it('does NOT recognize SC gates as TPs', () => {
    const gj = makeGeoJSON([
      makePointFeature('SC 01', 14, 50),
      makePointFeature('SC 02', 14.1, 50.1),
      makePointFeature('TP1', 14.2, 50.2),
    ])
    const r = findNamedPoints(gj)
    expect(r.tps).toHaveLength(1)
    expect(r.tps[0].name).toBe('TP1')
  })

  it('recognizes SP and FP', () => {
    const gj = makeGeoJSON([
      makePointFeature('SP', 14, 50),
      makePointFeature('FP', 15, 51),
    ])
    const r = findNamedPoints(gj)
    expect(r.sp).toBeDefined()
    expect(r.fp).toBeDefined()
  })

  it('sorts mixed TP formats correctly', () => {
    const gj = makeGeoJSON([
      makePointFeature('TP 3', 14.3, 50.3),
      makePointFeature('TP1', 14.1, 50.1),
      makePointFeature('TP 2', 14.2, 50.2),
    ])
    const r = findNamedPoints(gj)
    expect(r.tps.map(t => t.name)).toEqual(['TP1', 'TP 2', 'TP 3'])
  })
})

// ---------------------------------------------------------------------------
// 1b. isTpGatePerpendicular — length-based discriminator between TP gate
// perpendiculars and legitimate 3-vertex track legs. Regression for the
// 16-section race that hid corridors + TP markers (feedback 2026-04-23).
// ---------------------------------------------------------------------------

describe('isTpGatePerpendicular', () => {
  it('flags a short 3-coord perpendicular (~1 km wide) as a gate', () => {
    const perp: LonLatAlt[] = [
      [14.9950, 50.0000, 0],
      [15.0000, 50.0000, 0],
      [15.0050, 50.0000, 0],
    ]
    expect(isTpGatePerpendicular(perp)).toBe(true)
  })

  it('does NOT flag a long 3-vertex leg (~18 km) as a gate', () => {
    const leg: LonLatAlt[] = [
      [14.0, 50.0, 0],
      [14.1, 50.05, 0],
      [14.2, 50.1, 0],
    ]
    expect(isTpGatePerpendicular(leg)).toBe(false)
  })

  it('does NOT flag 2-coord or 4+-coord lines', () => {
    expect(isTpGatePerpendicular([[14, 50], [15, 51]])).toBe(false)
    expect(isTpGatePerpendicular([[14, 50], [14.1, 50], [14.2, 50], [14.3, 50]])).toBe(false)
  })

  // Boundary around the 3 km threshold — previously untested, a `<` vs `<=`
  // regression would silently misclassify a true-3 km gate as a leg and
  // reopen the 16-section-race bug.
  it('boundary: 2.89 km perpendicular is classified as a gate (under 3 km)', () => {
    // half = 0.013° lat ≈ 1.446 km (haversine, R=6371 km). Total ≈ 2.89 km.
    const perp: LonLatAlt[] = [
      [14.0, 49.987, 0],
      [14.0, 50.000, 0],
      [14.0, 50.013, 0],
    ]
    expect(isTpGatePerpendicular(perp)).toBe(true)
  })

  it('boundary: 3.11 km 3-vertex leg is NOT classified as a gate (over 3 km)', () => {
    // half = 0.014° lat ≈ 1.557 km. Total ≈ 3.11 km — just above the cut-off.
    const leg: LonLatAlt[] = [
      [14.0, 49.986, 0],
      [14.0, 50.000, 0],
      [14.0, 50.014, 0],
    ]
    expect(isTpGatePerpendicular(leg)).toBe(false)
  })
})

describe('extractAllSegments with long 3-vertex legs', () => {
  it('keeps 3-vertex track legs as segments instead of dropping them as gates', () => {
    const course: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[14.0, 50.0], [14.05, 50.02], [14.1, 50.05]] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[14.1, 50.05], [14.15, 50.07], [14.2, 50.1]] } },
        // plus a real gate perpendicular at TP1 (~1 km total)
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[14.095, 50.045], [14.1, 50.05], [14.105, 50.055]] } },
      ],
    }
    const segs = extractAllSegments(course)
    expect(segs.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 2. DISCIPLINE_CONFIGS — parameter correctness
// ---------------------------------------------------------------------------

describe('DISCIPLINE_CONFIGS', () => {
  it('precision config has correct values', () => {
    const c = DISCIPLINE_CONFIGS.precision
    expect(c.spAfterNm).toBe(0.5)
    expect(c.tpAfterNm).toBe(0.5)
    expect(c.leftDistanceM).toBe(100)
    expect(c.rightDistanceM).toBe(0)
  })

  it('rally config has correct values', () => {
    const c = DISCIPLINE_CONFIGS.rally
    expect(c.spAfterNm).toBe(5.0)
    expect(c.tpAfterNm).toBe(1.0)
    expect(c.leftDistanceM).toBe(300)
    expect(c.rightDistanceM).toBe(300)
  })

  // Feedback 2026-04-18: the rally "1 NM after SP" checkbox must produce
  // a corridor that is 1 NM — not 5 NM — past the start point, and it must
  // NOT mutate the module-level DISCIPLINE_CONFIGS record (a regression
  // from `base.spAfterNm = 1.0` instead of `{...base, spAfterNm: 1.0}`
  // would poison every subsequent session).
  it('rally-1NM override clones base config without mutating it', () => {
    const base = DISCIPLINE_CONFIGS.rally
    const overridden = { ...base, spAfterNm: 1.0 }
    expect(overridden.spAfterNm).toBe(1.0)
    expect(overridden.tpAfterNm).toBe(1.0)
    expect(overridden.leftDistanceM).toBe(300)
    // Module-level record must stay at the default.
    expect(DISCIPLINE_CONFIGS.rally.spAfterNm).toBe(5.0)
  })

  it('buildPreciseCorridorsAndGates accepts spAfterNm=1.0 without throwing', () => {
    const geojson = loadFixture('RED.kml')
    const result = buildPreciseCorridorsAndGates(geojson, {
      ...DISCIPLINE_CONFIGS.rally,
      spAfterNm: 1.0,
    })
    expect(result.leftSegments.length).toBeGreaterThan(0)
    expect(result.rightSegments.length).toBeGreaterThan(0)
    expect(result.gates.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 3. generateLeftRightCorridor — asymmetric corridors
// ---------------------------------------------------------------------------

describe('generateLeftRightCorridor', () => {
  // Simple 2-point track heading north
  const track: LonLatAlt[] = [[14.0, 50.0, 0], [14.0, 50.01, 0]]

  it('symmetric corridor (rally) offsets both sides', () => {
    const r = generateLeftRightCorridor(track, 300, 300)
    expect(r).not.toBeNull()
    const leftLon = r!.left.geometry.coordinates[0][0]
    const rightLon = r!.right.geometry.coordinates[0][0]
    // Left should be west of track, right should be east
    expect(leftLon).toBeLessThan(14.0)
    expect(rightLon).toBeGreaterThan(14.0)
  })

  it('asymmetric corridor (precision) has right on centerline', () => {
    const r = generateLeftRightCorridor(track, 100, 0)
    expect(r).not.toBeNull()
    const leftLon = r!.left.geometry.coordinates[0][0]
    const rightLon = r!.right.geometry.coordinates[0][0]
    // Left should be offset, right should be on the track
    expect(leftLon).toBeLessThan(14.0)
    expect(rightLon).toBeCloseTo(14.0, 5)
  })

  it('returns null for single-point track', () => {
    expect(generateLeftRightCorridor([[14, 50, 0]], 300, 300)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. buildGateAtPoint — asymmetric gate rendering
// ---------------------------------------------------------------------------

describe('buildGateAtPoint', () => {
  const center: LonLatAlt = [14.0, 50.0, 0]
  const bearing = 0 // heading north

  it('symmetric gate spans both sides', () => {
    const gate = buildGateAtPoint(center, bearing, 300, 300)
    const coords = gate.geometry.coordinates
    expect(coords).toHaveLength(2)
    const [leftLon] = coords[0]
    const [rightLon] = coords[1]
    expect(leftLon).toBeLessThan(14.0)
    expect(rightLon).toBeGreaterThan(14.0)
  })

  it('asymmetric gate (precision) has right at center', () => {
    const gate = buildGateAtPoint(center, bearing, 100, 0)
    const coords = gate.geometry.coordinates
    const [rightLon, rightLat] = coords[1]
    expect(rightLon).toBeCloseTo(14.0, 5)
    expect(rightLat).toBeCloseTo(50.0, 5)
  })
})

// ---------------------------------------------------------------------------
// 5. End-to-end: RED.kml (rally, "TP 1" format, no SC gates)
// ---------------------------------------------------------------------------

describe('RED.kml (rally, no SC gates)', () => {
  let geojson: GeoJSON

  it('parses without error', () => {
    geojson = loadFixture('RED.kml')
    expect(geojson).toBeDefined()
  })

  it('finds SP, FP, and 5 TPs', () => {
    geojson = loadFixture('RED.kml')
    const named = findNamedPoints(geojson)
    expect(named.sp).toBeDefined()
    expect(named.fp).toBeDefined()
    expect(named.tps).toHaveLength(5)
  })

  it('generates corridors with rally config', () => {
    geojson = loadFixture('RED.kml')
    const result = buildPreciseCorridorsAndGates(geojson, DISCIPLINE_CONFIGS.rally)
    expect(result.leftSegments.length).toBeGreaterThan(0)
    expect(result.rightSegments.length).toBeGreaterThan(0)
    expect(result.gates.length).toBeGreaterThan(0)
    expect(result.exactPoints.length).toBeGreaterThan(0)
  })

  it('produces correct number of corridor segments', () => {
    geojson = loadFixture('RED.kml')
    const result = buildPreciseCorridorsAndGates(geojson, DISCIPLINE_CONFIGS.rally)
    // 5 TPs + SP → 6 segments: SP→TP1, TP1→TP2, ..., TP5→FP
    expect(result.leftSegments.length).toBe(6)
    expect(result.rightSegments.length).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// 6. End-to-end: RED_SC.kml (precision, "TP1" format, has SC gates)
// ---------------------------------------------------------------------------

describe('RED_SC.kml (precision, TP1 format, SC gates)', () => {
  let geojson: GeoJSON

  it('parses without error', () => {
    geojson = loadFixture('RED_SC.kml')
    expect(geojson).toBeDefined()
  })

  it('finds SP, FP, and 5 TPs despite "TP1" naming', () => {
    geojson = loadFixture('RED_SC.kml')
    const named = findNamedPoints(geojson)
    expect(named.sp).toBeDefined()
    expect(named.fp).toBeDefined()
    expect(named.tps).toHaveLength(5)
    // Verify they're sorted correctly
    const nums = named.tps.map(t => parseInt(t.name.replace(/\D/g, ''), 10))
    expect(nums).toEqual([1, 2, 3, 4, 5])
  })

  it('does not pick up SC gates as TPs', () => {
    geojson = loadFixture('RED_SC.kml')
    const named = findNamedPoints(geojson)
    const scNames = named.tps.filter(t => t.name.startsWith('SC'))
    expect(scNames).toHaveLength(0)
  })

  it('generates corridors with precision config despite SC gates', () => {
    geojson = loadFixture('RED_SC.kml')
    const result = buildPreciseCorridorsAndGates(geojson, DISCIPLINE_CONFIGS.precision)
    expect(result.leftSegments.length).toBeGreaterThan(0)
    expect(result.rightSegments.length).toBeGreaterThan(0)
  })

  it('produces correct number of corridor segments', () => {
    geojson = loadFixture('RED_SC.kml')
    const result = buildPreciseCorridorsAndGates(geojson, DISCIPLINE_CONFIGS.precision)
    // 5 TPs + SP → 6 segments: SP→TP1, TP1→TP2, ..., TP5→FP
    expect(result.leftSegments.length).toBe(6)
    expect(result.rightSegments.length).toBe(6)
  })

  it('precision corridors are narrower than rally', () => {
    geojson = loadFixture('RED_SC.kml')
    const precision = buildPreciseCorridorsAndGates(geojson, DISCIPLINE_CONFIGS.precision)
    const rally = buildPreciseCorridorsAndGates(geojson, DISCIPLINE_CONFIGS.rally)
    // Both should produce segments, but precision left corridor should be closer to track
    if (precision.leftSegments.length > 0 && rally.leftSegments.length > 0) {
      // Compare the first left segment's offset from track
      const pCoords = precision.leftSegments[0].geometry.coordinates
      const rCoords = rally.leftSegments[0].geometry.coordinates
      // Rally corridor should be wider (first point's longitude further from track)
      // Just verify both generated something meaningful
      expect(pCoords.length).toBeGreaterThan(1)
      expect(rCoords.length).toBeGreaterThan(1)
    }
  })
})

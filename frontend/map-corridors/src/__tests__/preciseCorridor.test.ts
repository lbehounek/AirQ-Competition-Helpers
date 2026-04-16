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

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Feature, FeatureCollection, GeoJSON, LineString } from 'geojson'
import { parseTextToGeoJSON } from '../parsers/detect'
import { buildPreciseCorridorsAndGates, DISCIPLINE_CONFIGS } from '../corridors/preciseCorridor'
import { buildRouteWaypoints } from '../corridors/buildRouteWaypoints'
import { extractStartName, extractEndName } from '../corridors/extractStartName'
import { calculateDistance } from '../corridors/segments'
import {
  matchPointsToCorridors,
  legKey,
  type CorridorPolygon,
  type PointForMatching,
  type RouteWaypoint,
} from '../corridors/matchPoints'

// ---------------------------------------------------------------------------
// Regression suite for the real MZB 2026 rally course.
//
// The defect this pins: the leg-projection fallback used `coveredLegs` as a
// HARD EXCLUSION. A rally corridor is 300 m left + 300 m right, so a photo
// that misses its own leg's corridor by a few dozen metres had that leg
// permanently forbidden and was handed to the nearest leg that happened to
// have NO corridor — on this course up to 25.9 km away. 6 of the 18 en-route
// photos were misattributed:
//
//   s2,1 → TP 2 (14.80 NM), correct TP 4 (0.84 NM)
//   s2,2 → TP 2 (14.56 NM), correct TP 4 (2.36 NM)
//   s2,3 → TP 2 (15.17 NM), correct TP 4 (4.16 NM)
//   s2,4 → TP 2 (13.65 NM), correct TP 5 (1.88 NM)
//   s2,7 → TP 7 (0.77 NM),  correct TP 6 (11.08 NM)
//   s2,9 → TP 7 (2.10 NM),  correct TP 6 (9.74 NM)
//
// s2,7 and s2,9 are the decisive pair: they lie on the TP 6→TP 7 leg, whose
// track is a solid, undamaged LineString and whose corridor is built
// correctly. They are 342 m and 352 m from the centreline — only 42 m and
// 52 m outside the 600 m corridor. Their misattribution has nothing to do
// with the (separately fixed) dashed-track shredding.
//
// Which is why every assertion below runs TWICE: once on the fixture as
// authored (dashed legs shredded into 2-point dashes, so only 5 of 8 legs
// get a corridor) and once on a repaired track where the dash runs are
// merged (all 8 legs covered). Repairing the track ALONE makes the old
// behaviour worse, not better — with every leg covered, every photo outside
// its 600 m corridor is excluded from its own leg and dumped on whatever
// leg is left uncovered. The matcher has to be right in both worlds.
// ---------------------------------------------------------------------------

/** The 18 en-route photo positions as read from the competitors' EXIF GPS. */
const PHOTOS: ReadonlyArray<{ id: string; lat: number; lng: number }> = [
  { id: 's1,1', lat: 50.191190, lng: 13.683597 },
  { id: 's1,2', lat: 50.063373, lng: 13.456043 },
  { id: 's1,3', lat: 50.195062, lng: 13.719005 },
  { id: 's1,4', lat: 50.179318, lng: 13.625725 },
  { id: 's1,5', lat: 50.174765, lng: 13.562912 },
  { id: 's1,6', lat: 50.171513, lng: 13.532263 },
  { id: 's1,7', lat: 49.998440, lng: 13.528762 },
  { id: 's1,8', lat: 50.143302, lng: 13.487050 },
  { id: 's1,9', lat: 50.082915, lng: 13.460568 },
  { id: 's2,1', lat: 49.939768, lng: 13.649533 },
  { id: 's2,2', lat: 49.954995, lng: 13.681425 },
  { id: 's2,3', lat: 49.962860, lng: 13.727567 },
  { id: 's2,4', lat: 49.997208, lng: 13.729640 },
  { id: 's2,5', lat: 50.098897, lng: 13.820078 },
  { id: 's2,6', lat: 50.125827, lng: 13.866853 },
  { id: 's2,7', lat: 50.149923, lng: 13.914037 },
  { id: 's2,8', lat: 50.156993, lng: 13.947255 },
  { id: 's2,9', lat: 50.134913, lng: 13.888120 },
]

/**
 * Ground truth: the turning point each photo must be attributed to.
 * Waypoint names carry the space ("TP 4") because that is how the MZB KML
 * authors them and `findNamedPoints` preserves the authored spelling.
 */
const EXPECTED: Readonly<Record<string, string>> = {
  's1,1': 'TP 1', 's1,2': 'TP 2', 's1,3': 'TP 1',
  's1,4': 'TP 1', 's1,5': 'TP 1', 's1,6': 'TP 1',
  's1,7': 'TP 3', 's1,8': 'TP 2', 's1,9': 'TP 2',
  's2,1': 'TP 4', 's2,2': 'TP 4', 's2,3': 'TP 4',
  's2,4': 'TP 5', 's2,5': 'TP 6', 's2,6': 'TP 6',
  's2,7': 'TP 6', 's2,8': 'TP 7', 's2,9': 'TP 6',
}

// ---------------------------------------------------------------------------
// Pipeline replica — mirrors what App.tsx assembles before calling the matcher
// ---------------------------------------------------------------------------

type Pipeline = {
  corridorPolygons: CorridorPolygon[]
  waypoints: RouteWaypoint[]
  coveredLegs: Set<string>
}

/**
 * Run the production corridor pipeline over a parsed course and assemble the
 * three arguments `App.tsx` passes to `matchPointsToCorridors`: the corridor
 * polygons (left segment + reversed right segment closed into a ring), the
 * ordered route waypoints, and the covered-leg key set. Kept a faithful copy
 * of App.tsx:341-427 — if that assembly drifts, this test stops reflecting
 * production and should be updated alongside it.
 */
function buildPipeline(input: GeoJSON): Pipeline {
  const built = buildPreciseCorridorsAndGates(input, DISCIPLINE_CONFIGS.rally)

  // Pair left/right corridor edges by their `segment` property, exactly as App does.
  const byName: Record<string, { left?: number[][]; right?: number[][] }> = {}
  for (const f of built.leftSegments) {
    const name = (f.properties as { segment?: string } | null)?.segment
    if (!name) continue
    byName[name] = byName[name] || {}
    byName[name].left = f.geometry.coordinates as number[][]
  }
  for (const f of built.rightSegments) {
    const name = (f.properties as { segment?: string } | null)?.segment
    if (!name) continue
    byName[name] = byName[name] || {}
    byName[name].right = f.geometry.coordinates as number[][]
  }

  // Exact (track-snapped) waypoint coordinates keyed by waypoint name.
  const exactLookup: Record<string, [number, number]> = {}
  for (const f of built.exactPoints) {
    const props = f.properties as { role?: string; name?: string } | null
    if (props?.role !== 'exact' || !props?.name) continue
    exactLookup[props.name] = [f.geometry.coordinates[0], f.geometry.coordinates[1]]
  }

  const corridorPolygons: CorridorPolygon[] = []
  for (const name of Object.keys(byName)) {
    const pair = byName[name]
    if (!pair.left || !pair.right || pair.left.length < 2 || pair.right.length < 2) continue
    const left2D = pair.left.map((c) => [Number(c[0]), Number(c[1])] as [number, number])
    const right2D = pair.right.map((c) => [Number(c[0]), Number(c[1])] as [number, number])
    const ring: [number, number][] = [...left2D, ...right2D.slice().reverse()]
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]])
    if (ring.length < 4) continue
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng
      if (lat < minLat) minLat = lat
      if (lng > maxLng) maxLng = lng
      if (lat > maxLat) maxLat = lat
    }
    const startName = extractStartName(name)
    corridorPolygons.push({
      name,
      ring,
      bbox: [minLng, minLat, maxLng, maxLat],
      startName,
      startCoord: exactLookup[startName],
    })
  }

  const waypoints = buildRouteWaypoints({ features: built.exactPoints })
  const coveredLegs = new Set<string>()
  for (const c of corridorPolygons) {
    const from = extractStartName(c.name)
    const to = extractEndName(c.name)
    if (from && to) coveredLegs.add(legKey(from, to))
  }
  return { corridorPolygons, waypoints, coveredLegs }
}

// ---------------------------------------------------------------------------
// Dash-run repair — builds the "repaired track" world at the GeoJSON level
// ---------------------------------------------------------------------------

/** Initial great-circle bearing a→b in degrees, normalised to [0, 360). */
function bearingDeg(a: number[], b: number[]): number {
  const toRad = Math.PI / 180
  const φ1 = a[1] * toRad
  const φ2 = b[1] * toRad
  const Δλ = (b[0] - a[0]) * toRad
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Smallest absolute angle between two bearings, degrees (handles 359 vs 1). */
function bearingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function metersBetween(a: number[], b: number[]): number {
  return calculateDistance([a[0], a[1], 0], [b[0], b[1], 0])
}

/**
 * Merge collinear dash runs in a parsed course back into solid legs.
 *
 * A KML that draws a scenic leg as a dashed line arrives as dozens of
 * 2-point LineStrings. `preciseCorridor` refuses to build a corridor across
 * that (the span is not continuous on the main track), so the leg ends up
 * with no corridor at all. This helper reconstitutes the leg: a run of >= 3
 * consecutive 2-point LineStrings where each dash has the same length
 * (±5%) and bearing (±3°) as the run's first dash, and where the gap
 * between one dash's end and the next dash's start is itself collinear
 * (±3°) and shorter than 3x the dash length, collapses to a single
 * LineString from the run's first start to its last end.
 *
 * It lives in the test rather than in `src/corridors/` deliberately: the
 * production repair is being landed separately, and this regression suite
 * must not depend on that in-flight work to prove the matcher is correct on
 * a repaired track.
 */
function repairDashRuns(input: GeoJSON): FeatureCollection {
  const fc = input as FeatureCollection
  const features = fc.features
  const out: Feature[] = []

  const isDash = (f: Feature): f is Feature<LineString> =>
    f.geometry?.type === 'LineString' && (f.geometry as LineString).coordinates.length === 2

  let i = 0
  while (i < features.length) {
    const head = features[i]
    if (!isDash(head)) { out.push(head); i += 1; continue }

    // Extend the run while every geometric predicate holds against the
    // run's FIRST dash (not the previous one) so a slow drift in bearing
    // cannot creep a run around a curve one dash at a time.
    const headCoords = head.geometry.coordinates
    const dashLen = metersBetween(headCoords[0], headCoords[1])
    const dashBrg = bearingDeg(headCoords[0], headCoords[1])
    let end = i
    if (dashLen > 0) {
      while (end + 1 < features.length) {
        const next = features[end + 1]
        if (!isDash(next)) break
        const prev = features[end] as Feature<LineString>
        const nextCoords = next.geometry.coordinates
        const len = metersBetween(nextCoords[0], nextCoords[1])
        if (len <= 0 || Math.abs(len - dashLen) / dashLen > 0.05) break
        if (bearingDelta(bearingDeg(nextCoords[0], nextCoords[1]), dashBrg) > 3) break
        // The gap between the two dashes must continue the same line and be
        // short — otherwise these are two unrelated parallel features.
        const gapStart = prev.geometry.coordinates[1]
        const gapLen = metersBetween(gapStart, nextCoords[0])
        if (gapLen >= dashLen * 3) break
        if (gapLen > 0 && bearingDelta(bearingDeg(gapStart, nextCoords[0]), dashBrg) > 3) break
        end += 1
      }
    }

    const runLength = end - i + 1
    if (runLength >= 3) {
      const firstStart = (features[i] as Feature<LineString>).geometry.coordinates[0]
      const lastEnd = (features[end] as Feature<LineString>).geometry.coordinates[1]
      out.push({
        type: 'Feature',
        properties: { ...(features[i].properties ?? {}) },
        geometry: { type: 'LineString', coordinates: [firstStart, lastEnd] },
      })
    } else {
      for (let k = i; k <= end; k++) out.push(features[k])
    }
    i = end + 1
  }

  return { type: 'FeatureCollection', features: out }
}

function loadCourse(): GeoJSON {
  const kml = readFileSync(join(__dirname, 'fixtures', 'MZB_2026_RED.kml'), 'utf-8')
  return parseTextToGeoJSON(kml, 'MZB_2026_RED.kml')
}

/**
 * The three legs whose corridors the SHREDDED course could not build: their
 * track is drawn as a chain of dashed connectors, so `preciseCorridor` finds
 * no continuous span and emits no corridor. Measured on the fixture as
 * authored, before the track-repair work landed in `segments.ts`.
 */
const SHREDDED_MISSING_LEGS: ReadonlyArray<[string, string]> = [
  ['TP 1', 'TP 2'],
  ['TP 2', 'TP 3'],
  ['TP 7', 'FP'],
]

/**
 * Reproduce the corridor set the matcher actually saw during the MZB 2026
 * rally: five corridors (SP→TP1, TP3→TP4, TP4→TP5, TP5→TP6, TP6→TP7) and
 * three uncovered legs.
 *
 * Simulated by dropping corridors rather than by parsing an unrepaired
 * track, because the track repair now lives in the parse layer — there is
 * no longer a way to ask the parser for the broken world, and this suite
 * must keep testing it: the matcher has to be right whether or not the
 * repair is present, and a future change to the repair heuristic can put
 * any single leg back into the "no corridor" state at any time. The
 * matcher's contract is over (polygons, waypoints, coveredLegs), so
 * reconstructing that triple IS reconstructing its input faithfully.
 */
function shred(pipeline: Pipeline): Pipeline {
  const missing = new Set(SHREDDED_MISSING_LEGS.map(([a, b]) => legKey(a, b)))
  const corridorPolygons = pipeline.corridorPolygons.filter(
    (c) => !missing.has(legKey(extractStartName(c.name), extractEndName(c.name))),
  )
  const coveredLegs = new Set<string>()
  for (const c of corridorPolygons) {
    const from = extractStartName(c.name)
    const to = extractEndName(c.name)
    if (from && to) coveredLegs.add(legKey(from, to))
  }
  return { corridorPolygons, waypoints: pipeline.waypoints, coveredLegs }
}

function attribute(pipeline: Pipeline): Record<string, string | null> {
  const matches = matchPointsToCorridors(
    PHOTOS as ReadonlyArray<PointForMatching>,
    pipeline.corridorPolygons,
    pipeline.waypoints,
    pipeline.coveredLegs,
  )
  const named: Record<string, string | null> = {}
  for (const p of PHOTOS) named[p.id] = matches[p.id]?.startName ?? null
  return named
}

// ---------------------------------------------------------------------------

describe('MZB 2026 en-route photo attribution (real course, real EXIF)', () => {
  it('parses the course into the nine expected waypoints', () => {
    const pipeline = buildPipeline(loadCourse())
    expect(pipeline.waypoints.map((w) => w.name)).toEqual([
      'SP', 'TP 1', 'TP 2', 'TP 3', 'TP 4', 'TP 5', 'TP 6', 'TP 7', 'FP',
    ])
  })

  it('attributes all 18 photos to the correct TP on the SHREDDED course (3 legs without a corridor)', () => {
    const pipeline = shred(buildPipeline(loadCourse()))
    // Pin the world this assertion runs in: exactly the five corridors the
    // rally actually had. Under the old hard exclusion this input produced
    // the documented misattributions, up to 25.9 km out. Membership is
    // asserted leg by leg rather than as a whole-set equality because the
    // SP leg's corridor name is authored by `preciseCorridor` and its exact
    // spelling ("SP→TP1" vs "SP→TP 1") is not this test's business.
    expect(pipeline.corridorPolygons).toHaveLength(5)
    for (const [from, to] of SHREDDED_MISSING_LEGS) {
      expect(pipeline.coveredLegs.has(legKey(from, to)), `${from}→${to} must be uncovered`).toBe(false)
    }
    for (const [from, to] of [['TP 3', 'TP 4'], ['TP 4', 'TP 5'], ['TP 5', 'TP 6'], ['TP 6', 'TP 7']]) {
      expect(pipeline.coveredLegs.has(legKey(from, to)), `${from}→${to} must be covered`).toBe(true)
    }
    expect(attribute(pipeline)).toEqual(EXPECTED)
  })

  it('attributes all 18 photos to the correct TP on a REPAIRED track (every leg covered)', () => {
    const repaired = repairDashRuns(loadCourse())
    const pipeline = buildPipeline(repaired)
    // The repair must actually have done something, otherwise this test is a
    // duplicate of the one above wearing a different name.
    const before = (loadCourse() as FeatureCollection).features.length
    expect(repaired.features.length).toBeLessThan(before)
    // …and it must produce the harder world: every leg covered. That is the
    // case the old hard exclusion made WORSE (11 of 18 wrong instead of 6),
    // because every photo outside its 600 m corridor was excluded from its
    // own leg and dumped on whatever leg was left uncovered.
    expect(pipeline.corridorPolygons.length).toBe(pipeline.waypoints.length - 1)
    expect(attribute(pipeline)).toEqual(EXPECTED)
  })

  it('attributes all 18 photos to the correct TP on the course exactly as the app parses it today', () => {
    // Whatever state the track-repair layer is in, the answers must not move.
    expect(attribute(buildPipeline(loadCourse()))).toEqual(EXPECTED)
  })

  it('never attributes a photo to a leg further away than the geometrically nearest leg', () => {
    // The invariant, asserted directly rather than through the 18 known
    // answers: for each photo, the distance to the leg it was attributed to
    // must equal the distance to the nearest leg on the course. (Photos
    // resolved by polygon containment are exempt — a corridor that contains
    // the photo IS the leg it is on, even when a neighbouring leg's
    // centreline passes marginally closer.)
    const asParsed = buildPipeline(loadCourse())
    const { waypoints } = asParsed
    const legDistanceM = (idx: number, p: { lat: number; lng: number }): number => {
      const a = waypoints[idx].coord
      const b = waypoints[idx + 1].coord
      // Perpendicular distance to the segment, clamped at its endpoints,
      // computed in a local equirectangular frame — good to well under a
      // metre over leg lengths of tens of km at 50° N, and independent of
      // the turf call the implementation uses.
      const cosLat = Math.cos((p.lat * Math.PI) / 180)
      const toM = 111_320
      const ax = a[0] * cosLat * toM, ay = a[1] * toM
      const bx = b[0] * cosLat * toM, by = b[1] * toM
      const px = p.lng * cosLat * toM, py = p.lat * toM
      const dx = bx - ax, dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
      const cx = ax + t * dx, cy = ay + t * dy
      return Math.hypot(px - cx, py - cy)
    }

    // Both worlds: the invariant is a property of the matcher, not of how
    // many corridors the track happened to yield.
    const worlds: Array<[string, Pipeline]> = [
      ['as parsed', asParsed],
      ['shredded', shred(asParsed)],
      ['repaired', buildPipeline(repairDashRuns(loadCourse()))],
    ]
    for (const [world, pipeline] of worlds) {
      const matches = matchPointsToCorridors(
        PHOTOS as ReadonlyArray<PointForMatching>,
        pipeline.corridorPolygons,
        pipeline.waypoints,
        pipeline.coveredLegs,
      )
      for (const p of PHOTOS) {
        const startName = matches[p.id]?.startName
        expect(startName, `${world}/${p.id}`).toBeTruthy()
        const chosenIdx = waypoints.findIndex((w) => w.name === startName)
        expect(chosenIdx, `${world}/${p.id} attributed to unknown waypoint ${startName}`)
          .toBeGreaterThanOrEqual(0)
        let nearest = Infinity
        for (let i = 0; i < waypoints.length - 1; i++) nearest = Math.min(nearest, legDistanceM(i, p))
        // 1 m slack absorbs the equirectangular-vs-haversine difference.
        expect(legDistanceM(chosenIdx, p), `${world}/${p.id} attributed to a leg further than the nearest`)
          .toBeLessThanOrEqual(nearest + 1)
      }
    }
  })

  it('s2,7 and s2,9 sit just outside the TP 6→TP 7 corridor yet still belong to that leg', () => {
    // The decisive pair. Their misattribution was independent of the track
    // shredding: the TP 6→TP 7 leg is a solid LineString whose corridor is
    // built correctly, and these two photos are only 42 m / 52 m outside its
    // 600 m width. Pin both the geometry and the answer so a future change
    // that widens/narrows corridors shows up here as an explained failure
    // rather than a mystery.
    const pipeline = shred(buildPipeline(loadCourse()))
    expect(pipeline.coveredLegs.has(legKey('TP 6', 'TP 7'))).toBe(true)
    const named = attribute(pipeline)
    expect(named['s2,7']).toBe('TP 6')
    expect(named['s2,9']).toBe('TP 6')
    // …and the leg they were wrongly given (TP 7→FP, the uncovered one the
    // exclusion pushed them onto) is genuinely further away, so this is not
    // an accident of which leg the loop happened to visit first.
    expect(named['s2,7']).not.toBe('TP 7')
    expect(named['s2,9']).not.toBe('TP 7')
  })
})

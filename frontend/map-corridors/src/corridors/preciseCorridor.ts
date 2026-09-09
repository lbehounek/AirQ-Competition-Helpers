import type { Feature, FeatureCollection, GeoJSON, LineString, Point, Position } from 'geojson'
// Individual @turf subpackages rather than the `@turf/turf` barrel (see
// setSplit/partitionPicksBySet.ts) — same modules, no phantom dependency.
import { lineString, point } from '@turf/helpers'
import { length as turfLength } from '@turf/length'
import { getCoord } from '@turf/invariant'
import { bearing as turfBearing } from '@turf/bearing'
import { destination } from '@turf/destination'
import { nearestPointOnLine } from '@turf/nearest-point-on-line'
import { lineIntersect } from '@turf/line-intersect'
import type { LonLatAlt, Segment } from './segments'
import { calculateDistance, buildContinuousTrackWithSources, isTpGatePerpendicular } from './segments'

const DEBUG = (import.meta as any)?.env?.VITE_DEBUG_CORRIDORS === 'true' || (import.meta as any)?.env?.VITE_DEBUG_CORRIDORS === '1'
const log = (...args: any[]) => { if (DEBUG) console.log(...args) }

export type CorridorOutput = {
  left: Feature<LineString>
  right: Feature<LineString>
}

export type DisciplineConfig = {
  spAfterNm: number
  tpAfterNm: number
  leftDistanceM: number
  rightDistanceM: number
}

// Discipline is the shared cross-app type — re-exported here so the
// many existing `import type { Discipline } from './corridors/preciseCorridor'`
// callsites keep resolving without a sweep.
export type { Discipline } from '@airq/shared-discipline'
import type { Discipline } from '@airq/shared-discipline'

export const DISCIPLINE_CONFIGS: Record<Discipline, DisciplineConfig> = {
  precision: { spAfterNm: 0.5, tpAfterNm: 0.5, leftDistanceM: 100, rightDistanceM: 0 },
  rally:     { spAfterNm: 5.0, tpAfterNm: 1.0, leftDistanceM: 300, rightDistanceM: 300 },
}

// How far from a waypoint label we will look for its gate perpendicular.
const MAX_GATE_SEARCH_M = 2000
// A gate crossing further than this from the label is not this waypoint's.
const MAX_EXACT_SNAP_M = 500
// A gate is placed this far short of the next waypoint at the latest, so a
// short leg still leaves a corridor between the gate and the turn.
const GATE_MARGIN_M = 200

function calculateBearing(a: LonLatAlt, b: LonLatAlt): number {
  return turfBearing(point([a[0], a[1]]), point([b[0], b[1]]))
}

function projectCoordinate(origin: LonLatAlt, bearingDeg: number, distanceMeters: number): LonLatAlt {
  const dest = destination(point([origin[0], origin[1]]), distanceMeters / 1000, bearingDeg, { units: 'kilometers' })
  const [lon, lat] = getCoord(dest)
  return [lon, lat, origin[2]]
}

// moved: isDashedConnectorLine/extract/buildContinuousTrack* to segments.ts

export function generateLeftRightCorridor(track: LonLatAlt[], leftDistanceM = 300, rightDistanceM = 300): CorridorOutput | null {
  if (track.length < 2) return null

  // Simple segment-by-segment approach: no averaging, no complex bearing calculations
  // Each segment gets processed independently with start→end bearing
  const left: LonLatAlt[] = []
  const right: LonLatAlt[] = []
  const bearings: number[] = []
  const segLengths: number[] = []

  // Process each segment independently
  for (let i = 0; i < track.length - 1; i++) {
    const segmentStart = track[i]
    const segmentEnd = track[i + 1]

    // Calculate single bearing for this entire segment
    const segmentBearing = calculateBearing(segmentStart, segmentEnd)
    bearings.push(segmentBearing)
    // compute length for last-leg heuristics
    const segLenM = turfLength(lineString([[segmentStart[0], segmentStart[1]], [segmentEnd[0], segmentEnd[1]]]), { units: 'kilometers' }) * 1000
    segLengths.push(segLenM)
    const leftBearing = (segmentBearing - 90 + 360) % 360
    const rightBearing = (segmentBearing + 90) % 360

    // Offset start point of segment
    if (i === 0) {
      left.push(projectCoordinate(segmentStart, leftBearing, leftDistanceM))
      right.push(rightDistanceM > 0 ? projectCoordinate(segmentStart, rightBearing, rightDistanceM) : [...segmentStart] as LonLatAlt)
    }

    // Offset end point of segment (always add, creates clean segment boundaries)
    // For the very last segment, consider freezing bearing if last leg is tiny or sharply turns
    if (i === track.length - 2 && bearings.length >= 2) {
      const lastLen = segLengths[segLengths.length - 1]
      const prevBearing = bearings[bearings.length - 2]
      const angleDiff = Math.abs(((segmentBearing - prevBearing + 540) % 360) - 180)
      const isTiny = lastLen < 40 // meters threshold
      const isSharp = angleDiff > 50 // degrees threshold
      const finalBearing = (isTiny || isSharp) ? prevBearing : segmentBearing
      const finalLeftBearing = (finalBearing - 90 + 360) % 360
      const finalRightBearing = (finalBearing + 90) % 360
      left.push(projectCoordinate(segmentEnd, finalLeftBearing, leftDistanceM))
      right.push(rightDistanceM > 0 ? projectCoordinate(segmentEnd, finalRightBearing, rightDistanceM) : [...segmentEnd] as LonLatAlt)
    } else {
      left.push(projectCoordinate(segmentEnd, leftBearing, leftDistanceM))
      right.push(rightDistanceM > 0 ? projectCoordinate(segmentEnd, rightBearing, rightDistanceM) : [...segmentEnd] as LonLatAlt)
    }
  }
  
  return {
    left: lineString(left as Position[], { role: 'left', color: 'green' }),
    right: lineString(right as Position[], { role: 'right', color: 'green' }),
  }
}

/** `TP`/`CP` prefix, optional space/hyphen/underscore, then the number. */
const TP_NAME_PATTERN = /^(TP|CP)[\s\-_]?\d+\b/i

/**
 * The first run of digits in a waypoint name, used to order turning points.
 * Stripping every non-digit instead — the old behaviour — turned `CP 1 A` into
 * 11, which sorted it after `TP 10`.
 */
export function turningPointNumber(name: string): number {
  const m = name.match(/\d+/)
  return m ? parseInt(m[0], 10) : 0
}

export function findNamedPoints(input: GeoJSON): { sp?: LonLatAlt, tps: Array<{ name: string, coord: LonLatAlt }>, fp?: LonLatAlt, unrecognised: string[] } {
  const out: { sp?: LonLatAlt, tps: Array<{ name: string, coord: LonLatAlt }>, fp?: LonLatAlt, unrecognised: string[] } = { tps: [], unrecognised: [] }
  function scan(g: any) {
    if (!g) return
    if (g.type === 'FeatureCollection') {
      for (const f of (g as FeatureCollection).features) scan(f)
    } else if (g.type === 'Feature') {
      const f = g as Feature
      const geom = f.geometry
      const nameRaw = (f.properties?.name || f.properties?.Name || f.properties?.title) as string | undefined
      const name = nameRaw?.trim()
      if (geom?.type === 'Point' && name) {
        const p = geom as Point
        const c = p.coordinates as LonLatAlt
        if (name === 'SP') out.sp = c
        else if (name === 'FP') out.fp = c
        // Rally/Precision source KMLs name turning points as `TP n` or
        // `CP n` (Control Point) depending on the authoring tool.
        // Accept either prefix, optional space, one or more digits
        // (e.g. `TP1`, `TP 1`, `TP10`, `CP 15`) — feedback 2026-04-23.
        // Separator is optional and may be a space, hyphen or underscore:
        // `TP1`, `TP 1`, `TP-3`, `CP_15` all occur in the wild. Still anchored
        // on the prefix so a settlement named "Tperice" cannot match.
        else if (TP_NAME_PATTERN.test(name)) out.tps.push({ name, coord: c })
        // Anything else that is named but unmatched gets reported rather than
        // silently ignored. A placemark the author meant as a turning point but
        // typed as `OT 4` used to vanish, taking its corridor leg with it.
        // `SC n` scenic points are a deliberate, known exclusion.
        else if (!/^SC\s?\d*/i.test(name)) out.unrecognised.push(name)
      }
    }
  }
  scan(input)
  // sort TPs by number if present
  out.tps.sort((a, b) => turningPointNumber(a.name) - turningPointNumber(b.name))
  return out
}

// Removed redundant dashed-pair heuristics; rely on continuity and main-track-only build

export function nearestTrackIndex(track: LonLatAlt[], target: LonLatAlt): number {
  // Approximate: the vertex minimising planar distance. A degree of longitude
  // is only cos(latitude) as long as a degree of latitude — 0.64 at 50°N — so
  // comparing raw degrees stretches the east-west axis and can prefer a vertex
  // that is further away on the ground. Measured over 1680 waypoint
  // resolutions the raw and corrected metrics disagreed 19 times; correctness,
  // not a fix for any reported symptom.
  const cosLat = Math.cos(target[1] * Math.PI / 180)
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < track.length; i++) {
    const dx = (track[i][0] - target[0]) * cosLat
    const dy = track[i][1] - target[1]
    const d = dx * dx + dy * dy
    if (d < bestDist) { bestDist = d; bestIdx = i }
  }
  return bestIdx
}

export function pointAtDistanceAlongTrack(track: LonLatAlt[], startIdx: number, distanceMeters: number): { point: LonLatAlt, bearing: number, segmentIndex: number } | null {
  // A one-vertex track has no segment to walk, and the tail return below would
  // read track[-1]. The `| null` in the signature existed for this case but was
  // never actually produced, so callers' guards were dead code.
  if (track.length < 2) return null
  // walk segments from startIdx and interpolate
  let remaining = distanceMeters
  for (let i = startIdx; i < track.length - 1; i++) {
    const a = track[i]
    const b = track[i + 1]
    // use turf distance
    const segLenM = turfLength(lineString([ [a[0], a[1]], [b[0], b[1]] ]), { units: 'kilometers' }) * 1000
    if (remaining <= segLenM) {
      const brg = calculateBearing(a, b)
      const p = projectCoordinate(a, brg, remaining)
      return { point: p, bearing: brg, segmentIndex: i }
    }
    remaining -= segLenM
  }
  const lastBrg = calculateBearing(track[track.length - 2], track[track.length - 1])
  return { point: track[track.length - 1], bearing: lastBrg, segmentIndex: track.length - 2 }
}

export function buildGateAtPoint(center: LonLatAlt, localBearingDeg: number, leftDistanceM: number, rightDistanceM: number): Feature<LineString> {
  const leftBearing = (localBearingDeg - 90 + 360) % 360
  const left = projectCoordinate(center, leftBearing, leftDistanceM)
  const right = rightDistanceM > 0
    ? projectCoordinate(center, (localBearingDeg + 90) % 360, rightDistanceM)
    : [...center] as LonLatAlt
  return lineString([left as Position, right as Position], { role: 'gate', color: 'red' })
}

/** Along-track distance in metres between two track vertex indices. */
function trackDistanceBetween(track: LonLatAlt[], fromIdx: number, toIdx: number): number {
  const lo = Math.min(fromIdx, toIdx)
  const hi = Math.min(Math.max(fromIdx, toIdx), track.length - 1)
  let total = 0
  for (let i = lo; i < hi; i++) total += calculateDistance(track[i], track[i + 1])
  return total
}

/**
 * The gate sits a fixed distance after a waypoint — 5 NM after SP, 1 NM after
 * each TP — with nothing stopping it from landing *past* the next waypoint.
 * When it does, start and end snap to the same segment and the corridor becomes
 * a two-point stub running backwards; when two consecutive legs together are
 * shorter than the offset, the slice comes out empty and BOTH legs vanish.
 * Clamp the walk to this leg, and report null when the leg cannot hold a gate
 * at all so the caller can say so instead of drawing nonsense.
 */
function clampedGateOffset(track: LonLatAlt[], fromIdx: number, toIdx: number, desiredM: number): number | null {
  const usable = trackDistanceBetween(track, fromIdx, toIdx) - GATE_MARGIN_M
  if (usable <= 0) return null
  return Math.min(desiredM, usable)
}

function isSpanOnMain(fromIdx: number, toIdx: number, sourceSegIdx: number[], gapAfterIndex: boolean[], mainSegmentIndexSet: Set<number>): boolean {
  if (fromIdx > toIdx) return false
  if (fromIdx === toIdx) {
    // A single-segment span can still BE the synthetic chord the track builder
    // welds across a gap, so it must face the same gap test as the loop below.
    // Without this the MZB 2026 rally drew a corridor straight along an 11.6 km
    // chord from TP 4 to TP 6: both the gate and the next turning point landed
    // on that one chord segment, fromIdx === toIdx, and the gap was never
    // consulted. The result bypassed a real turn and looked plausible.
    if (gapAfterIndex[fromIdx]) return false
    const segIdx = sourceSegIdx[fromIdx]
    return mainSegmentIndexSet.has(segIdx)
  }
  for (let i = fromIdx; i < toIdx; i++) {
    if (gapAfterIndex[i]) return false
    const a = sourceSegIdx[i]
    const b = sourceSegIdx[i + 1]
    if (!mainSegmentIndexSet.has(a) || !mainSegmentIndexSet.has(b)) return false
  }
  return true
}

function maybeBuildGateFromStartIdxDistance(
  track: LonLatAlt[],
  startIdx: number,
  distanceMeters: number,
  leftDistanceM: number,
  rightDistanceM: number,
  sourceSegIdx: number[],
  gapAfterIndex: boolean[],
  mainSegmentIndexSet: Set<number>
): Feature<LineString> | null {
  const along = pointAtDistanceAlongTrack(track, startIdx, distanceMeters)
  if (!along) return null
  const fromIdx = Math.min(startIdx, along.segmentIndex)
  const toIdx = Math.max(startIdx, along.segmentIndex)
  if (!isSpanOnMain(fromIdx, toIdx, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet)) return null
  return buildGateAtPoint(along.point, along.bearing, leftDistanceM, rightDistanceM)
}

type WaypointData = {
  sp?: LonLatAlt
  tps: Array<{ name: string, coord: LonLatAlt }>
  fp?: LonLatAlt
}

function snapPointToTrack(track: LonLatAlt[], target: LonLatAlt): { point: LonLatAlt, segmentIndex: number, bearing: number } {
  if (track.length < 2) return { point: track[0], segmentIndex: 0, bearing: 0 }
  
  // Use turf's nearestPointOnLine to find the exact snapped point
  const line = lineString(track.map(c => [c[0], c[1]]) as Position[])
  const snapped = nearestPointOnLine(line, point([target[0], target[1]]))
  const [lon, lat] = getCoord(snapped)
  let segIndex = Math.max(0, Math.min((snapped.properties?.index as number) ?? 0, track.length - 2))
  // Prefer incoming segment if we are essentially at a vertex
  const t = (snapped.properties?.t as number) ?? undefined // position along segment [0..1]
  const atVertex = Number.isFinite(t as any) && ((t as number) < 1e-3 || (t as number) > 1 - 1e-3)
  if (atVertex && (t as number) > 1 - 1e-3) {
    // at end of segment → pick incoming
    if (segIndex > 0) segIndex = segIndex - 1
  }
  
  // FIXED: Use the bearing of the actual segment the point lies on
  const brg = calculateBearing(track[segIndex], track[segIndex + 1])
  return { point: [lon, lat, target[2] || 0], segmentIndex: segIndex, bearing: brg }
}

function buildPreciseSlice(track: LonLatAlt[], start: { point: LonLatAlt, segmentIndex: number }, end: { point: LonLatAlt, segmentIndex: number }): LonLatAlt[] {
  if (start.segmentIndex > end.segmentIndex) return []
  if (start.segmentIndex === end.segmentIndex) return [start.point, end.point]
  const out: LonLatAlt[] = []
  out.push(start.point)
  // include intermediate vertices strictly between segments
  for (let i = start.segmentIndex + 1; i <= end.segmentIndex; i++) {
    out.push(track[i])
  }
  out.push(end.point)
  return out
}

export function generateSegmentedCorridors(
  track: LonLatAlt[],
  waypoints: WaypointData,
  leftDistanceM: number,
  rightDistanceM: number,
  _originalInput: GeoJSON,
  sourceSegIdx: number[],
  gapAfterIndex: boolean[],
  mainSegmentIndexSet: Set<number>,
  _segments: Segment[],
  spAfterNm: number = 5,
  tpAfterNm: number = 1
): { leftSegments: Feature<LineString>[], rightSegments: Feature<LineString>[], endGates: Feature<LineString>[], warnings: string[] } {
  log('\n=== GENERATING SEGMENTED CORRIDORS ===')
  
  const NM = 1852
  const leftSegments: Feature<LineString>[] = []
  const rightSegments: Feature<LineString>[] = []
  const endGates: Feature<LineString>[] = []
  // Every abandoned leg appends here. Dropping a corridor silently is what
  // let a whole competition ship on a map with five wrong legs.
  const warnings: string[] = []
  
  // Step 1: Validate we have required waypoints
  if (!waypoints.sp || waypoints.tps.length === 0) {
    warnings.push('No corridors: the course needs an SP and at least one turning point.')
    return { leftSegments, rightSegments, endGates, warnings }
  }
  
  log(`✅ Found: SP + ${waypoints.tps.length} TPs + ${waypoints.fp ? 'FP' : 'no FP'}`)
  
  // Step 2: walk the route as consecutive waypoint pairs. A leg is defined
  // purely by adjacency in this list, which is why a single dropped or
  // mis-ordered entry used to draw a corridor straight past a real turn.
  const route: Array<{ name: string, coord: LonLatAlt }> = [
    { name: 'SP', coord: waypoints.sp },
    ...waypoints.tps,
  ]
  if (waypoints.fp) route.push({ name: 'FP', coord: waypoints.fp })

  // Non-consecutive turning-point numbers mean a waypoint was lost upstream —
  // an unreadable name, a missing gate, geometry filtered away. The corridor
  // that spans the hole looks entirely normal on the map, so say it out loud.
  for (let i = 1; i < waypoints.tps.length; i++) {
    const prev = turningPointNumber(waypoints.tps[i - 1].name)
    const cur = turningPointNumber(waypoints.tps[i].name)
    if (cur !== prev + 1) {
      warnings.push(`Corridor jumps ${waypoints.tps[i - 1].name} → ${waypoints.tps[i].name} — turning point numbers are not consecutive.`)
    }
  }

  // Step 3: one corridor per leg, running from this leg's gate to the next
  // waypoint. Every abandoned leg appends a warning; none may exit quietly.
  for (let i = 0; i < route.length - 1; i++) {
    const from = route[i]
    const to = route[i + 1]
    const offsetNm = i === 0 ? spAfterNm : tpAfterNm
    // Use the waypoint's own name. The SP leg used to hardcode `TP1` while
    // every other leg used the KML's name, so on a course naming its points
    // `TP 1` the SP leg's key never matched the route and that leg was treated
    // as uncovered for the whole rest of the pipeline.
    const segmentName = `${offsetNm}NM-after-${from.name}→${to.name}`

    const fromIdx = nearestTrackIndex(track, from.coord)
    const toIdx = nearestTrackIndex(track, to.coord)

    const offsetM = clampedGateOffset(track, fromIdx, toIdx, offsetNm * NM)
    if (offsetM === null) {
      warnings.push(`No corridor ${from.name} → ${to.name}: the leg is too short to place the ${offsetNm} NM gate.`)
      continue
    }
    const gateAlong = pointAtDistanceAlongTrack(track, fromIdx, offsetM)
    if (!gateAlong) {
      warnings.push(`No corridor ${from.name} → ${to.name}: no usable track after ${from.name}.`)
      continue
    }
    // Use the exact gate position and bearing; re-snapping loses both.
    const start = { point: gateAlong.point, segmentIndex: gateAlong.segmentIndex }
    const end = snapPointToTrack(track, to.coord)

    const fromSeg = Math.min(start.segmentIndex, end.segmentIndex)
    const toSeg = Math.max(start.segmentIndex, end.segmentIndex)
    if (!isSpanOnMain(fromSeg, toSeg, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet)) {
      warnings.push(`No corridor ${from.name} → ${to.name}: the track is interrupted between them.`)
      continue
    }

    const preciseSlice = buildPreciseSlice(track, start, { point: end.point, segmentIndex: end.segmentIndex })
    if (preciseSlice.length < 2) {
      warnings.push(`No corridor ${from.name} → ${to.name}: the gate falls at or beyond ${to.name}.`)
      continue
    }

    const lr = generateLeftRightCorridor(preciseSlice, leftDistanceM, rightDistanceM)
    if (!lr) {
      warnings.push(`No corridor ${from.name} → ${to.name}: corridor geometry could not be built.`)
      continue
    }
    leftSegments.push(lineString(lr.left.geometry.coordinates as Position[], { segment: segmentName }))
    rightSegments.push(lineString(lr.right.geometry.coordinates as Position[], { segment: segmentName }))
    log(`🟢 Corridor ${i + 1}: ${segmentName} (${start.segmentIndex}→${end.segmentIndex})`)
  }

  log(`\n🎯 RESULT: Generated ${leftSegments.length} corridor segments with gaps in forbidden zones`)
  
  return { leftSegments, rightSegments, endGates, warnings }
}

function extractGateCenterCandidates(input: GeoJSON): Array<{ center: LonLatAlt, line: Feature<LineString> } > {
  const out: Array<{ center: LonLatAlt, line: Feature<LineString> }> = []
  function scan(g: any) {
    if (!g) return
    if (g.type === 'FeatureCollection') {
      for (const f of (g as FeatureCollection).features) scan(f)
    } else if (g.type === 'Feature') {
      const f = g as Feature
      const geom = f.geometry
      if (geom?.type === 'LineString') {
        const ls = geom as LineString
        const coords = ls.coordinates as LonLatAlt[]
        if (isTpGatePerpendicular(coords)) {
          const center = coords[1]
          out.push({ center, line: lineString(coords as Position[]) })
        }
      }
    } else if (g.type === 'LineString') {
      const ls = g as LineString
      const coords = ls.coordinates as LonLatAlt[]
      if (isTpGatePerpendicular(coords)) {
        const center = coords[1]
        out.push({ center, line: lineString(coords as Position[]) })
      }
    }
  }
  scan(input)
  return out
}

function computeExactWaypoints(input: GeoJSON, track: LonLatAlt[]): { sp?: LonLatAlt, tps: Array<{ name: string, coord: LonLatAlt }>, fp?: LonLatAlt, exactPointFeatures: Feature<Point>[] } {
  const named = findNamedPoints(input)
  const candidates = extractGateCenterCandidates(input)
  const exactPointFeatures: Feature<Point>[] = []
  const result: { sp?: LonLatAlt, tps: Array<{ name: string, coord: LonLatAlt }>, fp?: LonLatAlt } = { tps: [] }

  const trackLine = lineString(track.map(c => [c[0], c[1]]) as Position[])

  function attachExact(name: string, approx: LonLatAlt): LonLatAlt | undefined {
    // Find the candidate gate nearest this label that also crosses the track.
    // Proximity is filtered first so a scenic point's gate cannot be stolen.
    let bestIdx = -1
    let bestD = Infinity
    for (let i = 0; i < candidates.length; i++) {
      // Measured on the ground, not in raw squared degrees. `d2 <= 0.0004`
      // described itself as "~2 km" but is really an ellipse 2.23 km
      // north-south by 1.43 km east-west at 50°N, so it could disqualify a
      // turning point's own gate purely for lying east of it.
      const d = calculateDistance(candidates[i].center, approx)
      if (d > MAX_GATE_SEARCH_M) continue
      const gate = candidates[i].line
      const ints = lineIntersect(trackLine, gate)
      if (!ints || !ints.features.length) continue
      if (d < bestD) { bestD = d; bestIdx = i }
    }
    if (bestIdx !== -1) {
      const gate = candidates[bestIdx].line
      const intersections = lineIntersect(trackLine, gate)
      if (intersections && intersections.features.length) {
        // A gate perpendicular reaches ~926 m each side, so wherever the course
        // passes within that of itself the gate crosses the track TWICE. The
        // old code took features[0] — turf's sweepline order, which has nothing
        // to do with which crossing belongs to this turning point, and picked
        // the wrong one by 109 m vs 71 m in the reproduced case. Take the
        // crossing nearest the label instead.
        let best: Feature<Point> | null = null
        let bestDist = Infinity
        for (const f of intersections.features) {
          const c = getCoord(f) as LonLatAlt
          const dist = calculateDistance(c, approx)
          if (dist < bestDist) { bestDist = dist; best = f as Feature<Point> }
        }
        if (best && bestDist <= MAX_EXACT_SNAP_M) {
          const [lon, lat] = getCoord(best)
          const exact: LonLatAlt = [lon, lat, approx[2] || 0]
          exactPointFeatures.push(point([lon, lat], { name, role: 'exact' }) as Feature<Point>)
          return exact
        }
        // Every crossing of this gate is implausibly far from the label; fall
        // through to the plain snap rather than trust it.
      }
    }
    // Fallback: snap the label to the track as the exact point
    const snapped = nearestPointOnLine(trackLine, point([approx[0], approx[1]]))
    const [lon, lat] = getCoord(snapped)
    const exact: LonLatAlt = [lon, lat, approx[2] || 0]
    exactPointFeatures.push(point([lon, lat], { name, role: 'exact' }) as Feature<Point>)
    return exact
  }

  if (named.sp) {
    const exact = attachExact('SP', named.sp)
    if (exact) result.sp = exact
  }
  for (const tp of named.tps) {
    const exact = attachExact(tp.name, tp.coord)
    if (exact) result.tps.push({ name: tp.name, coord: exact })
  }
  if (named.fp) {
    const exact = attachExact('FP', named.fp)
    if (exact) result.fp = exact
  }

  // keep TP order
  result.tps.sort((a, b) => turningPointNumber(a.name) - turningPointNumber(b.name))

  return { ...result, exactPointFeatures }
}

export function buildPreciseCorridorsAndGates(input: GeoJSON, config: DisciplineConfig = DISCIPLINE_CONFIGS.rally): { gates: Feature<LineString>[], points: Feature<Point>[], exactPoints: Feature<Point>[], leftSegments: Feature<LineString>[], rightSegments: Feature<LineString>[], warnings: string[] } {
  const { spAfterNm, tpAfterNm, leftDistanceM, rightDistanceM } = config
  const { track, sourceSegIdx, gapAfterIndex, segments, mainSegmentIndexSet, diagnostics } = buildContinuousTrackWithSources(input)
  const warnings: string[] = []
  const gates: Feature<LineString>[] = []
  const points: Feature<Point>[] = []
  const exactPoints: Feature<Point>[] = []
  const leftSegments: Feature<LineString>[] = []
  const rightSegments: Feature<LineString>[] = []
  
  const named = findNamedPoints(input)
  const { sp, tps, fp, exactPointFeatures } = computeExactWaypoints(input, track)
  exactPoints.push(...exactPointFeatures)
  const NM = 1852
  
  // Add SP point label
  if (named.sp) points.push(point([named.sp[0], named.sp[1]], { name: 'SP', role: 'waypoint' }) as Feature<Point>)
  if (sp) {
    const idx = nearestTrackIndex(track, sp)
    // Clamp to the SP→TP1 leg. A first leg shorter than spAfterNm used to put
    // this gate beyond TP 1, collapsing the corridor into a backwards stub.
    const nextAfterSp = tps[0]?.coord ?? fp
    const spOffsetM = nextAfterSp ? clampedGateOffset(track, idx, nearestTrackIndex(track, nextAfterSp), spAfterNm * NM) : spAfterNm * NM
    const gate = spOffsetM === null ? null : maybeBuildGateFromStartIdxDistance(track, idx, spOffsetM, leftDistanceM, rightDistanceM, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet)
    if (gate) gates.push(gate)
  }
  
  // Add TP point labels and gates 1NM AFTER each TP
  for (let i = 0; i < tps.length; i++) {
    const tp = tps[i]
    // add visual label at provided label position
    const labelTp = named.tps[i]
    if (labelTp) {
      points.push(point([labelTp.coord[0], labelTp.coord[1]], { name: labelTp.name, role: 'waypoint' }) as Feature<Point>)
    }
    const idx = nearestTrackIndex(track, tp.coord)
    // Same clamp, against whichever waypoint follows this one.
    const nextAfterTp = tps[i + 1]?.coord ?? fp
    const tpOffsetM = nextAfterTp ? clampedGateOffset(track, idx, nearestTrackIndex(track, nextAfterTp), tpAfterNm * NM) : tpAfterNm * NM
    const gate = tpOffsetM === null ? null : maybeBuildGateFromStartIdxDistance(track, idx, tpOffsetM, leftDistanceM, rightDistanceM, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet)
    if (gate) gates.push(gate)
  }
  
  // Add FP point label (no gate after FP)
  if (named.fp) points.push(point([named.fp[0], named.fp[1]], { name: 'FP', role: 'waypoint' }) as Feature<Point>)
  
  // Generate segmented corridors with forbidden zones using exact waypoints
  if (track.length >= 2) {
    const corridorSegments = generateSegmentedCorridors(track, { sp, tps, fp }, leftDistanceM, rightDistanceM, input, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet, segments, spAfterNm, tpAfterNm)
    leftSegments.push(...corridorSegments.leftSegments)
    rightSegments.push(...corridorSegments.rightSegments)
    warnings.push(...corridorSegments.warnings)
    // Note: endGates are available in corridorSegments.endGates if needed
  } else {
    warnings.push('No corridors: the file contains no usable track geometry.')
  }

  // Everything a reader needs in order to distrust this map, in one place.
  // A placemark the author meant as a turning point but named unusually used to
  // disappear without trace, and its corridor leg with it.
  if (named.unrecognised.length) {
    warnings.push(`${named.unrecognised.length} placemark(s) not recognised as turning points: ${named.unrecognised.map(n => `"${n}"`).join(', ')}.`)
  }
  for (const run of diagnostics.mergedDashRuns) {
    warnings.push(`Reconstructed a leg drawn as ${run.dashes} dashes of ${Math.round(run.dashLengthM)} m (${(run.spanM / 1000).toFixed(1)} km total) into continuous track.`)
  }
  if (diagnostics.gapCount > 0) {
    warnings.push(`The track has ${diagnostics.gapCount} gap(s); no corridor is drawn across a gap.`)
  }

  return { gates, points, exactPoints, leftSegments, rightSegments, warnings }
}



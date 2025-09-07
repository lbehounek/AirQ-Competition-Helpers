import type { Feature, FeatureCollection, GeoJSON, LineString, Point, Position } from 'geojson'
import { lineString, length as turfLength, getCoord, bearing as turfBearing, destination, point, nearestPointOnLine, lineIntersect } from '@turf/turf'
import type { LonLatAlt, Segment } from './segments'
import { calculateDistance, buildContinuousTrackWithSources } from './segments'

const DEBUG = (import.meta as any)?.env?.VITE_DEBUG_CORRIDORS === 'true' || (import.meta as any)?.env?.VITE_DEBUG_CORRIDORS === '1'
const log = (...args: any[]) => { if (DEBUG) console.log(...args) }

export type CorridorOutput = {
  left: Feature<LineString>
  right: Feature<LineString>
}

function calculateBearing(a: LonLatAlt, b: LonLatAlt): number {
  return turfBearing(point([a[0], a[1]]), point([b[0], b[1]]))
}

function projectCoordinate(origin: LonLatAlt, bearingDeg: number, distanceMeters: number): LonLatAlt {
  const dest = destination(point([origin[0], origin[1]]), distanceMeters / 1000, bearingDeg, { units: 'kilometers' })
  const [lon, lat] = getCoord(dest)
  return [lon, lat, origin[2]]
}

// moved: isDashedConnectorLine/extract/buildContinuousTrack* to segments.ts

export function generateLeftRightCorridor(track: LonLatAlt[], corridorDistanceM = 300): CorridorOutput | null {
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
      left.push(projectCoordinate(segmentStart, leftBearing, corridorDistanceM))
      right.push(projectCoordinate(segmentStart, rightBearing, corridorDistanceM))
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
      left.push(projectCoordinate(segmentEnd, finalLeftBearing, corridorDistanceM))
      right.push(projectCoordinate(segmentEnd, finalRightBearing, corridorDistanceM))
    } else {
      left.push(projectCoordinate(segmentEnd, leftBearing, corridorDistanceM))
      right.push(projectCoordinate(segmentEnd, rightBearing, corridorDistanceM))
    }
  }
  
  return {
    left: lineString(left as Position[], { role: 'left', color: 'green' }),
    right: lineString(right as Position[], { role: 'right', color: 'green' }),
  }
}

export function findNamedPoints(input: GeoJSON): { sp?: LonLatAlt, tps: Array<{ name: string, coord: LonLatAlt }>, fp?: LonLatAlt } {
  const out: { sp?: LonLatAlt, tps: Array<{ name: string, coord: LonLatAlt }>, fp?: LonLatAlt } = { tps: [] }
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
        else if (name.startsWith('TP ')) out.tps.push({ name, coord: c })
      }
    }
  }
  scan(input)
  // sort TPs by number if present
  out.tps.sort((a, b) => {
    const na = parseInt(a.name.split(' ').pop() || '0', 10)
    const nb = parseInt(b.name.split(' ').pop() || '0', 10)
    return na - nb
  })
  return out
}

// Removed redundant dashed-pair heuristics; rely on continuity and main-track-only build

export function nearestTrackIndex(track: LonLatAlt[], target: LonLatAlt): number {
  // approximate: choose the index minimizing distance along vertices
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < track.length; i++) {
    const dx = track[i][0] - target[0]
    const dy = track[i][1] - target[1]
    const d = dx * dx + dy * dy
    if (d < bestDist) { bestDist = d; bestIdx = i }
  }
  return bestIdx
}

export function pointAtDistanceAlongTrack(track: LonLatAlt[], startIdx: number, distanceMeters: number): { point: LonLatAlt, bearing: number, segmentIndex: number } | null {
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

export function buildGateAtPoint(center: LonLatAlt, localBearingDeg: number, corridorDistanceM: number): Feature<LineString> {
  const leftBearing = (localBearingDeg - 90 + 360) % 360
  const rightBearing = (localBearingDeg + 90) % 360
  const left = projectCoordinate(center, leftBearing, corridorDistanceM)
  const right = projectCoordinate(center, rightBearing, corridorDistanceM)
  return lineString([left as Position, right as Position], { role: 'gate', color: 'red' })
}

function isSpanOnMain(fromIdx: number, toIdx: number, sourceSegIdx: number[], gapAfterIndex: boolean[], mainSegmentIndexSet: Set<number>): boolean {
  if (fromIdx > toIdx) return false
  if (fromIdx === toIdx) {
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
  corridorDistanceM: number,
  sourceSegIdx: number[],
  gapAfterIndex: boolean[],
  mainSegmentIndexSet: Set<number>
): Feature<LineString> | null {
  const along = pointAtDistanceAlongTrack(track, startIdx, distanceMeters)
  if (!along) return null
  const fromIdx = Math.min(startIdx, along.segmentIndex)
  const toIdx = Math.max(startIdx, along.segmentIndex)
  if (!isSpanOnMain(fromIdx, toIdx, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet)) return null
  return buildGateAtPoint(along.point, along.bearing, corridorDistanceM)
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
  corridorDistanceM: number,
  _originalInput: GeoJSON,
  sourceSegIdx: number[],
  gapAfterIndex: boolean[],
  mainSegmentIndexSet: Set<number>,
  _segments: Segment[]
): { leftSegments: Feature<LineString>[], rightSegments: Feature<LineString>[], endGates: Feature<LineString>[] } {
  log('\n=== GENERATING SEGMENTED CORRIDORS ===')
  
  const NM = 1852
  const leftSegments: Feature<LineString>[] = []
  const rightSegments: Feature<LineString>[] = []
  const endGates: Feature<LineString>[] = []
  
  // Step 1: Validate we have required waypoints
  if (!waypoints.sp || waypoints.tps.length === 0) {
    console.log('❌ Missing SP or TPs - cannot generate corridors')
    return { leftSegments, rightSegments, endGates }
  }
  
  log(`✅ Found: SP + ${waypoints.tps.length} TPs + ${waypoints.fp ? 'FP' : 'no FP'}`)
  
  // Step 2: Calculate all gate positions (where corridors START)
  const gatePositions: Array<{ trackIdx: number, name: string, distanceNM: number }> = []
  
  // Gate 1: 5NM after SP
  const spIdx = nearestTrackIndex(track, waypoints.sp)
  const sp5nmResult = pointAtDistanceAlongTrack(track, spIdx, 5 * NM)
  if (sp5nmResult) {
    const sp5nmIdx = nearestTrackIndex(track, sp5nmResult.point)
    gatePositions.push({ trackIdx: sp5nmIdx, name: '5NM-after-SP', distanceNM: 5 })
    log(`📍 Gate 1: 5NM after SP at track index ${sp5nmIdx}`)
  }
  
  // Gates 2+: 1NM after each TP
  for (let i = 0; i < waypoints.tps.length; i++) {
    const tp = waypoints.tps[i]
    const tpIdx = nearestTrackIndex(track, tp.coord)
    const tp1nmResult = pointAtDistanceAlongTrack(track, tpIdx, 1 * NM)
    if (tp1nmResult) {
      const tp1nmIdx = nearestTrackIndex(track, tp1nmResult.point)
      gatePositions.push({ trackIdx: tp1nmIdx, name: `1NM-after-${tp.name}`, distanceNM: 1 })
      log(`📍 Gate ${i + 2}: 1NM after ${tp.name} at track index ${tp1nmIdx}`)
    }
  }
  
  // Step 3: Define corridor segments using exact snapped gate points (Gate → next TP)
  // Dashed TP pairs detection removed in cleanup; rely on continuity and main-track-only build
  const dashedPairs = new Set<number>()

  // Note: detectDashedConnectorPairs needs original input; workaround below patches later
  const corridorSegments: Array<{ start: { point: LonLatAlt, idx: number }, end: { point: LonLatAlt, idx: number }, name: string }> = []
  
  // Segment 1: 5NM-after-SP → TP1
  if (gatePositions.length > 0 && waypoints.tps.length > 0) {
    const startGateAlong = pointAtDistanceAlongTrack(track, spIdx, 5 * NM)
    // FIXED: Use exact gate position and bearing, don't re-snap
    const start = startGateAlong ? 
      { point: startGateAlong.point, segmentIndex: startGateAlong.segmentIndex, bearing: startGateAlong.bearing } :
      snapPointToTrack(track, track[gatePositions[0].trackIdx])
    const end = snapPointToTrack(track, waypoints.tps[0].coord)
    // Build precise slice
    const preciseSlice = buildPreciseSlice(track, { point: start.point, segmentIndex: start.segmentIndex }, { point: end.point, segmentIndex: end.segmentIndex })
    // Enforce continuity on main track for this span
    if (!isSpanOnMain(Math.min(start.segmentIndex, end.segmentIndex), Math.max(start.segmentIndex, end.segmentIndex), sourceSegIdx, gapAfterIndex, mainSegmentIndexSet)) {
      log(`❌ Skipping 5NM-after-SP→TP1 due to non-continuous/main span`)
    } else if (preciseSlice.length >= 2) {
      const lr = generateLeftRightCorridor(preciseSlice, corridorDistanceM)
      if (lr) {
        leftSegments.push(lineString(lr.left.geometry.coordinates as Position[], { segment: '5NM-after-SP→TP1' }))
        rightSegments.push(lineString(lr.right.geometry.coordinates as Position[], { segment: '5NM-after-SP→TP1' }))
      }
      const sliceLength = preciseSlice.reduce((acc, c, i) => i === 0 ? 0 : acc + calculateDistance(preciseSlice[i - 1], c), 0)
      log(`🟢 Corridor 1: ${gatePositions[0].name} → TP1 (${start.segmentIndex}→${end.segmentIndex}), ${(sliceLength/1000).toFixed(2)} km`)
    } else {
      log(`❌ Skipping 5NM-after-SP→TP1: slice too short`)
    }
  }
  
  // Segments 2+: 1NM-after-TPn → TP(n+1)
  for (let i = 1; i < gatePositions.length; i++) {
    const gateAlong = i - 1 < waypoints.tps.length
      ? pointAtDistanceAlongTrack(track, nearestTrackIndex(track, waypoints.tps[i - 1].coord), 1 * NM)
      : null
    // FIXED: Use exact gate position and bearing, don't re-snap
    const start = gateAlong ? 
      { point: gateAlong.point, segmentIndex: gateAlong.segmentIndex, bearing: gateAlong.bearing } :
      snapPointToTrack(track, track[gatePositions[i].trackIdx])

    let endPoint: { point: LonLatAlt, segmentIndex: number, bearing: number } | null = null
    let endName: string
    if (i < waypoints.tps.length) {
      endPoint = snapPointToTrack(track, waypoints.tps[i].coord)
      endName = waypoints.tps[i].name
    } else if (waypoints.fp) {
      endPoint = snapPointToTrack(track, waypoints.fp)
      endName = 'FP'
    } else {
      continue
    }

    if (!endPoint) continue

    // Build precise slice between snapped start and end
    const preciseSlice = buildPreciseSlice(track, { point: start.point, segmentIndex: start.segmentIndex }, { point: endPoint.point, segmentIndex: endPoint.segmentIndex })
    if (preciseSlice.length < 2) {
      log(`⚠️  Precise slice too short for ${gatePositions[i].name}→${endName}`)
      continue
    }

    // Skip if this is a known dashed TP pair (no uninterrupted main track between TPi and TP(i+1))
    const startTpIndex = i - 1
    if (startTpIndex >= 0 && dashedPairs.has(startTpIndex)) {
      log(`❌ Skipping dashed TP pair segment: ${gatePositions[i].name}→${endName}`)
      continue
    }

    // Additionally enforce continuity on the actual track index range
    const fromIdx = Math.min(start.segmentIndex, endPoint.segmentIndex)
    const toIdx = Math.max(start.segmentIndex, endPoint.segmentIndex)
    if (!isSpanOnMain(fromIdx, toIdx, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet)) {
      log(`❌ Skipping non-continuous/main span: ${gatePositions[i].name}→${endName} (${fromIdx}→${toIdx})`)
      continue
    }

    const segmentName = `${gatePositions[i].name}→${endName}`
    const lr = generateLeftRightCorridor(preciseSlice, corridorDistanceM)
    if (lr) {
      leftSegments.push(lineString(lr.left.geometry.coordinates as Position[], { segment: segmentName }))
      rightSegments.push(lineString(lr.right.geometry.coordinates as Position[], { segment: segmentName }))
      log(`🟢 Corridor ${i + 1}: ${segmentName} (${start.segmentIndex}→${endPoint.segmentIndex})`)
    }
  }
  
  
  // Step 4: Generate 300m corridors for each segment
  log(`\n📏 Generating ${corridorSegments.length} corridor segments...`)
  
  // already generated within the loop using precise slices
  
  log(`\n🎯 RESULT: Generated ${leftSegments.length} corridor segments with gaps in forbidden zones`)
  
  return { leftSegments, rightSegments, endGates }
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
        if (coords.length === 3) {
          const center = coords[1]
          out.push({ center, line: lineString(coords as Position[]) })
        }
      }
    } else if (g.type === 'LineString') {
      const ls = g as LineString
      const coords = ls.coordinates as LonLatAlt[]
      if (coords.length === 3) {
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
    // Find the candidate whose center is nearest to approx
    let bestIdx = -1
    let bestD2 = Infinity
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i].center
      const dx = c[0] - approx[0]
      const dy = c[1] - approx[1]
      const d2 = dx*dx + dy*dy
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i }
    }
    if (bestIdx !== -1) {
      const gate = candidates[bestIdx].line
      const intersections = lineIntersect(trackLine, gate)
      if (intersections && intersections.features.length) {
        const p = intersections.features[0]
        const [lon, lat] = getCoord(p)
        const exact: LonLatAlt = [lon, lat, approx[2] || 0]
        exactPointFeatures.push(point([lon, lat], { name, role: 'exact' }) as Feature<Point>)
        return exact
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
  result.tps.sort((a, b) => {
    const na = parseInt(a.name.split(' ').pop() || '0', 10)
    const nb = parseInt(b.name.split(' ').pop() || '0', 10)
    return na - nb
  })

  return { ...result, exactPointFeatures }
}

export function buildPreciseCorridorsAndGates(input: GeoJSON, corridorDistanceM = 300): { gates: Feature<LineString>[], points: Feature<Point>[], exactPoints: Feature<Point>[], leftSegments: Feature<LineString>[], rightSegments: Feature<LineString>[] } {
  const { track, sourceSegIdx, gapAfterIndex, segments, mainSegmentIndexSet } = buildContinuousTrackWithSources(input)
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
    const gate = maybeBuildGateFromStartIdxDistance(track, idx, 5 * NM, corridorDistanceM, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet)
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
    const gate = maybeBuildGateFromStartIdxDistance(track, idx, 1 * NM, corridorDistanceM, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet)
    if (gate) gates.push(gate)
  }
  
  // Add FP point label (no gate after FP)
  if (named.fp) points.push(point([named.fp[0], named.fp[1]], { name: 'FP', role: 'waypoint' }) as Feature<Point>)
  
  // Generate segmented corridors with forbidden zones using exact waypoints
  if (track.length >= 2) {
    const corridorSegments = generateSegmentedCorridors(track, { sp, tps, fp }, corridorDistanceM, input, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet, segments)
    leftSegments.push(...corridorSegments.leftSegments)
    rightSegments.push(...corridorSegments.rightSegments)
    // Note: endGates are available in corridorSegments.endGates if needed
  }
  
  return { gates, points, exactPoints, leftSegments, rightSegments }
}



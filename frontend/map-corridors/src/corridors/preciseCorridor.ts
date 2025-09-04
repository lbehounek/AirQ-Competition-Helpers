import type { Feature, FeatureCollection, GeoJSON, LineString, Point, Position } from 'geojson'
import { lineString, length as turfLength, getCoord, bearing as turfBearing, destination, point, nearestPointOnLine } from '@turf/turf'

const DEBUG = (import.meta as any)?.env?.VITE_DEBUG_CORRIDORS === 'true' || (import.meta as any)?.env?.VITE_DEBUG_CORRIDORS === '1'
const log = (...args: any[]) => { if (DEBUG) console.log(...args) }

type LonLatAlt = [number, number, number?]

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

function calculateDistance(coord1: LonLatAlt, coord2: LonLatAlt): number {
  const [lon1, lat1] = coord1
  const [lon2, lat2] = coord2
  const R = 6371000 // Earth's radius in meters
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180
  const deltaLat = (lat2 - lat1) * Math.PI / 180
  const deltaLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
           Math.cos(lat1Rad) * Math.cos(lat2Rad) *
           Math.sin(deltaLon/2) * Math.sin(deltaLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

function isDashedConnectorLine(coords: LonLatAlt[]): boolean {
  // Skip segments that are not simple 2-point lines
  if (coords.length !== 2) {
    return false
  }
  // Calculate segment length
  const length = calculateDistance(coords[0], coords[1])
  // Very short segments are likely dashed connectors
  return length < 500  // Less than 500m (match backend)
}

type Segment = {
  index: number
  coordinates: LonLatAlt[]
}

function extractAllSegments(input: GeoJSON): Segment[] {
  const segments: Segment[] = []
  let index = 0
  function extract(g: any) {
    if (!g) return
    if (g.type === 'FeatureCollection') {
      for (const f of (g as FeatureCollection).features) extract(f)
    } else if (g.type === 'Feature') {
      const f = g as Feature
      const geom = f.geometry
      if (geom?.type === 'LineString') {
        const ls = geom as LineString
        const coords = ls.coordinates as LonLatAlt[]
        // Skip turning point markers (3-coordinate segments)
        if (coords.length === 3) return
        segments.push({ index: index++, coordinates: coords })
      }
    } else if (g.type === 'LineString') {
      const ls = g as LineString
      const coords = ls.coordinates as LonLatAlt[]
      // Skip turning point markers (3-coordinate segments)
      if (coords.length === 3) return
      segments.push({ index: index++, coordinates: coords })
    }
  }
  extract(input)
  return segments
}

export function buildContinuousTrackWithSources(input: GeoJSON): { track: LonLatAlt[], sourceSegIdx: number[], gapAfterIndex: boolean[], segments: Segment[], mainSegmentIndexSet: Set<number> } {
  // Extract all segments
  const allSegments = extractAllSegments(input)
  
  // Classify segments: main track vs dashed connectors
  const mainTrackSegments = allSegments.filter(seg => !isDashedConnectorLine(seg.coordinates))
  const dashedConnectors = allSegments.filter(seg => isDashedConnectorLine(seg.coordinates))
  
  log(`=== PROCESSING SUMMARY ===`)
  log(`Total line segments found: ${allSegments.length}`)
  log(`Main track segments: ${mainTrackSegments.length}`)
  log(`Dashed connectors (excluded): ${dashedConnectors.length}`)
  
  // Build detailed continuous track from main segments only
  if (mainTrackSegments.length === 0) return { track: [], sourceSegIdx: [], gapAfterIndex: [], segments: allSegments, mainSegmentIndexSet: new Set() }
  
  // Sort segments by index to maintain original order
  const sortedSegments = mainTrackSegments.sort((a, b) => a.index - b.index)
  
  const detailedTrack: LonLatAlt[] = []
  const sourceSegIdx: number[] = []
  const gapAfterIndex: boolean[] = [] // length will be track.length - 1
  
  for (let i = 0; i < sortedSegments.length; i++) {
    const segment = sortedSegments[i]
    const coords = segment.coordinates
    
    if (i === 0) {
      // First segment: append all points, all edges are contiguous
      for (let k = 0; k < coords.length; k++) {
        detailedTrack.push(coords[k])
        sourceSegIdx.push(segment.index)
        if (k > 0) gapAfterIndex.push(false)
      }
    } else {
      const lastPoint = detailedTrack[detailedTrack.length - 1]
      const firstPoint = coords[0]
      const distance = calculateDistance(lastPoint, firstPoint)
      if (distance < 50) {
        // Connected: skip duplicate first, append rest; edges contiguous
        for (let k = 1; k < coords.length; k++) {
          detailedTrack.push(coords[k])
          sourceSegIdx.push(segment.index)
          gapAfterIndex.push(false)
        }
      } else {
        // Gap exists between previous last and this segment's first point
        // Append first point and mark the edge as a gap
        detailedTrack.push(coords[0])
        sourceSegIdx.push(segment.index)
        gapAfterIndex.push(true)
        // Append remaining points with contiguous edges
        for (let k = 1; k < coords.length; k++) {
          detailedTrack.push(coords[k])
          sourceSegIdx.push(segment.index)
          gapAfterIndex.push(false)
        }
      }
    }
  }
  
  log(`Built detailed track: ${detailedTrack.length} total points from ${mainTrackSegments.length} segments`)
  
  const mainSet = new Set<number>(mainTrackSegments.map(s => s.index))
  return { track: detailedTrack, sourceSegIdx, gapAfterIndex, segments: allSegments, mainSegmentIndexSet: mainSet }
}

export function buildContinuousTrack(input: GeoJSON): LonLatAlt[] {
  return buildContinuousTrackWithSources(input).track
}

export function generateLeftRightCorridor(track: LonLatAlt[], corridorDistanceM = 300): CorridorOutput | null {
  if (track.length < 2) return null
  const left: LonLatAlt[] = []
  const right: LonLatAlt[] = []
  for (let i = 0; i < track.length; i++) {
    const cur = track[i]
    let trackBearing: number
    if (i === 0) trackBearing = calculateBearing(cur, track[i + 1])
    else if (i === track.length - 1) trackBearing = calculateBearing(track[i - 1], cur)
    else {
      const bin = calculateBearing(track[i - 1], cur)
      const bout = calculateBearing(cur, track[i + 1])
      let diff = bout - bin
      if (diff > 180) diff -= 360
      else if (diff < -180) diff += 360
      trackBearing = (bin + diff / 2 + 360) % 360
    }
    const leftBearing = (trackBearing - 90 + 360) % 360
    const rightBearing = (trackBearing + 90) % 360
    left.push(projectCoordinate(cur, leftBearing, corridorDistanceM))
    right.push(projectCoordinate(cur, rightBearing, corridorDistanceM))
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

type WaypointData = {
  sp?: LonLatAlt
  tps: Array<{ name: string, coord: LonLatAlt }>
  fp?: LonLatAlt
}

function snapPointToTrack(track: LonLatAlt[], target: LonLatAlt): { point: LonLatAlt, segmentIndex: number, bearing: number } {
  if (track.length < 2) return { point: track[0], segmentIndex: 0, bearing: 0 }
  const line = lineString(track.map(c => [c[0], c[1]]) as Position[])
  const snapped = nearestPointOnLine(line, point([target[0], target[1]]))
  const [lon, lat] = getCoord(snapped)
  const segIndex = Math.max(0, Math.min((snapped.properties?.index as number) ?? 0, track.length - 2))
  const brg = calculateBearing(track[segIndex], track[segIndex + 1])
  return { point: [lon, lat, target[2]], segmentIndex: segIndex, bearing: brg }
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
  originalInput: GeoJSON,
  sourceSegIdx: number[],
  gapAfterIndex: boolean[],
  mainSegmentIndexSet: Set<number>,
  segments: Segment[]
): { leftSegments: Feature<LineString>[], rightSegments: Feature<LineString>[] } {
  log('\n=== GENERATING SEGMENTED CORRIDORS ===')
  
  const NM = 1852
  const leftSegments: Feature<LineString>[] = []
  const rightSegments: Feature<LineString>[] = []
  
  // Step 1: Validate we have required waypoints
  if (!waypoints.sp || waypoints.tps.length === 0) {
    console.log('❌ Missing SP or TPs - cannot generate corridors')
    return { leftSegments, rightSegments }
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

  const isContinuousMainSpan = (fromIdx: number, toIdx: number): boolean => {
    if (fromIdx === toIdx) {
      const segIdx = sourceSegIdx[fromIdx]
      return mainSegmentIndexSet.has(segIdx)
    }
    if (fromIdx > toIdx) return false
    for (let i = fromIdx; i < toIdx; i++) {
      if (gapAfterIndex[i]) return false
      const segIdxA = sourceSegIdx[i]
      const segIdxB = sourceSegIdx[i + 1]
      if (!mainSegmentIndexSet.has(segIdxA) || !mainSegmentIndexSet.has(segIdxB)) return false
    }
    return true
  }
  // Note: detectDashedConnectorPairs needs original input; workaround below patches later
  const corridorSegments: Array<{ start: { point: LonLatAlt, idx: number }, end: { point: LonLatAlt, idx: number }, name: string }> = []
  
  // Segment 1: 5NM-after-SP → TP1
  if (gatePositions.length > 0 && waypoints.tps.length > 0) {
    const startGateAlong = pointAtDistanceAlongTrack(track, spIdx, 5 * NM)
    const start = startGateAlong ? snapPointToTrack(track, startGateAlong.point) : snapPointToTrack(track, track[gatePositions[0].trackIdx])
    const end = snapPointToTrack(track, waypoints.tps[0].coord)
    // Build precise slice
    const preciseSlice = buildPreciseSlice(track, { point: start.point, segmentIndex: start.segmentIndex }, { point: end.point, segmentIndex: end.segmentIndex })
    // Enforce continuity on main track for this span
    if (!isContinuousMainSpan(Math.min(start.segmentIndex, end.segmentIndex), Math.max(start.segmentIndex, end.segmentIndex))) {
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
    const start = gateAlong ? snapPointToTrack(track, gateAlong.point) : snapPointToTrack(track, track[gatePositions[i].trackIdx])

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
    if (!isContinuousMainSpan(fromIdx, toIdx)) {
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
  
  return { leftSegments, rightSegments }
}

export function buildPreciseCorridorsAndGates(input: GeoJSON, corridorDistanceM = 300): { left?: Feature<LineString>, right?: Feature<LineString>, gates: Feature<LineString>[], points: Feature<Point>[], leftSegments: Feature<LineString>[], rightSegments: Feature<LineString>[] } {
  const { track, sourceSegIdx, gapAfterIndex, segments, mainSegmentIndexSet } = buildContinuousTrackWithSources(input)
  const gates: Feature<LineString>[] = []
  const points: Feature<Point>[] = []
  let left: Feature<LineString> | undefined
  let right: Feature<LineString> | undefined
  const leftSegments: Feature<LineString>[] = []
  const rightSegments: Feature<LineString>[] = []
  
  const { sp, tps, fp } = findNamedPoints(input)
  const NM = 1852
  
  // Add SP point label
  if (sp) {
    points.push(point([sp[0], sp[1]], { name: 'SP', role: 'waypoint' }) as Feature<Point>)
    const idx = nearestTrackIndex(track, sp)
    const p = pointAtDistanceAlongTrack(track, idx, 5 * NM)
    if (p) gates.push(buildGateAtPoint(p.point, p.bearing, corridorDistanceM))
  }
  
  // Add TP point labels and gates 1NM AFTER each TP
  for (const tp of tps) {
    points.push(point([tp.coord[0], tp.coord[1]], { name: tp.name, role: 'waypoint' }) as Feature<Point>)
    const idx = nearestTrackIndex(track, tp.coord)
    const p = pointAtDistanceAlongTrack(track, idx, 1 * NM)
    if (p) gates.push(buildGateAtPoint(p.point, p.bearing, corridorDistanceM))
  }
  
  // Add FP point label (no gate after FP)
  if (fp) {
    points.push(point([fp[0], fp[1]], { name: 'FP', role: 'waypoint' }) as Feature<Point>)
  }
  
  // Generate segmented corridors with forbidden zones
  if (track.length >= 2) {
    const corridorSegments = generateSegmentedCorridors(track, { sp, tps, fp }, corridorDistanceM, input, sourceSegIdx, gapAfterIndex, mainSegmentIndexSet, segments)
    leftSegments.push(...corridorSegments.leftSegments)
    rightSegments.push(...corridorSegments.rightSegments)
    
    // Keep single continuous corridors for backward compatibility (but these will be hidden)
    const lr = generateLeftRightCorridor(track, corridorDistanceM)
    if (lr) { left = lr.left; right = lr.right }
  }
  
  return { left, right, gates, points, leftSegments, rightSegments }
}



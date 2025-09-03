import type { Feature, FeatureCollection, GeoJSON, LineString, Point, Position } from 'geojson'
import { lineString, length as turfLength, getCoord, bearing as turfBearing, destination, point } from '@turf/turf'

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
  return length < 500  // Less than 500m
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

export function buildContinuousTrack(input: GeoJSON): LonLatAlt[] {
  // Extract all segments
  const allSegments = extractAllSegments(input)
  
  // Classify segments: main track vs dashed connectors
  const mainTrackSegments = allSegments.filter(seg => !isDashedConnectorLine(seg.coordinates))
  const dashedConnectors = allSegments.filter(seg => isDashedConnectorLine(seg.coordinates))
  
  console.log(`=== PROCESSING SUMMARY ===`)
  console.log(`Total line segments found: ${allSegments.length}`)
  console.log(`Main track segments: ${mainTrackSegments.length}`)
  console.log(`Dashed connectors (excluded): ${dashedConnectors.length}`)
  
  // Build detailed continuous track from main segments only
  if (mainTrackSegments.length === 0) return []
  
  // Sort segments by index to maintain original order
  const sortedSegments = mainTrackSegments.sort((a, b) => a.index - b.index)
  
  const detailedTrack: LonLatAlt[] = []
  
  for (let i = 0; i < sortedSegments.length; i++) {
    const segment = sortedSegments[i]
    const coords = segment.coordinates
    
    if (i === 0) {
      // First segment: add all coordinates
      detailedTrack.push(...coords)
    } else {
      // For subsequent segments, check for duplicates
      const lastPoint = detailedTrack[detailedTrack.length - 1]
      const firstPoint = coords[0]
      
      const distance = calculateDistance(lastPoint, firstPoint)
      if (distance < 50) {  // Points are very close, likely connected
        // Skip the duplicate first coordinate
        detailedTrack.push(...coords.slice(1))
      } else {
        // Gap exists, add all coordinates including first
        detailedTrack.push(...coords)
      }
    }
  }
  
  console.log(`Built detailed track: ${detailedTrack.length} total points from ${mainTrackSegments.length} segments`)
  
  return detailedTrack
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

export function findNamedPoints(input: GeoJSON): { sp?: LonLatAlt, tps: Array<{ name: string, coord: LonLatAlt }> } {
  const out: { sp?: LonLatAlt, tps: Array<{ name: string, coord: LonLatAlt }> } = { tps: [] }
  function scan(g: any) {
    if (!g) return
    if (g.type === 'FeatureCollection') {
      for (const f of (g as FeatureCollection).features) scan(f)
    } else if (g.type === 'Feature') {
      const f = g as Feature
      const geom = f.geometry
      const name = (f.properties?.name || f.properties?.Name || f.properties?.title) as string | undefined
      if (geom?.type === 'Point' && name) {
        const p = geom as Point
        const c = p.coordinates as LonLatAlt
        if (name === 'SP') out.sp = c
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

export function pointAtDistanceAlongTrack(track: LonLatAlt[], startIdx: number, distanceMeters: number): { point: LonLatAlt, bearing: number } | null {
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
      return { point: p, bearing: brg }
    }
    remaining -= segLenM
  }
  const lastBrg = calculateBearing(track[track.length - 2], track[track.length - 1])
  return { point: track[track.length - 1], bearing: lastBrg }
}

export function buildGateAtPoint(center: LonLatAlt, localBearingDeg: number, corridorDistanceM: number): Feature<LineString> {
  const leftBearing = (localBearingDeg - 90 + 360) % 360
  const rightBearing = (localBearingDeg + 90) % 360
  const left = projectCoordinate(center, leftBearing, corridorDistanceM)
  const right = projectCoordinate(center, rightBearing, corridorDistanceM)
  return lineString([left as Position, right as Position], { role: 'gate', color: 'red' })
}

export function buildPreciseCorridorsAndGates(input: GeoJSON, corridorDistanceM = 300): { left?: Feature<LineString>, right?: Feature<LineString>, gates: Feature<LineString>[] } {
  const track = buildContinuousTrack(input)
  const gates: Feature<LineString>[] = []
  let left: Feature<LineString> | undefined
  let right: Feature<LineString> | undefined
  if (track.length >= 2) {
    const lr = generateLeftRightCorridor(track, corridorDistanceM)
    if (lr) { left = lr.left; right = lr.right }
  }
  const { sp, tps } = findNamedPoints(input)
  const NM = 1852
  if (sp) {
    const idx = nearestTrackIndex(track, sp)
    const p = pointAtDistanceAlongTrack(track, idx, 5 * NM)
    if (p) gates.push(buildGateAtPoint(p.point, p.bearing, corridorDistanceM))
  }
  for (const tp of tps) {
    const idx = nearestTrackIndex(track, tp.coord)
    const p = pointAtDistanceAlongTrack(track, idx, 1 * NM)
    if (p) gates.push(buildGateAtPoint(p.point, p.bearing, corridorDistanceM))
  }
  return { left, right, gates }
}



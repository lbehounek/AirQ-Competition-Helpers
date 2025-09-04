import type { FeatureCollection, GeoJSON, LineString, Position } from 'geojson'
import { lineString, point } from '@turf/turf'

export type LonLatAlt = [number, number, number?]

export type Segment = {
  index: number
  coordinates: LonLatAlt[]
}

export function calculateDistance(coord1: LonLatAlt, coord2: LonLatAlt): number {
  const [lon1, lat1] = coord1
  const [lon2, lat2] = coord2
  const R = 6371000
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180
  const deltaLat = (lat2 - lat1) * Math.PI / 180
  const deltaLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(deltaLat/2) ** 2 + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon/2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function isDashedConnectorLine(coords: LonLatAlt[]): boolean {
  if (coords.length !== 2) return false
  const length = calculateDistance(coords[0], coords[1])
  return length < 500
}

export function extractAllSegments(input: GeoJSON): Segment[] {
  const segments: Segment[] = []
  let index = 0
  function extract(g: any) {
    if (!g) return
    if (g.type === 'FeatureCollection') {
      for (const f of (g as FeatureCollection).features) extract(f)
    } else if (g.type === 'Feature') {
      const f = g
      const geom = f.geometry
      if (geom?.type === 'LineString') {
        const ls = geom as LineString
        const coords = ls.coordinates as LonLatAlt[]
        if (coords.length === 3) return
        segments.push({ index: index++, coordinates: coords })
      }
    } else if (g.type === 'LineString') {
      const ls = g as LineString
      const coords = ls.coordinates as LonLatAlt[]
      if (coords.length === 3) return
      segments.push({ index: index++, coordinates: coords })
    }
  }
  extract(input)
  return segments
}

export function buildContinuousTrackWithSources(input: GeoJSON): { track: LonLatAlt[], sourceSegIdx: number[], gapAfterIndex: boolean[], segments: Segment[], mainSegmentIndexSet: Set<number> } {
  const allSegments = extractAllSegments(input)
  const mainTrackSegments = allSegments.filter(seg => !isDashedConnectorLine(seg.coordinates))
  const sortedSegments = mainTrackSegments.sort((a, b) => a.index - b.index)

  const detailedTrack: LonLatAlt[] = []
  const sourceSegIdx: number[] = []
  const gapAfterIndex: boolean[] = []

  for (let i = 0; i < sortedSegments.length; i++) {
    const segment = sortedSegments[i]
    const coords = segment.coordinates
    if (i === 0) {
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
        for (let k = 1; k < coords.length; k++) {
          detailedTrack.push(coords[k])
          sourceSegIdx.push(segment.index)
          gapAfterIndex.push(false)
        }
      } else {
        detailedTrack.push(coords[0])
        sourceSegIdx.push(segment.index)
        gapAfterIndex.push(true)
        for (let k = 1; k < coords.length; k++) {
          detailedTrack.push(coords[k])
          sourceSegIdx.push(segment.index)
          gapAfterIndex.push(false)
        }
      }
    }
  }

  const mainSet = new Set<number>(mainTrackSegments.map(s => s.index))
  return { track: detailedTrack, sourceSegIdx, gapAfterIndex, segments: allSegments, mainSegmentIndexSet: mainSet }
}

export function buildContinuousTrack(input: GeoJSON): LonLatAlt[] {
  return buildContinuousTrackWithSources(input).track
}



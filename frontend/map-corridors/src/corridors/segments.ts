import type { FeatureCollection, GeoJSON, LineString, MultiLineString, GeometryCollection } from 'geojson'

export type LonLatAlt = [number, number, number?]

export type Segment = {
  index: number
  coordinates: LonLatAlt[]
}

/**
 * What the track builder had to do to the input to make a usable track.
 *
 * Every one of these used to happen silently, which is why the MZB 2026 rally
 * shipped a map with five wrong legs and nobody could produce a failing file:
 * the app rendered a plausible-looking course and said nothing. Callers are
 * expected to surface these to the user.
 */
export type TrackDiagnostics = {
  /** Isolated short lines discarded as map decoration (arrowheads, ticks). */
  droppedShortSegments: number
  /** Dashed legs reconstructed into continuous track — see mergeDashRuns. */
  mergedDashRuns: Array<{ dashes: number, dashLengthMinM: number, dashLengthMaxM: number, spanM: number }>
  /** Straight chords welded across a real discontinuity in the source. */
  gapCount: number
}

export function calculateDistance(coord1: LonLatAlt, coord2: LonLatAlt): number {
  const [lon1, lat1] = coord1
  const [lon2, lat2] = coord2
  const R = 6371000
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180
  const deltaLat = (lat2 - lat1) * Math.PI / 180
  const deltaLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/** Initial great-circle bearing a to b, degrees clockwise from north. */
function bearingBetween(a: LonLatAlt, b: LonLatAlt): number {
  const lat1 = a[1] * Math.PI / 180
  const lat2 = b[1] * Math.PI / 180
  const dLon = (b[0] - a[0]) * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/** Smallest absolute angle between two bearings, 0..180. */
function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 180) % 360 + 360) % 360 - 180)
}

export function isDashedConnectorLine(coords: LonLatAlt[]): boolean {
  if (coords.length !== 2) return false
  const length = calculateDistance(coords[0], coords[1])
  return length < 500
}

/**
 * A 3-coord LineString in this app's KMLs is almost always a TP gate
 * perpendicular (left → center → right, ~2 km wide). But rally courses
 * authored elsewhere sometimes express a straight-ish leg with 3 vertices
 * (start → waypoint → end), and blindly dropping those hides the whole
 * track for larger courses (user report 2026-04-23: 16-section race).
 *
 * Distinguish by total polyline length: gates are short (≤ 3 km). Real
 * flight legs are always longer — Rally/Precision minimum leg length is
 * well above this threshold.
 */
export function isTpGatePerpendicular(coords: LonLatAlt[]): boolean {
  if (coords.length !== 3) return false
  const total = calculateDistance(coords[0], coords[1]) + calculateDistance(coords[1], coords[2])
  return total < 3000
}

// A run must reach this many dashes before it reads as a dashed leg rather
// than decoration. Two is not enough: RED.kml carries exactly two isolated
// 200 m decorations near FP that must keep being discarded.
const MIN_DASHES_IN_RUN = 3
// Per-step tolerances. Loose enough that a dashed leg drawn along a curve still
// reads as one run; far too tight for unrelated decoration, which does not
// repeat, does not match length, and does not continue its neighbour's heading.
const DASH_LENGTH_TOLERANCE = 0.25
const DASH_BEARING_TOLERANCE_DEG = 30
// Every gap in the real MZB file measures gap/dash = 1.00 exactly. 1.5 leaves
// half a dash of headroom for uneven authoring while refusing to swallow a
// genuine discontinuity: anything wider stays a gap chord, so isSpanOnMain can
// still refuse to draw a corridor across it. At the old value of 3 a 3.8 km
// jump between MZB's 1267 m dashes would have been welded into ordinary track,
// destroying the very guarantee the gap check exists to provide.
const MAX_GAP_TO_DASH_RATIO = 1.5
// Two vertices closer than this are the same point drawn twice.
const COINCIDENT_VERTEX_M = 1
// Mirrors the 50 m weld threshold in buildContinuousTrackWithSources: a gap at
// least this wide is what would have become a gap chord.
const WELD_THRESHOLD_M = 50

/**
 * Rebuild legs that the course author drew as a *dashed line*.
 *
 * KML has no dash style that survives export from every planning tool, so
 * authors draw a dashed leg literally: N separate 2-point LineStrings laid
 * end-to-gap-to-end along the leg. The MZB 2026 rally drew five of its eight
 * legs this way, in dashes of 200-1267 m.
 *
 * That representation defeats both downstream rules at once. Dashes under
 * 500 m are deleted outright by isDashedConnectorLine, so the leg's geometry
 * vanishes and the track builder welds a straight chord across two turning
 * points — on MZB, an 11.6 km chord from TP 4 to TP 6 that left TP 5 with no
 * track within 7.7 km and drew a corridor straight past it. Dashes *over*
 * 500 m survive, but every inter-dash space becomes a gap chord, so no
 * corridor can be built along the leg at all. Either way the leg is lost.
 *
 * So: detect the dash pattern before either rule runs and splice each run back
 * into one continuous segment. The discriminator is NOT length and NOT shared
 * endpoints — dashes deliberately do not touch, which is why the "shares an
 * endpoint with its neighbours" heuristic proposed during the investigation
 * would not have fixed this file. It is *repetition*: three or more
 * consecutive short lines of near-equal length, each continuing the previous
 * one's heading across a gap no wider than a few dash lengths. Decoration
 * never does that.
 *
 * All dash endpoints are kept, in order, so a dashed leg drawn along a curve
 * keeps its shape instead of collapsing to a chord.
 */
export function mergeDashRuns(segments: Segment[]): { segments: Segment[], merged: TrackDiagnostics['mergedDashRuns'] } {
  const merged: TrackDiagnostics['mergedDashRuns'] = []
  const out: Segment[] = []

  // Only 2-point lines participate; anything richer is already real geometry.
  const isDash = (s: Segment) => s.coordinates.length === 2

  let i = 0
  while (i < segments.length) {
    if (!isDash(segments[i])) { out.push(segments[i]); i++; continue }

    // Greedily extend a run of dashes that continue one another.
    let end = i
    // Widest space inside the run, needed to tell a dashed leg (whose spaces
    // would have become gap chords) from a course simply drawn in touching
    // pieces (which needs no repair at all).
    let maxGapInRun = 0
    while (end + 1 < segments.length && isDash(segments[end + 1])) {
      const prev = segments[end].coordinates
      const next = segments[end + 1].coordinates
      const prevLen = calculateDistance(prev[0], prev[1])
      const nextLen = calculateDistance(next[0], next[1])
      // A zero-length dash has no heading to continue, so it cannot extend a run.
      if (prevLen === 0 || nextLen === 0) break
      if (Math.abs(prevLen - nextLen) / Math.max(prevLen, nextLen) > DASH_LENGTH_TOLERANCE) break

      const prevBearing = bearingBetween(prev[0], prev[1])
      if (bearingDelta(prevBearing, bearingBetween(next[0], next[1])) > DASH_BEARING_TOLERANCE_DEG) break

      // The space between dashes must be a forward continuation, not a jump to
      // somewhere else on the map.
      const gap = calculateDistance(prev[1], next[0])
      if (gap > MAX_GAP_TO_DASH_RATIO * prevLen) break
      if (gap > COINCIDENT_VERTEX_M && bearingDelta(prevBearing, bearingBetween(prev[1], next[0])) > DASH_BEARING_TOLERANCE_DEG) break

      if (gap > maxGapInRun) maxGapInRun = gap
      end++
    }

    const runLength = end - i + 1
    const dashLengths: number[] = []
    for (let k = i; k <= end; k++) dashLengths.push(calculateDistance(segments[k].coordinates[0], segments[k].coordinates[1]))
    // Only repair what the naive pipeline would actually have destroyed. A run
    // of long, touching 2-point legs is an ordinarily authored course: merging
    // it changes nothing, and announcing it as a reconstruction spends the
    // banner's credibility on every file that genuinely needs it.
    const wouldHaveBeenDestroyed =
      Math.max(...dashLengths) < 500 ||   // each dash deleted by isDashedConnectorLine
      maxGapInRun >= WELD_THRESHOLD_M     // each space turned into a gap chord

    if (runLength >= MIN_DASHES_IN_RUN && wouldHaveBeenDestroyed) {
      const coordinates: LonLatAlt[] = []
      for (let k = i; k <= end; k++) {
        const [a, b] = segments[k].coordinates
        // Skip a dash's start vertex when it coincides with the previous dash's
        // end, so a solid polyline that was merely split into pieces does not
        // gain duplicate vertices.
        if (coordinates.length === 0 || calculateDistance(coordinates[coordinates.length - 1], a) > COINCIDENT_VERTEX_M) coordinates.push(a)
        coordinates.push(b)
      }
      let spanM = 0
      for (let k = 1; k < coordinates.length; k++) spanM += calculateDistance(coordinates[k - 1], coordinates[k])
      // Report the real range. Quoting the first dash alone stated one measured
      // number as if it described all of them, and DASH_LENGTH_TOLERANCE
      // compounds per step, so a long run can end far from where it started.
      merged.push({
        dashes: runLength,
        dashLengthMinM: Math.min(...dashLengths),
        dashLengthMaxM: Math.max(...dashLengths),
        spanM,
      })
      // Keep the first dash's index so the merged leg holds the run's position
      // in source order, which sourceSegIdx and mainSegmentIndexSet rely on.
      out.push({ index: segments[i].index, coordinates })
    } else {
      for (let k = i; k <= end; k++) out.push(segments[k])
    }
    i = end + 1
  }

  return { segments: out, merged }
}

export function extractAllSegments(input: GeoJSON): Segment[] {
  const segments: Segment[] = []
  let index = 0
  const push = (coords: LonLatAlt[]) => {
    if (!coords || coords.length < 2) return
    if (isTpGatePerpendicular(coords)) return
    segments.push({ index: index++, coordinates: coords })
  }
  function extract(g: unknown) {
    if (!g || typeof g !== 'object') return
    const node = g as { type?: string }
    if (node.type === 'FeatureCollection') {
      for (const f of ((g as FeatureCollection).features ?? [])) extract(f)
    } else if (node.type === 'Feature') {
      extract((g as { geometry?: unknown }).geometry)
    } else if (node.type === 'GeometryCollection') {
      // A KML <MultiGeometry> arrives as a GeometryCollection.
      for (const geom of ((g as GeometryCollection).geometries ?? [])) extract(geom)
    } else if (node.type === 'LineString') {
      push((g as LineString).coordinates as LonLatAlt[])
    } else if (node.type === 'MultiLineString') {
      // A GPX <trk> holding several <trkseg> — what any receiver that pauses
      // recording emits — parses to MultiLineString. Ignoring it left the track
      // empty and made turf throw "coordinates must be an array of two or more
      // positions", so nothing rendered at all.
      for (const line of ((g as MultiLineString).coordinates ?? [])) push(line as LonLatAlt[])
    }
  }
  extract(input)
  return segments
}

export function buildContinuousTrackWithSources(input: GeoJSON): { track: LonLatAlt[], sourceSegIdx: number[], gapAfterIndex: boolean[], segments: Segment[], mainSegmentIndexSet: Set<number>, diagnostics: TrackDiagnostics } {
  const rawSegments = extractAllSegments(input)
  // Reconstruct dashed legs BEFORE the short-line filter, or their dashes are
  // deleted one by one and the leg is gone before anything can notice.
  const { segments: allSegments, merged } = mergeDashRuns(rawSegments)
  const mainTrackSegments = allSegments.filter(seg => !isDashedConnectorLine(seg.coordinates))
  const droppedShortSegments = allSegments.length - mainTrackSegments.length
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
  return {
    track: detailedTrack,
    sourceSegIdx,
    gapAfterIndex,
    segments: allSegments,
    mainSegmentIndexSet: mainSet,
    diagnostics: { droppedShortSegments, mergedDashRuns: merged, gapCount: gapAfterIndex.filter(Boolean).length },
  }
}

export function buildContinuousTrack(input: GeoJSON): LonLatAlt[] {
  return buildContinuousTrackWithSources(input).track
}

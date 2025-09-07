## KML parsing and exact turnpoint detection (frontend/map-corridors)

### Overview
- We load KML/GPX, build a continuous main track, detect waypoints (SP/TP/FP), derive exact turnpoints by intersecting the main track with short gate lines, and generate corridors and gates.
- Implementation entry points:
  - `frontend/map-corridors/src/parsers/detect.ts` (KML→GeoJSON)
  - `frontend/map-corridors/src/corridors/segments.ts` (track build, dashed detection)
  - `frontend/map-corridors/src/corridors/preciseCorridor.ts` (exact points, gates, corridors)

### KML structure we rely on
- Styles: original track is styled yellow in KML (ABGR color format).
```4:9:BLUE.kml
<Style id="myStyleLine">
  <LineStyle>
    <color>ff00ffff</color>
    <width>2.0</width>
  </LineStyle>
</Style>
```

- Track geometry: a sequence of `Placemark` `LineString`s. Short 2‑point `LineString`s (<500 m) are treated as dashed connectors, otherwise as main track segments.
```82:87:BLUE.kml
<Placemark>
  <styleUrl>#myStyleLine</styleUrl>
  <LineString>
    <coordinates>14.787404,49.812812,0 14.95241,49.883466,0 </coordinates>
  </LineString>
</Placemark>
```

- Waypoint labels (offset for visibility): `Point` placemarks named `SP`, `TP n`, `FP`.
```358:366:BLUE.kml
<Placemark>
  <name>TP 7</name>
  <LookAt>
    <longitude>14.95241</longitude>
    <latitude>49.883466</latitude>
  </LookAt>
  <styleUrl>#msn_ylw-pushpin</styleUrl>
  <Point>
    <coordinates>14.95341,49.883466,0</coordinates>
  </Point>
</Placemark>
```

- Gate candidates: short 3‑coordinate `LineString`s around each labeled waypoint. We use them to find the exact intersection with the main track.
```181:189:BLUE.kml
<Placemark>
  <styleUrl>#myStyleLine</styleUrl>
  <LineString>
    <coordinates>15.2102201224351,49.7797601702329,0 15.222946,49.778412,0 15.2356711686629,49.7770624345527,0 </coordinates>
  </LineString>
</Placemark>
```

### Parsing pipeline (step‑by‑step)
1) Load and convert
   - We parse uploaded KML with `@tmcw/togeojson` into GeoJSON.
   - File: `parsers/detect.ts`

2) Extract segments and build continuous main track
   - `extractAllSegments` collects all `LineString`s except 3‑coordinate ones (reserved for gates).
   - `isDashedConnectorLine(coords)` returns true if a 2‑point segment is shorter than 500 m.
   - `buildContinuousTrackWithSources` concatenates non‑dashed segments in order, records:
     - `track` (array of lon,lat[,alt])
     - `sourceSegIdx` (map from `track` vertex index to original segment index)
     - `gapAfterIndex` (true where a discontinuity/gap occurs)
     - `mainSegmentIndexSet` (set of original segment indices that are main track)
   - File: `corridors/segments.ts`

3) Detect labeled waypoints
   - Scan `Point` features with names `SP`, `TP n`, `FP` into `{ sp, tps[], fp }`.
   - File: `preciseCorridor.ts` → `findNamedPoints`

4) Compute exact SP/TP/FP positions
   - Collect 3‑coordinate `LineString` gate candidates near waypoints.
   - For each named waypoint, pick the nearest gate candidate and compute intersection with the continuous track (`@turf/lineIntersect`).
   - Fallback: if no intersection, snap the label to the track (`@turf/nearestPointOnLine`).
   - Output exact points as GeoJSON features (also rendered as labels/markers).
   - File: `preciseCorridor.ts` → `computeExactWaypoints`

5) Gates at distances (5 NM after SP, 1 NM after each TP)
   - Compute along‑track point/bearing from a start index using `pointAtDistanceAlongTrack` (great‑circle per segment).
   - Add a perpendicular short gate line via `buildGateAtPoint`.
   - Critical: we only place gates if the span from start index to the along‑track segment index is a continuous main track span (no `gapAfterIndex`, both sides in `mainSegmentIndexSet`). This matches corridor generation and skips dashed connectors.
   - File: `preciseCorridor.ts` → `maybeBuildGateFromStartIdxDistance` and `isSpanOnMain`

6) Corridors
   - For each Gate→Next TP/FP, build a precise centerline slice between snapped endpoints (including intermediate vertices), verify continuity on main track, then offset each piece independently left/right to create corridor borders.
   - File: `preciseCorridor.ts` → `generateSegmentedCorridors`, `generateLeftRightCorridor`

### Notes and invariants
- Label `Point` positions are intentionally offset for readability; exact turnpoints are intersections of the main track and the nearest 3‑coordinate gate line. If missing, we snap labels to the track.
- Dashed connectors: any 2‑point segment shorter than 500 m. Corridors and distance‑based gates are skipped whenever the span crosses these.
- Colors in export: original KML is preserved; we only append corridors (green), gates (green), and exact labels.

### Reuse
- The same pipeline (segments extraction, continuity span checks, label→exact intersection) can be reused in other frontends. The minimal required data per KML:
  - Main track as `LineString` placemarks
  - Waypoint `Point` placemarks named `SP`, `TP n`, `FP`
  - Short 3‑coordinate `LineString` gate candidates near each waypoint (optional; improves exact detection)

### Exact turnpoint detection algorithm (label ≠ exact position)

Goal: derive the exact SP/TP/FP position on the main track even though label `Point` coordinates are offset for readability.

Inputs:
- `track`: continuous main track polyline (GeoJSON LineString coords)
- `labels`: `{ sp?: Point, tps: Array<{name: 'TP n', coord: [lon,lat,alt?]}>, fp?: Point }`
- `gateCandidates`: list of short 3‑coordinate `LineString`s (per KML) around the labeled waypoints

Pseudocode:
```
function computeExactWaypoints(inputGeoJSON, track): { sp?, tps[], fp?, exactPointFeatures[] }:
  labels = findNamedPoints(inputGeoJSON)
  gateCandidates = collectAll3PointLineStrings(inputGeoJSON) // center = coords[1]
  exact = { sp: undefined, tps: [], fp: undefined }

  lineTrack = toLineString(track)

  function nearestGateTo(labelCoord): gate | undefined:
    return argmin_{g in gateCandidates} squaredDistance(g.center, labelCoord)

  function exactFrom(labelName, labelCoord): [lon,lat,alt]?:
    gate = nearestGateTo(labelCoord)
    if gate exists:
      I = lineIntersect(lineTrack, gate)
      if I has features:
        p = I.features[0] // current implementation uses the first intersection
        return [p.lon, p.lat, labelCoord.alt || 0]
    // fallback: snap label to main track (offset label → nearest point on track)
    snapped = nearestPointOnLine(lineTrack, point(labelCoord))
    return [snapped.lon, snapped.lat, labelCoord.alt || 0]

  if labels.sp: exact.sp = exactFrom('SP', labels.sp)
  for tp in labels.tps:
    p = exactFrom(tp.name, tp.coord)
    if p: exact.tps.push({ name: tp.name, coord: p })
  if labels.fp: exact.fp = exactFrom('FP', labels.fp)

  sort exact.tps by numeric suffix of name (TP 1, TP 2, ...)
  also emit exactPointFeatures (Point features with name + role="exact")
  return exact
```

Reference implementation:
- See `extractExactTurningPointsFromKML.js` at the repo root for a dependency‑free JavaScript function that returns `{ name, lon, lat }[]` for all TPs.

Notes/assumptions:
- We pick the nearest 3‑point gate candidate by its middle point to the label; if multiple gates exist, the nearest determines the “gate line.”
- We currently take the first intersection returned by `lineIntersect`. If needed, this can be refined to choose the intersection closest to the label or along the local track segment.
- If a gate line is missing for a waypoint, the fallback ensures we still place the exact point by snapping the offset label to the main track.



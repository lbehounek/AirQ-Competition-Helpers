## KML Corridors – Analysis and Tooling

### KML structure (observed in `inputs/RED.kml`)
- **Styles**: line style for track lines and pushpins for markers are defined in the KML `Document`.
- **Placemarks**:
  - `LineString` placemarks form the track geometry. Most are long 2-point segments; one large multi-point arc segment appears near the end (61 points).
  - `Point` placemarks name the waypoints:
    - `SP` (Start Point)
    - `TP 1` … `TP 9` (Turning Points)
    - `FP` (Finish Point)

### Direction of travel
- The track direction is from `SP` to `FP` (as defined by the file). We treat this as the forward direction for distance calculations.

### Segment types and what to include/exclude
- **Main track segments**: long 2-point segments plus the long multi-point arc segment, which together form the actual route.
- **Dashed/connector-like segments**: short 2-point segments (~200–335 m) used around turning areas. These are excluded from corridor generation and distance measurements.
  - Heuristic used: segments with length < 500 m are considered connectors and skipped.

### Corridor requirements (implemented)
- Generate two continuous corridor lines (left and right) offset by exactly 300 m from the track centerline.
- Skip drawing corridors along dashed/connector-like segments.
- Compute corridor offsets with local bearings to handle both straight lines and arcs.

### Distance markers (implemented)
- Place a perpendicular line across the corridor (left-to-right) at:
  - 5 nautical miles (9260 m) after `SP` (measured along the track centerline).
  - 1 nautical mile (1852 m) after each `TP n` (measured along the track centerline from that TP).
- Placement is computed at the exact arc-length point on the track (not snapped to vertices), then a perpendicular is constructed using the local bearing.

### Minimal KML samples (from the provided file)

Input styles (excerpt):
```xml
<Style id="myStyleLine">
  <LineStyle>
    <color>ff00ffff</color>
    <width>2.0</width>
  </LineStyle>
</Style>
```

Input track segment (LineString):
```xml
<Placemark>
  <styleUrl>#myStyleLine</styleUrl>
  <LineString>
    <coordinates>15.12992,49.799635,0 14.996388,49.82263,0 </coordinates>
  </LineString>
  <!-- … more fields optional … -->
</Placemark>
```

Input point markers (SP/TP/FP):
```xml
<Placemark>
  <name>SP</name>
  <styleUrl>#msn_ylw-pushpin</styleUrl>
  <Point>
    <coordinates>15.13092,49.799635,0</coordinates>
  </Point>
</Placemark>

<Placemark>
  <name>TP 1</name>
  <styleUrl>#msn_ylw-pushpin</styleUrl>
  <Point>
    <coordinates>14.997388,49.82263,0</coordinates>
  </Point>
</Placemark>
```

Typical short dashed/connector-like segment (excluded from corridors):
```xml
<Placemark>
  <styleUrl>#myStyleLine</styleUrl>
  <LineString>
    <coordinates>14.85937,49.78865,0 14.854986,49.787619,0 </coordinates>
  </LineString>
</Placemark>
```

Output styles (added by generator):
```xml
<Style id="leftCorridorStyle">
  <LineStyle>
    <color>ff00ff00</color> <!-- green (AABBGGRR) -->
    <width>2.0</width>
  </LineStyle>
  
</Style>
<Style id="rightCorridorStyle">
  <LineStyle>
    <color>ff00ff00</color> <!-- green (AABBGGRR) -->
    <width>2.0</width>
  </LineStyle>
</Style>
<Style id="distanceMarkerStyle">
  <LineStyle>
    <color>ff0000ff</color> <!-- red (AABBGGRR) -->
    <width>4.0</width>
  </LineStyle>
</Style>
```

Output corridor (LineString, continuous):
```xml
<Placemark>
  <name>Left Corridor (300.0m)</name>
  <styleUrl>#leftCorridorStyle</styleUrl>
  <LineString>
    <coordinates>… many lon,lat,alt triples …</coordinates>
  </LineString>
  
</Placemark>
```

Output distance marker (perpendicular across the corridor):
```xml
<Placemark>
  <name>1NM after TP 3</name>
  <styleUrl>#distanceMarkerStyle</styleUrl>
  <LineString>
    <coordinates>
      15.23,49.77,0 15.24,49.78,0
    </coordinates>
  </LineString>
</Placemark>
```

### Simplified KML schema used by this project

- **kml.Document**
  - `Style*`, `StyleMap*` (style definitions; color is hex in AABBGGRR)
  - `Placemark*`
    - Optional `name` (for waypoints: `SP`, `TP n`, `FP`)
    - `styleUrl` → references a style by id (e.g., `#myStyleLine`)
    - One of:
      - `LineString`
        - `coordinates` is a whitespace-separated list of `lon,lat,alt` (WGS84 degrees; altitude 0 in inputs)
      - `Point`
        - `coordinates` is a single `lon,lat,alt`

Project-specific conventions:
- Direction: from `SP` to `FP`.
- Main track vs connector:
  - Main: long 2-point segments and a long multi-point arc; used to build centerline.
  - Connector: short 2-point (~200–335 m); excluded from corridors and distance measurement.
- Output adds three styles: `leftCorridorStyle` (green), `rightCorridorStyle` (green), `distanceMarkerStyle` (red).
- Output adds three Placemark types:
  - Left/Right corridor as continuous `LineString`s.
  - Perpendicular distance markers as short `LineString`s spanning from left corridor to right corridor.

### Color encoding (KML)
- KML color is ARGB but Google Earth-style strings here are treated as AABBGGRR:
  - `ff00ff00` → green, `ff0000ff` → red, `ff00ffff` → yellow/cyan-like from input.
  - First byte is alpha (opacity), then Blue, Green, Red.

### Input/Output conventions
- Inputs are expected in the `inputs/` folder, outputs are written to `outputs/`.
- Default input path: `inputs/input.kml` (can be overridden via CLI).
- Default output path: `outputs/corridors.kml` (can be overridden via CLI).

### Tooling – generator script
- `photo_corridor_generator.py` is the single generator script.
- Basic usage:
  - Default paths:
    ```bash
    python3 photo_corridor_generator.py
    ```
  - Custom paths and corridor distance:
    ```bash
    python3 photo_corridor_generator.py -i inputs/RED.kml -o outputs/RED_corridors.kml -d 300
    ```

### Notes
- The connector skipping threshold (500 m) can be adjusted if input KML characteristics change.
- Colors: corridors are green; distance markers are red; original styles from input are preserved.



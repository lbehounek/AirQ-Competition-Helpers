# Map Corridors (frontend)

Visualize uploaded KML on a Mapbox GL map (`react-map-gl/mapbox`) with a streets/satellite style picker and a simple corridor buffer. The design is modular to add GPX later.

## Scripts

- npm run dev: start dev server
- npm run build: type-check and build
- npm run preview: preview production build

## Env

Create a `.env` file (not committed) based on `.env.example`:

- `VITE_MAPBOX_TOKEN`: your Mapbox access token. When set, the app defaults to Mapbox provider.
- `VITE_MAPYCZ_TOKEN` (optional): Mapy.com token. When set, the Mapy.com street and aerial styles appear in the style picker (they are hidden without it).

## Usage

1) npm run dev
2) Click "Select KML/GPX" or drag a file onto the map. The track renders and corridors are drawn.

## Tech

- Map: react-map-gl/mapbox + mapbox-gl
- Parsing: @tmcw/togeojson (KML now; GPX ready)
- Geospatial: individual `@turf/*` subpackages (helpers, length, bearing, destination, invariant, line-intersect, nearest-point-on-line, point-to-line-distance, boolean-point-in-polygon, buffer)
- Upload: native file input + HTML5 drag-and-drop

## Notes

- Every style is rendered by Mapbox GL JS. `VITE_MAPBOX_TOKEN` unlocks the Mapbox Streets / Mapbox Satellite styles and `VITE_MAPYCZ_TOKEN` the Mapy.com ones; without either token the token-free OpenStreetMap and ESRI Satellite styles are used (see `src/config/mapProviders.ts`).

### Distances

- Corridor gates (e.g., “1 NM after TP”) are computed as distance along the track. The code walks the polyline segment-by-segment using geodesic lengths and places the gate at the exact accumulated distance.
- Photo marker distances shown in the popup and in the Answer Sheet are straight-line (geodesic) distances from the corridor’s starting turning point to the photo location.

### Turning point markers

- Exact TP markers (black dots) are currently hidden by setting the circle radius to 0 for the `exact-points` layer.
- To show them again, change the layer paint in `src/App.tsx`:
  - Find the `exact-points` overlay and set `'circle-radius'` from `0` back to `4` (or desired size).

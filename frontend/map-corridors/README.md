# Map Corridors (frontend)

Visualize uploaded KML on a MapLibre map with streets/satellite toggle and a simple corridor buffer. The design is modular to add GPX and Mapbox later.

## Scripts

- npm run dev: start dev server
- npm run build: type-check and build
- npm run preview: preview production build

## Env

Create a `.env` file (not committed) based on `.env.example`:

- `VITE_MAPBOX_TOKEN`: your Mapbox access token. When set, the app defaults to Mapbox provider.
- `VITE_MAPTILER_KEY` (optional): key for MapLibre satellite style via MapTiler. If omitted, satellite style under MapLibre shows a placeholder URL.

## Usage

1) npm run dev
2) Click "Select KML/GPX" or drag a file onto the map. The track renders and corridors are drawn.

## Tech

- Map: @vis.gl/react-maplibre + maplibre-gl
- Parsing: @tmcw/togeojson (KML now; GPX ready)
- Geospatial: @turf/turf
- Upload: native file input + HTML5 drag-and-drop

## Notes

- When `VITE_MAPBOX_TOKEN` is present, the app starts with Mapbox provider. Otherwise, it uses MapLibre.

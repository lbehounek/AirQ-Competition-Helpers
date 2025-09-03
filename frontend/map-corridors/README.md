# Map Corridors (frontend)

Visualize uploaded KML on a MapLibre map with streets/satellite toggle and a simple corridor buffer. The design is modular to add GPX and Mapbox later.

## Scripts

- npm run dev: start dev server
- npm run build: type-check and build
- npm run preview: preview production build

## Env (optional)

- VITE_MAPBOX_TOKEN: needed only if you switch to Mapbox styles.

## Usage

1) npm run dev
2) Drop a .kml file in the drop zone. The track renders and a ~300m buffer is drawn.

## Tech

- Map: @vis.gl/react-maplibre + maplibre-gl
- Parsing: @tmcw/togeojson (KML now; GPX ready)
- Geospatial: @turf/turf
- Upload: react-dropzone

## Notes

- The satellite style under MapLibre uses MapTiler; add your key to the URL or switch to Mapbox when you provide a token.

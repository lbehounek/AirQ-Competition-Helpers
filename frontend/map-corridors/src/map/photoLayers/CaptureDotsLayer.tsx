// Phase 4 of photo-map-culling: capture-dots map layer.
// See docs/photo-map-culling/implementation-plan.md and ADR-016
// (marker rendering split: GeoJSON layer for static dots, not individual
// <Marker> components — keeps the React tree flat at any photo count).

import { useMemo } from 'react'
import { Layer, Source } from 'react-map-gl/mapbox'
import type { PhotoMarker } from '../../types/markers'
import { buildCaptureDotFeatures } from './captureFeatures'

const SOURCE_ID = 'photo-capture-dots'
const LAYER_ID = 'photo-capture-dots'

interface Props {
  markers: readonly PhotoMarker[]
}

export function CaptureDotsLayer({ markers }: Props) {
  // Memoize the GeoJSON projection so MapboxGL doesn't re-diff the source
  // every render — marker props change frequently during the import phase
  // (one re-render per onProgress tick).
  const data = useMemo(() => buildCaptureDotFeatures(markers), [markers])
  if (data.features.length === 0) return null
  return (
    <Source id={SOURCE_ID} type="geojson" data={data}>
      <Layer
        id={LAYER_ID}
        type="circle"
        paint={{
          'circle-radius': 5,
          // Data-driven match on `flag` denormalized at projection time
          // (see captureFeatures). Picks aren't in this layer at all.
          'circle-color': [
            'match',
            ['get', 'flag'],
            'reject', '#d32f2f', // red (MUI error.main)
            '#9e9e9e',            // neutral grey (default)
          ],
          'circle-opacity': [
            'match',
            ['get', 'flag'],
            'reject', 0.55, // visibly de-emphasized but not invisible
            1,
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        }}
      />
    </Source>
  )
}

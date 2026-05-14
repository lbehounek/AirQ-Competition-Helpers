// Phase 4/5 follow-up — passive overlay layers for photo markers.
//
// File kept under its original name (CaptureDotsLayer.tsx) to preserve
// imports across the call sites. Renamed export `PhotoOverlayLayers`
// mounts two GeoJSON layers:
//   1. Dashed line from capturedAt → current subject (lng/lat).
//   2. Ghost circle at capturedAt.
//
// Both layers only emit features for photos that have been MOVED
// (subject coords ≠ capture coords). Unmoved photos show only the live
// <Marker> pin in MapProviderView; the ghost would just overlap it.

import { useMemo } from 'react'
import { Layer, Source } from 'react-map-gl/mapbox'
import type { PhotoMarker } from '../../types/markers'
import { buildDashedLineFeatures, buildGhostFeatures } from './captureFeatures'

const GHOST_SOURCE_ID = 'photo-ghost-dots'
const GHOST_LAYER_ID = 'photo-ghost-dots'
const LINE_SOURCE_ID = 'photo-dashed-lines'
const LINE_LAYER_ID = 'photo-dashed-lines'

interface Props {
  markers: readonly PhotoMarker[]
}

export function PhotoOverlayLayers({ markers }: Props) {
  const ghostData = useMemo(() => buildGhostFeatures(markers), [markers])
  const lineData = useMemo(() => buildDashedLineFeatures(markers), [markers])
  if (ghostData.features.length === 0 && lineData.features.length === 0) return null
  return (
    <>
      {lineData.features.length > 0 && (
        <Source id={LINE_SOURCE_ID} type="geojson" data={lineData}>
          <Layer
            id={LINE_LAYER_ID}
            type="line"
            paint={{
              'line-color': '#9e9e9e',
              'line-width': 1.5,
              'line-dasharray': [2, 2],
              'line-opacity': 0.8,
            }}
          />
        </Source>
      )}
      {ghostData.features.length > 0 && (
        <Source id={GHOST_SOURCE_ID} type="geojson" data={ghostData}>
          <Layer
            id={GHOST_LAYER_ID}
            type="circle"
            paint={{
              'circle-radius': 4,
              'circle-color': '#9e9e9e',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1,
              'circle-opacity': 0.5,
            }}
          />
        </Source>
      )}
    </>
  )
}

// Re-export under the old name so existing imports still resolve while
// the new model takes the same slot. Drop the alias once call sites are
// updated.
export const CaptureDotsLayer = PhotoOverlayLayers

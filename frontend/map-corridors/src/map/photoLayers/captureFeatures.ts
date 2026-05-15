// Phase 4/5 follow-up — projections for the photo overlay layers.
// File kept under its original name (captureFeatures.ts) to preserve
// imports; previously exported buildCaptureDotFeatures. Layers/exports
// re-purposed once "drag every photo, not just picks" became the model:
//
//   • Pins are individual <Marker> components for ALL photos (drag +
//     click-to-popup).
//   • Ghost dots + dashed lines are GeoJSON layers that ONLY render
//     when a photo has been moved away from its EXIF capture point.
//     "Moved" = the user has confirmed the subject location, so the
//     ghost is the cue: "this photo is processed; here's where the
//     camera was".

import type { FeatureCollection, LineString, Point } from 'geojson'
import type { PhotoMarker } from '../../types/markers'

/** True when the marker's subject coords differ from its capture coords. */
export function isPhotoMoved(m: PhotoMarker): boolean {
  if (!m.capturedAt) return false
  return m.lng !== m.capturedAt.lng || m.lat !== m.capturedAt.lat
}

export interface GhostProperties {
  photoId: string
}

/**
 * Ghost points at the original EXIF capture location, rendered as a
 * faded grey dot for every photo whose subject pin has been dragged
 * away from where the camera recorded it. Skipped when subject ==
 * capture (no need to show a ghost on top of the live pin).
 */
export function buildGhostFeatures(
  markers: readonly PhotoMarker[],
): FeatureCollection<Point, GhostProperties> {
  const features: FeatureCollection<Point, GhostProperties>['features'] = []
  for (const m of markers) {
    if (!m.capturedAt || !m.photoId) continue
    if (!isPhotoMoved(m)) continue
    features.push({
      type: 'Feature',
      id: m.id,
      geometry: { type: 'Point', coordinates: [m.capturedAt.lng, m.capturedAt.lat] },
      properties: { photoId: m.photoId },
    })
  }
  return { type: 'FeatureCollection', features }
}

export interface DashedLineProperties {
  photoId: string
}

/**
 * Dashed LineStrings linking each ghost (capturedAt) to its live subject
 * pin (lng/lat). Same membership rule as buildGhostFeatures — only for
 * moved photos.
 */
export function buildDashedLineFeatures(
  markers: readonly PhotoMarker[],
): FeatureCollection<LineString, DashedLineProperties> {
  const features: FeatureCollection<LineString, DashedLineProperties>['features'] = []
  for (const m of markers) {
    if (!m.capturedAt || !m.photoId) continue
    if (!isPhotoMoved(m)) continue
    features.push({
      type: 'Feature',
      id: m.id,
      geometry: {
        type: 'LineString',
        coordinates: [
          [m.capturedAt.lng, m.capturedAt.lat],
          [m.lng, m.lat],
        ],
      },
      properties: { photoId: m.photoId },
    })
  }
  return { type: 'FeatureCollection', features }
}

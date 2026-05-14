// Phase 4 of photo-map-culling: capture-dots GeoJSON projection.
// See docs/photo-map-culling/implementation-plan.md and ADR-016
// (marker rendering split: GeoJSON layer for static dots).
//
// Pure projection — `PhotoMarker[]` → `FeatureCollection<Point>` — so the
// expensive React tree only sees a single Source/Layer pair regardless of
// how many photos are imported (30..100 typical, 200+ edge case).

import type { FeatureCollection, Point } from 'geojson'
import type { PhotoMarker } from '../../types/markers'

export interface CaptureDotProperties {
  photoId: string
  /** Filename — surfaced in hover tooltips downstream (Phase 5). */
  name: string
}

/**
 * Build the GeoJSON FeatureCollection for the capture-dots layer.
 *
 * A photo marker appears in the capture-dots layer when ALL hold:
 *   - `capturedAt` is set (EXIF GPS was extracted at import time)
 *   - `photoId` is set (otherwise it's a KML/click marker, not a photo)
 *   - `label` is unset (a labelled marker is a Phase-5 "pick" — those
 *     render as a draggable subject pin, not a static capture dot)
 *
 * The feature is positioned at `capturedAt.lng/lat` — the location where
 * the camera GPS recorded the photo. The marker's primary `lng/lat`
 * (subject location) is irrelevant for the capture layer; Phase 5's
 * subject-pin path uses that.
 */
export function buildCaptureDotFeatures(
  markers: readonly PhotoMarker[],
): FeatureCollection<Point, CaptureDotProperties> {
  const features: FeatureCollection<Point, CaptureDotProperties>['features'] = []
  for (const m of markers) {
    if (!m.capturedAt) continue
    if (!m.photoId) continue
    if (m.label) continue
    features.push({
      type: 'Feature',
      id: m.id,
      geometry: { type: 'Point', coordinates: [m.capturedAt.lng, m.capturedAt.lat] },
      properties: { photoId: m.photoId, name: m.name },
    })
  }
  return { type: 'FeatureCollection', features }
}

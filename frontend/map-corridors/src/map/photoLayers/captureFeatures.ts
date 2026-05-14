// Phase 4 of photo-map-culling: capture-dots GeoJSON projection.
// See docs/photo-map-culling/implementation-plan.md and ADR-016
// (marker rendering split: GeoJSON layer for static dots).
//
// Pure projection — `PhotoMarker[]` → `FeatureCollection<Point>` — so the
// expensive React tree only sees a single Source/Layer pair regardless of
// how many photos are imported (30..100 typical, 200+ edge case).

import type { FeatureCollection, Point } from 'geojson'
import type { PhotoFlag, PhotoMarker } from '../../types/markers'

// `'neutral'` is denormalized at projection time so the Mapbox `match`
// paint expression can branch on a single property — it's not stored on
// the marker (absence of `flag` is the neutral state).
export type CaptureDotFlag = PhotoFlag | 'neutral'

export interface CaptureDotProperties {
  photoId: string
  /** Filename — surfaced in hover tooltips downstream. */
  name: string
  /** Drives the data-driven paint expression in CaptureDotsLayer. */
  flag: CaptureDotFlag
}

/**
 * Build the GeoJSON FeatureCollection for the capture-dots layer.
 *
 * A photo marker appears in the capture-dots layer when ALL hold:
 *   - `capturedAt` is set (EXIF GPS was extracted at import time)
 *   - `photoId` is set (otherwise it's a KML/click marker, not a photo)
 *   - `label` is unset (a labelled marker renders via the subject-pin
 *     path, not a capture dot)
 *   - `flag !== 'pick'` (picks render via the subject-pin path too,
 *     even without a label yet — user can pick first, label later)
 *
 * The feature is positioned at `capturedAt.lng/lat` — where the camera
 * GPS recorded the photo. The marker's primary `lng/lat` is the subject
 * location; once the user drags the subject pin away, the capture dot
 * must stay where the camera was. Test pins this invariant.
 */
export function buildCaptureDotFeatures(
  markers: readonly PhotoMarker[],
): FeatureCollection<Point, CaptureDotProperties> {
  const features: FeatureCollection<Point, CaptureDotProperties>['features'] = []
  for (const m of markers) {
    if (!m.capturedAt) continue
    if (!m.photoId) continue
    if (m.label) continue
    if (m.flag === 'pick') continue
    features.push({
      type: 'Feature',
      id: m.id,
      geometry: { type: 'Point', coordinates: [m.capturedAt.lng, m.capturedAt.lat] },
      properties: {
        photoId: m.photoId,
        name: m.name,
        flag: m.flag ?? 'neutral',
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

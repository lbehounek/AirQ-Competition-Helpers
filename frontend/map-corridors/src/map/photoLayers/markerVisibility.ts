// Single source of truth for "does this photo marker draw a live pin on the
// map?". A marker is visible iff it is a photo marker (has a `photoId`) and is
// NOT rejected — rejected photos are hidden from the map entirely and live
// only in the side panel's "Odmítnuté" group (Phase 12 / ADR-022). The capture
// ghost-dot + dashed-line projections in `captureFeatures` apply the same
// reject rule so the whole marker visual disappears together.

import type { PhotoMarker } from '../../types/markers'

export function isPhotoMarkerVisible(m: PhotoMarker): boolean {
  return !!m.photoId && m.flag !== 'reject'
}

/**
 * Does this marker draw a pin ANYWHERE on the live map? The live map renders
 * markers in two passes — photo pins (`isPhotoMarkerVisible`) and non-photo
 * KML/click-placed pins (`!m.photoId`, always shown) — so the on-screen set is
 * their union: everything except a rejected photo.
 *
 * Exports (PNG print, KML) MUST gate on this so they ship exactly what the user
 * sees. Filtering on `isPhotoMarkerVisible` alone would wrongly drop manually
 * placed markers (no `photoId`); not filtering at all reprints rejected photos
 * at their original EXIF spot — the "duplicate dot after dragging" bug.
 */
export function isMarkerVisibleOnMap(m: PhotoMarker): boolean {
  return !m.photoId || isPhotoMarkerVisible(m)
}

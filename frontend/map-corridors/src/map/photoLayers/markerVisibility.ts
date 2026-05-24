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

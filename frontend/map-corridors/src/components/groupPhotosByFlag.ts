// Phase 7 of photo-map-culling — grouping helper for the right-side panel.
// Pure function so the component itself stays thin and the grouping logic
// is testable without mounting React.

import type { NoGpsPhoto, PhotoMarker } from '../types/markers'

export interface GroupedPhotos {
  /** Photo markers with `flag === 'pick'`. Includes label-less picks. */
  picks: readonly PhotoMarker[]
  /** Photo markers with no flag and no label. */
  neutral: readonly PhotoMarker[]
  /** Photo markers with `flag === 'reject'`. */
  rejects: readonly PhotoMarker[]
  /** Photos imported without GPS that haven't been placed yet (live in NoGpsTray). */
  noGps: readonly NoGpsPhoto[]
  /** Total count across all four groups — useful for the empty-panel test. */
  total: number
}

/**
 * Partition the in-memory photo set into the four flag groups the right-
 * side panel shows. Excludes non-photo markers (KML/click-placed) by the
 * `photoId` filter — they don't belong on the photo list.
 */
export function groupPhotosByFlag(
  markers: readonly PhotoMarker[],
  noGpsPhotos: readonly NoGpsPhoto[],
): GroupedPhotos {
  const picks: PhotoMarker[] = []
  const neutral: PhotoMarker[] = []
  const rejects: PhotoMarker[] = []
  for (const m of markers) {
    if (!m.photoId) continue // KML markers don't belong in the photo list
    if (m.flag === 'pick') picks.push(m)
    else if (m.flag === 'reject') rejects.push(m)
    else neutral.push(m)
  }
  return {
    picks,
    neutral,
    rejects,
    noGps: noGpsPhotos,
    total: picks.length + neutral.length + rejects.length + noGpsPhotos.length,
  }
}

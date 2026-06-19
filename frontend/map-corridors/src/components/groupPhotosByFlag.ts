// Phase 7 of photo-map-culling — grouping helper for the right-side panel.
// Pure function so the component itself stays thin and the grouping logic
// is testable without mounting React.

import { isPickFlag } from '@airq/shared-handoff'
import type { NoGpsPhoto, PhotoMarker } from '../types/markers'
import { compareFilenames, compareNoGpsPhotos } from '../types/markers'

export interface GroupedPhotos {
  /** Photo markers picked as a TURNING-POINT (`flag === 'pick-turning'`). */
  picksTurning: readonly PhotoMarker[]
  /** Photo markers picked as a TRACK photo (`flag === 'pick-track'`, incl. legacy bare `pick`). */
  picksTrack: readonly PhotoMarker[]
  /** Photo markers with no flag and no label. */
  neutral: readonly PhotoMarker[]
  /** Photo markers with `flag === 'reject'`. */
  rejects: readonly PhotoMarker[]
  /** Photos imported without GPS that haven't been placed yet (live in NoGpsTray). */
  noGps: readonly NoGpsPhoto[]
  /** Total count across all groups — useful for the empty-panel test. */
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
  const picksTurning: PhotoMarker[] = []
  const picksTrack: PhotoMarker[] = []
  const neutral: PhotoMarker[] = []
  const rejects: PhotoMarker[] = []
  for (const m of markers) {
    if (!m.photoId) continue // KML markers don't belong in the photo list
    // Split picks by category so the panel shows "turning-point picks" vs
    // "track picks" separately. Turning-point first; every other pick
    // (pick-track + any legacy bare `pick`, migrated to track on load) goes to
    // the track group — matching the editor's per-flag print-set routing.
    if (m.flag === 'pick-turning') picksTurning.push(m)
    else if (isPickFlag(m.flag)) picksTrack.push(m)
    else if (m.flag === 'reject') rejects.push(m)
    else neutral.push(m)
  }
  // Order every group by the ORIGINAL camera filename (numeric-aware), so the
  // list mirrors the shooting sequence regardless of any custom `displayName`.
  // Sorting by the immutable `name` means renaming a photo never moves it.
  picksTurning.sort((a, b) => compareFilenames(a.name, b.name))
  picksTrack.sort((a, b) => compareFilenames(a.name, b.name))
  neutral.sort((a, b) => compareFilenames(a.name, b.name))
  rejects.sort((a, b) => compareFilenames(a.name, b.name))
  // Reuse the tray's comparator so the no-GPS group and the NoGpsTray agree on
  // tie-break order (filename primary, EXIF timestamp tie-break) for identical
  // filenames — not just on the primary filename sort.
  const noGps = [...noGpsPhotos].sort(compareNoGpsPhotos)
  return {
    picksTurning,
    picksTrack,
    neutral,
    rejects,
    noGps,
    total: picksTurning.length + picksTrack.length + neutral.length + rejects.length + noGps.length,
  }
}

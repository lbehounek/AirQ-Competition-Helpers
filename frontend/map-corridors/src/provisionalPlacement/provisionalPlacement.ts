// Phase 14 — provisional placement of a no-GPS photo (a draggable pin at the
// map center, committed to a category via its popup). The photo stays in
// `noGpsPhotos` until commit, so the provisional state can be invalidated out
// from under us if that photo leaves the list by another path (placed via the
// tray, or deleted). This pure predicate drives the reconcile effect that
// cancels a now-stale provisional, preventing an orphan pin + a misleading
// "placement failed" snack on a photo that was actually placed/removed.

import type { NoGpsPhoto } from '../types/markers'

export interface ProvisionalPlacement {
  photoId: string
  filename: string
  lng: number
  lat: number
}

/**
 * A provisional placement is still valid only while its photo is still
 * awaiting placement (present in `noGpsPhotos`). Null is trivially invalid.
 */
export function isProvisionalValid(
  provisional: ProvisionalPlacement | null,
  noGpsPhotos: readonly NoGpsPhoto[],
): boolean {
  if (!provisional) return false
  return noGpsPhotos.some(p => p.photoId === provisional.photoId)
}

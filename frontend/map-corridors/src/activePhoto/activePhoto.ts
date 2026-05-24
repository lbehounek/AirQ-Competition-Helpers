// Phase 13 (active-photo highlight) — pure helpers for the "currently active
// photo" (the one whose map popup is open). Extracted from App.tsx /
// MapProviderView so the two load-bearing rules can be unit-tested without
// mounting React:
//
//  - `shouldClearActivePhoto` — when MapProviderView's prune effect must drop
//    the active state (marker deleted, or rejected → hidden from the map).
//  - `resolveActivePhotoId` — the photoId the list panel should highlight,
//    null unless the active marker still exists AND is visible (not rejected).
//    Excluding rejected here prevents a one-render tint flash on a reject row
//    before the prune effect fires.

import type { PhotoMarker } from '../types/markers'

/**
 * True when the active marker should be cleared: nothing is active is NOT a
 * reason to clear (returns false for a null id), but a set id that no longer
 * resolves to a visible marker (missing, or `flag === 'reject'`) is.
 */
export function shouldClearActivePhoto(
  markers: readonly PhotoMarker[],
  activeMarkerId: string | null,
): boolean {
  if (!activeMarkerId) return false
  const m = markers.find(mm => mm.id === activeMarkerId)
  return !m || m.flag === 'reject'
}

/**
 * The photoId of the active photo for the list-panel highlight, or null when
 * nothing is active or the active marker is gone/rejected (hidden) or lacks a
 * photoId (KML markers are never photo-active).
 */
export function resolveActivePhotoId(
  markers: readonly PhotoMarker[],
  activeMarkerId: string | null,
): string | null {
  if (!activeMarkerId) return null
  const m = markers.find(mm => mm.id === activeMarkerId)
  if (!m || m.flag === 'reject') return null
  return m.photoId ?? null
}

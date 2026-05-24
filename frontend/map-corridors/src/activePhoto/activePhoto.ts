// Phase 13 (active-photo highlight) — pure helpers for the "currently active
// photo" (the one whose map popup is open). Extracted from App.tsx /
// MapProviderView so the two load-bearing rules can be unit-tested without
// mounting React:
//
//  - `shouldClearActivePhoto` — when MapProviderView's prune effect must drop
//    the active state. ONLY on deletion. NOT on reject — see below.
//  - `resolveActivePhotoId` — the photoId the list panel should highlight.
//
// Active = "the marker whose popup is open", regardless of flag. A rejected
// photo MUST be able to be active: clicking a rejected row in the side panel
// opens its popup so the user can un-reject it (set it back to pick/neutral).
// Clearing active on reject is exactly the bug that "broke re-opening
// picks/rejects from the side-panel click" — rejecting *via the popup* is
// closed by the explicit onReject handler, which is the only reject path that
// should dismiss the popup.

import type { PhotoMarker } from '../types/markers'

/**
 * True when the active marker should be cleared: only when the id no longer
 * resolves to ANY marker (deleted elsewhere). A null id is not a reason to
 * clear (returns false). Reject does NOT clear — a rejected photo stays
 * openable so it can be un-rejected from the list.
 */
export function shouldClearActivePhoto(
  markers: readonly PhotoMarker[],
  activeMarkerId: string | null,
): boolean {
  if (!activeMarkerId) return false
  return !markers.some(mm => mm.id === activeMarkerId)
}

/**
 * The photoId of the active photo for the list-panel highlight, or null when
 * nothing is active, the active marker is gone, or it lacks a photoId (KML
 * markers are never photo-active). Rejected photos DO resolve — their row
 * highlights while the popup is open so the user sees which one they're
 * un-rejecting.
 */
export function resolveActivePhotoId(
  markers: readonly PhotoMarker[],
  activeMarkerId: string | null,
): string | null {
  if (!activeMarkerId) return null
  const m = markers.find(mm => mm.id === activeMarkerId)
  return m?.photoId ?? null
}

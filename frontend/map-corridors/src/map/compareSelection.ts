// Pure decision logic for the map-side "compare co-located photos" gesture.
//
// Both entry points (a cluster's "⇄ N" pill and the floating Compare bar)
// resolve to a set of live PhotoMarkers and then have to choose between three
// outcomes: do nothing (too few), open the side-by-side modal (within the cap),
// or drop the set into the selection so the user can trim it down (over the
// cap). Kept free of React/map state — mirroring how `PhotoListPanel` extracts
// its pure selection helpers — so the cap boundary can be unit-tested directly.

import type { PhotoMarker } from '../types/markers'

export type CompareDecision =
  | { kind: 'ignore' }
  | { kind: 'compare'; markers: readonly PhotoMarker[] }
  | { kind: 'select'; ids: string[] }

/**
 * Decide what a compare gesture should do with `markers`, given the modal's
 * variant cap (`maxVariants`, i.e. `MAX_COMPARE_VARIANTS`):
 *   • fewer than 2  → `ignore` (nothing to compare)
 *   • 2..=cap       → `compare` (open the modal directly)
 *   • more than cap → `select` (trim down via the floating bar)
 */
export function decideCompareOrSelect(
  markers: readonly PhotoMarker[],
  maxVariants: number,
): CompareDecision {
  if (markers.length < 2) return { kind: 'ignore' }
  if (markers.length <= maxVariants) return { kind: 'compare', markers }
  return { kind: 'select', ids: markers.map(m => m.id) }
}

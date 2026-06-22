// Single source of truth for the set1/set2 split at a user-chosen TP break.
//
// Both the handoff writer (buildMapPicks → MapPickEntry.set, which the editor
// obeys) and the right-side panel's set1│set2 divider compute membership from
// THIS helper, so the file the editor receives and the boundary the user sees
// in the panel can never disagree. (Reframe 2026-06-22, visualize-break-only —
// see docs/photo-map-culling/set-split-suggestion-plan.md.)

import { isPickFlag } from '@airq/shared-handoff'
import type { PhotoMarker } from '../types/markers'
import { comparePhotoMarkers } from '../types/markers'

export type SetKey = 'set1' | 'set2'

/**
 * Resolve the effective set-break id, applying the rally-only rule in ONE
 * place: precision is single-sheet, so it never has a break (→ `null`, i.e.
 * default fill on the wire and no divider in the panel). Both `buildMapPicks`
 * write sites and the `PhotoListPanel` prop go through this, so the
 * "no break under precision" rule can't drift between the three call sites in
 * App.tsx (the click-time send write, the debounced effect, and the panel).
 */
export function resolveSetBreakId(
  effectiveDiscipline: string | null | undefined,
  setBreakPhotoId: string | null | undefined,
): string | null {
  if (effectiveDiscipline === 'precision') return null
  return setBreakPhotoId ?? null
}

/**
 * Map each pick's photoId to its target sheet, given the designated break TP.
 *
 * Picks are ordered by ROUTE order (`comparePhotoMarkers` — filename, then EXIF
 * time). Everything up to AND INCLUDING the break turning point is `set1`;
 * everything after is `set2` (locked convention: the break TP closes leg 1).
 * Track and turning picks share the single cut — the editor routes each into
 * its discipline's set1/set2 by flag, so one global partition is correct for
 * both disciplines.
 *
 * Returns an EMPTY map when there's no break, or the break id isn't a current
 * pick (a stale break). Callers then fall back to default behavior: the writer
 * emits no `set`, and the panel draws no divider.
 */
export function partitionPicksBySet(
  markers: readonly PhotoMarker[],
  breakPhotoId: string | null | undefined,
): Map<string, SetKey> {
  const out = new Map<string, SetKey>()
  if (!breakPhotoId) return out
  const sorted = markers
    .filter((m): m is PhotoMarker & { photoId: string } => !!m.photoId && isPickFlag(m.flag))
    .sort(comparePhotoMarkers)
  const breakIndex = sorted.findIndex(m => m.photoId === breakPhotoId)
  if (breakIndex < 0) return out
  sorted.forEach((m, i) => out.set(m.photoId, i <= breakIndex ? 'set1' : 'set2'))
  return out
}

/**
 * Index in `orderedPhotoIds` at which to render the "set 2 begins" divider, or
 * -1 for none. The divider sits before the first `set2` photo, but only when at
 * least one `set1` photo precedes it in the SAME list — a group that is wholly
 * set1 or wholly set2 has no within-group boundary and shows no divider.
 *
 * Pure + exported so the panel's JSX stays declarative and the boundary rule is
 * unit-tested. It must agree with the route-order partition even though the
 * panel sorts rows by filename: the two share a primary key (filename), so set1
 * is a prefix except across identical-filename ties, where "before the first
 * set2 row in panel order" is still the well-defined, sensible rendering.
 */
export function setBreakDividerIndex(
  orderedPhotoIds: readonly string[],
  setByPhotoId: ReadonlyMap<string, SetKey>,
): number {
  let sawSet1 = false
  for (let i = 0; i < orderedPhotoIds.length; i++) {
    const set = setByPhotoId.get(orderedPhotoIds[i])
    if (set === 'set1') sawSet1 = true
    else if (set === 'set2' && sawSet1) return i
  }
  return -1
}

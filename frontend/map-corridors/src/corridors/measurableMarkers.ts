import type { PhotoFlag } from '../types/markers'

/**
 * Which photo markers may be measured against the corridors.
 *
 * Rally flying hands the crew two kinds of photograph and they work in
 * opposite directions:
 *
 * - **En-route photographs** (FAI GAC Rally Flying Rules 2025, A 3.4.3b):
 *   a ringed target within 300 m of track. The crew locates it and marks its
 *   position. These ARE scored by distance — the corridor/leg matching exists
 *   for them.
 * - **Turning-point photographs** (A 3.4.3a, A 3.4.4): 11-17 of them, of which
 *   some deliberately show a feature NOT within 1.0 NM of the turn point. The
 *   crew decides correct or incorrect for each. These are NOT measured at all.
 *
 * So a distance from a turning-point photograph to a corridor is meaningless.
 * Worse, showing one is an information leak: the false photographs are exactly
 * the ones that would land far from any leg, so a printed distance column would
 * hand the crew the answer the task is asking them for.
 *
 * Extracted from `App.tsx` rather than left as an inline `.filter` so the
 * contract is unit-testable, the same reason `extractStartName` was split out.
 * Before this existed, `matchPointsToCorridors` ran over the unfiltered marker
 * list and a `pick-turning` marker did get a distance computed, which could
 * surface on the answer sheet whenever the photo carried a letter.
 *
 * `reject` is deliberately still measurable: it means the operator discarded
 * the photo from the set, not that it is a different KIND of photo, and
 * nothing downstream treats a rejected photo as a turning-point one.
 *
 * See docs/RALLY_TP_PHOTOS.md.
 */
export function isMeasurablePhoto(flag: PhotoFlag | null | undefined): boolean {
  return flag !== 'pick-turning'
}

/**
 * Filter a marker list down to the ones a distance may be computed for.
 *
 * Returns the input array itself when nothing is excluded. That buys one less
 * allocation on the common all-measurable path, and makes `result === markers`
 * true for anyone debugging — it does NOT control whether downstream memos
 * re-run. App wraps this call in `useMemo(..., [markers])`, so the identity
 * handed downstream is pinned by that memo, and returning a fresh array here
 * every time would behave identically.
 */
export function measurableMarkers<T extends { flag?: PhotoFlag | null }>(markers: readonly T[]): readonly T[] {
  const kept = markers.filter(m => isMeasurablePhoto(m.flag))
  return kept.length === markers.length ? markers : kept
}

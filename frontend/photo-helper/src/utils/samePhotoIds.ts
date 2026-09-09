/**
 * Compare two photo lists by id, in order.
 *
 * Returns `true` when both lists hold the same ids in the same positions.
 * ORDER MATTERS on purpose: a reorder must count as a change so the photo
 * files are (re)saved exactly as they were before this helper existed — the
 * persist path uses the result to decide whether `saveSessionPhotos` runs.
 *
 * Edge cases: the same array reference short-circuits to `true`; two empty
 * lists are equal; a length difference is decided without touching elements.
 *
 * WHY: replaces `JSON.stringify(a.map(p => p.id)) === JSON.stringify(b.map(p => p.id))`
 * on the persist hot path (`useCompetitionSystem.updateCurrentCompetition`,
 * which runs on every canvas edit). Identical semantics for arrays of strings,
 * at O(n) with no intermediate array or string allocation.
 */
export function samePhotoIds(
  a: readonly { id: string }[],
  b: readonly { id: string }[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

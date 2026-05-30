/**
 * Candidate-pool view filters. Pure so the rendering path stays testable
 * without mounting MUI (PR #62 review gap B8). V1 ships only the
 * `hideRejects` toggle; future pill filters (Picks / Neutral / Rejects)
 * will add cases to this helper rather than re-implementing the predicates.
 */
import { isPickFlag } from '@airq/shared-handoff';
import type { ApiPhoto } from '../types/api';

export type CandidateFilter = { hideRejects: boolean };

/**
 * Apply the view filter to the candidate pool.
 *
 * Returns the SAME array reference when no filter is active — useful for React
 * memoization and to skip unnecessary re-renders of the thumb grid.
 */
export function filterCandidates(photos: ApiPhoto[], filter: CandidateFilter): ApiPhoto[] {
  if (!filter.hideRejects) return photos;
  return photos.filter((p) => p.flag !== 'reject');
}

/**
 * Tally counts for the header chips. Centralised so a future filter that
 * changes the visible set doesn't have to re-implement the count logic.
 * Counts are computed over ALL photos (not the filtered view) — the header
 * shows totals regardless of what is hidden.
 */
export function countByFlag(photos: ApiPhoto[]): {
  pick: number;
  neutral: number;
  reject: number;
  total: number;
} {
  let pick = 0;
  let neutral = 0;
  let reject = 0;
  for (const p of photos) {
    // Any pick category (legacy `pick`, `pick-track`, `pick-turning`) tallies
    // as a pick — see shared isPickFlag (A3 split, 2026-05-30).
    if (isPickFlag(p.flag)) pick++;
    else if (p.flag === 'reject') reject++;
    else neutral++;
  }
  return { pick, neutral, reject, total: photos.length };
}

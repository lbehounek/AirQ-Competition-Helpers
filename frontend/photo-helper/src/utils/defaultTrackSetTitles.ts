/**
 * Default titles for the track-mode print-header sets, keyed by discipline.
 *
 * Precision hides set2 in the UI (`AppApi.tsx:202`) and packs every photo
 * into set1, so the set1 title represents the WHOLE route from SP to FP.
 * The rally "SP - TPX" / "TPX - FP" pair would mislead the print header
 * into suggesting a midway split that doesn't exist for precision
 * (feedback 2026-04-26 — issue #1: "Přesné: track-photo set title
 * `SP - TPX` -> `SP - FP`").
 *
 * Rally retains the split "SP - TPX" / "TPX - FP" so the auto-prefill
 * regex `/^SP\s*-\s*TP(\d+)$/i` keeps working when crews customise to
 * `SP - TP3` mid-flight.
 *
 * Extracted from `useCompetitionSystem.ts` so the contract can be unit-
 * tested in isolation. Three call sites in the hook (init, create, mode-
 * switch fallback) consume this; if a future refactor flips the ternary
 * or maps the precision branch to the rally pair, precision sessions
 * would silently default to "SP - TPX" — exactly the bug this module's
 * test pins against.
 */

export const DEFAULT_TRACK_SET1_TITLE_RALLY = 'SP - TPX';
export const DEFAULT_TRACK_SET2_TITLE_RALLY = 'TPX - FP';
export const DEFAULT_TRACK_SET1_TITLE_PRECISION = 'SP - FP';

export interface TrackSetTitles {
  set1: string;
  set2: string;
}

export function defaultTrackSetTitles(isPrecision: boolean): TrackSetTitles {
  return isPrecision
    ? { set1: DEFAULT_TRACK_SET1_TITLE_PRECISION, set2: '' }
    : { set1: DEFAULT_TRACK_SET1_TITLE_RALLY, set2: DEFAULT_TRACK_SET2_TITLE_RALLY };
}

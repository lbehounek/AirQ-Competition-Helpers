import { describe, it, expect } from 'vitest';
import {
  defaultTrackSetTitles,
  DEFAULT_TRACK_SET1_TITLE_PRECISION,
  DEFAULT_TRACK_SET1_TITLE_RALLY,
  DEFAULT_TRACK_SET2_TITLE_RALLY,
} from '../utils/defaultTrackSetTitles';

/**
 * Pins the discipline → default-title mapping (feedback 2026-04-26 #1).
 * If a future refactor flips the ternary or accidentally returns the
 * rally pair for precision, the print header for precision sessions
 * would revert to the misleading "SP - TPX" / "TPX - FP" — exactly the
 * bug this fix addresses.
 */
describe('defaultTrackSetTitles', () => {
  it('returns "SP - FP" set1 and EMPTY set2 for precision', () => {
    // Precision hides set2 entirely (AppApi.tsx:202), so set2.title must
    // not contain the rally placeholder text — empty string signals
    // "no set2 to render in the header".
    expect(defaultTrackSetTitles(true)).toEqual({
      set1: 'SP - FP',
      set2: '',
    });
    expect(defaultTrackSetTitles(true).set1).toBe(DEFAULT_TRACK_SET1_TITLE_PRECISION);
  });

  it('returns the split "SP - TPX" / "TPX - FP" pair for rally', () => {
    // Rally keeps the auto-prefill seed so /^SP\s*-\s*TP(\d+)$/i still
    // fires for crews who customise to "SP - TP3" mid-flight.
    expect(defaultTrackSetTitles(false)).toEqual({
      set1: 'SP - TPX',
      set2: 'TPX - FP',
    });
    expect(defaultTrackSetTitles(false).set1).toBe(DEFAULT_TRACK_SET1_TITLE_RALLY);
    expect(defaultTrackSetTitles(false).set2).toBe(DEFAULT_TRACK_SET2_TITLE_RALLY);
  });

  it('NEVER returns rally defaults for precision (regression guard)', () => {
    // The bug this PR fixes was the precision path leaking rally titles.
    // If anyone accidentally swaps the branches, this fails loudly.
    const precision = defaultTrackSetTitles(true);
    expect(precision.set1).not.toBe(DEFAULT_TRACK_SET1_TITLE_RALLY);
    expect(precision.set2).not.toBe(DEFAULT_TRACK_SET2_TITLE_RALLY);
  });

  it('returns a fresh object on each call (no shared mutable reference)', () => {
    // Defensive: callers mutate `newSets.set1.title = trackTitles.set1`
    // (useCompetitionSystem.ts:740). If we returned a shared singleton,
    // all call sites would alias the same object — fine for primitive
    // assignments today but a footgun if anyone later mutates the
    // returned object directly.
    const a = defaultTrackSetTitles(true);
    const b = defaultTrackSetTitles(true);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

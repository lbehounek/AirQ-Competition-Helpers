import { describe, it, expect } from 'vitest';
import {
  deriveSet1FromSet2,
  deriveSet2FromSet1,
  matchSpTpTitle,
  matchTpFpTitle,
} from '../utils/autoPrefillSetTitle';

/**
 * Pins the rally track-mode auto-prefill contract:
 *
 *   "if photos switch at TP3, the first set must be SP-TP3 and the
 *    other TP3-FP"  (user feedback)
 *
 * The contract has lived as inline regex in three separate call sites
 * (AppApi.tsx:316, useCompetitionSystem.ts:679,
 * usePhotoSessionOPFS.ts:355-356). Now consolidated; the tests below
 * lock the behavior so future drift across call sites can't happen.
 */
describe('autoPrefillSetTitle', () => {
  describe('deriveSet2FromSet1 (track-mode set1 → set2)', () => {
    it('derives "TP3 - FP" when the user types "SP - TP3" — the headline contract', () => {
      // The exact scenario from the user feedback: photos switch at TP3,
      // set1 becomes "SP - TP3", set2 must auto-fill to "TP3 - FP".
      expect(deriveSet2FromSet1('SP - TP3')).toBe('TP3 - FP');
    });

    it('handles single-digit TPs (TP1 through TP9)', () => {
      for (let i = 1; i <= 9; i++) {
        expect(deriveSet2FromSet1(`SP - TP${i}`)).toBe(`TP${i} - FP`);
      }
    });

    it('handles two-digit TPs (TP10, TP25, TP99)', () => {
      // Defensive — long competitions can have TP10+. The regex captures
      // \d+ so multi-digit numbers are preserved without truncation.
      expect(deriveSet2FromSet1('SP - TP10')).toBe('TP10 - FP');
      expect(deriveSet2FromSet1('SP - TP25')).toBe('TP25 - FP');
      expect(deriveSet2FromSet1('SP - TP99')).toBe('TP99 - FP');
    });

    it('is lenient on inner whitespace (matches "SP-TP3" and "SP   -   TP3")', () => {
      expect(deriveSet2FromSet1('SP-TP3')).toBe('TP3 - FP');
      expect(deriveSet2FromSet1('SP   -   TP3')).toBe('TP3 - FP');
      expect(deriveSet2FromSet1('  SP - TP3  ')).toBe('TP3 - FP');
    });

    it('is case-insensitive on the SP and TP letters', () => {
      expect(deriveSet2FromSet1('sp - tp3')).toBe('TP3 - FP');
      expect(deriveSet2FromSet1('Sp - Tp3')).toBe('TP3 - FP');
    });

    it('returns null for the "SP - TPX" placeholder (NOT a real TP number)', () => {
      // Critical contract: the rally default is "SP - TPX" — auto-prefill
      // must NOT fire on the placeholder, otherwise set2 would get the
      // garbage value "TPX - FP" derived from the placeholder. The user
      // must commit to a real TP number (digit) before set2 follows.
      expect(deriveSet2FromSet1('SP - TPX')).toBeNull();
    });

    it('returns null for arbitrary user-customised titles (preserves overrides)', () => {
      // The user's deliberate set1 customisation is sacred — we never
      // overwrite their set2 unless set1 looks EXACTLY like the
      // SP-TP<N> shape. "SP - my route" stays untouched.
      expect(deriveSet2FromSet1('SP - my route')).toBeNull();
      expect(deriveSet2FromSet1('Custom title')).toBeNull();
      expect(deriveSet2FromSet1('SP - FP')).toBeNull();          // precision default
      expect(deriveSet2FromSet1('SP - TP3 (note)')).toBeNull();  // trailing extras
    });

    it('returns null for the empty string (user cleared the field)', () => {
      expect(deriveSet2FromSet1('')).toBeNull();
      expect(deriveSet2FromSet1('   ')).toBeNull();
    });

    it('returns null for half-matches (no FP/TP suffix)', () => {
      expect(deriveSet2FromSet1('SP')).toBeNull();
      expect(deriveSet2FromSet1('SP -')).toBeNull();
      expect(deriveSet2FromSet1('SP - TP')).toBeNull();
      expect(deriveSet2FromSet1('TP3 - FP')).toBeNull();
    });
  });

  describe('deriveSet1FromSet2 (turning-point-mode set2 → set1, bidirectional sync)', () => {
    it('derives "SP - TP3" when the user types "TP3 - FP" — the inverse contract', () => {
      expect(deriveSet1FromSet2('TP3 - FP')).toBe('SP - TP3');
    });

    it('handles multi-digit TPs', () => {
      expect(deriveSet1FromSet2('TP10 - FP')).toBe('SP - TP10');
      expect(deriveSet1FromSet2('TP25 - FP')).toBe('SP - TP25');
    });

    it('is lenient on whitespace and case', () => {
      expect(deriveSet1FromSet2('tp3 - fp')).toBe('SP - TP3');
      expect(deriveSet1FromSet2('TP3-FP')).toBe('SP - TP3');
      expect(deriveSet1FromSet2('  TP3 - FP  ')).toBe('SP - TP3');
    });

    it('returns null for the "TPX - FP" placeholder', () => {
      expect(deriveSet1FromSet2('TPX - FP')).toBeNull();
    });

    it('returns null for arbitrary titles', () => {
      expect(deriveSet1FromSet2('Custom - FP')).toBeNull();
      expect(deriveSet1FromSet2('TP3 - destination')).toBeNull();
      expect(deriveSet1FromSet2('SP - FP')).toBeNull();
      expect(deriveSet1FromSet2('')).toBeNull();
    });
  });

  describe('low-level matchers (matchSpTpTitle, matchTpFpTitle)', () => {
    it('matchSpTpTitle returns the captured digit string', () => {
      expect(matchSpTpTitle('SP - TP3')).toBe('3');
      expect(matchSpTpTitle('SP - TP10')).toBe('10');
      expect(matchSpTpTitle('Custom')).toBeNull();
    });

    it('matchTpFpTitle returns the captured digit string', () => {
      expect(matchTpFpTitle('TP3 - FP')).toBe('3');
      expect(matchTpFpTitle('TP10 - FP')).toBe('10');
      expect(matchTpFpTitle('Custom')).toBeNull();
    });
  });

  describe('round-trip — set1 ↔ set2 consistency', () => {
    // The headline behavior: derive each direction and verify they
    // agree. A regression that swapped or dropped capture groups
    // would surface here.
    it('SP - TP3 → TP3 - FP → SP - TP3 (round-trip identity)', () => {
      const set2 = deriveSet2FromSet1('SP - TP3');
      expect(set2).toBe('TP3 - FP');
      const set1 = deriveSet1FromSet2(set2!);
      expect(set1).toBe('SP - TP3');
    });

    it('round-trip works for multi-digit TPs', () => {
      const set2 = deriveSet2FromSet1('SP - TP12');
      expect(set2).toBe('TP12 - FP');
      const set1 = deriveSet1FromSet2(set2!);
      expect(set1).toBe('SP - TP12');
    });
  });
});

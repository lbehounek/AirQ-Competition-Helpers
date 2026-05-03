import { describe, it, expect } from 'vitest';
import { rallyGridFor } from '../utils/rallyGridFor';

// The boundary at count === 10 is load-bearing: a regression where
// `count >= 10` becomes `count > 10` would resurrect the round-4 bug
// (the 10th photo silently hidden behind a 3×3 landscape grid).
// Pinning every adjacent point to the boundary surfaces that.
describe('rallyGridFor', () => {
  describe('precision discipline', () => {
    it('returns undefined regardless of count or layout', () => {
      expect(rallyGridFor(0, 'landscape', true)).toBeUndefined();
      expect(rallyGridFor(5, 'portrait', true)).toBeUndefined();
      expect(rallyGridFor(10, 'landscape', true)).toBeUndefined();
      expect(rallyGridFor(10, 'portrait', true)).toBeUndefined();
    });
  });

  describe('rally portrait', () => {
    it('always returns 10 slots in 2 columns (2×5), regardless of count', () => {
      // Portrait stays 2×5 = 10 unconditionally — the only orientation
      // that ever rendered 10 cells in the legacy code.
      expect(rallyGridFor(0, 'portrait', false)).toEqual({ slots: 10, columns: 2 });
      expect(rallyGridFor(5, 'portrait', false)).toEqual({ slots: 10, columns: 2 });
      expect(rallyGridFor(10, 'portrait', false)).toEqual({ slots: 10, columns: 2 });
    });
  });

  describe('rally landscape', () => {
    it('returns 9 slots in 3 columns (3×3) when count is below 10', () => {
      expect(rallyGridFor(0, 'landscape', false)).toEqual({ slots: 9, columns: 3 });
      expect(rallyGridFor(5, 'landscape', false)).toEqual({ slots: 9, columns: 3 });
      expect(rallyGridFor(9, 'landscape', false)).toEqual({ slots: 9, columns: 3 });
    });

    it('returns 10 slots in 5 columns (5×2) at the count === 10 boundary', () => {
      // The exact boundary the round-4 fix targets — flips from 3×3 to 5×2.
      expect(rallyGridFor(10, 'landscape', false)).toEqual({ slots: 10, columns: 5 });
    });

    it('returns 10 slots in 5 columns when count > 10 (defensive — cap is 10)', () => {
      // Cap is enforced upstream by distributeRallyDrop. If somehow a
      // higher count slips through, the grid still shows 5×2 rather
      // than truncating to 3×3.
      expect(rallyGridFor(11, 'landscape', false)).toEqual({ slots: 10, columns: 5 });
      expect(rallyGridFor(99, 'landscape', false)).toEqual({ slots: 10, columns: 5 });
    });

    it('shrinks back to 3×3 if the user removes a photo from a full 5×2 set', () => {
      // 10 photos → 5×2; user removes one, count becomes 9 → 3×3.
      // The remaining 9 photos still fit (3×3 holds 9 exactly), no loss.
      const fullGrid = rallyGridFor(10, 'landscape', false);
      const afterRemove = rallyGridFor(9, 'landscape', false);
      expect(fullGrid).toEqual({ slots: 10, columns: 5 });
      expect(afterRemove).toEqual({ slots: 9, columns: 3 });
    });
  });
});

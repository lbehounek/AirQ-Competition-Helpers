import { describe, it, expect } from 'vitest';
import { samePhotoIds } from '../utils/samePhotoIds';

// `samePhotoIds` replaced four `JSON.stringify(...map(p => p.id))` comparisons
// on `updateCurrentCompetition`'s hot path. The contract that matters is that
// it produces the SAME verdict as the code it replaced — including the part
// people find surprising, that a pure reorder counts as a change (photo files
// must be re-saved in their new order).

const ids = (...values: string[]) => values.map(id => ({ id }));

/** The exact expression this helper replaced, kept as the oracle. */
const stringifyOracle = (a: { id: string }[], b: { id: string }[]) =>
  JSON.stringify(a.map(p => p.id)) === JSON.stringify(b.map(p => p.id));

describe('samePhotoIds', () => {
  it('returns true for the same array reference', () => {
    const list = ids('a', 'b', 'c');
    expect(samePhotoIds(list, list)).toBe(true);
  });

  it('returns true for equal ids in the same order', () => {
    expect(samePhotoIds(ids('a', 'b', 'c'), ids('a', 'b', 'c'))).toBe(true);
  });

  it('returns false when the lengths differ', () => {
    expect(samePhotoIds(ids('a', 'b'), ids('a', 'b', 'c'))).toBe(false);
    expect(samePhotoIds(ids('a', 'b', 'c'), ids('a', 'b'))).toBe(false);
  });

  it('returns false for the same ids in a different order (a reorder IS a change)', () => {
    expect(samePhotoIds(ids('a', 'b', 'c'), ids('c', 'b', 'a'))).toBe(false);
  });

  it('returns true for two empty lists', () => {
    expect(samePhotoIds([], [])).toBe(true);
  });

  it('agrees with the JSON.stringify comparison it replaced', () => {
    const cases: Array<[{ id: string }[], { id: string }[]]> = [
      [[], []],
      [ids('a'), []],
      [[], ids('a')],
      [ids('a'), ids('a')],
      [ids('a'), ids('b')],
      [ids('a', 'b'), ids('b', 'a')],
      [ids('a', 'b', 'c'), ids('a', 'b', 'c')],
      [ids('a', 'b', 'c'), ids('a', 'b', 'c', 'd')],
      // Ids that only differ deep in the string — guards against a comparison
      // that accidentally short-circuits on length or first character.
      [ids('photo-1111', 'photo-2222'), ids('photo-1111', 'photo-2223')],
    ];
    for (const [a, b] of cases) {
      expect(samePhotoIds(a, b), `mismatch for ${JSON.stringify([a, b])}`)
        .toBe(stringifyOracle(a, b));
    }
  });
});

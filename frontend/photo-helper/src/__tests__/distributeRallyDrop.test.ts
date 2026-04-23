import { describe, it, expect } from 'vitest';
import { distributeRallyDrop } from '../utils/distributeRallyDrop';

// Minimal File stand-in; distributeRallyDrop only uses `files.slice` and
// `files.length`, never File's own API. Plain objects keep the test hermetic.
function fakeFiles(n: number): File[] {
  return Array.from({ length: n }, (_, i) => ({ name: `p${i}.jpg` } as unknown as File));
}

describe('distributeRallyDrop — landscape (9+9 = 18 cap)', () => {
  it('splits 16 photos across the empty 9/9 grid as 9 + 7', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(16), layoutMode: 'landscape', set1Count: 0, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(9);
    expect(r.toSet2).toHaveLength(7);
    expect(r.maxTotal).toBe(18);
  });

  it('splits 10 photos as 9 + 1', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(10), layoutMode: 'landscape', set1Count: 0, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(9);
    expect(r.toSet2).toHaveLength(1);
  });

  it('accepts exactly 18 photos (capacity boundary)', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(18), layoutMode: 'landscape', set1Count: 0, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(9);
    expect(r.toSet2).toHaveLength(9);
  });

  it('rejects 19 photos in landscape (over cap)', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(19), layoutMode: 'landscape', set1Count: 0, set2Count: 0,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('overflow');
    expect(r.maxTotal).toBe(18);
    expect(r.totalIfAdded).toBe(19);
  });

  it('respects partially-filled set1: set1Count=5 + drop 10 → 4 remaining to set1, 6 to set2', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(10), layoutMode: 'landscape', set1Count: 5, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(4);
    expect(r.toSet2).toHaveLength(6);
  });

  it('set1 already full: drop 8 → 0 to set1, 8 to set2', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(8), layoutMode: 'landscape', set1Count: 9, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(0);
    expect(r.toSet2).toHaveLength(8);
  });

  it('set1 over-full (data anomaly): clamps set1Remaining to 0 rather than negative-slicing', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(3), layoutMode: 'landscape', set1Count: 12, set2Count: 0,
    });
    // set1Count (12) > maxTotal (18) – files(3) = 15, so overflow check passes.
    // Math.max(0, 9 - 12) = 0 → everything to set2.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(0);
    expect(r.toSet2).toHaveLength(3);
  });
});

describe('distributeRallyDrop — portrait (10+10 = 20 cap)', () => {
  it('splits 16 photos across the empty 10/10 grid as 10 + 6', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(16), layoutMode: 'portrait', set1Count: 0, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(10);
    expect(r.toSet2).toHaveLength(6);
  });

  it('accepts exactly 20 photos (capacity boundary)', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(20), layoutMode: 'portrait', set1Count: 0, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(10);
    expect(r.toSet2).toHaveLength(10);
    expect(r.maxTotal).toBe(20);
  });

  it('rejects 21 photos in portrait (over cap)', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(21), layoutMode: 'portrait', set1Count: 0, set2Count: 0,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('overflow');
    expect(r.maxTotal).toBe(20);
  });
});

describe('distributeRallyDrop — empty drops', () => {
  it('zero files returns empty arrays and ok=true', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(0), layoutMode: 'landscape', set1Count: 3, set2Count: 2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(0);
    expect(r.toSet2).toHaveLength(0);
  });
});

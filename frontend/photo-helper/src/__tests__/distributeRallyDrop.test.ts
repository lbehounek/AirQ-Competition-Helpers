import { describe, it, expect } from 'vitest';
import {
  distributeRallyDrop,
  RALLY_TURNING_PER_SET,
  RALLY_TURNING_MAX_TOTAL,
} from '../utils/distributeRallyDrop';

// Minimal File stand-in; distributeRallyDrop only uses `files.slice` and
// `files.length`, never File's own API. Plain objects keep the test hermetic.
function fakeFiles(n: number): File[] {
  return Array.from({ length: n }, (_, i) => ({ name: `p${i}.jpg` } as unknown as File));
}

// Rally rules allow up to 18 turning points (= SP + 18 TP + FP = 20
// photos) per feedback 2026-05-03. Per-set capacity is therefore 10 in
// BOTH orientations — the landscape grid auto-expands from 3×3 to 5×2
// once a set reaches 10 photos. `layoutMode` is retained on the input
// type for backward compatibility but no longer affects capacity.
describe('distributeRallyDrop — orientation-agnostic 10+10 = 20 cap', () => {
  it('exposes the per-set and total caps', () => {
    expect(RALLY_TURNING_PER_SET).toBe(10);
    expect(RALLY_TURNING_MAX_TOTAL).toBe(20);
  });

  it('splits 16 photos across an empty 10/10 grid as 10 + 6 (landscape)', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(16), layoutMode: 'landscape', set1Count: 0, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(10);
    expect(r.toSet2).toHaveLength(6);
    expect(r.maxTotal).toBe(20);
  });

  it('splits 10 photos as 10 + 0 (single page filled)', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(10), layoutMode: 'landscape', set1Count: 0, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(10);
    expect(r.toSet2).toHaveLength(0);
  });

  it('accepts exactly 20 photos at the capacity boundary', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(20), layoutMode: 'landscape', set1Count: 0, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(10);
    expect(r.toSet2).toHaveLength(10);
  });

  it('rejects 21 photos (over cap) regardless of layout', () => {
    const land = distributeRallyDrop({
      files: fakeFiles(21), layoutMode: 'landscape', set1Count: 0, set2Count: 0,
    });
    expect(land.ok).toBe(false);
    if (land.ok) return;
    expect(land.reason).toBe('overflow');
    expect(land.maxTotal).toBe(20);
    expect(land.totalIfAdded).toBe(21);

    const port = distributeRallyDrop({
      files: fakeFiles(21), layoutMode: 'portrait', set1Count: 0, set2Count: 0,
    });
    expect(port.ok).toBe(false);
  });

  it('respects partially-filled set1: set1Count=5 + drop 10 → 5 remaining to set1, 5 to set2', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(10), layoutMode: 'landscape', set1Count: 5, set2Count: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(5);
    expect(r.toSet2).toHaveLength(5);
  });

  it('set1 already full: drop 8 → 0 to set1, 8 to set2', () => {
    const r = distributeRallyDrop({
      files: fakeFiles(8), layoutMode: 'landscape', set1Count: 10, set2Count: 0,
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
    // set1Count (12) + files (3) = 15 ≤ maxTotal (20), so overflow check passes.
    // Math.max(0, 10 - 12) = 0 → everything to set2.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.toSet1).toHaveLength(0);
    expect(r.toSet2).toHaveLength(3);
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

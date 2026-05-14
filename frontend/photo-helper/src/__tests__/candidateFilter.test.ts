import { describe, it, expect } from 'vitest';
import { filterCandidates, countByFlag } from '../utils/candidateFilter';
import type { ApiPhoto, CandidateFlag } from '../types/api';

// Filter helper for the CandidateTray view (PR #62 review gap B8). The
// component was previously 507 lines of UI logic with no direct test; the
// filter + count helpers are now isolated and behaviorally pinned here.

function makePhoto(id: string, flag?: CandidateFlag | undefined): ApiPhoto {
  return {
    id,
    sessionId: 'sess-1',
    url: `blob:${id}`,
    filename: `${id}.jpg`,
    canvasState: {
      position: { x: 0, y: 0 },
      scale: 1,
      brightness: 0,
      contrast: 1,
      sharpness: 0,
      whiteBalance: { temperature: 0, tint: 0, auto: false },
      labelPosition: 'bottom-left',
    } as any,
    label: '',
    ...(flag !== undefined ? { flag } : {}),
  };
}

describe('filterCandidates', () => {
  it('returns the same array reference when hideRejects is off (memo-friendly)', () => {
    const photos = [makePhoto('a', 'pick'), makePhoto('b', 'reject'), makePhoto('c')];
    const result = filterCandidates(photos, { hideRejects: false });
    expect(result).toBe(photos);
  });

  it('removes only rejected photos when hideRejects is on', () => {
    const photos = [makePhoto('a', 'pick'), makePhoto('b', 'reject'), makePhoto('c')];
    const result = filterCandidates(photos, { hideRejects: true });
    expect(result.map(p => p.id)).toEqual(['a', 'c']);
  });

  it('treats missing flag as not-rejected', () => {
    const photos = [makePhoto('a'), makePhoto('b', 'pick'), makePhoto('c', 'reject')];
    const result = filterCandidates(photos, { hideRejects: true });
    expect(result.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('returns empty when every photo is rejected and toggle is on', () => {
    const photos = [makePhoto('a', 'reject'), makePhoto('b', 'reject')];
    expect(filterCandidates(photos, { hideRejects: true })).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const photos = [makePhoto('a', 'reject'), makePhoto('b', 'pick')];
    const before = photos.map(p => p.id);
    filterCandidates(photos, { hideRejects: true });
    expect(photos.map(p => p.id)).toEqual(before);
  });
});

describe('countByFlag', () => {
  it('counts each flag bucket, treats missing flag as neutral', () => {
    const photos = [
      makePhoto('a', 'pick'),
      makePhoto('b', 'pick'),
      makePhoto('c'),
      makePhoto('d', 'reject'),
      makePhoto('e'),
    ];
    expect(countByFlag(photos)).toEqual({ pick: 2, neutral: 2, reject: 1, total: 5 });
  });

  it('zeros all counts on an empty pool', () => {
    expect(countByFlag([])).toEqual({ pick: 0, neutral: 0, reject: 0, total: 0 });
  });
});

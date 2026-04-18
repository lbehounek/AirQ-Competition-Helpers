import { describe, it, expect } from 'vitest';
import { buildPdfSets } from '../utils/buildPdfSets';
import type { ApiPhoto, ApiPhotoSet } from '../types/api';

// buildPdfSets is the pure core of the precision PDF correctness guarantee
// from feedback 2026-04-18: "precision = single set". If a stale set2 from
// a mid-session discipline switch leaks into the printed PDF, competition
// judges see wrong photos. That regression ships silently unless pinned.

function makePhoto(id: string, filename = `${id}.jpg`): ApiPhoto {
  return {
    id,
    sessionId: 'sess-1',
    url: `blob://${id}`,
    filename,
    canvasState: {} as any,
    label: '', // will be overwritten by buildPdfSets
  };
}

function makeSet(title: string, ids: string[]): ApiPhotoSet {
  return { title, photos: ids.map(id => makePhoto(id)) };
}

const letterLabel = (index: number, offset = 0): string =>
  String.fromCharCode(65 + index + offset) + '.';

describe('buildPdfSets — turningpoint mode', () => {
  it('rally: labels full SP / TP1..TPn / FP sequence across both sets', () => {
    const result = buildPdfSets({
      mode: 'turningpoint',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: makeSet('SP - TP5', ['a', 'b', 'c', 'd', 'e']),
      set2: makeSet('TP5 - FP', ['f', 'g', 'h', 'i', 'j']),
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual([
      'SP', 'TP1', 'TP2', 'TP3', 'TP4',
    ]);
    expect(result.set2WithLabels.photos.map(p => p.label)).toEqual([
      'TP5', 'TP6', 'TP7', 'TP8', 'FP',
    ]);
  });

  it('precision: set2 photos dropped, set1 labeled SP + TP1..TP7 + FP (9 photos)', () => {
    const result = buildPdfSets({
      mode: 'turningpoint',
      layoutMode: 'landscape',
      isPrecision: true,
      set1: makeSet('Precision', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']),
      // stale set2 from a prior rally session that must NOT leak into PDF
      set2: makeSet('stale', ['s1', 's2', 's3']),
      generateLabel: letterLabel,
    });
    expect(result.set2WithLabels.photos).toEqual([]);
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual([
      'SP', 'TP1', 'TP2', 'TP3', 'TP4', 'TP5', 'TP6', 'TP7', 'FP',
    ]);
  });

  it('precision: preserves set2.title even when photos are cleared', () => {
    const result = buildPdfSets({
      mode: 'turningpoint',
      layoutMode: 'landscape',
      isPrecision: true,
      set1: makeSet('single', ['a', 'b', 'c']),
      set2: makeSet('should-persist-title', ['x']),
      generateLabel: letterLabel,
    });
    expect(result.set2WithLabels.title).toBe('should-persist-title');
  });

  it('precision: empty set1 still zeros set2 without throwing', () => {
    const result = buildPdfSets({
      mode: 'turningpoint',
      layoutMode: 'landscape',
      isPrecision: true,
      set1: makeSet('empty', []),
      set2: makeSet('stale', ['x', 'y']),
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos).toEqual([]);
    expect(result.set2WithLabels.photos).toEqual([]);
  });

  it('preserves ApiPhoto fields other than label', () => {
    const result = buildPdfSets({
      mode: 'turningpoint',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: makeSet('s1', ['a']),
      set2: makeSet('s2', ['b']),
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos[0].id).toBe('a');
    expect(result.set1WithLabels.photos[0].filename).toBe('a.jpg');
    expect(result.set1WithLabels.photos[0].sessionId).toBe('sess-1');
  });
});

describe('buildPdfSets — track mode', () => {
  it('rally: letter labels continue across sets (A B C | D E F)', () => {
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: makeSet('s1', ['a', 'b', 'c']),
      set2: makeSet('s2', ['d', 'e', 'f']),
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['A.', 'B.', 'C.']);
    expect(result.set2WithLabels.photos.map(p => p.label)).toEqual(['D.', 'E.', 'F.']);
  });

  it('precision: set2 dropped regardless of layoutMode', () => {
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'portrait',
      isPrecision: true,
      set1: makeSet('s1', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']),
      set2: makeSet('stale', ['s']),
      generateLabel: letterLabel,
    });
    expect(result.set2WithLabels.photos).toEqual([]);
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual([
      'A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.', 'H.', 'I.', 'J.',
    ]);
  });

  it('passes set1 offset to generateLabel for set2 so rally counts keep going', () => {
    const calls: Array<[number, number | undefined]> = [];
    const spyLabel = (index: number, offset?: number): string => {
      calls.push([index, offset]);
      return `${index}/${offset ?? 0}`;
    };
    buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: makeSet('s1', ['a', 'b', 'c']),
      set2: makeSet('s2', ['d', 'e']),
      generateLabel: spyLabel,
    });
    expect(calls).toEqual([
      [0, undefined], [1, undefined], [2, undefined], // set1
      [0, 3], [1, 3],                                 // set2 offset by set1.length
    ]);
  });
});

describe('buildPdfSets — non-mutation guarantee', () => {
  it('does not mutate the input sets or photos', () => {
    const set1 = makeSet('s1', ['a']);
    const set2 = makeSet('s2', ['b']);
    const frozen1 = JSON.parse(JSON.stringify(set1));
    const frozen2 = JSON.parse(JSON.stringify(set2));
    buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: true,
      set1,
      set2,
      generateLabel: letterLabel,
    });
    expect(set1).toEqual(frozen1);
    expect(set2).toEqual(frozen2);
  });
});

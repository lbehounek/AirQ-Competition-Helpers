import { describe, it, expect } from 'vitest';
import { buildPdfSets } from '../utils/buildPdfSets';
import type { ApiPhoto, ApiPhotoSet } from '../types/api';
import { makeCanvasState } from './support/testHelpers';

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
    canvasState: makeCanvasState(),
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

  it('rally: a "no photo" placeholder holds its slot number; surrounding labels are unaffected', () => {
    const placeholder: ApiPhoto = { ...makePhoto('ph'), isPlaceholder: true, url: '' };
    const result = buildPdfSets({
      mode: 'turningpoint',
      layoutMode: 'landscape',
      isPrecision: false,
      // The 2nd photo is missing — a placeholder holds the TP1 position so the
      // following photos keep TP2/TP3 (numbering not shifted).
      set1: { title: 'SP - TP3', photos: [makePhoto('a'), placeholder, makePhoto('c'), makePhoto('d')] },
      set2: makeSet('FP', ['f']),
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['SP', 'TP1', 'TP2', 'TP3']);
    // The placeholder IS the TP1 cell and keeps its flag for the PDF render branch.
    expect(result.set1WithLabels.photos[1].isPlaceholder).toBe(true);
    expect(result.set2WithLabels.photos.map(p => p.label)).toEqual(['FP']);
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

// The MZB 2026 defect: the app-generated en-route photo PDF and the
// app-generated answer sheet disagreed about which letter belongs to which
// photo on 16 of 18 photos. `buildPdfSets` overwrote the route-ordered label
// map-corridors had computed with a purely positional one derived from slot
// order, so the printed sheet and the answer sheet were keyed off two
// different orderings with no warning anywhere in either app.
//
// NOT PROVEN, and deliberately not asserted here: that this overwrite was the
// SOLE cause of that specific 16/18 disagreement. The answer sheet carries no
// timestamp, so it could not be established that both PDFs came from one
// unmodified session — the operator may also have reordered slots between the
// two exports. These tests pin the defect on its own merits: computed
// information must not be discarded.
describe('buildPdfSets — track mode, handed-over route-ordered labels', () => {
  // A photo as it arrives from map-corridors: `useMapPicksSync` copies
  // `entry.label` onto `ApiPhoto.label`, and `routeImportedPickIntoSets`
  // spreads it through into the slot.
  const labelled = (id: string, label: string): ApiPhoto => ({ ...makePhoto(id), label });

  it('prefers the handed-over label over the positional one in set1', () => {
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      // Slot order is a, b, c; route order (as labelled on the map) is C, A, B.
      set1: { title: 's1', photos: [labelled('a', 'C'), labelled('b', 'A'), labelled('c', 'B')] },
      set2: makeSet('s2', []),
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['C', 'A', 'B']);
  });

  it('prefers the handed-over label in set2 as well', () => {
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: { title: 's1', photos: [labelled('a', 'J')] },
      set2: { title: 's2', photos: [labelled('d', 'B'), labelled('e', 'Q')] },
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['J']);
    expect(result.set2WithLabels.photos.map(p => p.label)).toEqual(['B', 'Q']);
  });

  it('precision: keeps handed-over labels on set1 and still drops set2', () => {
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'portrait',
      isPrecision: true,
      set1: { title: 's1', photos: [labelled('a', '7'), labelled('b', '3')] },
      set2: { title: 'stale', photos: [labelled('s', '9')] },
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['7', '3']);
    expect(result.set2WithLabels.photos).toEqual([]);
  });

  it('falls back to the positional label for a photo with no handed-over one', () => {
    // Photo-helper-originated photos are created with `label: ''`.
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: makeSet('s1', ['a', 'b']),
      set2: makeSet('s2', ['c']),
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['A.', 'B.']);
    expect(result.set2WithLabels.photos.map(p => p.label)).toEqual(['C.']);
  });

  it('a legacy photo with no `label` key at all falls back instead of throwing', () => {
    // Sessions persisted before `label` was non-nullable can round-trip
    // without the key; `editorPicksWriter`'s `p.label ?? ''` documents that
    // the field is not guaranteed present on disk.
    // Built as a loose record because `ApiPhoto.label` is declared required —
    // `delete` on the typed shape is a compile error, and that is the point:
    // the key can only go missing via data on disk, never via app code.
    const legacy: Record<string, unknown> = { ...makePhoto('legacy') };
    delete legacy.label;
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: { title: 's1', photos: [legacy as unknown as ApiPhoto] },
      set2: makeSet('s2', []),
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['A.']);
  });

  it('treats a whitespace-only label as absent and trims a padded one', () => {
    // The wire type is a bare `string` (shared-handoff keeps it un-narrowed on
    // purpose), so neither value is structurally impossible.
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: { title: 's1', photos: [labelled('a', '   '), labelled('b', ' F ')] },
      set2: makeSet('s2', []),
      generateLabel: letterLabel,
    });
    // Blank → positional (index 0 → 'A.'); padded → trimmed, not blanked.
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['A.', 'F']);
  });

  it('mixes sources per-photo: the fallback stays purely positional', () => {
    // A labelled photo neither consumes nor shifts the positional sequence for
    // its unlabelled neighbours — index 2 is still 'C.' even though the photo
    // before it prints 'R'. Pinning this documents the (accepted) collision
    // risk of a half-labelled set: index 0 falls back to 'A.' while another
    // photo could legitimately carry a handed-over 'A'.
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: { title: 's1', photos: [makePhoto('a'), labelled('b', 'R'), makePhoto('c')] },
      set2: { title: 's2', photos: [labelled('d', 'A'), makePhoto('e')] },
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['A.', 'R', 'C.']);
    // set2's fallback still offsets by set1's PHOTO count (3), not by the
    // number of labels the fallback actually emitted.
    expect(result.set2WithLabels.photos.map(p => p.label)).toEqual(['A', 'E.']);
  });

  it('preserves duplicate handed-over labels rather than silently renaming one', () => {
    // map-corridors' picker disables an already-used letter, so a duplicate
    // means the data is already inconsistent. Re-deriving one of them from
    // slot position would hide that; printing both makes it visible on the
    // sheet, where the operator can act on it.
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: { title: 's1', photos: [labelled('a', 'C'), labelled('b', 'C')] },
      set2: { title: 's2', photos: [labelled('d', 'C')] },
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['C', 'C']);
    expect(result.set2WithLabels.photos.map(p => p.label)).toEqual(['C']);
  });

  it('never calls generateLabel for a photo that has a handed-over label', () => {
    // Beyond avoiding wasted work this is a correctness guard: the real
    // generator (`generateLabelForMode`) throws a RangeError past index 19,
    // so a fully-labelled set longer than the 20-entry alphabet must not
    // abort the export.
    const boom = (): string => { throw new Error('generateLabel must not be called'); };
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: { title: 's1', photos: [labelled('a', 'A'), labelled('b', 'B')] },
      set2: { title: 's2', photos: [labelled('d', 'C')] },
      generateLabel: boom,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['A', 'B']);
    expect(result.set2WithLabels.photos.map(p => p.label)).toEqual(['C']);
  });

  it('an unlabelled photo past the alphabet still surfaces the generator RangeError', () => {
    // Deliberate existing behaviour, unchanged: `generateLabelForMode` refuses
    // an out-of-range index rather than emitting silent garbage. The fallback
    // path must keep propagating that, not swallow it into a blank label.
    const strict = (index: number, offset = 0): string => {
      if (index + offset > 19) throw new RangeError('index out of range');
      return String.fromCharCode(65 + index + offset);
    };
    const twentyOne = Array.from({ length: 21 }, (_, i) => makePhoto(`p${i}`));
    expect(() => buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: { title: 's1', photos: twentyOne },
      set2: makeSet('s2', []),
      generateLabel: strict,
    })).toThrow(RangeError);
  });

  it('empty sets produce empty outputs and never call the generator', () => {
    const boom = (): string => { throw new Error('generateLabel must not be called'); };
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: makeSet('s1', []),
      set2: makeSet('s2', []),
      generateLabel: boom,
    });
    expect(result.set1WithLabels.photos).toEqual([]);
    expect(result.set2WithLabels.photos).toEqual([]);
    expect(result.set1WithLabels.title).toBe('s1');
    expect(result.set2WithLabels.title).toBe('s2');
  });

  it('does not mutate the handed-over label on the input photo', () => {
    const set1: ApiPhotoSet = { title: 's1', photos: [labelled('a', ' F ')] };
    const set2: ApiPhotoSet = { title: 's2', photos: [labelled('d', 'G')] };
    const frozen1 = JSON.parse(JSON.stringify(set1));
    const frozen2 = JSON.parse(JSON.stringify(set2));
    buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1,
      set2,
      generateLabel: letterLabel,
    });
    expect(set1).toEqual(frozen1);
    expect(set2).toEqual(frozen2);
  });
});

describe('buildPdfSets — turningpoint mode ignores handed-over labels (deliberate)', () => {
  it('SP / TPn / FP wins over a letter carried over from map-corridors', () => {
    // A `pick-turning` photo can carry a letter from the map's label picker,
    // but that letter keys the EN-ROUTE answer sheet, not the SP/TP/FP
    // navigation sheet. Letting it through would punch an 'F' into the middle
    // of the turning-point numbering.
    const result = buildPdfSets({
      mode: 'turningpoint',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: {
        title: 's1',
        photos: [
          { ...makePhoto('a'), label: 'F' },
          { ...makePhoto('b'), label: 'B' },
          { ...makePhoto('c'), label: 'Q' },
        ],
      },
      set2: { title: 's2', photos: [{ ...makePhoto('d'), label: 'A' }] },
      generateLabel: letterLabel,
    });
    expect(result.set1WithLabels.photos.map(p => p.label)).toEqual(['SP', 'TP1', 'TP2']);
    expect(result.set2WithLabels.photos.map(p => p.label)).toEqual(['FP']);
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

// PR #62 review G8: structural regression marker for the
// "tray photos never reach the printed PDF" invariant. The candidate
// pool is a *workspace* concept; promoting candidates into the printed
// PDF would silently put the wrong photos in front of a judge.
//
// We pin this at the type level (`PdfSetsInput` has no candidates
// channel) AND at the behavior level (driving the builder with both
// containers populated and asserting only slot ids appear in output).
describe('buildPdfSets — tray-photo leak guard (PR #62 review G8)', () => {
  it('PdfSetsInput shape contains no `candidates` field', () => {
    // Structural pin: if a future refactor adds `candidates?: CandidatePool`
    // to PdfSetsInput, the type assertion below breaks at compile time and
    // forces a deliberate review (does the PDF really want tray photos?).
    type RequiredKeys = 'mode' | 'layoutMode' | 'isPrecision' | 'set1' | 'set2' | 'generateLabel';
    type ActualKeys = keyof import('../utils/buildPdfSets').PdfSetsInput;
    // Both directions: ActualKeys must be a subset of RequiredKeys (no
    // extras like 'candidates') AND vice versa (no removals).
    const _exhaustive1: RequiredKeys extends ActualKeys ? true : false = true;
    const _exhaustive2: ActualKeys extends RequiredKeys ? true : false = true;
    void _exhaustive1; void _exhaustive2;
    expect(true).toBe(true);
  });

  it('only emits photos that came from set1/set2 — never references a candidate-only id', () => {
    // Build sets with 3 slot ids and verify the output's photo ids match
    // the input's set1+set2 ids exactly (no extra ids leaking in).
    const result = buildPdfSets({
      mode: 'track',
      layoutMode: 'landscape',
      isPrecision: false,
      set1: makeSet('s1', ['slot-a', 'slot-b']),
      set2: makeSet('s2', ['slot-c']),
      generateLabel: letterLabel,
    });

    const outputIds = [
      ...result.set1WithLabels.photos.map(p => p.id),
      ...result.set2WithLabels.photos.map(p => p.id),
    ];
    expect(outputIds).toEqual(['slot-a', 'slot-b', 'slot-c']);
    // Sanity: no candidate-shaped ids materialise.
    expect(outputIds.every(id => !id.startsWith('cand-'))).toBe(true);
  });
});

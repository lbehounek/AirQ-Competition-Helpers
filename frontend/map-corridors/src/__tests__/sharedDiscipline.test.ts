import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest';
import {
  parseDisciplineFromSearch,
  isDiscipline,
  getLabelingMode,
  getLabelsForDiscipline,
  generateLabel,
  generateLabelForMode,
  DISCIPLINES,
  PHOTO_LABELS_LETTERS,
  PHOTO_LABELS_NUMBERS,
  ALL_PHOTO_LABELS,
  MAX_LABEL_INDEX,
  type Discipline,
  type LabelingMode,
  type PhotoLabel,
  type PhotoLabelLetter,
  type PhotoLabelNumber,
} from '@airq/shared-discipline';

// Mirror of `photo-helper/src/__tests__/sharedDiscipline.test.ts`. Both
// apps independently assert the shared contract so a regression in
// `@airq/shared-discipline` fails CI in *both* suites — preventing the
// scenario where one app's test suite is silently broken (e.g. a node-canvas
// dependency issue in photo-helper) and the other still ships the regression.
//
// Keep the two files in sync: any new contract test added here must also
// be added on the photo-helper side, and vice versa.

describe('DISCIPLINES + Discipline type', () => {
  it('exports the canonical allowlist', () => {
    expect(DISCIPLINES).toEqual(['precision', 'rally']);
  });

  it('Discipline type is derived from DISCIPLINES (no drift possible)', () => {
    expectTypeOf<Discipline>().toEqualTypeOf<(typeof DISCIPLINES)[number]>();
  });
});

describe('isDiscipline', () => {
  it('narrows to Discipline for valid values', () => {
    expect(isDiscipline('precision')).toBe(true);
    expect(isDiscipline('rally')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isDiscipline('Precision')).toBe(false);
    expect(isDiscipline('RALLY')).toBe(false);
    expect(isDiscipline('')).toBe(false);
    expect(isDiscipline(null)).toBe(false);
    expect(isDiscipline(undefined)).toBe(false);
    expect(isDiscipline(123)).toBe(false);
    expect(isDiscipline({})).toBe(false);
    expect(isDiscipline(['precision'])).toBe(false);
  });
});

describe('parseDisciplineFromSearch', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('returns "precision" for ?discipline=precision', () => {
    expect(parseDisciplineFromSearch('?discipline=precision')).toBe('precision');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns "rally" for ?discipline=rally', () => {
    expect(parseDisciplineFromSearch('?discipline=rally')).toBe('rally');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null when the param is absent', () => {
    expect(parseDisciplineFromSearch('')).toBeNull();
    expect(parseDisciplineFromSearch('?other=1')).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null for empty ?discipline= without logging', () => {
    expect(parseDisciplineFromSearch('?discipline=')).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns null AND logs for mixed-case / typo values', () => {
    expect(parseDisciplineFromSearch('?discipline=Precision')).toBeNull();
    expect(parseDisciplineFromSearch('?discipline=RALLY')).toBeNull();
    expect(parseDisciplineFromSearch('?discipline=precsn')).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it('does NOT accept URL-encoded whitespace around a valid value', () => {
    expect(parseDisciplineFromSearch('?discipline=%20precision')).toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('logs the invalid value verbatim so launcher drift is visible', () => {
    parseDisciplineFromSearch('?discipline=Precision');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Precision'));
  });

  it('extracts discipline among multiple URL params', () => {
    expect(parseDisciplineFromSearch('?competitionId=abc&discipline=precision'))
      .toBe('precision');
    expect(parseDisciplineFromSearch('?discipline=rally&foo=bar'))
      .toBe('rally');
  });

  it('parses without a leading "?" (URLSearchParams is permissive)', () => {
    expect(parseDisciplineFromSearch('discipline=precision')).toBe('precision');
    expect(parseDisciplineFromSearch('discipline=rally')).toBe('rally');
  });

  it('does NOT strip a URL fragment — caller must pass location.search, not the full URL', () => {
    expect(parseDisciplineFromSearch('?discipline=precision#foo')).toBeNull();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('precision#foo'));
  });

  it('first wins for duplicate ?discipline= keys', () => {
    expect(parseDisciplineFromSearch('?discipline=rally&discipline=precision'))
      .toBe('rally');
    expect(parseDisciplineFromSearch('?discipline=precision&discipline=rally'))
      .toBe('precision');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('getLabelingMode', () => {
  it('returns "numbers" for precision (rules-mandated)', () => {
    expect(getLabelingMode('precision')).toBe('numbers');
  });

  it('returns "letters" for rally (legacy default)', () => {
    expect(getLabelingMode('rally')).toBe('letters');
  });

  it('1:1 mapping covers every Discipline (compile + runtime exhaustiveness)', () => {
    for (const d of DISCIPLINES) {
      expect(() => getLabelingMode(d)).not.toThrow();
    }
  });
});

describe('getLabelsForDiscipline', () => {
  it('returns the numeric set (1..20) for precision', () => {
    expect(getLabelsForDiscipline('precision')).toEqual(PHOTO_LABELS_NUMBERS);
  });

  it('returns the letter set (A..T) for rally', () => {
    expect(getLabelsForDiscipline('rally')).toEqual(PHOTO_LABELS_LETTERS);
  });
});

describe('generateLabel', () => {
  it('generates 1..N for precision (1-based)', () => {
    expect(generateLabel('precision', 0)).toBe('1');
    expect(generateLabel('precision', 9)).toBe('10');
    expect(generateLabel('precision', 19)).toBe('20');
  });

  it('generates A..T for rally', () => {
    expect(generateLabel('rally', 0)).toBe('A');
    expect(generateLabel('rally', 9)).toBe('J');
    expect(generateLabel('rally', 19)).toBe('T');
  });

  it('matches getLabelsForDiscipline(d)[index] for every i in [0,19]', () => {
    for (const d of DISCIPLINES) {
      const labels = getLabelsForDiscipline(d);
      for (let i = 0; i <= MAX_LABEL_INDEX; i++) {
        expect(generateLabel(d, i)).toBe(labels[i]);
      }
    }
  });

  it('throws RangeError for out-of-range indices (no silent garbage)', () => {
    expect(() => generateLabel('rally', 20)).toThrow(RangeError);
    expect(() => generateLabel('rally', 26)).toThrow(RangeError);
    expect(() => generateLabel('rally', -1)).toThrow(RangeError);
    expect(() => generateLabel('precision', 20)).toThrow(RangeError);
    expect(() => generateLabel('precision', -1)).toThrow(RangeError);
    expect(() => generateLabel('precision', 100)).toThrow(RangeError);
  });

  it('throws for non-integer indices', () => {
    expect(() => generateLabel('rally', 1.5)).toThrow(RangeError);
    expect(() => generateLabel('rally', NaN)).toThrow(RangeError);
    expect(() => generateLabel('rally', Infinity)).toThrow(RangeError);
  });
});

describe('generateLabelForMode', () => {
  it('mode "numbers" returns 1..20', () => {
    expect(generateLabelForMode('numbers', 0)).toBe('1');
    expect(generateLabelForMode('numbers', 9)).toBe('10');
    expect(generateLabelForMode('numbers', 19)).toBe('20');
  });

  it('mode "letters" returns A..T', () => {
    expect(generateLabelForMode('letters', 0)).toBe('A');
    expect(generateLabelForMode('letters', 9)).toBe('J');
    expect(generateLabelForMode('letters', 19)).toBe('T');
  });

  it('throws RangeError on out-of-range / non-integer indices', () => {
    expect(() => generateLabelForMode('letters', 20)).toThrow(RangeError);
    expect(() => generateLabelForMode('letters', -1)).toThrow(RangeError);
    expect(() => generateLabelForMode('numbers', 20)).toThrow(RangeError);
    expect(() => generateLabelForMode('numbers', 1.5)).toThrow(RangeError);
  });

  it('result equals generateLabel for the corresponding discipline', () => {
    for (let i = 0; i <= MAX_LABEL_INDEX; i++) {
      expect(generateLabelForMode('numbers', i)).toBe(generateLabel('precision', i));
      expect(generateLabelForMode('letters', i)).toBe(generateLabel('rally', i));
    }
  });
});

describe('label sets', () => {
  it('letters and numbers are both length 20', () => {
    expect(PHOTO_LABELS_LETTERS).toHaveLength(20);
    expect(PHOTO_LABELS_NUMBERS).toHaveLength(20);
  });

  it('ALL_PHOTO_LABELS is the disjoint union of the two sets', () => {
    expect(ALL_PHOTO_LABELS).toHaveLength(40);
    const letters = new Set<string>(PHOTO_LABELS_LETTERS);
    for (const n of PHOTO_LABELS_NUMBERS) expect(letters.has(n)).toBe(false);
  });

  it('MAX_LABEL_INDEX matches the set length minus 1', () => {
    expect(MAX_LABEL_INDEX).toBe(PHOTO_LABELS_LETTERS.length - 1);
    expect(MAX_LABEL_INDEX).toBe(PHOTO_LABELS_NUMBERS.length - 1);
  });
});

describe('type-level pins', () => {
  it('PhotoLabelLetter is the 20-letter union (not a string)', () => {
    expectTypeOf<PhotoLabelLetter>().toEqualTypeOf<
      'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J'
      | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T'
    >();
  });

  it('PhotoLabelNumber is the 20-string-number union (not a string)', () => {
    expectTypeOf<PhotoLabelNumber>().toEqualTypeOf<
      '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
      | '11' | '12' | '13' | '14' | '15' | '16' | '17' | '18' | '19' | '20'
    >();
  });

  it('PhotoLabel is the union of the two', () => {
    expectTypeOf<PhotoLabel>().toEqualTypeOf<PhotoLabelLetter | PhotoLabelNumber>();
  });

  it('LabelingMode is the binary string union', () => {
    expectTypeOf<LabelingMode>().toEqualTypeOf<'letters' | 'numbers'>();
  });

  it('generateLabel returns PhotoLabel, not string', () => {
    expectTypeOf(generateLabel).returns.toEqualTypeOf<PhotoLabel>();
  });

  it('generateLabelForMode returns PhotoLabel, not string', () => {
    expectTypeOf(generateLabelForMode).returns.toEqualTypeOf<PhotoLabel>();
  });
});

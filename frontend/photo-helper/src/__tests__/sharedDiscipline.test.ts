import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseDisciplineFromSearch,
  getLabelingMode,
  getLabelsForDiscipline,
  generateLabel,
  PHOTO_LABELS_LETTERS,
  PHOTO_LABELS_NUMBERS,
  ALL_PHOTO_LABELS,
} from '@airq/shared-discipline';

// Contract tests for the shared discipline + labeling rules. These pin
// the behaviour both photo-helper AND map-corridors rely on. A change
// here that breaks one app will break the other identically — that's the
// whole point of centralising.

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
});

describe('getLabelingMode', () => {
  it('returns "numbers" for precision (rules-mandated)', () => {
    expect(getLabelingMode('precision')).toBe('numbers');
  });

  it('returns "letters" for rally (legacy default)', () => {
    expect(getLabelingMode('rally')).toBe('letters');
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
});

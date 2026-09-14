import { describe, it, expect } from 'vitest';
import * as ops from '../src/index.ts';

const FIXED_NOW_ISO = '2026-04-18T12:00:00.000Z';
const FIXED_NOW_MS = new Date(FIXED_NOW_ISO).getTime();

function daysAgoISO(n, anchor) {
  const base = typeof anchor === 'number' ? anchor : FIXED_NOW_MS;
  return new Date(base - n * 24 * 60 * 60 * 1000).toISOString();
}

function makeMetadata(overrides) {
  return Object.assign(
    {
      id: 'comp-test-1',
      name: 'Test Competition',
      discipline: 'rally',
      createdAt: FIXED_NOW_ISO,
      lastModified: FIXED_NOW_ISO,
      photoCount: 0,
      isActive: false,
    },
    overrides || {}
  );
}

function makeIndex(competitions, activeCompetitionId) {
  return {
    competitions: competitions || [],
    activeCompetitionId: activeCompetitionId === undefined ? null : activeCompetitionId,
    version: 1,
  };
}

describe('createMetadata', () => {
  it('produces metadata with defaults', () => {
    const md = ops.createMetadata({ name: 'Foo', now: FIXED_NOW_ISO, id: 'comp-x' });
    expect(md).toEqual({
      id: 'comp-x',
      name: 'Foo',
      discipline: 'rally',
      createdAt: FIXED_NOW_ISO,
      lastModified: FIXED_NOW_ISO,
      photoCount: 0,
      isActive: true,
    });
  });

  it('accepts precision discipline', () => {
    const md = ops.createMetadata({ name: 'X', discipline: 'precision', now: FIXED_NOW_ISO, id: 'c' });
    expect(md.discipline).toBe('precision');
  });

  it('rejects empty name', () => {
    expect(() => ops.createMetadata({ name: '', now: FIXED_NOW_ISO })).toThrow(/name/);
  });

  it('rejects missing name', () => {
    expect(() => ops.createMetadata({ now: FIXED_NOW_ISO })).toThrow(/name/);
  });

  it('rejects invalid discipline', () => {
    expect(() =>
      ops.createMetadata({ name: 'X', discipline: 'aerobatic', now: FIXED_NOW_ISO })
    ).toThrow(/invalid discipline/);
  });

  it('generates an id when none provided', () => {
    const md = ops.createMetadata({ name: 'X', now: FIXED_NOW_ISO });
    expect(md.id).toMatch(/^comp-\d+-[a-z0-9]{1,6}$/);
  });
});

describe('addCompetition', () => {
  it('marks the new entry as active and others inactive', () => {
    const existing = makeMetadata({ id: 'a', isActive: true });
    const index = makeIndex([existing], 'a');
    const incoming = makeMetadata({ id: 'b', isActive: false });
    const result = ops.addCompetition(index, incoming);

    expect(result.activeCompetitionId).toBe('b');
    expect(result.competitions).toHaveLength(2);
    expect(result.competitions.find(c => c.id === 'a').isActive).toBe(false);
    expect(result.competitions.find(c => c.id === 'b').isActive).toBe(true);
  });

  it('does not mutate the input index', () => {
    const existing = makeMetadata({ id: 'a', isActive: true });
    const index = makeIndex([existing], 'a');
    const snapshot = JSON.stringify(index);
    ops.addCompetition(index, makeMetadata({ id: 'b' }));
    expect(JSON.stringify(index)).toBe(snapshot);
  });
});

describe('removeCompetition', () => {
  it('removes the entry and reassigns active to the first remaining', () => {
    const index = makeIndex(
      [
        makeMetadata({ id: 'a', isActive: true }),
        makeMetadata({ id: 'b' }),
      ],
      'a'
    );
    const result = ops.removeCompetition(index, 'a');
    expect(result.index.competitions).toHaveLength(1);
    expect(result.index.competitions[0].id).toBe('b');
    expect(result.index.activeCompetitionId).toBe('b');
    expect(result.index.competitions[0].isActive).toBe(true);
    expect(result.newActiveId).toBe('b');
  });

  it('nulls active when list empties', () => {
    const index = makeIndex([makeMetadata({ id: 'a', isActive: true })], 'a');
    const result = ops.removeCompetition(index, 'a');
    expect(result.index.competitions).toHaveLength(0);
    expect(result.index.activeCompetitionId).toBe(null);
    expect(result.newActiveId).toBe(null);
  });

  it('preserves active when removing a non-active entry', () => {
    const index = makeIndex(
      [
        makeMetadata({ id: 'a', isActive: true }),
        makeMetadata({ id: 'b' }),
      ],
      'a'
    );
    const result = ops.removeCompetition(index, 'b');
    expect(result.index.activeCompetitionId).toBe('a');
    expect(result.newActiveId).toBe('a');
  });
});

describe('setActive', () => {
  it('sets the target active, deactivates others', () => {
    const index = makeIndex(
      [
        makeMetadata({ id: 'a', isActive: true }),
        makeMetadata({ id: 'b' }),
      ],
      'a'
    );
    const result = ops.setActive(index, 'b');
    expect(result.activeCompetitionId).toBe('b');
    expect(result.competitions.find(c => c.id === 'a').isActive).toBe(false);
    expect(result.competitions.find(c => c.id === 'b').isActive).toBe(true);
  });

  it('throws on unknown id', () => {
    const index = makeIndex([makeMetadata({ id: 'a' })], 'a');
    expect(() => ops.setActive(index, 'zzz')).toThrow(/not found/);
  });
});

describe('setDiscipline', () => {
  it('updates discipline and lastModified', () => {
    const index = makeIndex(
      [makeMetadata({ id: 'a', discipline: 'rally' })],
      'a'
    );
    const result = ops.setDiscipline(index, 'a', 'precision', { now: '2026-05-01T10:00:00.000Z' });
    const updated = result.competitions.find(c => c.id === 'a');
    expect(updated.discipline).toBe('precision');
    expect(updated.lastModified).toBe('2026-05-01T10:00:00.000Z');
  });

  it('throws on invalid discipline', () => {
    const index = makeIndex([makeMetadata({ id: 'a' })], 'a');
    expect(() => ops.setDiscipline(index, 'a', 'aerobatic')).toThrow(/invalid discipline/);
  });

  it('throws on unknown id', () => {
    const index = makeIndex([makeMetadata({ id: 'a' })], 'a');
    expect(() => ops.setDiscipline(index, 'zzz', 'rally')).toThrow(/not found/);
  });
});

describe('touchCompetition', () => {
  it('applies patch and updates lastModified', () => {
    const index = makeIndex(
      [makeMetadata({ id: 'a', name: 'Old', photoCount: 0 })],
      'a'
    );
    const result = ops.touchCompetition(
      index,
      'a',
      { name: 'New', photoCount: 5 },
      { now: '2026-05-01T10:00:00.000Z' }
    );
    const updated = result.competitions.find(c => c.id === 'a');
    expect(updated.name).toBe('New');
    expect(updated.photoCount).toBe(5);
    expect(updated.lastModified).toBe('2026-05-01T10:00:00.000Z');
  });

  it('throws on unknown id', () => {
    const index = makeIndex([makeMetadata({ id: 'a' })], 'a');
    expect(() => ops.touchCompetition(index, 'zzz', { name: 'X' })).toThrow(/not found/);
  });
});

describe('detectCleanupCandidates', () => {
  it('flags competitions older than maxAgeDays', () => {
    const index = makeIndex([
      makeMetadata({ id: 'old', createdAt: daysAgoISO(45) }),
      makeMetadata({ id: 'fresh', createdAt: daysAgoISO(5) }),
    ]);
    const result = ops.detectCleanupCandidates(index, { now: FIXED_NOW_MS });
    expect(result).toHaveLength(1);
    expect(result[0].competition.id).toBe('old');
    expect(result[0].reason).toBe('age');
    expect(result[0].daysOld).toBe(45);
  });

  it('flags excess competitions beyond maxCount', () => {
    const competitions = [];
    for (let i = 0; i < 12; i++) {
      competitions.push(makeMetadata({ id: `c${i}`, createdAt: daysAgoISO(i) }));
    }
    const index = makeIndex(competitions);
    const result = ops.detectCleanupCandidates(index, {
      now: FIXED_NOW_MS,
      maxAgeDays: 365,
      maxCount: 10,
    });
    expect(result).toHaveLength(2);
    expect(result.every(c => c.reason === 'excess')).toBe(true);
    const flaggedIds = result.map(c => c.competition.id);
    expect(flaggedIds).toContain('c10');
    expect(flaggedIds).toContain('c11');
  });

  it('deduplicates when a competition is both old and excess', () => {
    const competitions = [];
    for (let i = 0; i < 12; i++) {
      competitions.push(makeMetadata({ id: `c${i}`, createdAt: daysAgoISO(50 + i) }));
    }
    const index = makeIndex(competitions);
    const result = ops.detectCleanupCandidates(index, {
      now: FIXED_NOW_MS,
      maxAgeDays: 30,
      maxCount: 10,
    });
    const ids = result.map(c => c.competition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns empty array for empty index', () => {
    const index = makeIndex([]);
    expect(ops.detectCleanupCandidates(index, { now: FIXED_NOW_MS })).toEqual([]);
  });
});

describe('validateIndex', () => {
  it('returns empty index for null input', () => {
    expect(ops.validateIndex(null)).toEqual({
      competitions: [],
      activeCompetitionId: null,
      version: 1,
    });
  });

  it('returns empty index for non-object input', () => {
    expect(ops.validateIndex('nope')).toEqual({
      competitions: [],
      activeCompetitionId: null,
      version: 1,
    });
  });

  it('fills missing fields with defaults', () => {
    expect(ops.validateIndex({})).toEqual({
      competitions: [],
      activeCompetitionId: null,
      version: 1,
    });
  });

  it('preserves valid fields', () => {
    const raw = {
      competitions: [makeMetadata({ id: 'a' })],
      activeCompetitionId: 'a',
      version: 2,
    };
    expect(ops.validateIndex(raw)).toEqual(raw);
  });
});

describe('emptyIndex', () => {
  it('returns a fresh empty index', () => {
    expect(ops.emptyIndex()).toEqual({
      competitions: [],
      activeCompetitionId: null,
      version: 1,
    });
  });
});

describe('re-exports', () => {
  it('exposes constants from the aggregator', () => {
    expect(ops.MAX_AGE_DAYS).toBe(30);
    expect(ops.MAX_COMPETITIONS).toBe(10);
    expect(ops.COMPETITIONS_INDEX_FILE).toBe('competitions-index.json');
    expect(ops.DEFAULT_DISCIPLINE).toBe('rally');
    expect(ops.VALID_DISCIPLINES).toEqual(['precision', 'rally']);
  });
});

describe('validateIndex drops malformed elements', () => {
  // Regression: validateIndex used to cast the array through unchecked, so a
  // corrupted or hand-edited index reached the UI as well-typed values. A
  // `name` that is an object then throws "Objects are not valid as a React
  // child" and white-screens the launcher, with no way back but editing storage.
  it('keeps well-formed entries and discards broken ones', () => {
    const good = {
      id: 'a',
      name: 'Good',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-02T00:00:00.000Z',
      photoCount: 0,
      isActive: false,
    };
    const result = ops.validateIndex({
      competitions: [
        good,
        { id: 'b', name: { nested: 'object' }, createdAt: '2026-01-01T00:00:00.000Z', lastModified: 'x' },
        { name: 'no id', createdAt: '2026-01-01T00:00:00.000Z', lastModified: 'x' },
        { id: 'c', name: 'bad date', createdAt: 'not-a-date', lastModified: 'x' },
        null,
        'a string',
      ],
      activeCompetitionId: 'a',
      version: 1,
    });
    expect(result.competitions.map((c) => c.id)).toEqual(['a']);
    expect(result.activeCompetitionId).toBe('a');
  });

  it('still returns an empty index for a non-array competitions field', () => {
    expect(ops.validateIndex({ competitions: 'nope' }).competitions).toEqual([]);
  });
});

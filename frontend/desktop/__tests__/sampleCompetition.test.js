// Regression suite for the bundled-sample bootstrap that used to live inline in
// `main.js` and ran synchronously before the window was created. It now runs in
// the background AFTER first paint, which makes two things load-bearing and
// therefore worth pinning here: the index write must be a single synchronous
// read→modify→write segment (nothing may interleave with the main process's
// other index writers), and the function must NEVER reject — `main.js` awaits it
// as a readiness gate for `competition-list`/`storage-init`, so a rejection
// would break whichever IPC handler is waiting.
//
// Same shape as pathValidation.test.js: ESM test file (required by vitest 4)
// importing the CommonJS module under test through `createRequire`, with real
// temp-directory fixtures so the fs behaviour is exercised for real rather than
// mocked.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SAMPLE_COMP_ID,
  SAMPLE_COMP_NAME,
  countSessionPhotos,
  buildEmptySampleSession,
  ensureSampleCompetition,
} = require('../lib/sampleCompetition');

const NOW = '2026-09-05T10:00:00.000Z';

let tmpDir;
let sampleDataDir;
let competitionsDir;
let compDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airq-sample-'));
  sampleDataDir = path.join(tmpDir, 'sample-data');
  competitionsDir = path.join(tmpDir, 'photo-sessions', 'competitions');
  compDir = path.join(competitionsDir, SAMPLE_COMP_ID);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Build a `deps` object over the per-test temp dirs with an in-memory index.
 * `overrides` replaces any individual dep (used to inject throwing stubs).
 * Returns the deps plus a `state` handle so assertions can read the index the
 * module actually wrote.
 */
function makeDeps(overrides = {}) {
  const state = { index: { competitions: [], activeCompetitionId: null, version: 1 } };
  const log = { log: vi.fn(), warn: vi.fn() };
  const deps = {
    sampleDataDir,
    competitionsDir,
    compDir,
    // Deep-copy on read so a test can prove the module wrote back rather than
    // mutating a shared object it happened to be handed.
    readIndex: vi.fn(() => structuredClone(state.index)),
    writeIndex: vi.fn((index) => { state.index = structuredClone(index); }),
    sampleAvailable: vi.fn(() => false),
    now: () => NOW,
    log,
    ...overrides,
  };
  return { deps, state, log };
}

/** Write the pre-built `sample-data/competition/` fixture used by the copy path. */
function writePrebuiltFixture() {
  const prebuilt = path.join(sampleDataDir, 'competition');
  fs.mkdirSync(path.join(prebuilt, 'photos'), { recursive: true });
  fs.mkdirSync(path.join(prebuilt, 'corridors'), { recursive: true });
  const session = {
    id: 'session-prebuilt',
    sets: {
      set1: { title: 'SP - TPX', photos: [{ id: 'p1' }, { id: 'ph', isPlaceholder: true }] },
      set2: { title: 'TPX - FP', photos: [{ id: 'p2' }] },
    },
    // `p1` again — the buckets are alternate views of one pool, so it must not
    // be double-counted.
    setsTrack: { set1: { title: 'SP - TPX', photos: [{ id: 'p1' }] }, set2: { title: 'TPX - FP', photos: [] } },
    setsTurning: { set1: { title: '', photos: [] }, set2: { title: '', photos: [] } },
  };
  fs.writeFileSync(path.join(prebuilt, 'session.json'), JSON.stringify(session, null, 2), 'utf8');
  fs.writeFileSync(path.join(prebuilt, 'map-picks.json'), '{"picks":[]}', 'utf8');
  fs.writeFileSync(path.join(prebuilt, 'photos', 'a.jpg'), 'JPEGBYTES', 'utf8');
  fs.writeFileSync(path.join(prebuilt, 'corridors', 'session.json'), '{"corridors":1}', 'utf8');
  return prebuilt;
}

describe('ensureSampleCompetition', () => {
  it('returns "none" and still creates competitions/ when nothing is bundled', async () => {
    const { deps, log } = makeDeps();

    await expect(ensureSampleCompetition(deps)).resolves.toBe('none');

    // Parity with the old sync code, which created the directory before any
    // branch — other handlers assume it exists.
    expect(fs.existsSync(competitionsDir)).toBe(true);
    expect(fs.existsSync(compDir)).toBe(false);
    expect(deps.writeIndex).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('returns "present" without touching the disk when the index already has the sample', async () => {
    writePrebuiltFixture();
    const { deps } = makeDeps({
      readIndex: vi.fn(() => ({ competitions: [{ id: SAMPLE_COMP_ID }] })),
    });

    await expect(ensureSampleCompetition(deps)).resolves.toBe('present');

    // A user who deleted the folder by hand must NOT get it resurrected.
    expect(fs.existsSync(compDir)).toBe(false);
    expect(deps.writeIndex).not.toHaveBeenCalled();
    expect(deps.readIndex).toHaveBeenCalledTimes(1);
  });

  it('copies the pre-built competition verbatim and indexes it with the real photo count', async () => {
    const prebuilt = writePrebuiltFixture();
    const { deps, state, log } = makeDeps();

    await expect(ensureSampleCompetition(deps)).resolves.toBe('copied');

    // Byte-for-byte copy of every file, including nested directories.
    for (const rel of ['session.json', 'map-picks.json', path.join('photos', 'a.jpg'), path.join('corridors', 'session.json')]) {
      expect(fs.readFileSync(path.join(compDir, rel), 'utf8'))
        .toBe(fs.readFileSync(path.join(prebuilt, rel), 'utf8'));
    }
    // The copy path is already finalized — no runtime import is pending.
    expect(fs.existsSync(path.join(compDir, '.sample-pending'))).toBe(false);

    expect(deps.writeIndex).toHaveBeenCalledTimes(1);
    expect(state.index.competitions).toEqual([{
      id: SAMPLE_COMP_ID,
      name: SAMPLE_COMP_NAME,
      discipline: 'rally',
      createdAt: NOW,
      lastModified: NOW,
      photoCount: 2,
      isActive: false,
    }]);
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('[sample]'));
  });

  it('self-heals a directory left behind by a quit mid-copy', async () => {
    const prebuilt = writePrebuiltFixture();
    // Simulate the partial state: files on disk, no index entry.
    fs.mkdirSync(compDir, { recursive: true });
    fs.writeFileSync(path.join(compDir, 'junk.tmp'), 'half-written', 'utf8');
    fs.writeFileSync(path.join(compDir, 'session.json'), '{"stale":true}', 'utf8');
    const { deps } = makeDeps();

    await expect(ensureSampleCompetition(deps)).resolves.toBe('copied');

    expect(fs.existsSync(path.join(compDir, 'junk.tmp'))).toBe(false);
    expect(fs.readFileSync(path.join(compDir, 'session.json'), 'utf8'))
      .toBe(fs.readFileSync(path.join(prebuilt, 'session.json'), 'utf8'));
  });

  it('falls back to an empty competition plus a pending marker when only raw sample files are bundled', async () => {
    fs.mkdirSync(sampleDataDir, { recursive: true });
    const { deps, state } = makeDeps({ sampleAvailable: vi.fn(() => true) });

    await expect(ensureSampleCompetition(deps)).resolves.toBe('pending');

    expect(fs.existsSync(path.join(compDir, 'photos'))).toBe(true);
    const session = JSON.parse(fs.readFileSync(path.join(compDir, 'session.json'), 'utf8'));
    expect(session.id).toMatch(/^session-sample-\d+$/);
    expect(session.competition_name).toBe(SAMPLE_COMP_NAME);
    expect(session.mode).toBe('track');
    expect(session.sets.set1.title).toBe('SP - TPX');
    expect(session.sets.set2.title).toBe('TPX - FP');
    expect(session.setsTrack.set1.title).toBe('SP - TPX');
    expect(session.setsTrack.set2.title).toBe('TPX - FP');
    expect(session.setsTurning.set1.title).toBe('');
    expect(session.setsTurning.set2.title).toBe('');
    for (const bucket of [session.sets, session.setsTrack, session.setsTurning]) {
      expect(bucket.set1.photos).toEqual([]);
      expect(bucket.set2.photos).toEqual([]);
    }
    expect(fs.readFileSync(path.join(compDir, '.sample-pending'), 'utf8')).toBe('1');
    expect(state.index.competitions[0].photoCount).toBe(0);
  });

  it('merges into an index another writer changed during the copy instead of clobbering it', async () => {
    writePrebuiltFixture();
    let call = 0;
    const { deps, state } = makeDeps({
      // Call 1 = the "already there?" check, call 2 = the re-read before the
      // write. Between them the launcher's New-competition button created
      // comp-x, which must survive.
      readIndex: vi.fn(() => (++call === 1
        ? { competitions: [] }
        : { competitions: [{ id: 'comp-x' }] })),
    });

    await expect(ensureSampleCompetition(deps)).resolves.toBe('copied');

    expect(state.index.competitions.map(c => c.id)).toEqual(['comp-x', SAMPLE_COMP_ID]);
  });

  it('writes the index synchronously after re-reading it (no await inside the atomic segment)', async () => {
    writePrebuiltFixture();
    let call = 0;
    let microtaskRan = false;
    const { deps } = makeDeps({
      readIndex: vi.fn(() => {
        if (++call === 2) {
          // If any `await` sneaks between readIndex and writeIndex, the event
          // loop drains this microtask first and the assertion below trips.
          queueMicrotask(() => { microtaskRan = true; });
        }
        return { competitions: [] };
      }),
      writeIndex: vi.fn(() => {
        expect(microtaskRan).toBe(false);
      }),
    });

    await expect(ensureSampleCompetition(deps)).resolves.toBe('copied');
    expect(deps.readIndex).toHaveBeenCalledTimes(2);
    expect(deps.writeIndex).toHaveBeenCalledTimes(1);
  });

  it('does not write the index when the re-read already contains the sample', async () => {
    writePrebuiltFixture();
    let call = 0;
    const { deps } = makeDeps({
      readIndex: vi.fn(() => (++call === 1
        ? { competitions: [] }
        : { competitions: [{ id: SAMPLE_COMP_ID }] })),
    });

    // Still 'copied' — the files really were written, only the index entry was
    // already there (another writer raced us to it).
    await expect(ensureSampleCompetition(deps)).resolves.toBe('copied');
    expect(deps.writeIndex).not.toHaveBeenCalled();
  });

  it('resolves "failed" and cleans up its own directory when the index write throws', async () => {
    writePrebuiltFixture();
    const { deps, log } = makeDeps({
      writeIndex: vi.fn(() => { throw new Error('disk full'); }),
    });

    await expect(ensureSampleCompetition(deps)).resolves.toBe('failed');

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('[sample]'),
      expect.any(Error),
    );
    expect(fs.existsSync(compDir)).toBe(false);
  });

  it('resolves "failed" without touching the disk when the first index read throws', async () => {
    writePrebuiltFixture();
    const { deps } = makeDeps({
      readIndex: vi.fn(() => { throw new Error('index unreadable'); }),
    });

    await expect(ensureSampleCompetition(deps)).resolves.toBe('failed');

    expect(fs.existsSync(compDir)).toBe(false);
    expect(fs.existsSync(competitionsDir)).toBe(false);
    expect(deps.writeIndex).not.toHaveBeenCalled();
  });

  it('resolves "failed" and removes the partial directory when the copy itself throws', async () => {
    writePrebuiltFixture();
    // Spy on the same `fs.promises` object the module captured at require time.
    vi.spyOn(fs.promises, 'cp').mockRejectedValue(new Error('EIO'));
    const { deps } = makeDeps();

    await expect(ensureSampleCompetition(deps)).resolves.toBe('failed');

    expect(fs.existsSync(compDir)).toBe(false);
    expect(deps.writeIndex).not.toHaveBeenCalled();
  });

  it('never removes a pre-existing directory it did not create', async () => {
    // No prebuilt fixture and no raw sample → the function returns before it
    // touches compDir, so a folder the user still has must survive a failure.
    fs.mkdirSync(compDir, { recursive: true });
    fs.writeFileSync(path.join(compDir, 'user-data.json'), '{}', 'utf8');
    const { deps } = makeDeps({
      readIndex: vi.fn(() => { throw new Error('index unreadable'); }),
    });

    await expect(ensureSampleCompetition(deps)).resolves.toBe('failed');
    expect(fs.existsSync(path.join(compDir, 'user-data.json'))).toBe(true);
  });
});

describe('countSessionPhotos', () => {
  it('counts a photo id once even when it appears in several buckets', () => {
    const text = JSON.stringify({
      sets: { set1: { photos: [{ id: 'a' }] }, set2: { photos: [{ id: 'b' }] } },
      setsTrack: { set1: { photos: [{ id: 'a' }] }, set2: { photos: [] } },
      setsTurning: { set1: { photos: [{ id: 'b' }] }, set2: { photos: [{ id: 'c' }] } },
    });
    expect(countSessionPhotos(text)).toBe(3);
  });

  it('ignores placeholders, id-less entries and nulls', () => {
    const text = JSON.stringify({
      sets: {
        set1: { photos: [{ id: 'a' }, { id: 'ph', isPlaceholder: true }, { url: 'x' }, null] },
        set2: { photos: [] },
      },
    });
    expect(countSessionPhotos(text)).toBe(1);
  });

  it('returns 0 for malformed JSON, an empty object and missing sets', () => {
    expect(countSessionPhotos('{not json')).toBe(0);
    expect(countSessionPhotos('{}')).toBe(0);
    expect(countSessionPhotos(JSON.stringify({ sets: {} }))).toBe(0);
    expect(countSessionPhotos(JSON.stringify({ sets: { set1: {} } }))).toBe(0);
  });
});

describe('buildEmptySampleSession', () => {
  it('derives the session id from the supplied timestamp', () => {
    const s = buildEmptySampleSession(NOW);
    expect(s.id).toBe(`session-sample-${Date.parse(NOW)}`);
    expect(s.createdAt).toBe(NOW);
    expect(s.updatedAt).toBe(NOW);
  });

  it('matches the empty-competition session shape used by competition-create', () => {
    const s = buildEmptySampleSession(NOW);
    expect(s.version).toBe(1);
    expect(s.mode).toBe('track');
    expect(s.competition_name).toBe(SAMPLE_COMP_NAME);
    expect(Object.keys(s.sets)).toEqual(['set1', 'set2']);
    expect(s.sets.set1).toEqual({ title: 'SP - TPX', photos: [] });
    expect(s.sets.set2).toEqual({ title: 'TPX - FP', photos: [] });
    expect(s.setsTrack).toEqual(s.sets);
    expect(s.setsTurning.set1).toEqual({ title: '', photos: [] });
    expect(s.setsTurning.set2).toEqual({ title: '', photos: [] });
  });
});

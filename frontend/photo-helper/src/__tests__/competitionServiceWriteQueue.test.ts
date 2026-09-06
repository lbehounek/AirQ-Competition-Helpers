import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DirectoryHandle } from '@airq/shared-storage';
import type { Competition, CompetitionsIndex } from '../types/competition';
import type { ApiPhoto, ApiPhotoSession } from '../types/api';
import { makeCanvasState, resetCompetitionServiceCaches } from './support/testHelpers';
import { InMemoryStorage } from './support/inMemoryStorage';

// The write path is now coalescing and serialized: a burst of saves collapses
// into ONE session.json write of the newest snapshot, the competitions index
// leaves the hot path behind a change-detector plus a 10 s throttle, and
// `flushPendingWrites()` drains whatever is still owed. None of that is
// visible through the public API's SIGNATURES — every caller still just awaits
// `updateCompetition` — so it can only be pinned by counting writes.
//
// Every case awaits (or `Promise.all`s) its service calls: the service's
// serial queue is a module singleton and cannot be reset, so a call left in
// flight would bleed into the next test's write order.

let storageMock: InMemoryStorage;

vi.mock('@airq/shared-storage', async () => {
  // Typed against the real module so the spread below can't silently drop an
  // export the service depends on (an `any` here hid exactly that class of bug).
  const actual = await vi.importActual<typeof import('@airq/shared-storage')>('@airq/shared-storage');
  return {
    ...actual,
    initStorage: vi.fn(async () => storageMock),
    getStorage: vi.fn(() => storageMock),
  };
});

/**
 * Per-test failure injection for `writeJSON`. Return an Error to make the call
 * reject; `null` lets it through to the real in-memory write.
 */
let failWriteJSON: ((dir: DirectoryHandle, name: string) => Error | null) | null = null;
const realWriteJSON = InMemoryStorage.prototype.writeJSON;

/**
 * Install the two storage spies on a fresh double. Wrapped in a function so
 * the module-level handles can be typed by inference — `vi.spyOn`'s explicit
 * generic form does not accept method keys.
 */
function installSpies(storage: InMemoryStorage) {
  return {
    write: vi.spyOn(storage, 'writeJSON').mockImplementation(async (dir, name, data) => {
      const err = failWriteJSON?.(dir, name);
      if (err) throw err;
      return realWriteJSON.call(storage, dir, name, data);
    }),
    savePhoto: vi.spyOn(storage, 'savePhotoFile'),
  };
}

let writeSpy: ReturnType<typeof installSpies>['write'];
let savePhotoSpy: ReturnType<typeof installSpies>['savePhoto'];

let urlCounter = 0;
const createdUrls = new Map<string, Blob>();

beforeEach(async () => {
  urlCounter = 0;
  createdUrls.clear();
  failWriteJSON = null;
  storageMock = new InMemoryStorage();

  globalThis.URL.createObjectURL = (blob: Blob) => {
    const id = `blob:test/${++urlCounter}`;
    createdUrls.set(id, blob);
    return id;
  };
  globalThis.URL.revokeObjectURL = (url: string) => { createdUrls.delete(url); };
  // `saveSessionPhotos` fetches each blob: URL, which jsdom cannot do. A REAL
  // `Response` keeps the double honest against the genuine `fetch` signature;
  // bytes go in as an ArrayBuffer because undici's Response stringifies a
  // jsdom Blob to "[object Blob]".
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const blob = createdUrls.get(url);
    if (!blob) throw new Error(`Mock fetch: unknown URL ${url}`);
    return new Response(await blob.arrayBuffer(), { headers: { 'Content-Type': blob.type } });
  };

  const spies = installSpies(storageMock);
  writeSpy = spies.write;
  savePhotoSpy = spies.savePhoto;

  const { competitionService } = await import('../services/competitionService');
  resetCompetitionServiceCaches(competitionService);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_FILE = 'session.json';
const INDEX_FILE = 'competitions-index.json';

/** Names of the JSON files written since the last `clearWrites()`, in order. */
const writtenNames = (): string[] => writeSpy.mock.calls.map(call => call[1]);
const countWrites = (name: string): number => writtenNames().filter(n => n === name).length;
const clearWrites = () => { writeSpy.mockClear(); savePhotoSpy.mockClear(); };

function makePhoto(id: string): ApiPhoto {
  const url = URL.createObjectURL(new Blob([id], { type: 'image/jpeg' }));
  return {
    id,
    sessionId: 'sess-1',
    url,
    filename: `${id}.jpg`,
    canvasState: makeCanvasState(),
    label: '',
  };
}

function makeSession(photos: ApiPhoto[] = []): ApiPhotoSession {
  return {
    id: 'sess-1',
    version: 1,
    createdAt: '2026-05-12T00:00:00Z',
    updatedAt: '2026-05-12T00:00:00Z',
    mode: 'track',
    competition_name: 'Test',
    sets: {
      set1: { title: 'Set 1', photos },
      set2: { title: 'Set 2', photos: [] },
    },
  };
}

/**
 * Build an update payload from a live (URL-carrying) session, optionally
 * overriding the competition name and the first photo's brightness.
 */
function payload(
  base: Competition,
  liveSession: ApiPhotoSession,
  opts: { name?: string; brightness?: number; extraPhoto?: ApiPhoto } = {},
): Competition {
  const photos = liveSession.sets.set1.photos.map(p =>
    opts.brightness === undefined
      ? p
      : { ...p, canvasState: { ...p.canvasState, brightness: opts.brightness } });
  const withExtra = opts.extraPhoto ? [...photos, opts.extraPhoto] : photos;
  return {
    ...base,
    name: opts.name ?? base.name,
    session: {
      ...liveSession,
      sets: { ...liveSession.sets, set1: { ...liveSession.sets.set1, photos: withExtra } },
    },
  };
}

/** Read the session.json a competition currently has on disk. */
async function readSession(id: string): Promise<ApiPhotoSession | null> {
  return storageMock.readJSON<ApiPhotoSession>({ path: `/competitions/${id}` } as DirectoryHandle, SESSION_FILE);
}

async function readIndex(): Promise<CompetitionsIndex | null> {
  return storageMock.readJSON<CompetitionsIndex>({ path: '/' } as DirectoryHandle, INDEX_FILE);
}

/** Private write-coalescing state, for the tombstone assertions. */
type ServiceInternals = {
  pendingSessionWrites: Map<string, unknown>;
  indexTouch: Map<string, unknown>;
  indexDirty: Set<string>;
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('competitionService — coalescing serial write queue', () => {
  it('collapses a burst of saves into one session.json write of the last payload', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    // Seed the index touch so the burst below has nothing new to say about it.
    await competitionService.updateCompetition(payload(created, live, { brightness: 0 }));
    clearWrites();

    await Promise.all([1, 2, 3, 4, 5].map(b =>
      competitionService.updateCompetition(payload(created, live, { brightness: b }))));

    expect(countWrites(SESSION_FILE)).toBe(1);
    expect(countWrites(INDEX_FILE)).toBe(0);
    const onDisk = await readSession(created.id);
    expect(onDisk!.sets.set1.photos[0].canvasState.brightness).toBe(5);
  });

  it('writes the index immediately when the name changed', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    await competitionService.updateCompetition(payload(created, live));
    clearWrites();

    await competitionService.updateCompetition(payload(created, live, { name: 'Renamed' }));

    expect(countWrites(INDEX_FILE)).toBe(1);
    const index = await readIndex();
    expect(index!.competitions.find(c => c.id === created.id)!.name).toBe('Renamed');
  });

  it('writes the index immediately when the photo count changed', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    await competitionService.updateCompetition(payload(created, live));
    clearWrites();

    await competitionService.updateCompetition(payload(created, live, { extraPhoto: makePhoto('p2') }));

    expect(countWrites(INDEX_FILE)).toBe(1);
    const index = await readIndex();
    expect(index!.competitions.find(c => c.id === created.id)!.photoCount).toBe(2);
  });

  it('throttles the index lastModified refresh to once per 10 s', async () => {
    // Fake ONLY Date: real timers keep promises and microtasks flowing.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-12T10:00:00Z'));

    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    clearWrites();

    // First save of this id — no `indexTouch` yet, so the entry is written.
    await competitionService.updateCompetition(payload(created, live, { brightness: 1 }));
    expect(countWrites(INDEX_FILE)).toBe(1);

    clearWrites();
    vi.setSystemTime(new Date('2026-05-12T10:00:05Z'));
    await competitionService.updateCompetition(payload(created, live, { brightness: 2 }));
    expect(countWrites(INDEX_FILE)).toBe(0);
    expect(countWrites(SESSION_FILE)).toBe(1);

    clearWrites();
    vi.setSystemTime(new Date('2026-05-12T10:00:10Z'));
    await competitionService.updateCompetition(payload(created, live, { brightness: 3 }));
    expect(countWrites(INDEX_FILE)).toBe(1);
  });

  it('flushPendingWrites applies a skipped index patch once, then does nothing', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    await competitionService.updateCompetition(payload(created, live));
    const before = (await readIndex())!.competitions.find(c => c.id === created.id)!.lastModified;

    // A save whose index patch is skipped by the throttle.
    await competitionService.updateCompetition(payload(created, live, { brightness: 4 }));
    clearWrites();

    await competitionService.flushPendingWrites();
    expect(countWrites(INDEX_FILE)).toBe(1);
    const after = (await readIndex())!.competitions.find(c => c.id === created.id)!.lastModified;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());

    clearWrites();
    await competitionService.flushPendingWrites();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('OR-accumulates updatePhotos across a coalesced burst', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    await competitionService.updateCompetition(payload(created, live));
    clearWrites();

    // A asks for photo bytes, B does not — but B's payload is the one written,
    // so B's write must still carry A's photo request.
    await Promise.all([
      competitionService.updateCompetition(payload(created, live, { brightness: 1 }), { updatePhotos: true }),
      competitionService.updateCompetition(payload(created, live, { brightness: 2 })),
    ]);

    expect(countWrites(SESSION_FILE)).toBe(1);
    expect(savePhotoSpy).toHaveBeenCalledTimes(1);
    const onDisk = await readSession(created.id);
    expect(onDisk!.sets.set1.photos[0].canvasState.brightness).toBe(2);
  });

  it('reports a failed write to its own caller and retries the owed payload on the next task', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    await competitionService.updateCompetition(payload(created, live));
    clearWrites();

    let failedOnce = false;
    failWriteJSON = (_dir, name) => {
      if (name === SESSION_FILE && !failedOnce) {
        failedOnce = true;
        return new Error('disk full');
      }
      return null;
    };

    const pA = competitionService.updateCompetition(payload(created, live, { brightness: 1 }));
    const pB = competitionService.updateCompetition(payload(created, live, { brightness: 2 }));
    const [rA, rB] = await Promise.allSettled([pA, pB]);

    expect(rA.status).toBe('rejected');
    expect(rB.status).toBe('fulfilled');
    const onDisk = await readSession(created.id);
    expect(onDisk!.sets.set1.photos[0].canvasState.brightness).toBe(2);

    // The queue is not wedged.
    failWriteJSON = null;
    await competitionService.updateCompetition(payload(created, live, { brightness: 9 }));
    expect((await readSession(created.id))!.sets.set1.photos[0].canvasState.brightness).toBe(9);
  });

  it('deleteCompetition tombstones an in-flight save (no resurrected session.json)', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    await competitionService.updateCompetition(payload(created, live));

    // Fire both without awaiting the first: the update's task runs, then the
    // delete's, and the delete must leave nothing behind.
    await Promise.all([
      competitionService.updateCompetition(payload(created, live, { brightness: 3 })),
      competitionService.deleteCompetition(created.id),
    ]);

    expect(await readSession(created.id)).toBeNull();
    const index = await readIndex();
    expect(index!.competitions.find(c => c.id === created.id)).toBeUndefined();

    const internals = competitionService as unknown as ServiceInternals;
    expect(internals.pendingSessionWrites.has(created.id)).toBe(false);
    expect(internals.indexTouch.has(created.id)).toBe(false);
    expect(internals.indexDirty.has(created.id)).toBe(false);
  });

  it('orders a session write before an index write enqueued after it', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const first = await competitionService.createCompetition('Comp A', live);
    const second = await competitionService.createCompetition('Comp B', makeSession());
    await competitionService.updateCompetition(payload(first, live));
    clearWrites();

    await Promise.all([
      competitionService.updateCompetition(payload(first, live, { brightness: 6 })),
      competitionService.setActiveCompetition(second.id),
    ]);

    const names = writtenNames();
    expect(names.indexOf(SESSION_FILE)).toBeGreaterThanOrEqual(0);
    expect(names.indexOf(INDEX_FILE)).toBeGreaterThan(names.indexOf(SESSION_FILE));
    expect((await readIndex())!.activeCompetitionId).toBe(second.id);
  });

  it('flushPendingWrites isolates per entry: one failure does not stop the other', async () => {
    const { competitionService } = await import('../services/competitionService');
    const liveA = makeSession([makePhoto('a1')]);
    const liveB = makeSession([makePhoto('b1')]);
    const compA = await competitionService.createCompetition('Comp A', liveA);
    const compB = await competitionService.createCompetition('Comp B', liveB);

    // Make both updates fail so both payloads stay owed.
    failWriteJSON = (_dir, name) => (name === SESSION_FILE ? new Error('transient') : null);
    await Promise.allSettled([
      competitionService.updateCompetition(payload(compA, liveA, { brightness: 1 })),
      competitionService.updateCompetition(payload(compB, liveB, { brightness: 2 })),
    ]);

    // On the flush, only A keeps failing.
    const aError = new Error('A still broken');
    failWriteJSON = (dir, name) =>
      (name === SESSION_FILE && dir.path.endsWith(compA.id) ? aError : null);

    await expect(competitionService.flushPendingWrites()).rejects.toBe(aError);

    // A's edit never landed (its file still carries the create-time state)…
    const onDiskA = await readSession(compA.id);
    expect(onDiskA!.sets.set1.photos[0].canvasState.brightness).toBe(0);
    // …but B's did, which is the isolation the flush promises.
    const onDiskB = await readSession(compB.id);
    expect(onDiskB!.sets.set1.photos[0].canvasState.brightness).toBe(2);
  });

  it('drops an owed payload for good when its directory is gone', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    await competitionService.updateCompetition(payload(created, live));

    // Leave a payload owed…
    failWriteJSON = (_dir, name) => (name === SESSION_FILE ? new Error('transient') : null);
    await expect(
      competitionService.updateCompetition(payload(created, live, { brightness: 5 })),
    ).rejects.toThrow('transient');

    // …then make the directory disappear behind the service's back.
    failWriteJSON = null;
    storageMock.removeDirectory(`/competitions/${created.id}`);
    clearWrites();

    await expect(competitionService.flushPendingWrites()).rejects.toMatchObject({ name: 'NotFoundError' });

    clearWrites();
    await expect(competitionService.flushPendingWrites()).resolves.toBeUndefined();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('flushPendingWrites patches the index from the payload it just retried', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    // One good save so `indexTouch` holds {Comp A, 1} — the stale pair the flush
    // must NOT fall back to.
    await competitionService.updateCompetition(payload(created, live));

    // A rename that also adds a photo, whose session write fails: the payload
    // stays owed and its index patch never ran.
    failWriteJSON = (_dir, name) => (name === SESSION_FILE ? new Error('transient') : null);
    const owed = payload(created, live, { name: 'Renamed', extraPhoto: makePhoto('p2') });
    await expect(competitionService.updateCompetition(owed)).rejects.toThrow('transient');

    failWriteJSON = null;
    await competitionService.flushPendingWrites();

    // The flush landed the session — so the index must describe THAT payload,
    // not the {Comp A, 1} snapshot from the last successful index write.
    const onDisk = await readSession(created.id);
    expect(onDisk!.sets.set1.photos).toHaveLength(2);
    const entry = (await readIndex())!.competitions.find(c => c.id === created.id)!;
    expect(entry.photoCount).toBe(2);
    expect(entry.name).toBe('Renamed');
  });

  it('flushPendingWrites refreshes the index even with no prior successful index write', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);

    // No successful save yet, so `indexTouch` is empty (createCompetition writes
    // the entry directly and never seeds it) — the id must still not be dropped.
    failWriteJSON = (_dir, name) => (name === SESSION_FILE ? new Error('transient') : null);
    await expect(
      competitionService.updateCompetition(payload(created, live, { extraPhoto: makePhoto('p2') })),
    ).rejects.toThrow('transient');

    failWriteJSON = null;
    const internals = competitionService as unknown as ServiceInternals;
    expect(internals.indexTouch.has(created.id)).toBe(false);

    await competitionService.flushPendingWrites();

    expect((await readIndex())!.competitions.find(c => c.id === created.id)!.photoCount).toBe(2);
  });

  it('collapses a rename burst into one index write carrying the final name', async () => {
    const { competitionService } = await import('../services/competitionService');
    const live = makeSession([makePhoto('p1')]);
    const created = await competitionService.createCompetition('Comp A', live);
    clearWrites();

    await Promise.all([
      competitionService.updateCompetition(payload(created, live, { name: 'Comp B' })),
      competitionService.updateCompetition(payload(created, live, { name: 'Comp A' })),
      competitionService.updateCompetition(payload(created, live, { name: 'Comp A', brightness: 7 })),
    ]);

    expect(countWrites(SESSION_FILE)).toBe(1);
    expect(countWrites(INDEX_FILE)).toBe(1);
    const index = await readIndex();
    expect(index!.competitions.find(c => c.id === created.id)!.name).toBe('Comp A');
  });
});

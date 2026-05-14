import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DirectoryHandle, StorageInterface } from '@airq/shared-storage';
import type { ApiPhoto, ApiPhotoSession } from '../types/api';
// Note: competitionService is dynamic-imported inside each test so the
// `vi.mock` hoist below takes effect before the service captures the mocked
// `getStorage` reference. We then reset the singleton's cached handles in
// `beforeEach` so each test starts on a fresh storageMock.

// PR #62 review gap B1: docs/CANDIDATE_PHOTOS.md test plan promised
// `competitionServiceRoundtrip.test.ts` but it was never written. This file
// fills that gap: it pins sanitize → write JSON → read JSON → load (with blob
// rehydration) so flag / canvasState / candidate-pool round-trip survive
// future persistence refactors.

// ── In-memory storage adapter ────────────────────────────────────────────────
// Implements the StorageInterface contract enough for the roundtrip we care
// about (dir lookup, writeJSON/readJSON, savePhotoFile/getPhotoBlob,
// deletePhotoFile, list/clear, estimate). Mirrors OPFSStorage's "create or
// fail" semantics. The competitionService consumes it through the singleton
// `getStorage()`, so we mock the module export.

type Entry =
  | { kind: 'dir'; children: Map<string, Entry> }
  | { kind: 'json'; data: unknown }
  | { kind: 'blob'; blob: Blob; mime: string };

function makeDir(): Entry { return { kind: 'dir', children: new Map() }; }

function ensureChildDir(parent: Entry, name: string, create: boolean): Entry {
  if (parent.kind !== 'dir') throw new Error(`Not a directory`);
  let child = parent.children.get(name);
  if (!child) {
    if (!create) throw new Error(`Directory missing: ${name}`);
    child = makeDir();
    parent.children.set(name, child);
  }
  if (child.kind !== 'dir') throw new Error(`Path is not a directory: ${name}`);
  return child;
}

class InMemoryStorage implements StorageInterface {
  // Each directory handle has a stable `path` so the service can compare them
  // and the mock can resolve back to the underlying entry.
  root: Entry = makeDir();
  pathToEntry: Map<string, Entry> = new Map();

  constructor() {
    this.pathToEntry.set('/', this.root);
  }

  async init() {
    const sessionsDir = ensureChildDir(this.root, 'sessions', true);
    this.pathToEntry.set('/sessions', sessionsDir);
    return {
      root: { path: '/' } as DirectoryHandle,
      sessions: { path: '/sessions' } as DirectoryHandle,
    };
  }

  async ensureSessionDirs(_id: string) {
    return {
      dir: { path: '/' } as DirectoryHandle,
      photos: { path: '/' } as DirectoryHandle,
    };
  }

  async writeJSON(dir: DirectoryHandle, name: string, data: unknown) {
    const entry = this.pathToEntry.get(dir.path);
    if (!entry || entry.kind !== 'dir') throw new Error(`Bad dir: ${dir.path}`);
    entry.children.set(name, { kind: 'json', data: JSON.parse(JSON.stringify(data)) });
  }

  async readJSON<T>(dir: DirectoryHandle, name: string): Promise<T | null> {
    const entry = this.pathToEntry.get(dir.path);
    if (!entry || entry.kind !== 'dir') return null;
    const file = entry.children.get(name);
    if (!file || file.kind !== 'json') return null;
    return JSON.parse(JSON.stringify(file.data)) as T;
  }

  async savePhotoFile(photosDir: DirectoryHandle, photoId: string, file: File) {
    const entry = this.pathToEntry.get(photosDir.path);
    if (!entry || entry.kind !== 'dir') throw new Error(`Bad dir: ${photosDir.path}`);
    const buf = await file.arrayBuffer();
    entry.children.set(photoId, { kind: 'blob', blob: new Blob([buf], { type: file.type }), mime: file.type });
  }

  async getPhotoBlob(photosDir: DirectoryHandle, photoId: string): Promise<Blob> {
    const entry = this.pathToEntry.get(photosDir.path);
    if (!entry || entry.kind !== 'dir') throw new Error(`Bad dir: ${photosDir.path}`);
    const file = entry.children.get(photoId);
    if (!file || file.kind !== 'blob') throw new Error(`Photo not found: ${photoId}`);
    return file.blob;
  }

  async deletePhotoFile(photosDir: DirectoryHandle, photoId: string) {
    const entry = this.pathToEntry.get(photosDir.path);
    if (!entry || entry.kind !== 'dir') return;
    entry.children.delete(photoId);
  }

  async clearDirectory(dir: DirectoryHandle) {
    const entry = this.pathToEntry.get(dir.path);
    if (!entry || entry.kind !== 'dir') return;
    entry.children.clear();
  }

  async deleteSessionDir() { /* unused */ }

  async getDirectoryHandle(parent: DirectoryHandle, name: string, options?: { create?: boolean }) {
    const parentEntry = this.pathToEntry.get(parent.path);
    if (!parentEntry) throw new Error(`Parent dir missing: ${parent.path}`);
    const child = ensureChildDir(parentEntry, name, !!options?.create);
    const childPath = parent.path === '/' ? `/${name}` : `${parent.path}/${name}`;
    this.pathToEntry.set(childPath, child);
    return { path: childPath } as DirectoryHandle;
  }

  async isAvailable() { return true; }

  async getStorageEstimate() { return { usage: 0, quota: 1024 * 1024 * 1024 }; }

  async listDirectory(dir: DirectoryHandle) {
    const entry = this.pathToEntry.get(dir.path);
    if (!entry || entry.kind !== 'dir') return [];
    return [...entry.children.entries()].map(([name, e]) => ({
      name,
      isDirectory: e.kind === 'dir',
    }));
  }
}

let storageMock: InMemoryStorage;

// Mock the shared-storage module BEFORE importing competitionService. The
// service captures `getStorage()` at call time, so the mock just needs to
// return our in-memory adapter consistently.
vi.mock('@airq/shared-storage', async () => {
  const actual = await vi.importActual<any>('@airq/shared-storage');
  return {
    ...actual,
    initStorage: vi.fn(async () => storageMock),
    getStorage: vi.fn(() => storageMock),
  };
});

// Mock URL.createObjectURL / revokeObjectURL — jsdom provides them but they
// return opaque strings that don't round-trip via fetch(). The service
// rehydrates URLs via createObjectURL on load; for our roundtrip we only
// care that the URL is a string starting with `blob:`.
let urlCounter = 0;
const createdUrls = new Map<string, Blob>();
beforeEach(async () => {
  urlCounter = 0;
  createdUrls.clear();
  storageMock = new InMemoryStorage();
  globalThis.URL.createObjectURL = (blob: Blob) => {
    const id = `blob:test/${++urlCounter}`;
    createdUrls.set(id, blob);
    return id;
  };
  globalThis.URL.revokeObjectURL = (url: string) => { createdUrls.delete(url); };
  // Service's saveSessionPhotos calls `fetch(blob:url)` then `.blob()`. jsdom
  // doesn't implement that, so route through our map.
  globalThis.fetch = (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const blob = createdUrls.get(url);
    if (!blob) return Promise.reject(new Error(`Mock fetch: unknown URL ${url}`));
    return Promise.resolve({ blob: async () => blob } as any);
  };
  // The competitionService is a module-singleton that caches `this.storage`,
  // `this.handles`, and `this.competitionsDir` on first `initialize()`. Wipe
  // those between tests so `ensureInitialized` re-grabs the fresh mock.
  const { competitionService } = await import('../services/competitionService');
  (competitionService as any).storage = null;
  (competitionService as any).handles = null;
  (competitionService as any).competitionsDir = null;
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function makePhoto(id: string, overrides: Partial<ApiPhoto> = {}): ApiPhoto {
  const url = URL.createObjectURL(new Blob([id], { type: 'image/jpeg' }));
  return {
    id,
    sessionId: 'sess-1',
    url,
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
    ...overrides,
  };
}

function makeSession(opts: {
  set1?: ApiPhoto[];
  set2?: ApiPhoto[];
  candidates?: ApiPhoto[];
  includeCandidatesField?: boolean;
}): ApiPhotoSession {
  const base: ApiPhotoSession = {
    id: 'sess-1',
    version: 1,
    createdAt: '2026-05-12T00:00:00Z',
    updatedAt: '2026-05-12T00:00:00Z',
    mode: 'track',
    competition_name: 'Test',
    sets: {
      set1: { title: 'Set 1', photos: opts.set1 ?? [] },
      set2: { title: 'Set 2', photos: opts.set2 ?? [] },
    },
  };
  if (opts.includeCandidatesField !== false) {
    base.candidates = { photos: opts.candidates ?? [] };
  }
  return base;
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('competitionService — candidate pool roundtrip', () => {
  it('persists flags and canvasState through create → reload', async () => {
    const { competitionService } = await import('../services/competitionService');

    const cand1 = makePhoto('cand-1', { flag: 'pick' });
    cand1.canvasState = { ...cand1.canvasState, brightness: 0.42 } as any;
    const cand2 = makePhoto('cand-2', { flag: 'reject' });
    const slot1 = makePhoto('slot-1');

    const session = makeSession({ set1: [slot1], candidates: [cand1, cand2] });
    const created = await competitionService.createCompetition('TestComp', session);

    // Sanity: on-disk JSON has URLs stripped (sanitize) but flag + canvasState present.
    const savedJson = await storageMock.readJSON<ApiPhotoSession>(
      { path: `/competitions/${created.id}` } as DirectoryHandle,
      'session.json',
    );
    expect(savedJson).toBeTruthy();
    expect(savedJson!.candidates?.photos).toHaveLength(2);
    expect(savedJson!.candidates?.photos.every(p => p.url === '')).toBe(true);
    expect(savedJson!.candidates?.photos[0].flag).toBe('pick');
    expect(savedJson!.candidates?.photos[1].flag).toBe('reject');
    expect((savedJson!.candidates?.photos[0].canvasState as any).brightness).toBe(0.42);

    // Reload — blob URLs rehydrated, candidate pool intact.
    const reloaded = await competitionService.getCompetition(created.id);
    expect(reloaded).toBeTruthy();
    expect(reloaded!.session.candidates?.photos).toHaveLength(2);
    const reloadedCand1 = reloaded!.session.candidates!.photos.find(p => p.id === 'cand-1')!;
    expect(reloadedCand1.flag).toBe('pick');
    expect(reloadedCand1.url.startsWith('blob:')).toBe(true);
    expect((reloadedCand1.canvasState as any).brightness).toBe(0.42);
    const reloadedCand2 = reloaded!.session.candidates!.photos.find(p => p.id === 'cand-2')!;
    expect(reloadedCand2.flag).toBe('reject');
    expect(reloaded!.session.sets.set1.photos[0].id).toBe('slot-1');
    expect(reloaded!.session.sets.set1.photos[0].url.startsWith('blob:')).toBe(true);
  });

  it('handles legacy session without a candidates field', async () => {
    const { competitionService } = await import('../services/competitionService');
    const session = makeSession({ set1: [makePhoto('slot-1')], includeCandidatesField: false });
    const created = await competitionService.createCompetition('Legacy', session);

    const reloaded = await competitionService.getCompetition(created.id);
    expect(reloaded).toBeTruthy();
    // `loadCandidates(undefined)` returns undefined — the field round-trips as
    // absent rather than `{ photos: [] }`. Code that reads it uses
    // `session.candidates?.photos ?? []` per the contract.
    expect(reloaded!.session.candidates).toBeUndefined();
    expect(reloaded!.session.sets.set1.photos).toHaveLength(1);
  });

  it('deletePhotosByIds removes only the listed files from OPFS', async () => {
    const { competitionService } = await import('../services/competitionService');
    const c1 = makePhoto('c1');
    const c2 = makePhoto('c2');
    const c3 = makePhoto('c3');
    const created = await competitionService.createCompetition('Cleanup', makeSession({ candidates: [c1, c2, c3] }));

    const photosDir = { path: `/competitions/${created.id}/photos` } as DirectoryHandle;
    const beforeNames = (await storageMock.listDirectory(photosDir)).map(e => e.name);
    expect(new Set(beforeNames)).toEqual(new Set(['c1', 'c2', 'c3']));

    await competitionService.deletePhotosByIds(created.id, ['c1', 'c3']);

    const afterNames = (await storageMock.listDirectory(photosDir)).map(e => e.name);
    expect(afterNames).toEqual(['c2']);
  });

  it('deletePhotosByIds is a safe no-op for an unknown competition id', async () => {
    const { competitionService } = await import('../services/competitionService');
    // Missing competition directory → treated as already-cleaned. `failed`
    // is empty (the entries don't exist, so no per-id failure to report).
    // Per PR #62 review CRIT-3 the function returns `{ failed }` so callers
    // can surface partial OPFS failures.
    await expect(
      competitionService.deletePhotosByIds('comp-nonexistent', ['x'])
    ).resolves.toEqual({ failed: [] });
  });

  it('updates and reloads — candidate flag changes are persisted even when photoCount is unchanged', async () => {
    const { competitionService } = await import('../services/competitionService');
    const cand = makePhoto('cand-1', { flag: 'neutral' });
    const created = await competitionService.createCompetition('FlagTest', makeSession({ candidates: [cand] }));

    // Simulate `useCompetitionSystem.setCandidateFlag` writing back without
    // `updatePhotos: true`. `updateCompetition` always writes session.json
    // regardless of the flag, so the new flag MUST persist (PR #62 review).
    const updatedSession = {
      ...created.session,
      candidates: { photos: [{ ...created.session.candidates!.photos[0], flag: 'reject' as const }] },
    };
    await competitionService.updateCompetition(
      { ...created, session: updatedSession, lastModified: new Date().toISOString() },
      { updatePhotos: false },
    );

    const reloaded = await competitionService.getCompetition(created.id);
    expect(reloaded!.session.candidates?.photos[0].flag).toBe('reject');
  });

  // PR #62 review G11: a session that has both mode buckets populated AND a
  // candidate pool must round-trip cleanly — deduplication preserves the
  // blob URL across containers, and each container loads back independently.
  it('round-trips a session with setsTrack, setsTurning, AND candidates all populated', async () => {
    const { competitionService } = await import('../services/competitionService');

    // Build a "rich" session: same id shared across active sets, mode
    // buckets, and a tray photo.
    const shared = makePhoto('shared-1');
    const trackOnly = makePhoto('track-only');
    const turningOnly = makePhoto('turning-only');
    const candOnly = makePhoto('cand-only', { flag: 'pick' });

    const session: ApiPhotoSession = {
      id: 'sess-rich',
      version: 1,
      createdAt: '2026-05-12T00:00:00Z',
      updatedAt: '2026-05-12T00:00:00Z',
      mode: 'track',
      competition_name: 'Rich',
      sets: { set1: { title: 'S1', photos: [shared] }, set2: { title: 'S2', photos: [] } },
      setsTrack: { set1: { title: 'S1', photos: [shared, trackOnly] }, set2: { title: 'S2', photos: [] } },
      setsTurning: { set1: { title: 'S1', photos: [turningOnly] }, set2: { title: 'S2', photos: [] } },
      candidates: { photos: [candOnly] },
    };

    const created = await competitionService.createCompetition('Rich', session);
    const reloaded = await competitionService.getCompetition(created.id);
    expect(reloaded).toBeTruthy();

    // All four containers come back with rehydrated blob URLs.
    expect(reloaded!.session.sets.set1.photos.map(p => p.id)).toEqual(['shared-1']);
    expect(reloaded!.session.setsTrack?.set1.photos.map(p => p.id)).toEqual(['shared-1', 'track-only']);
    expect(reloaded!.session.setsTurning?.set1.photos.map(p => p.id)).toEqual(['turning-only']);
    expect(reloaded!.session.candidates?.photos.map(p => p.id)).toEqual(['cand-only']);

    // The shared id reloads with a blob URL in BOTH places (separate
    // `URL.createObjectURL` calls — they are independent strings but both
    // valid). Tests that the deduplication-by-id in `saveSessionPhotos`
    // doesn't accidentally write only one copy.
    const sharedInActive = reloaded!.session.sets.set1.photos[0];
    const sharedInTrack = reloaded!.session.setsTrack!.set1.photos.find(p => p.id === 'shared-1')!;
    expect(sharedInActive.url.startsWith('blob:')).toBe(true);
    expect(sharedInTrack.url.startsWith('blob:')).toBe(true);

    // Candidate-only id keeps its flag through the round-trip.
    expect(reloaded!.session.candidates?.photos[0].flag).toBe('pick');
  });

  // PR #62 review G12: an OPFS blob that was evicted (cross-device sync,
  // user wiping the photos/ subdir) must not crash the entire load —
  // a single missing blob should not block opening the competition.
  it('reloads gracefully when one candidate blob is missing on disk', async () => {
    const { competitionService } = await import('../services/competitionService');
    const c1 = makePhoto('c1');
    const c2 = makePhoto('c2');
    const created = await competitionService.createCompetition('MissingBlob', makeSession({ candidates: [c1, c2] }));

    // Evict one blob by deleting it directly from the storage mock.
    const photosDir = { path: `/competitions/${created.id}/photos` } as DirectoryHandle;
    await storageMock.deletePhotoFile(photosDir, 'c1');

    // Reload must not throw — the surviving blob loads as usual, the
    // missing one either drops out or surfaces with a fallback. We assert
    // only that the call resolves and the other photo is still reachable.
    await expect(competitionService.getCompetition(created.id)).resolves.toBeTruthy();
    const reloaded = await competitionService.getCompetition(created.id);
    const ids = reloaded!.session.candidates?.photos.map(p => p.id) ?? [];
    expect(ids).toContain('c2');
  });

  // PR #62 review CRIT-3: the new `{ failed }` return shape lets the cleanup
  // dialog distinguish partial failure from success. Pin both branches.
  it('deletePhotosByIds returns empty `failed` array on the happy path', async () => {
    const { competitionService } = await import('../services/competitionService');
    const created = await competitionService.createCompetition('OK', makeSession({ candidates: [makePhoto('a'), makePhoto('b')] }));
    const result = await competitionService.deletePhotosByIds(created.id, ['a', 'b']);
    expect(result).toEqual({ failed: [] });
  });

  it('deletePhotosByIds reports per-id failures in `failed`', async () => {
    const { competitionService } = await import('../services/competitionService');
    const created = await competitionService.createCompetition('Partial', makeSession({ candidates: [makePhoto('keep')] }));
    // Stub `deletePhotoFile` to throw for one specific id so we exercise
    // the partial-failure path without touching real OPFS.
    const original = storageMock.deletePhotoFile.bind(storageMock);
    storageMock.deletePhotoFile = (async (dir, id) => {
      if (id === 'boom') throw new Error('simulated OPFS write error');
      return original(dir, id);
    }) as typeof storageMock.deletePhotoFile;

    const result = await competitionService.deletePhotosByIds(created.id, ['keep', 'boom']);
    expect(result.failed).toEqual(['boom']);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { DirectoryHandle, StorageInterface } from '@airq/shared-storage';

// PR #62 review G1 / G2 / G5: the hook layer wraps the pure helpers with
// capacity clamps, smart-drop routing, mode-bucket mirroring, and the
// CRIT-3 partial-failure rethrow. The pure helpers are tested separately;
// here we exercise the WRAPPER behaviours that exist only at the hook.
//
// The hook depends on `competitionService` (a module singleton over OPFS),
// `migrationService`, and `useI18n`. We mock each so the test owns its
// storage state and doesn't drag in unrelated initialization paths.

// ── In-memory storage mock (re-used pattern from competitionServiceRoundtrip.test.ts) ─
type Entry =
  | { kind: 'dir'; children: Map<string, Entry> }
  | { kind: 'json'; data: unknown }
  | { kind: 'blob'; blob: Blob };

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
  root: Entry = makeDir();
  pathToEntry: Map<string, Entry> = new Map();

  constructor() { this.pathToEntry.set('/', this.root); }

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
    entry.children.set(photoId, { kind: 'blob', blob: new Blob([buf], { type: file.type }) });
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
    return [...entry.children.entries()].map(([name, e]) => ({ name, isDirectory: e.kind === 'dir' }));
  }
}

let storageMock: InMemoryStorage;

vi.mock('@airq/shared-storage', async () => {
  const actual = await vi.importActual<any>('@airq/shared-storage');
  return {
    ...actual,
    initStorage: vi.fn(async () => storageMock),
    getStorage: vi.fn(() => storageMock),
  };
});

// Mock the i18n context — echo the key so assertions can check error
// reasons without spinning up the I18nProvider tree.
vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

// Skip the storage-migration path so initialise() doesn't try to scan
// legacy sessions. Returning `migrated: false` keeps the hook's
// migrationPerformed flag false but doesn't matter — we don't re-render.
vi.mock('../services/migrationService', () => ({
  migrationService: {
    performMigration: vi.fn(async () => ({ migrated: false, message: '' })),
  },
}));

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
  globalThis.fetch = (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const blob = createdUrls.get(url);
    if (!blob) return Promise.reject(new Error(`Mock fetch: unknown URL ${url}`));
    return Promise.resolve({ blob: async () => blob } as any);
  };
  // competitionService is a module singleton — reset its caches each test.
  const { competitionService } = await import('../services/competitionService');
  (competitionService as any).storage = null;
  (competitionService as any).handles = null;
  (competitionService as any).competitionsDir = null;
});

afterEach(() => { vi.restoreAllMocks(); });

function makeFile(name = 'photo.jpg'): File {
  return new File([new Uint8Array([0xFF, 0xD8, 0xFF])], name, { type: 'image/jpeg' });
}

async function setup() {
  const { useCompetitionSystem } = await import('../hooks/useCompetitionSystem');
  const { result } = renderHook(() => useCompetitionSystem());
  // Wait for the initial async init to settle and a competition to exist.
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
    expect(result.current.currentCompetition).not.toBeNull();
  }, { timeout: 5000 });
  return result;
}

describe('useCompetitionSystem — smart-drop integration (PR #62 review G1)', () => {
  it('addPhotosToSet routes overflow batches to the candidate tray', async () => {
    const result = await setup();
    // 9-slot landscape (default). Drop 12 files → over capacity → tray.
    const files = Array.from({ length: 12 }, (_, i) => makeFile(`f${i}.jpg`));

    let resultValue: any;
    await act(async () => {
      resultValue = await result.current.addPhotosToSet(files, 'set1');
    });

    expect(resultValue).toEqual({ kind: 'ok', routedTo: 'tray', count: 12 });
    expect(result.current.session?.sets.set1.photos.length).toBe(0);
    expect(result.current.session?.candidates?.photos.length).toBe(12);
  });

  it('addPhotosToSet fills slots when batch fits within remaining capacity', async () => {
    const result = await setup();
    const files = Array.from({ length: 5 }, (_, i) => makeFile(`f${i}.jpg`));

    let resultValue: any;
    await act(async () => {
      resultValue = await result.current.addPhotosToSet(files, 'set1');
    });

    expect(resultValue).toEqual({ kind: 'ok', routedTo: 'slot', count: 5 });
    expect(result.current.session?.sets.set1.photos.length).toBe(5);
    expect((result.current.session?.candidates?.photos ?? []).length).toBe(0);
  });

  it('addPhotosToSet returns over-capacity err when set is already over the cap', async () => {
    const result = await setup();
    // Force the session into a corrupted state with 11 photos in a 9-slot
    // capacity (simulates a legacy session or layout switch).
    await act(async () => {
      await result.current.addPhotosToSet([makeFile('a.jpg')], 'set1');
    });
    // Manually push the over-cap state by addressing the singleton — this
    // is a TEST-ONLY shortcut for the rare corruption path the guard covers.
    const session = result.current.currentCompetition!.session;
    (session.sets.set1.photos as any).push(
      ...Array.from({ length: 11 }, (_, i) => ({
        id: `corrupt-${i}`, sessionId: session.id, url: '', filename: 'x', canvasState: {} as any, label: '',
      })),
    );

    let errResult: any;
    await act(async () => {
      errResult = await result.current.addPhotosToSet([makeFile('y.jpg')], 'set1');
    });
    expect(errResult.kind).toBe('err');
    expect(errResult.reason).toBe('over-capacity');
  });
});

describe('useCompetitionSystem — promoteCandidateToSlot capacity clamp (PR #62 review G5 / C1)', () => {
  it('clamps slotIndex >= capacity to capacity - 1 so swap-on-full fires instead of append', async () => {
    const result = await setup();
    // Fill set1 with 9 slot photos.
    await act(async () => {
      await result.current.addPhotosToSet(
        Array.from({ length: 9 }, (_, i) => makeFile(`s${i}.jpg`)),
        'set1',
      );
    });
    // Add 1 candidate.
    await act(async () => {
      await result.current.addPhotosToCandidates([makeFile('cand.jpg')]);
    });

    const slotIdsBefore = result.current.session!.sets.set1.photos.map(p => p.id);
    const candidateId = result.current.session!.candidates!.photos[0].id;

    // Pass slotIndex = 9 (== capacity) — pre-clamp this APPENDED past
    // capacity (PR #62 review C1). The clamp must redirect to index 8 so
    // the swap branch fires instead.
    await act(async () => {
      await result.current.promoteCandidateToSlot(candidateId, 'set1', 9);
    });

    expect(result.current.session!.sets.set1.photos.length).toBe(9);
    expect(result.current.session!.sets.set1.photos[8].id).toBe(candidateId);
    // The displaced photo (formerly at index 8) is now back in the tray.
    expect(result.current.session!.candidates!.photos.map(p => p.id))
      .toContain(slotIdsBefore[8]);
  });

  it('clamps negative slotIndex to 0', async () => {
    const result = await setup();
    await act(async () => {
      await result.current.addPhotosToCandidates([makeFile('cand.jpg')]);
    });
    const candidateId = result.current.session!.candidates!.photos[0].id;
    await act(async () => {
      await result.current.promoteCandidateToSlot(candidateId, 'set1', -5);
    });
    expect(result.current.session!.sets.set1.photos.map(p => p.id)).toEqual([candidateId]);
  });

  it('mirrors slot mutation into active mode bucket so mode-switch round-trip preserves it', async () => {
    const result = await setup();
    await act(async () => {
      await result.current.addPhotosToCandidates([makeFile('c.jpg')]);
    });
    const candidateId = result.current.session!.candidates!.photos[0].id;
    await act(async () => {
      await result.current.promoteCandidateToSlot(candidateId, 'set1', 0);
    });
    // After promote: setsTrack (active mode bucket) MUST mirror sets.
    const session = result.current.session!;
    expect(session.sets.set1.photos.map(p => p.id)).toEqual([candidateId]);
    expect(session.setsTrack?.set1.photos.map(p => p.id)).toEqual([candidateId]);
  });
});

describe('useCompetitionSystem — deleteCandidates and clearAllCandidates (PR #62 review G5 / CRIT-3)', () => {
  it('deleteCandidates removes specific ids and frees OPFS files', async () => {
    const result = await setup();
    await act(async () => {
      await result.current.addPhotosToCandidates([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')]);
    });
    const ids = result.current.session!.candidates!.photos.map(p => p.id);
    const [keepId, deleteId1, deleteId2] = ids;

    await act(async () => {
      await (result.current as any).deleteCandidates([deleteId1, deleteId2]);
    });

    expect(result.current.session!.candidates!.photos.map(p => p.id)).toEqual([keepId]);
    // OPFS file for deleted ids is gone; keepId's file remains.
    const compId = result.current.currentCompetition!.id;
    const photosDir = { path: `/competitions/${compId}/photos` } as DirectoryHandle;
    const remainingFiles = (await storageMock.listDirectory(photosDir)).map(e => e.name);
    expect(remainingFiles).toContain(keepId);
    expect(remainingFiles).not.toContain(deleteId1);
    expect(remainingFiles).not.toContain(deleteId2);
  });

  it('deleteCandidates is a no-op for ids no longer in the pool', async () => {
    const result = await setup();
    await act(async () => {
      await result.current.addPhotosToCandidates([makeFile('a.jpg')]);
    });
    // Try to delete an id that doesn't exist — should not throw or remove anything.
    await act(async () => {
      await (result.current as any).deleteCandidates(['ghost-id']);
    });
    expect(result.current.session!.candidates!.photos.length).toBe(1);
  });

  it('deleteCandidates RETHROWS on OPFS partial failure so the cleanup dialog stays open', async () => {
    const result = await setup();
    await act(async () => {
      await result.current.addPhotosToCandidates([makeFile('boom.jpg')]);
    });
    const id = result.current.session!.candidates!.photos[0].id;

    // Stub deletePhotoFile to throw — exercises the CRIT-3 wiring where
    // `{ failed }` from the service causes `deleteCandidates` to throw,
    // which the AppApi cleanup dialog catches to stay open + show Snackbar.
    const original = storageMock.deletePhotoFile.bind(storageMock);
    storageMock.deletePhotoFile = (async (dir, fileId) => {
      if (fileId === id) throw new Error('simulated OPFS error');
      return original(dir, fileId);
    }) as typeof storageMock.deletePhotoFile;

    await expect(
      act(async () => { await (result.current as any).deleteCandidates([id]); })
    ).rejects.toThrow(/candidateDeletePartialFailure/);
  });

  it('clearAllCandidates wipes the pool via deleteCandidates', async () => {
    const result = await setup();
    await act(async () => {
      await result.current.addPhotosToCandidates([makeFile('a.jpg'), makeFile('b.jpg')]);
    });
    expect(result.current.session!.candidates!.photos.length).toBe(2);

    await act(async () => {
      await result.current.clearAllCandidates();
    });
    expect(result.current.session!.candidates!.photos.length).toBe(0);
  });
});

describe('useCompetitionSystem — addPhotosToTurningPoint overflow (PR #62 review G2)', () => {
  it('routes 25-photo rally turning-point drop to candidates instead of erroring', async () => {
    const result = await setup();
    // Switch to turningpoint mode.
    await act(async () => { await result.current.updateSessionMode('turningpoint'); });

    const files = Array.from({ length: 25 }, (_, i) => makeFile(`f${i}.jpg`));
    let resultValue: any;
    await act(async () => {
      resultValue = await (result.current as any).addPhotosToTurningPoint(files);
    });

    expect(resultValue).toEqual({ kind: 'ok', routedTo: 'tray', count: 25 });
    expect(result.current.session!.candidates!.photos.length).toBe(25);
    expect(result.current.session!.sets.set1.photos.length).toBe(0);
    expect(result.current.session!.sets.set2.photos.length).toBe(0);
  });
});

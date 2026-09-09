import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { DirectoryHandle } from '@airq/shared-storage';
import type { ApiPhotoSession } from '../types/api';
import { resetCompetitionServiceCaches } from './support/testHelpers';
import { InMemoryStorage } from './support/inMemoryStorage';

// The hook half of the persistence work: coalesced writes seen from above,
// the CONDITIONAL rollback (a failed write whose payload a later call already
// carried to disk must not roll the ref back or raise a banner), the
// `samePhotoIds` gate on photo bytes, and the `flushPersistence` entry point.
//
// Scaffolded from useCompetitionSystem.candidates.test.tsx: the same in-memory
// storage double, the same i18n / migration stubs.

let storageMock: InMemoryStorage;

vi.mock('@airq/shared-storage', async () => {
  const actual = await vi.importActual<typeof import('@airq/shared-storage')>('@airq/shared-storage');
  return {
    ...actual,
    initStorage: vi.fn(async () => storageMock),
    getStorage: vi.fn(() => storageMock),
  };
});

vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('../services/migrationService', () => ({
  migrationService: {
    performMigration: vi.fn(async () => ({ migrated: false, message: '' })),
  },
}));

/** Per-test failure injection for `writeJSON`; `null` lets the write through. */
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

afterEach(() => { vi.restoreAllMocks(); });

const SESSION_FILE = 'session.json';

const countSessionWrites = () =>
  writeSpy.mock.calls.filter(call => call[1] === SESSION_FILE).length;

function makeFile(name = 'photo.jpg'): File {
  const nameBytes = Array.from(name, c => c.charCodeAt(0) & 0xff);
  return new File([new Uint8Array([0xFF, 0xD8, 0xFF, ...nameBytes])], name, { type: 'image/jpeg' });
}

async function setup() {
  const { useCompetitionSystem } = await import('../hooks/useCompetitionSystem');
  const { result } = renderHook(() => useCompetitionSystem());
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
    expect(result.current.currentCompetition).not.toBeNull();
  }, { timeout: 5000 });
  return result;
}

/** Add one photo to set1 and return its generated id. */
async function seedPhoto(result: Awaited<ReturnType<typeof setup>>): Promise<string> {
  await act(async () => { await result.current.addPhotosToSet([makeFile('a.jpg')], 'set1'); });
  const id = result.current.session!.sets.set1.photos[0].id;
  expect(id).toBeTruthy();
  return id;
}

const readPersisted = async (competitionId: string) =>
  storageMock.readJSON<ApiPhotoSession>(
    { path: `/competitions/${competitionId}` } as DirectoryHandle,
    SESSION_FILE,
  );

describe('useCompetitionSystem — persistence', () => {
  it('coalesces two un-awaited canvas edits into one session.json write', async () => {
    const result = await setup();
    const photoId = await seedPhoto(result);
    const competitionId = result.current.currentCompetition!.id;
    writeSpy.mockClear();

    await act(async () => {
      const a = result.current.updatePhotoState('set1', photoId, { brightness: 10 });
      const b = result.current.updatePhotoState('set1', photoId, { brightness: 20 });
      await Promise.all([a, b]);
    });

    expect(countSessionWrites()).toBe(1);
    expect(result.current.session!.sets.set1.photos[0].canvasState.brightness).toBe(20);
    const persisted = await readPersisted(competitionId);
    expect(persisted!.sets.set1.photos[0].canvasState.brightness).toBe(20);
  });

  it('a five-step burst still costs exactly one session.json write', async () => {
    // The realistic shape of a slider drag once the editor's debounce has
    // collapsed the pointer moves: several hook calls issued back-to-back,
    // faster than the queue can drain them.
    const result = await setup();
    const photoId = await seedPhoto(result);
    writeSpy.mockClear();

    await act(async () => {
      await Promise.all([1, 2, 3, 4, 5].map(b =>
        result.current.updatePhotoState('set1', photoId, { brightness: b })));
    });

    expect(countSessionWrites()).toBe(1);
    expect(result.current.session!.sets.set1.photos[0].canvasState.brightness).toBe(5);
  });

  it('does not roll back or raise a banner when a failed write was superseded', async () => {
    const result = await setup();
    const photoId = await seedPhoto(result);
    writeSpy.mockClear();

    // Only the FIRST session write fails; the retry of the same owed payload
    // (issued by the second call's task) succeeds.
    let failed = false;
    failWriteJSON = (_dir, name) => {
      if (name === SESSION_FILE && !failed) { failed = true; return new Error('transient'); }
      return null;
    };

    await act(async () => {
      const a = result.current.updatePhotoState('set1', photoId, { brightness: 11 });
      const b = result.current.updatePhotoState('set1', photoId, { brightness: 22 });
      await Promise.all([a, b]);
    });

    expect(result.current.session!.sets.set1.photos[0].canvasState.brightness).toBe(22);
    expect(result.current.error).toBeNull();
  });

  it('still rolls back and reports when the failed write was the last one', async () => {
    const result = await setup();
    const photoId = await seedPhoto(result);
    const before = result.current.session!.sets.set1.photos[0].canvasState.brightness;

    failWriteJSON = (_dir, name) => (name === SESSION_FILE ? new Error('disk full') : null);

    await act(async () => {
      await result.current.updatePhotoState('set1', photoId, { brightness: 33 });
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    // The ref rolled back, so React state never advanced to the phantom value.
    expect(result.current.session!.sets.set1.photos[0].canvasState.brightness).toBe(before);
  });

  it('does not resurrect a rolled-back edit at the next flush', async () => {
    // The counterpart to the test above: once the UI has told the user the
    // edit was NOT saved and rolled the ref back, the payload the service
    // still owed must be dropped too — otherwise the very next drain (tab
    // hidden, pagehide, competition switch) writes exactly the edit the
    // banner disowned, and it reappears after a reload.
    const result = await setup();
    const photoId = await seedPhoto(result);
    const competitionId = result.current.currentCompetition!.id;
    const before = result.current.session!.sets.set1.photos[0].canvasState.brightness;

    failWriteJSON = (_dir, name) => (name === SESSION_FILE ? new Error('disk full') : null);
    await act(async () => {
      await result.current.updatePhotoState('set1', photoId, { brightness: 44 });
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());

    // Storage recovers. A retry is exactly what flush is FOR — but not of a
    // payload whose author already disowned it.
    failWriteJSON = null;
    await act(async () => { await result.current.flushPersistence(); });

    const persisted = await readPersisted(competitionId);
    expect(persisted!.sets.set1.photos[0].canvasState.brightness).toBe(before);
    expect(result.current.session!.sets.set1.photos[0].canvasState.brightness).toBe(before);
  });

  it('flushPersistence delegates to the service and swallows its failure', async () => {
    const result = await setup();
    const { competitionService } = await import('../services/competitionService');

    const flushSpy = vi.spyOn(competitionService, 'flushPendingWrites').mockResolvedValue(undefined);
    await act(async () => { await result.current.flushPersistence(); });
    expect(flushSpy).toHaveBeenCalledTimes(1);

    flushSpy.mockRejectedValueOnce(new Error('storage gone'));
    await act(async () => {
      await expect(result.current.flushPersistence()).resolves.toBeUndefined();
    });
    expect(result.current.error).toBeNull();
  });

  it('writes photo bytes only when the photo LIST changed, not on canvas edits', async () => {
    const result = await setup();
    // Adding photos changes the id list → bytes are written.
    await act(async () => { await result.current.addPhotosToSet([makeFile('a.jpg')], 'set1'); });
    expect(savePhotoSpy.mock.calls.length).toBeGreaterThan(0);

    const photoId = result.current.session!.sets.set1.photos[0].id;
    savePhotoSpy.mockClear();

    // A canvas edit touches no ids → `samePhotoIds` says nothing changed.
    await act(async () => {
      await result.current.updatePhotoState('set1', photoId, { brightness: 15 });
    });
    expect(savePhotoSpy).not.toHaveBeenCalled();
  });

  // The three navigation choke points. A mode switch is observable through the
  // blob-URL stripping it does (below); create / switch / delete are not — the
  // add's queued task normally wins the race anyway — so what is pinned here is
  // the ORDER, which is the actual contract: nothing that revokes blob URLs,
  // reassigns the active competition or writes a tombstone may run before the
  // owed payloads have been drained.
  it.each([
    ['createNewCompetition', 'createCompetition' as const,
      (r: Awaited<ReturnType<typeof setup>>) => r.current.createNewCompetition('Next')],
    ['switchToCompetition', 'setActiveCompetition' as const,
      (r: Awaited<ReturnType<typeof setup>>, other: string) => r.current.switchToCompetition(other)],
    ['deleteCompetition', 'deleteCompetition' as const,
      (r: Awaited<ReturnType<typeof setup>>, other: string) => r.current.deleteCompetition(other)],
  ])('%s drains owed writes first', async (_name, serviceMethod, run) => {
    const result = await setup();
    const first = result.current.currentCompetition!.id;
    // A second competition, so switch/delete have a real target that is not
    // the one the pending payload belongs to.
    await act(async () => { await result.current.createNewCompetition('Second'); });

    const { competitionService } = await import('../services/competitionService');
    const flushSpy = vi.spyOn(competitionService, 'flushPendingWrites');
    const opSpy = vi.spyOn(competitionService, serviceMethod);

    await act(async () => { await run(result, first); });

    expect(opSpy).toHaveBeenCalled();
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(flushSpy.mock.invocationCallOrder[0])
      .toBeLessThan(opSpy.mock.invocationCallOrder[0]);
  });

  it('flushes owed photo bytes before a mode switch strips the blob URLs', async () => {
    const result = await setup();
    const competitionId = result.current.currentCompetition!.id;

    // The add is deliberately NOT awaited: its payload carries live `blob:`
    // URLs, and the mode switch below blanks them. The drain has to happen
    // while they are still fetchable.
    await act(async () => {
      const adding = result.current.addPhotosToSet([makeFile('a.jpg')], 'set1');
      await result.current.updateSessionMode('turningpoint');
      await adding;
    });

    const photoEntries = await storageMock.listDirectory(
      { path: `/competitions/${competitionId}/photos` } as DirectoryHandle,
    );
    expect(photoEntries.filter(e => !e.isDirectory).length).toBeGreaterThan(0);
  });
});

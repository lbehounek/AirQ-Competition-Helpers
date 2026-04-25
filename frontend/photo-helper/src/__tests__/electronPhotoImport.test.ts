import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  base64ToUint8Array,
  getCompetitionIdFromUrl,
  isElectronPhotoImportAvailable,
  openPhotosViaElectron,
} from '../utils/electronPhotoImport';

// `electronPhotoImport.openPhotosViaElectron` is the entry point for
// every photo-helper dropzone in the desktop bundle. The original
// implementation silently swallowed per-file read failures (4 of 9
// photos vanish without a peep) AND silently swallowed dialog errors
// (click → nothing). These tests pin the failure-surfacing contract:
// failures land in `result.failures`, never lost.

type ElectronAPI = NonNullable<Window['electronAPI']>;

function setElectronAPI(api: Partial<ElectronAPI> | undefined) {
  if (api === undefined) {
    delete (window as { electronAPI?: ElectronAPI }).electronAPI;
  } else {
    (window as { electronAPI?: ElectronAPI }).electronAPI = api as ElectronAPI;
  }
}

function setUrlSearch(search: string) {
  // jsdom keeps the same Location across tests; we patch only the
  // `search` getter so other test files aren't affected.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, search },
    writable: true,
  });
}

describe('base64ToUint8Array', () => {
  it('round-trips ASCII bytes', () => {
    const input = 'hello world';
    const b64 = btoa(input);
    const bytes = base64ToUint8Array(b64);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe(input);
  });

  it('round-trips empty string', () => {
    expect(base64ToUint8Array('').length).toBe(0);
  });

  it('throws on invalid base64', () => {
    // `atob` throws InvalidCharacterError on malformed input. Don't
    // swallow — let the caller's per-file try/catch report it as a
    // failure (better than silently returning empty bytes).
    expect(() => base64ToUint8Array('not!base64!!')).toThrow();
  });

  it('preserves non-ASCII byte values', () => {
    const expected = new Uint8Array([0xff, 0x00, 0x80, 0x7f]);
    const b64 = btoa(String.fromCharCode(...expected));
    expect(Array.from(base64ToUint8Array(b64))).toEqual(Array.from(expected));
  });
});

describe('getCompetitionIdFromUrl', () => {
  afterEach(() => setUrlSearch(''));

  it('returns null when the param is absent', () => {
    setUrlSearch('?foo=bar');
    expect(getCompetitionIdFromUrl()).toBeNull();
  });

  it('returns null when the param is empty', () => {
    setUrlSearch('?competitionId=');
    expect(getCompetitionIdFromUrl()).toBeNull();
  });

  it('returns the value when present', () => {
    setUrlSearch('?competitionId=abc-123');
    expect(getCompetitionIdFromUrl()).toBe('abc-123');
  });

  it('returns null for empty search string', () => {
    setUrlSearch('');
    expect(getCompetitionIdFromUrl()).toBeNull();
  });

  it('handles multiple params with competitionId in any position', () => {
    setUrlSearch('?discipline=rally&competitionId=race-1&foo=bar');
    expect(getCompetitionIdFromUrl()).toBe('race-1');
  });
});

describe('isElectronPhotoImportAvailable', () => {
  afterEach(() => setElectronAPI(undefined));

  it('returns false when electronAPI is missing', () => {
    setElectronAPI(undefined);
    expect(isElectronPhotoImportAvailable()).toBe(false);
  });

  it('returns false when only one IPC is exposed', () => {
    setElectronAPI({ openPhotos: vi.fn() } as Partial<ElectronAPI>);
    expect(isElectronPhotoImportAvailable()).toBe(false);
  });

  it('returns true when both required IPCs are functions', () => {
    setElectronAPI({
      openPhotos: vi.fn(),
      readPhotoFile: vi.fn(),
    } as Partial<ElectronAPI>);
    expect(isElectronPhotoImportAvailable()).toBe(true);
  });
});

describe('openPhotosViaElectron', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setUrlSearch('?competitionId=test-comp');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    setElectronAPI(undefined);
    setUrlSearch('');
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  it('returns empty result when electronAPI is unavailable (web build)', async () => {
    setElectronAPI(undefined);
    const result = await openPhotosViaElectron(9);
    expect(result.files).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.cancelled).toBe(true);
  });

  it('returns empty result when openPhotos returns []', async () => {
    setElectronAPI({
      openPhotos: vi.fn(async () => []),
      readPhotoFile: vi.fn(),
      competitions: { setWorkingDir: vi.fn() },
    });
    const result = await openPhotosViaElectron(9);
    expect(result.files).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.cancelled).toBe(true);
  });

  it('reads all picked files in parallel and returns reconstructed File objects', async () => {
    const path1 = '/photos/a.jpg';
    const path2 = '/photos/b.png';
    const readPhotoFile = vi.fn(async (p: string) => ({
      name: p.split('/').pop()!,
      mimeType: p.endsWith('.png') ? 'image/png' : 'image/jpeg',
      base64: btoa('fake-bytes'),
    }));
    setElectronAPI({
      openPhotos: vi.fn(async () => [path1, path2]),
      readPhotoFile,
      competitions: { setWorkingDir: vi.fn(async () => undefined) },
    });

    const result = await openPhotosViaElectron(9);

    expect(result.files).toHaveLength(2);
    expect(result.failures).toEqual([]);
    expect(result.cancelled).toBe(false);
    expect(result.files[0].name).toBe('a.jpg');
    expect(result.files[1].name).toBe('b.png');
    expect(result.files[1].type).toBe('image/png');
    expect(readPhotoFile).toHaveBeenCalledTimes(2);
  });

  it('captures per-file failures without losing successes (partial import)', async () => {
    const setWorkingDir = vi.fn(async () => undefined);
    setElectronAPI({
      openPhotos: vi.fn(async () => ['/a.jpg', '/b.jpg', '/c.jpg']),
      readPhotoFile: vi.fn(async (p: string) => {
        if (p === '/b.jpg') throw new Error('EACCES');
        return { name: p.slice(1), mimeType: 'image/jpeg', base64: btoa('x') };
      }),
      competitions: { setWorkingDir },
    });

    const result = await openPhotosViaElectron(9);

    expect(result.files).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].path).toBe('/b.jpg');
    expect((result.failures[0].error as Error).message).toBe('EACCES');
    // Working dir is still persisted — we use the FIRST SUCCESSFUL
    // path's dirname, not the failed one.
    expect(setWorkingDir).toHaveBeenCalledWith('test-comp', '/');
  });

  it('treats a null/empty readPhotoFile response as a failure', async () => {
    const setWorkingDir = vi.fn(async () => undefined);
    setElectronAPI({
      openPhotos: vi.fn(async () => ['/x.jpg']),
      readPhotoFile: vi.fn(async () => null),
      competitions: { setWorkingDir },
    });
    const result = await openPhotosViaElectron(9);
    expect(result.files).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].path).toBe('/x.jpg');
    // No successful reads → don't persist a workingDir we couldn't import from.
    expect(setWorkingDir).not.toHaveBeenCalled();
  });

  it('does NOT persist workingDir when ALL reads fail', async () => {
    // Persisting a directory we couldn't actually import from would
    // mislead the next dialog into a folder the user is already
    // having trouble with.
    const setWorkingDir = vi.fn(async () => undefined);
    setElectronAPI({
      openPhotos: vi.fn(async () => ['/bad/a.jpg', '/bad/b.jpg']),
      readPhotoFile: vi.fn(async () => { throw new Error('EACCES'); }),
      competitions: { setWorkingDir },
    });

    const result = await openPhotosViaElectron(9);

    expect(result.files).toEqual([]);
    expect(result.failures).toHaveLength(2);
    expect(setWorkingDir).not.toHaveBeenCalled();
  });

  it('seeds workingDir from the FIRST successful read, skipping a failed leading file', async () => {
    // Picks: [bad, good1, good2]. First successful path is good1 — its
    // dirname is what we persist, NOT the failed leading file's dirname.
    const setWorkingDir = vi.fn(async () => undefined);
    setElectronAPI({
      openPhotos: vi.fn(async () => ['/bad/a.jpg', '/good/b.jpg', '/good/c.jpg']),
      readPhotoFile: vi.fn(async (p: string) => {
        if (p === '/bad/a.jpg') throw new Error('EACCES');
        return { name: p.split('/').pop()!, mimeType: 'image/jpeg', base64: btoa('x') };
      }),
      competitions: { setWorkingDir },
    });

    await openPhotosViaElectron(9);

    expect(setWorkingDir).toHaveBeenCalledWith('test-comp', '/good');
  });

  it('flags workingDirPersistFailed when setWorkingDir rejects', async () => {
    const setWorkingDir = vi.fn(async () => { throw new Error('EACCES on config.json'); });
    setElectronAPI({
      openPhotos: vi.fn(async () => ['/photos/img.jpg']),
      readPhotoFile: vi.fn(async () => ({
        name: 'img.jpg', mimeType: 'image/jpeg', base64: btoa('x'),
      })),
      competitions: { setWorkingDir },
    });

    const result = await openPhotosViaElectron(9);

    // Import itself succeeded — failure is on persistence side only.
    expect(result.files).toHaveLength(1);
    expect(result.failures).toEqual([]);
    expect(result.workingDirPersistFailed).toBe(true);
  });

  it('skips workingDir persistence when no competitionId is on the URL', async () => {
    setUrlSearch('?foo=bar');
    const setWorkingDir = vi.fn();
    setElectronAPI({
      openPhotos: vi.fn(async () => ['/x.jpg']),
      readPhotoFile: vi.fn(async () => ({
        name: 'x.jpg', mimeType: 'image/jpeg', base64: btoa('x'),
      })),
      competitions: { setWorkingDir },
    });

    const result = await openPhotosViaElectron(9);

    expect(result.files).toHaveLength(1);
    expect(setWorkingDir).not.toHaveBeenCalled();
  });

  it('seeds the dialog with the persisted workingDir when getWorkingDir returns one', async () => {
    const openPhotos = vi.fn(async () => []);
    setElectronAPI({
      openPhotos,
      readPhotoFile: vi.fn(),
      competitions: {
        getWorkingDir: vi.fn(async () => '/persisted/dir'),
        setWorkingDir: vi.fn(),
      },
    });

    await openPhotosViaElectron(9);

    expect(openPhotos).toHaveBeenCalledWith('/persisted/dir', 9);
  });

  it('falls back to undefined defaultDir when getWorkingDir rejects', async () => {
    const openPhotos = vi.fn(async () => []);
    setElectronAPI({
      openPhotos,
      readPhotoFile: vi.fn(),
      competitions: {
        getWorkingDir: vi.fn(async () => { throw new Error('IPC down'); }),
        setWorkingDir: vi.fn(),
      },
    });

    await openPhotosViaElectron(9);

    expect(openPhotos).toHaveBeenCalledWith(undefined, 9);
    // getWorkingDir failure should be debug-level, NOT user-facing
    expect(consoleDebugSpy).toHaveBeenCalled();
  });
});

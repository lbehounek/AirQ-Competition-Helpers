import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElectronStorage, type ElectronStorageAPI, type DirectoryHandle } from '@airq/shared-storage';

// The candidate thumbnail tier only regenerates a thumb when `getPhotoThumb`
// resolves to null, and the shared helper only converts an error to null when
// its `name` is 'NotFoundError' (the OPFS shape). Electron's main process
// signals a miss with a REJECTION carrying a `NotFound:` marker, which
// `ipcRenderer.invoke` rewraps — these tests pin the renderer-side mapping in
// both directions, so a genuine read fault is never silently swallowed.

const photosDir: DirectoryHandle = { path: '/photos' };

interface ApiMocks {
  getPhotoBlob: ReturnType<typeof vi.fn>;
  getDirectoryHandle: ReturnType<typeof vi.fn>;
}

let api: ApiMocks;
let storage: ElectronStorage;

beforeEach(() => {
  api = {
    getPhotoBlob: vi.fn(),
    getDirectoryHandle: vi.fn(async (parentPath: string, name: string) => `${parentPath}/${name}`),
  };
  (window as { electronAPI?: ElectronStorageAPI }).electronAPI = {
    isElectron: true,
    storage: api as unknown as ElectronStorageAPI['storage'],
  };
  storage = new ElectronStorage();
});

afterEach(() => {
  delete (window as { electronAPI?: ElectronStorageAPI }).electronAPI;
});

describe('ElectronStorage.getPhotoBlob — miss mapping', () => {
  it('maps the main-process NotFound rejection to a NotFoundError', async () => {
    // Verbatim renderer-side shape: Electron prefixes the handler's message.
    api.getPhotoBlob.mockRejectedValueOnce(
      new Error("Error invoking remote method 'storage-get-photo': Error: NotFound: no photo file for 'p1' in /photos"),
    );
    await expect(storage.getPhotoBlob(photosDir, 'p1')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });

  it('maps a null IPC result to a NotFoundError too (older main processes)', async () => {
    api.getPhotoBlob.mockResolvedValueOnce(null);
    await expect(storage.getPhotoBlob(photosDir, 'p1')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });

  it('rethrows a genuine read failure unchanged', async () => {
    const boom = new Error('EACCES: permission denied');
    api.getPhotoBlob.mockRejectedValueOnce(boom);
    await expect(storage.getPhotoBlob(photosDir, 'p1')).rejects.toBe(boom);
  });
});

describe('ElectronStorage.getPhotoThumb — the contract that mapping serves', () => {
  it('resolves to null for a missing thumb instead of rejecting', async () => {
    api.getPhotoBlob.mockRejectedValue(
      new Error("Error invoking remote method 'storage-get-photo': Error: NotFound: no photo file for 'p1.jpg' in /photos/thumbs"),
    );
    await expect(storage.getPhotoThumb(photosDir, 'p1')).resolves.toBeNull();
  });

  it('still propagates a non-NotFound read failure', async () => {
    api.getPhotoBlob.mockRejectedValue(new Error('EIO: i/o error'));
    await expect(storage.getPhotoThumb(photosDir, 'p1')).rejects.toThrow('EIO: i/o error');
  });
});

describe('ElectronStorage.getDirectoryHandle — miss mapping', () => {
  // `storage-get-directory` predates the shared `NotFound:` marker and rejects
  // with `Directory not found: <abs path>`; both wordings must map, so the
  // renderer keeps working whichever main process it is paired with.
  it.each([
    ["Error invoking remote method 'storage-get-directory': Error: Directory not found: /photos/thumbs"],
    ["Error invoking remote method 'storage-get-directory': Error: NotFound: directory 'thumbs' in /photos"],
  ])('maps %# to a NotFoundError', async (message) => {
    api.getDirectoryHandle.mockRejectedValueOnce(new Error(message));
    await expect(storage.getDirectoryHandle(photosDir, 'thumbs', { create: false }))
      .rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('rethrows a genuine directory failure unchanged', async () => {
    const boom = new Error('EACCES: permission denied');
    api.getDirectoryHandle.mockRejectedValueOnce(boom);
    await expect(storage.getDirectoryHandle(photosDir, 'thumbs', { create: false })).rejects.toBe(boom);
  });
});

describe('ElectronStorage thumb helpers — a missing thumbs/ dir is "absent", not "broken"', () => {
  // The state of EVERY competition on desktop before its first thumb persist.
  const missingThumbsDir = () =>
    new Error("Error invoking remote method 'storage-get-directory': Error: Directory not found: /photos/thumbs");

  it('getPhotoThumb resolves to null instead of rejecting', async () => {
    api.getDirectoryHandle.mockRejectedValueOnce(missingThumbsDir());
    await expect(storage.getPhotoThumb(photosDir, 'p1')).resolves.toBeNull();
  });

  it('deletePhotoThumb resolves (idempotent), so a photo delete does not log a failure', async () => {
    api.getDirectoryHandle.mockRejectedValueOnce(missingThumbsDir());
    await expect(storage.deletePhotoThumb(photosDir, 'p1')).resolves.toBeUndefined();
  });

  it('still propagates a non-NotFound directory failure', async () => {
    api.getDirectoryHandle.mockRejectedValue(new Error('EIO: i/o error'));
    await expect(storage.getPhotoThumb(photosDir, 'p1')).rejects.toThrow('EIO: i/o error');
  });
});

describe('ElectronStorage.getPhotoBlob — base64 decode', () => {
  it('decodes the IPC payload byte-for-byte', async () => {
    // Non-ASCII bytes catch a charCode/byte mix-up that plain text would hide.
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 255]);
    const base64 = btoa(String.fromCharCode(...bytes));
    api.getPhotoBlob.mockResolvedValueOnce({ base64, mimeType: 'image/jpeg' });

    const blob = await storage.getPhotoBlob(photosDir, 'p1');
    expect(blob.type).toBe('image/jpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });
});

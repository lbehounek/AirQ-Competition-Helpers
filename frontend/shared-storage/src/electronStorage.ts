/**
 * Electron native filesystem storage implementation
 * Uses IPC to communicate with the main process for file operations
 */

import type {
  StorageInterface,
  DirectoryHandle,
  StorageHandles,
  SessionDirectoryHandles,
} from './types';
import {
  savePhotoThumb as savePhotoThumbImpl,
  getPhotoThumb as getPhotoThumbImpl,
  deletePhotoThumb as deletePhotoThumbImpl,
} from './photoThumbs';

/**
 * Create a DirectoryHandle from a path string (Electron)
 */
function createPathHandle(path: string): DirectoryHandle {
  return {
    path,
    _opfsHandle: undefined,
  };
}

/**
 * Convert a File to base64 for IPC transfer
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a base64 payload from the main process into a Blob.
 *
 * Returns a Blob of the decoded bytes with the given MIME type.
 *
 * Writes straight into a preallocated `Uint8Array` instead of filling a plain
 * `Array` first. That intermediate was the single most expensive step of an
 * Electron session load: a 5 MB photo produced a 5-million-entry JS array of
 * boxed numbers (tens of MB of transient heap, all of it garbage) on top of
 * the ~6.7 MB binary string `atob` already returns — repeated once per photo
 * while `loadSessionPhotos` walks every candidate. The loop below allocates
 * exactly one buffer of the final size.
 *
 * (The remaining 1.33x base64 string is inherent to the current IPC payload
 * shape; moving the channel to an ArrayBuffer/Buffer would remove it too.)
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const bytes = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    bytes[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Build a "this file/directory does not exist" error in the shape the rest of
 * the storage layer recognises.
 *
 * Returns a plain `Error` stamped with `name = 'NotFoundError'` — the name the
 * OPFS backend raises natively and the ONLY absence condition `photoThumbs.ts`
 * resolves to `null` instead of rethrowing. Subclassing `Error` is not an
 * option here: this package compiles with `erasableSyntaxOnly`.
 */
function notFoundError(message: string): Error {
  return Object.assign(new Error(message), { name: 'NotFoundError' });
}

/**
 * Does this rejection represent a main-process "no such file" miss?
 *
 * Returns true when the error message carries the `NotFound:` marker that
 * `storage-get-photo` throws (desktop/main.js). Matched with `includes`, not
 * `startsWith`, because Electron's `ipcRenderer.invoke` rewraps a handler
 * rejection as `Error invoking remote method '<channel>': Error: <message>`,
 * so the marker is never at position 0 in the renderer.
 */
function isNotFoundIpcError(err: unknown): boolean {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.includes('NotFound:');
}

/**
 * Does this rejection represent a main-process "no such directory" miss?
 *
 * Returns true for either marker: the shared `NotFound:` prefix, and the older
 * `Directory not found:` wording that `storage-get-directory` throws today
 * (desktop/main.js). Both are matched with `includes` for the same
 * `ipcRenderer.invoke` rewrapping reason as `isNotFoundIpcError`, and both are
 * accepted so the renderer keeps working against a main process that predates
 * the marker.
 */
function isMissingDirectoryIpcError(err: unknown): boolean {
  if (isNotFoundIpcError(err)) return true;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.includes('Directory not found:');
}

/**
 * Get the Electron storage API from the window object
 */
function getElectronAPI() {
  if (!window.electronAPI?.storage) {
    throw new Error('Electron storage API not available');
  }
  return window.electronAPI.storage;
}

/**
 * Electron native filesystem storage implementation
 */
export class ElectronStorage implements StorageInterface {
  async init(): Promise<StorageHandles> {
    const api = getElectronAPI();
    const { rootPath, sessionsPath } = await api.init();

    return {
      root: createPathHandle(rootPath),
      sessions: createPathHandle(sessionsPath),
    };
  }

  async ensureSessionDirs(sessionId: string): Promise<SessionDirectoryHandles> {
    const api = getElectronAPI();
    const { dirPath, photosPath } = await api.ensureSessionDirs(sessionId);

    return {
      dir: createPathHandle(dirPath),
      photos: createPathHandle(photosPath),
    };
  }

  async writeJSON(dir: DirectoryHandle, name: string, data: unknown): Promise<void> {
    const api = getElectronAPI();
    await api.writeJSON(dir.path, name, data);
  }

  async readJSON<T>(dir: DirectoryHandle, name: string): Promise<T | null> {
    const api = getElectronAPI();
    return await api.readJSON<T>(dir.path, name);
  }

  async savePhotoFile(photosDir: DirectoryHandle, photoId: string, file: File): Promise<void> {
    const api = getElectronAPI();
    const base64Data = await fileToBase64(file);
    const mimeType = file.type || 'image/jpeg';
    await api.savePhotoFile(photosDir.path, photoId, base64Data, mimeType);
  }

  async getPhotoBlob(photosDir: DirectoryHandle, photoId: string): Promise<Blob> {
    const api = getElectronAPI();

    // A miss MUST surface as a NotFoundError, not as a generic Error: the
    // shared `getPhotoThumb` helper only treats `name === 'NotFoundError'` as
    // "no thumb yet, regenerate" and rethrows everything else. Before this
    // mapping, every first-time thumb read on Electron looked like a real read
    // failure to callers (map-corridors logged a warning per missing thumb;
    // photo-helper's tray had to treat any rejection as a miss and so could
    // not distinguish a genuinely broken read).
    let result: Awaited<ReturnType<typeof api.getPhotoBlob>>;
    try {
      result = await api.getPhotoBlob(photosDir.path, photoId);
    } catch (err) {
      if (isNotFoundIpcError(err)) throw notFoundError(`Photo not found: ${photoId}`);
      throw err;
    }

    // Defensive: main-process builds older than the `NotFound:` rejection (and
    // test doubles for the IPC layer) resolve with null for a miss. Same shape.
    if (!result) {
      throw notFoundError(`Photo not found: ${photoId}`);
    }

    return base64ToBlob(result.base64, result.mimeType);
  }

  async deletePhotoFile(photosDir: DirectoryHandle, photoId: string): Promise<void> {
    const api = getElectronAPI();
    await api.deletePhotoFile(photosDir.path, photoId);
  }

  async savePhotoThumb(photosDir: DirectoryHandle, photoId: string, blob: Blob): Promise<void> {
    return savePhotoThumbImpl(this, photosDir, photoId, blob);
  }

  async getPhotoThumb(photosDir: DirectoryHandle, photoId: string): Promise<Blob | null> {
    return getPhotoThumbImpl(this, photosDir, photoId);
  }

  async deletePhotoThumb(photosDir: DirectoryHandle, photoId: string): Promise<void> {
    return deletePhotoThumbImpl(this, photosDir, photoId);
  }

  async clearDirectory(dir: DirectoryHandle): Promise<void> {
    const api = getElectronAPI();
    await api.clearDirectory(dir.path);
  }

  async deleteSessionDir(sessionId: string): Promise<void> {
    const api = getElectronAPI();
    await api.deleteSessionDir(sessionId);
  }

  async getDirectoryHandle(
    parent: DirectoryHandle,
    name: string,
    options?: { create?: boolean }
  ): Promise<DirectoryHandle> {
    const api = getElectronAPI();

    // Same mapping, same reason as `getPhotoBlob`: a `{ create: false }` miss
    // MUST surface as a NotFoundError. Three callers key on that name and
    // silently mis-behave without it on the desktop build —
    // `photoThumbs.getPhotoThumb` / `deletePhotoThumb` (a competition with no
    // `thumbs/` dir yet is the NORMAL state before the first thumb persist, and
    // rethrowing there makes every such read and every photo delete look like a
    // real I/O failure), and `competitionService.flushPendingWrites`, which only
    // drops an unwritable owed payload — a competition directory that is gone —
    // when it sees this name, and would otherwise retry it at every flush point
    // forever.
    let childPath: string;
    try {
      childPath = await api.getDirectoryHandle(parent.path, name, options?.create ?? false);
    } catch (err) {
      if (isMissingDirectoryIpcError(err)) throw notFoundError(`Directory not found: ${name}`);
      throw err;
    }
    return createPathHandle(childPath);
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Electron API is exposed
      if (!window.electronAPI?.storage) {
        return false;
      }

      // Try to initialize to verify it works
      await this.init();
      return true;
    } catch {
      return false;
    }
  }

  async getStorageEstimate(): Promise<{ usage: number | null; quota: number | null }> {
    try {
      const api = getElectronAPI();
      return await api.getStorageStats();
    } catch {
      return { usage: null, quota: null };
    }
  }

  async listDirectory(dir: DirectoryHandle): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const api = getElectronAPI();
    return await api.listDirectory(dir.path);
  }
}

// Export singleton instance
export const electronStorage = new ElectronStorage();

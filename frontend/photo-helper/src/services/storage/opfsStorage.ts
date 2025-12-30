/**
 * OPFS (Origin Private File System) storage implementation
 * Used for web browser storage
 */

import type {
  StorageInterface,
  DirectoryHandle,
  StorageHandles,
  SessionDirectoryHandles,
} from './types';

/**
 * Sanitize filename to prevent path traversal and invalid characters
 */
function sanitizeFileName(input: string): string {
  // Remove path separators and control characters
  const removedUnsafe = input
    .replace(/[\\/]/g, '-')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  // Replace any remaining unsafe characters with '-'
  const normalized = removedUnsafe.replace(/[^A-Za-z0-9._-]/g, '-');
  // Enforce a reasonable max length (e.g., 128)
  const truncated = normalized.slice(0, 128);
  // Ensure non-empty
  return truncated.length > 0 ? truncated : 'file';
}

/**
 * Create a DirectoryHandle wrapper from an OPFS FileSystemDirectoryHandle
 */
function wrapOPFSHandle(handle: FileSystemDirectoryHandle, path: string): DirectoryHandle {
  return {
    path,
    _opfsHandle: handle,
  };
}

/**
 * Get the underlying OPFS handle from a DirectoryHandle
 */
function unwrapOPFSHandle(handle: DirectoryHandle): FileSystemDirectoryHandle {
  if (!handle._opfsHandle) {
    throw new Error('Invalid directory handle: missing OPFS handle');
  }
  return handle._opfsHandle;
}

/**
 * OPFS Storage implementation
 */
export class OPFSStorage implements StorageInterface {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private sessionsHandle: FileSystemDirectoryHandle | null = null;

  async init(): Promise<StorageHandles> {
    const storage: any = (navigator as any).storage;
    if (!storage || typeof storage.getDirectory !== 'function') {
      throw new Error('OPFS not supported');
    }

    const root: FileSystemDirectoryHandle = await storage.getDirectory();
    const sessions = await root.getDirectoryHandle('sessions', { create: true });

    this.rootHandle = root;
    this.sessionsHandle = sessions;

    return {
      root: wrapOPFSHandle(root, '/'),
      sessions: wrapOPFSHandle(sessions, '/sessions'),
    };
  }

  async ensureSessionDirs(sessionId: string): Promise<SessionDirectoryHandles> {
    if (!this.sessionsHandle) {
      await this.init();
    }

    const dir = await this.sessionsHandle!.getDirectoryHandle(sessionId, { create: true });
    const photos = await dir.getDirectoryHandle('photos', { create: true });

    return {
      dir: wrapOPFSHandle(dir, `/sessions/${sessionId}`),
      photos: wrapOPFSHandle(photos, `/sessions/${sessionId}/photos`),
    };
  }

  async writeJSON(dir: DirectoryHandle, name: string, data: unknown): Promise<void> {
    const opfsDir = unwrapOPFSHandle(dir);
    const fh = await opfsDir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    await w.close();
  }

  async readJSON<T>(dir: DirectoryHandle, name: string): Promise<T | null> {
    try {
      const opfsDir = unwrapOPFSHandle(dir);
      const fh = await opfsDir.getFileHandle(name, { create: false });
      const file = await fh.getFile();
      const text = await file.text();
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async savePhotoFile(photosDir: DirectoryHandle, photoId: string, file: File): Promise<void> {
    const opfsDir = unwrapOPFSHandle(photosDir);
    const safeId = sanitizeFileName(photoId);
    if (safeId !== photoId) {
      console.warn(`Sanitized photoId for save: '${photoId}' -> '${safeId}'`);
    }
    const fh = await opfsDir.getFileHandle(safeId, { create: true });
    const w = await fh.createWritable();
    await w.write(file);
    await w.close();
  }

  async getPhotoBlob(photosDir: DirectoryHandle, photoId: string): Promise<Blob> {
    const opfsDir = unwrapOPFSHandle(photosDir);
    const safeId = sanitizeFileName(photoId);
    if (safeId !== photoId) {
      console.warn(`Sanitized photoId for read: '${photoId}' -> '${safeId}'`);
    }
    const fh = await opfsDir.getFileHandle(safeId, { create: false });
    const file = await fh.getFile();
    return file;
  }

  async deletePhotoFile(photosDir: DirectoryHandle, photoId: string): Promise<void> {
    const opfsDir = unwrapOPFSHandle(photosDir);
    const safeId = sanitizeFileName(photoId);
    if (safeId !== photoId) {
      console.warn(`Sanitized photoId for delete: '${photoId}' -> '${safeId}'`);
    }
    await opfsDir.removeEntry(safeId);
  }

  async clearDirectory(dir: DirectoryHandle): Promise<void> {
    const opfsDir = unwrapOPFSHandle(dir);
    const anyDir: any = opfsDir as any;
    if (!anyDir?.entries) return;

    for await (const [name, handle] of anyDir.entries()) {
      try {
        await opfsDir.removeEntry(name, {
          recursive: (handle as any)?.kind === 'directory'
        });
      } catch {
        // best effort; ignore failures
      }
    }
  }

  async deleteSessionDir(sessionId: string): Promise<void> {
    if (!this.sessionsHandle) {
      await this.init();
    }

    const dirHandle: any = this.sessionsHandle as any;
    if (typeof dirHandle.removeEntry === 'function') {
      await dirHandle.removeEntry(sessionId, { recursive: true });
    } else {
      // Fallback: best effort (will throw if non-empty)
      await (this.sessionsHandle as any).removeEntry(sessionId);
    }
  }

  async getDirectoryHandle(
    parent: DirectoryHandle,
    name: string,
    options?: { create?: boolean }
  ): Promise<DirectoryHandle> {
    const opfsDir = unwrapOPFSHandle(parent);
    const child = await opfsDir.getDirectoryHandle(name, {
      create: options?.create ?? false
    });
    return wrapOPFSHandle(child, `${parent.path}/${name}`);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const storage: any = (navigator as any).storage;
      if (!storage || typeof storage.getDirectory !== 'function') return false;

      const root: any = await storage.getDirectory?.();
      if (!root?.getFileHandle || !root?.getDirectoryHandle) return false;

      // Test write capability
      const test = await root.getFileHandle('opfs-test.tmp', { create: true });
      if (!test?.createWritable) return false;

      const w = await test.createWritable();
      await w.write(new Blob([new Uint8Array([1, 2, 3])]));
      await w.close();

      try {
        await root.removeEntry('opfs-test.tmp');
      } catch {
        // Cleanup failed; still consider write support present
      }

      return true;
    } catch {
      return false;
    }
  }

  async getStorageEstimate(): Promise<{ usage: number | null; quota: number | null }> {
    try {
      const estimate: any = await (navigator as any).storage?.estimate?.();
      return {
        usage: estimate?.usage ?? null,
        quota: estimate?.quota ?? null,
      };
    } catch {
      return { usage: null, quota: null };
    }
  }

  async listDirectory(dir: DirectoryHandle): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const opfsDir = unwrapOPFSHandle(dir);
    const anyDir: any = opfsDir as any;
    const entries: Array<{ name: string; isDirectory: boolean }> = [];

    if (!anyDir?.entries) return entries;

    for await (const [name, handle] of anyDir.entries()) {
      entries.push({
        name,
        isDirectory: (handle as any)?.kind === 'directory',
      });
    }

    return entries;
  }
}

// Export singleton instance
export const opfsStorage = new OPFSStorage();

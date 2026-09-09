/**
 * An in-memory `StorageInterface` double.
 *
 * WHY it lives in `support/`: the write-path tests added for the persistence
 * work need the same adapter as `competitionServiceRoundtrip.test.ts` and
 * `useCompetitionSystem.candidates.test.tsx`, and a third hand-rolled copy of
 * a 100-line double is where the copies start disagreeing about edge cases
 * (this one's `NotFoundError` naming in particular is load-bearing — the
 * service distinguishes "already gone" from a real fault purely by `err.name`).
 *
 * Implements enough of the contract for the persistence paths: directory
 * lookup, JSON read/write, photo blob read/write/delete, list, clear, and the
 * storage estimate. Thumb methods delegate to the very helpers the real
 * backends use, so the double keeps the real `thumbs/` subdir + `.jpg` naming
 * rules instead of inventing a divergent layout.
 */

import type { DirectoryHandle, StorageInterface } from '@airq/shared-storage';
import {
  savePhotoThumb as savePhotoThumbImpl,
  getPhotoThumb as getPhotoThumbImpl,
  deletePhotoThumb as deletePhotoThumbImpl,
} from '@airq/shared-storage';

export type Entry =
  | { kind: 'dir'; children: Map<string, Entry> }
  | { kind: 'json'; data: unknown }
  | { kind: 'blob'; blob: Blob; mime: string };

export function makeDir(): Entry {
  return { kind: 'dir', children: new Map() };
}

/**
 * Resolve (or create) a child directory, mirroring real OPFS semantics.
 *
 * Throws a `NotFoundError`-named error when the directory is missing and
 * `create` is false — the exact signal the service branches on.
 */
export function ensureChildDir(parent: Entry, name: string, create: boolean): Entry {
  if (parent.kind !== 'dir') throw new Error('Not a directory');
  let child = parent.children.get(name);
  if (!child) {
    if (!create) {
      const err = new Error(`Directory missing: ${name}`);
      err.name = 'NotFoundError';
      throw err;
    }
    child = makeDir();
    parent.children.set(name, child);
  }
  if (child.kind !== 'dir') throw new Error(`Path is not a directory: ${name}`);
  return child;
}

export class InMemoryStorage implements StorageInterface {
  // Each directory handle has a stable `path` so the service can compare them
  // and the double can resolve back to the underlying entry.
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
    if (!file || file.kind !== 'blob') {
      const err = new Error(`Photo not found: ${photoId}`);
      err.name = 'NotFoundError';
      throw err;
    }
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

  async savePhotoThumb(photosDir: DirectoryHandle, photoId: string, blob: Blob) {
    return savePhotoThumbImpl(this, photosDir, photoId, blob);
  }

  async getPhotoThumb(photosDir: DirectoryHandle, photoId: string) {
    return getPhotoThumbImpl(this, photosDir, photoId);
  }

  async deletePhotoThumb(photosDir: DirectoryHandle, photoId: string) {
    return deletePhotoThumbImpl(this, photosDir, photoId);
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

  /**
   * Test-only: forget a directory entirely, as if it had been removed on
   * disk behind the service's back. Used to exercise the `NotFoundError`
   * branch of `flushPendingWrites`. Returns nothing; a path that does not
   * exist is silently ignored.
   */
  removeDirectory(path: string): void {
    const slash = path.lastIndexOf('/');
    const parentPath = slash <= 0 ? '/' : path.slice(0, slash);
    const name = path.slice(slash + 1);
    const parent = this.pathToEntry.get(parentPath);
    if (parent && parent.kind === 'dir') parent.children.delete(name);
    // Drop the cached handle mapping too, plus anything nested beneath it.
    for (const key of [...this.pathToEntry.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.pathToEntry.delete(key);
    }
  }
}

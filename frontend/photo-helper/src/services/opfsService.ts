const SESSION_STORAGE_KEY = 'airq-session-id';

export type OPFSHandles = {
  root: FileSystemDirectoryHandle;
  sessions: FileSystemDirectoryHandle;
};

export async function detectOPFSWriteSupport(): Promise<boolean> {
  try {
    const storage: any = (navigator as any).storage;
    if (!storage || typeof storage.getDirectory !== 'function') return false;
    const root: any = await storage.getDirectory?.();
    if (!root?.getFileHandle || !root?.getDirectoryHandle) return false;
    const test = await root.getFileHandle('opfs-test.tmp', { create: true });
    if (!test?.createWritable) return false;
    const w = await test.createWritable();
    await w.write(new Blob([new Uint8Array([1, 2, 3])]));
    await w.close();
    try {
      await root.removeEntry('opfs-test.tmp');
    } catch (e) {
      // Cleanup failed; still consider write support present
      // Optionally: console.debug('OPFS cleanup failed after test write', e);
    }
    return true;
  } catch {
    return false;
  }
}

export async function initOPFS(): Promise<OPFSHandles> {
  const storage: any = (navigator as any).storage;
  if (!storage || typeof storage.getDirectory !== 'function') {
    throw new Error('OPFS not supported');
  }
  const root: FileSystemDirectoryHandle = await storage.getDirectory();
  const sessions = await root.getDirectoryHandle('sessions', { create: true });
  return { root, sessions };
}

export async function ensureSessionDirs(
  handles: OPFSHandles,
  sessionId: string
): Promise<{ dir: FileSystemDirectoryHandle; photos: FileSystemDirectoryHandle }> {
  const dir = await handles.sessions.getDirectoryHandle(sessionId, { create: true });
  const photos = await dir.getDirectoryHandle('photos', { create: true });
  return { dir, photos };
}

export async function writeJSON(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: any
) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  await w.close();
}

export async function readJSON<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  try {
    const fh = await dir.getFileHandle(name, { create: false });
    const file = await fh.getFile();
    const text = await file.text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function savePhotoFile(
  photosDir: FileSystemDirectoryHandle,
  photoId: string,
  file: File
) {
  const safeId = sanitizeFileName(photoId);
  if (safeId !== photoId) {
    console.warn(`Sanitized photoId for save: '${photoId}' -> '${safeId}'`);
  }
  const fh = await photosDir.getFileHandle(safeId, { create: true });
  const w = await fh.createWritable();
  await w.write(file);
  await w.close();
}

export async function getPhotoBlob(
  photosDir: FileSystemDirectoryHandle,
  photoId: string
): Promise<Blob> {
  const safeId = sanitizeFileName(photoId);
  if (safeId !== photoId) {
    console.warn(`Sanitized photoId for read: '${photoId}' -> '${safeId}'`);
  }
  const fh = await photosDir.getFileHandle(safeId, { create: false });
  const file = await fh.getFile();
  return file;
}

export async function deletePhotoFile(
  photosDir: FileSystemDirectoryHandle,
  photoId: string
) {
  const safeId = sanitizeFileName(photoId);
  if (safeId !== photoId) {
    console.warn(`Sanitized photoId for delete: '${photoId}' -> '${safeId}'`);
  }
  await photosDir.removeEntry(safeId);
}

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

export async function clearDirectory(dir: FileSystemDirectoryHandle) {
  const anyDir: any = dir as any;
  if (!anyDir?.entries) return;
  for await (const [name, handle] of anyDir.entries()) {
    try {
      await dir.removeEntry(name, { recursive: (handle as any)?.kind === 'directory' });
    } catch {
      // best effort; ignore failures
    }
  }
}

export function loadOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

export async function deleteSessionDir(
  sessionsDir: FileSystemDirectoryHandle,
  sessionId: string
) {
  // Some implementations require { recursive: true } to delete non-empty dirs
  const dirHandle: any = sessionsDir as any;
  if (typeof dirHandle.removeEntry === 'function') {
    await dirHandle.removeEntry(sessionId, { recursive: true });
  } else {
    // Fallback: best effort (will throw if non-empty)
    await (sessionsDir as any).removeEntry(sessionId);
  }
}



// Phase 2 of photo-map-culling: thumbnail storage helpers.
// See docs/photo-map-culling/implementation-plan.md.
//
// These functions encapsulate the "thumbs are just photos in a subdir"
// pattern so both OPFSStorage and ElectronStorage delegate to identical
// behaviour without duplicating the subdir-navigation + filename rules.

import type { StorageInterface, DirectoryHandle } from './types';

/** Filename inside `thumbs/`. `.jpg` extension matches the generated MIME. */
function thumbFilename(photoId: string): string {
  return `${photoId}.jpg`;
}

/**
 * Save a thumbnail blob into the `thumbs/` subdirectory of the photos
 * directory. The subdirectory is created on demand.
 */
export async function savePhotoThumb(
  storage: StorageInterface,
  photosDir: DirectoryHandle,
  photoId: string,
  blob: Blob,
): Promise<void> {
  const thumbsDir = await storage.getDirectoryHandle(photosDir, 'thumbs', { create: true });
  const filename = thumbFilename(photoId);
  // savePhotoFile takes a File; wrap the Blob. Default to image/jpeg
  // because generateThumb always emits JPEG and an empty MIME on the
  // Blob would surface as application/octet-stream in some callers.
  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
  await storage.savePhotoFile(thumbsDir, filename, file);
}

// NotFoundError is the only "absence" condition that should silently
// resolve to null/undefined; anything else (permission revoked, OPFS
// InvalidStateError, quota issues, type errors) is a real failure and
// must surface so callers can react.
function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return name === 'NotFoundError';
}

/**
 * Read a thumbnail blob. Returns null when the `thumbs/` subdirectory
 * does not exist OR when the specific thumb file is missing — callers
 * regenerate from the original photo on miss. Other errors propagate.
 */
export async function getPhotoThumb(
  storage: StorageInterface,
  photosDir: DirectoryHandle,
  photoId: string,
): Promise<Blob | null> {
  try {
    const thumbsDir = await storage.getDirectoryHandle(photosDir, 'thumbs', { create: false });
    return await storage.getPhotoBlob(thumbsDir, thumbFilename(photoId));
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/**
 * Delete a thumbnail. Idempotent for "already gone" — does NOT throw
 * when the thumb or the `thumbs/` subdirectory does not exist. Cleanup
 * paths (failed import, photo rejection) shouldn't fail on already-
 * deleted state. Other errors propagate.
 */
export async function deletePhotoThumb(
  storage: StorageInterface,
  photosDir: DirectoryHandle,
  photoId: string,
): Promise<void> {
  try {
    const thumbsDir = await storage.getDirectoryHandle(photosDir, 'thumbs', { create: false });
    await storage.deletePhotoFile(thumbsDir, thumbFilename(photoId));
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}

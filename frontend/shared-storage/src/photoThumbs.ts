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

/**
 * Read a thumbnail blob. Returns null when the `thumbs/` subdirectory
 * does not exist OR when the specific thumb file is missing — callers
 * regenerate from the original photo on miss.
 */
export async function getPhotoThumb(
  storage: StorageInterface,
  photosDir: DirectoryHandle,
  photoId: string,
): Promise<Blob | null> {
  try {
    const thumbsDir = await storage.getDirectoryHandle(photosDir, 'thumbs', { create: false });
    return await storage.getPhotoBlob(thumbsDir, thumbFilename(photoId));
  } catch {
    return null;
  }
}

/**
 * Delete a thumbnail. Idempotent — does NOT throw when the thumb or the
 * `thumbs/` subdirectory does not exist. Cleanup paths (failed import,
 * photo rejection) shouldn't fail on already-deleted state.
 */
export async function deletePhotoThumb(
  storage: StorageInterface,
  photosDir: DirectoryHandle,
  photoId: string,
): Promise<void> {
  try {
    const thumbsDir = await storage.getDirectoryHandle(photosDir, 'thumbs', { create: false });
    await storage.deletePhotoFile(thumbsDir, thumbFilename(photoId));
  } catch {
    // No thumbs dir or thumb missing — silent.
  }
}

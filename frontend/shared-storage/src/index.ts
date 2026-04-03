/**
 * Storage abstraction layer
 *
 * Provides a unified interface for storage operations across:
 * - OPFS (Origin Private File System) for web browsers
 * - Native filesystem for Electron desktop apps
 *
 * Usage:
 *   import { getStorage, initStorage } from './services/storage';
 *
 *   // Initialize once at app startup
 *   await initStorage();
 *
 *   // Get the storage instance anywhere
 *   const storage = getStorage();
 *   await storage.writeJSON(dir, 'data.json', { key: 'value' });
 */

export type {
  StorageInterface,
  DirectoryHandle,
  StorageHandles,
  SessionDirectoryHandles,
  StorageType,
  ElectronStorageAPI,
} from './types';

import type { StorageInterface, StorageType } from './types';
import { OPFSStorage, opfsStorage } from './opfsStorage';
import { ElectronStorage, electronStorage } from './electronStorage';

// Singleton storage instance
let storageInstance: StorageInterface | null = null;
let detectedStorageType: StorageType | null = null;

/**
 * Detect whether we're running in Electron or browser
 */
export function detectStorageType(): StorageType {
  // Check if Electron API is available
  if (typeof window !== 'undefined' && window.electronAPI?.isElectron === true) {
    return 'electron';
  }
  return 'opfs';
}

/**
 * Get the detected storage type
 */
export function getStorageType(): StorageType {
  if (!detectedStorageType) {
    detectedStorageType = detectStorageType();
  }
  return detectedStorageType;
}

/**
 * Check if running in Electron environment
 */
export function isElectron(): boolean {
  return getStorageType() === 'electron';
}

/**
 * Get the appropriate storage implementation based on environment
 * This creates a new instance but does not initialize it
 */
export function createStorage(): StorageInterface {
  const type = getStorageType();

  if (type === 'electron') {
    return new ElectronStorage();
  }

  return new OPFSStorage();
}

/**
 * Get the singleton storage instance
 * Must call initStorage() first
 */
export function getStorage(): StorageInterface {
  if (!storageInstance) {
    throw new Error('Storage not initialized. Call initStorage() first.');
  }
  return storageInstance;
}

/**
 * Initialize the storage system
 * Detects environment and creates the appropriate storage implementation
 *
 * @returns The initialized storage instance
 */
export async function initStorage(): Promise<StorageInterface> {
  if (storageInstance) {
    return storageInstance;
  }

  const type = getStorageType();
  console.log(`Initializing storage: ${type}`);

  if (type === 'electron') {
    storageInstance = electronStorage;
  } else {
    storageInstance = opfsStorage;
  }

  // Initialize the storage
  await storageInstance.init();

  return storageInstance;
}

/**
 * Check if storage is available and writable
 * Useful for feature detection before using storage
 */
export async function isStorageAvailable(): Promise<boolean> {
  const type = getStorageType();

  if (type === 'electron') {
    return await electronStorage.isAvailable();
  }

  return await opfsStorage.isAvailable();
}

/**
 * Reset the storage instance (mainly for testing)
 */
export function resetStorage(): void {
  storageInstance = null;
  detectedStorageType = null;
}

// Re-export storage classes for direct use if needed
export { OPFSStorage, opfsStorage } from './opfsStorage';
export { ElectronStorage, electronStorage } from './electronStorage';

// ============================================================================
// Backward Compatibility Layer
// ============================================================================
// These exports maintain compatibility with existing code that imports from
// opfsService.ts. They delegate to the storage abstraction.

const SESSION_STORAGE_KEY = 'airq-session-id';

/**
 * Legacy type for OPFS handles (for backward compatibility)
 * @deprecated Use StorageHandles instead
 */
export type OPFSHandles = {
  root: FileSystemDirectoryHandle;
  sessions: FileSystemDirectoryHandle;
};

/**
 * Detect OPFS write support
 * @deprecated Use isStorageAvailable() instead
 */
export async function detectOPFSWriteSupport(): Promise<boolean> {
  return isStorageAvailable();
}

/**
 * Initialize OPFS storage
 * @deprecated Use initStorage() instead
 */
export async function initOPFS(): Promise<OPFSHandles> {
  const type = getStorageType();

  if (type === 'electron') {
    // For Electron, we return a mock that won't actually be used directly
    // The actual operations go through the storage abstraction
    await initStorage();
    return {
      root: {} as FileSystemDirectoryHandle,
      sessions: {} as FileSystemDirectoryHandle,
    };
  }

  // For OPFS, return actual handles for backward compatibility
  const storage = await initStorage();
  const handles = await storage.init();

  return {
    root: handles.root._opfsHandle!,
    sessions: handles.sessions._opfsHandle!,
  };
}

/**
 * Ensure session directories exist
 * @deprecated Use storage.ensureSessionDirs() instead
 */
export async function ensureSessionDirs(
  _handles: OPFSHandles,
  sessionId: string
): Promise<{ dir: FileSystemDirectoryHandle; photos: FileSystemDirectoryHandle }> {
  const storage = getStorage();
  const dirs = await storage.ensureSessionDirs(sessionId);

  const type = getStorageType();
  if (type === 'electron') {
    // For Electron, return mock handles that store the path
    // Create objects that act like FileSystemDirectoryHandle but store path info
    const mockDir = { _storagePath: dirs.dir.path } as any;
    const mockPhotos = { _storagePath: dirs.photos.path } as any;
    return { dir: mockDir, photos: mockPhotos };
  }

  return {
    dir: dirs.dir._opfsHandle!,
    photos: dirs.photos._opfsHandle!,
  };
}

/**
 * Helper to convert legacy FileSystemDirectoryHandle to DirectoryHandle
 */
function toDirectoryHandle(handle: FileSystemDirectoryHandle | any): import('./types').DirectoryHandle {
  // Check if it's already a DirectoryHandle-like object (from Electron mock)
  if (handle._storagePath) {
    return { path: handle._storagePath };
  }

  // It's a real OPFS handle
  return {
    path: handle.name || '/',
    _opfsHandle: handle,
  };
}

/**
 * Write JSON data
 * @deprecated Use storage.writeJSON() instead
 */
export async function writeJSON(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: any
): Promise<void> {
  const storage = getStorage();
  await storage.writeJSON(toDirectoryHandle(dir), name, data);
}

/**
 * Read JSON data
 * @deprecated Use storage.readJSON() instead
 */
export async function readJSON<T>(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<T | null> {
  const storage = getStorage();
  return storage.readJSON<T>(toDirectoryHandle(dir), name);
}

/**
 * Save photo file
 * @deprecated Use storage.savePhotoFile() instead
 */
export async function savePhotoFile(
  photosDir: FileSystemDirectoryHandle,
  photoId: string,
  file: File
): Promise<void> {
  const storage = getStorage();
  await storage.savePhotoFile(toDirectoryHandle(photosDir), photoId, file);
}

/**
 * Get photo blob
 * @deprecated Use storage.getPhotoBlob() instead
 */
export async function getPhotoBlob(
  photosDir: FileSystemDirectoryHandle,
  photoId: string
): Promise<Blob> {
  const storage = getStorage();
  return storage.getPhotoBlob(toDirectoryHandle(photosDir), photoId);
}

/**
 * Delete photo file
 * @deprecated Use storage.deletePhotoFile() instead
 */
export async function deletePhotoFile(
  photosDir: FileSystemDirectoryHandle,
  photoId: string
): Promise<void> {
  const storage = getStorage();
  await storage.deletePhotoFile(toDirectoryHandle(photosDir), photoId);
}

/**
 * Clear directory
 * @deprecated Use storage.clearDirectory() instead
 */
export async function clearDirectory(dir: FileSystemDirectoryHandle): Promise<void> {
  const storage = getStorage();
  await storage.clearDirectory(toDirectoryHandle(dir));
}

/**
 * Load or create session ID
 */
export function loadOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

/**
 * Delete session directory
 * @deprecated Use storage.deleteSessionDir() instead
 */
export async function deleteSessionDir(
  _sessionsDir: FileSystemDirectoryHandle,
  sessionId: string
): Promise<void> {
  const storage = getStorage();
  await storage.deleteSessionDir(sessionId);
}

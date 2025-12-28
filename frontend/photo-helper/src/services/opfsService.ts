/**
 * @deprecated This module is deprecated. Use './storage' instead.
 *
 * This file re-exports the storage abstraction layer for backward compatibility.
 * All new code should import from './storage' directly.
 */

export {
  // Types
  type OPFSHandles,
  type DirectoryHandle,
  type StorageHandles,
  type SessionDirectoryHandles,
  type StorageInterface,
  type StorageType,

  // Functions
  detectOPFSWriteSupport,
  initOPFS,
  ensureSessionDirs,
  writeJSON,
  readJSON,
  savePhotoFile,
  getPhotoBlob,
  deletePhotoFile,
  clearDirectory,
  loadOrCreateSessionId,
  deleteSessionDir,

  // New storage abstraction
  initStorage,
  getStorage,
  isStorageAvailable,
  isElectron,
  getStorageType,
  createStorage,
  resetStorage,

  // Storage implementations
  OPFSStorage,
  opfsStorage,
  ElectronStorage,
  electronStorage,
} from './storage';

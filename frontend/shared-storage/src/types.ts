/**
 * Storage abstraction layer type definitions
 * Provides a common interface for OPFS (web) and native filesystem (Electron) storage
 */

/**
 * Directory handle abstraction - represents a directory in the storage system
 * For OPFS: wraps FileSystemDirectoryHandle
 * For Electron: wraps a path string
 */
export interface DirectoryHandle {
  /** Unique identifier for the directory (path for Electron, internal ID for OPFS) */
  path: string;
  /** The underlying handle (FileSystemDirectoryHandle for OPFS, null for Electron) */
  _opfsHandle?: FileSystemDirectoryHandle;
}

/**
 * Session directory handles returned after ensuring session directories exist
 */
export interface SessionDirectoryHandles {
  /** The session root directory */
  dir: DirectoryHandle;
  /** The photos subdirectory within the session */
  photos: DirectoryHandle;
}

/**
 * Root storage handles returned after initialization
 */
export interface StorageHandles {
  /** The root storage directory */
  root: DirectoryHandle;
  /** The sessions directory (contains all session subdirectories) */
  sessions: DirectoryHandle;
}

/**
 * Storage interface that abstracts filesystem operations
 * Both OPFS and Electron implementations must conform to this interface
 */
export interface StorageInterface {
  /**
   * Initialize the storage system
   * @returns Root and sessions directory handles
   */
  init(): Promise<StorageHandles>;

  /**
   * Ensure session directories exist (creates if needed)
   * @param sessionId - The session identifier
   * @returns The session directory and photos subdirectory handles
   */
  ensureSessionDirs(sessionId: string): Promise<SessionDirectoryHandles>;

  /**
   * Write JSON data to a file
   * @param dir - Directory handle where the file should be written
   * @param name - Filename (e.g., 'session.json')
   * @param data - The data to serialize and write
   */
  writeJSON(dir: DirectoryHandle, name: string, data: unknown): Promise<void>;

  /**
   * Read JSON data from a file
   * @param dir - Directory handle where the file exists
   * @param name - Filename (e.g., 'session.json')
   * @returns Parsed JSON data or null if file doesn't exist
   */
  readJSON<T>(dir: DirectoryHandle, name: string): Promise<T | null>;

  /**
   * Save a photo file to the photos directory
   * @param photosDir - Directory handle for photos
   * @param photoId - Unique identifier for the photo (used as filename)
   * @param file - The File object to save
   */
  savePhotoFile(photosDir: DirectoryHandle, photoId: string, file: File): Promise<void>;

  /**
   * Get a photo as a Blob
   * @param photosDir - Directory handle for photos
   * @param photoId - Unique identifier for the photo
   * @returns The photo as a Blob
   */
  getPhotoBlob(photosDir: DirectoryHandle, photoId: string): Promise<Blob>;

  /**
   * Delete a photo file
   * @param photosDir - Directory handle for photos
   * @param photoId - Unique identifier for the photo to delete
   */
  deletePhotoFile(photosDir: DirectoryHandle, photoId: string): Promise<void>;

  /**
   * Clear all contents of a directory
   * @param dir - Directory handle to clear
   */
  clearDirectory(dir: DirectoryHandle): Promise<void>;

  /**
   * Delete a session directory and all its contents
   * @param sessionId - The session identifier to delete
   */
  deleteSessionDir(sessionId: string): Promise<void>;

  /**
   * Get a directory handle within a parent directory
   * @param parent - Parent directory handle
   * @param name - Name of the subdirectory
   * @param options - Options including whether to create if missing
   * @returns The directory handle
   */
  getDirectoryHandle(
    parent: DirectoryHandle,
    name: string,
    options?: { create?: boolean }
  ): Promise<DirectoryHandle>;

  /**
   * Check if the storage system is available and writable
   * @returns true if storage is available and functional
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get storage usage statistics
   * @returns Storage usage and quota information
   */
  getStorageEstimate(): Promise<{
    usage: number | null;
    quota: number | null;
  }>;

  /**
   * List entries in a directory
   * @param dir - Directory handle to list
   * @returns Array of entry names and their types
   */
  listDirectory(dir: DirectoryHandle): Promise<Array<{ name: string; isDirectory: boolean }>>;
}

/**
 * Storage type identifier
 */
export type StorageType = 'opfs' | 'electron';

/**
 * Electron IPC API for storage operations (exposed via preload.js)
 */
export interface ElectronStorageAPI {
  isElectron: true;
  storage: {
    init: () => Promise<{ rootPath: string; sessionsPath: string }>;
    ensureSessionDirs: (sessionId: string) => Promise<{ dirPath: string; photosPath: string }>;
    writeJSON: (dirPath: string, name: string, data: unknown) => Promise<void>;
    readJSON: <T>(dirPath: string, name: string) => Promise<T | null>;
    savePhotoFile: (photosPath: string, photoId: string, base64Data: string, mimeType: string) => Promise<void>;
    getPhotoBlob: (photosPath: string, photoId: string) => Promise<{ base64: string; mimeType: string } | null>;
    deletePhotoFile: (photosPath: string, photoId: string) => Promise<void>;
    clearDirectory: (dirPath: string) => Promise<void>;
    deleteSessionDir: (sessionId: string) => Promise<void>;
    getDirectoryHandle: (parentPath: string, name: string, create: boolean) => Promise<string>;
    listDirectory: (dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean }>>;
    getStorageStats: () => Promise<{ usage: number | null; quota: number | null }>;
  };
}

/**
 * Extended window interface for Electron environment
 */
declare global {
  interface Window {
    electronAPI?: ElectronStorageAPI;
  }
}

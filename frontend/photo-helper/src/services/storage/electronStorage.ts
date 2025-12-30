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
 * Convert base64 to Blob
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
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
  private rootPath: string | null = null;
  private sessionsPath: string | null = null;

  async init(): Promise<StorageHandles> {
    const api = getElectronAPI();
    const { rootPath, sessionsPath } = await api.init();

    this.rootPath = rootPath;
    this.sessionsPath = sessionsPath;

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
    const result = await api.getPhotoBlob(photosDir.path, photoId);

    if (!result) {
      throw new Error(`Photo not found: ${photoId}`);
    }

    return base64ToBlob(result.base64, result.mimeType);
  }

  async deletePhotoFile(photosDir: DirectoryHandle, photoId: string): Promise<void> {
    const api = getElectronAPI();
    await api.deletePhotoFile(photosDir.path, photoId);
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
    const childPath = await api.getDirectoryHandle(parent.path, name, options?.create ?? false);
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

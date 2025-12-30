const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Navigate to a specific app
  navigateToApp: (appName) => ipcRenderer.invoke('navigate-to-app', appName),

  // Go back to the home/landing page
  goHome: () => ipcRenderer.invoke('go-home'),

  // Config management
  getConfig: (key) => ipcRenderer.invoke('get-config', key),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),

  // Open external URL in default browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Open Mapbox token settings dialog
  openMapboxSettings: () => ipcRenderer.invoke('open-mapbox-settings'),

  // Update menu language
  setMenuLocale: (locale) => ipcRenderer.invoke('set-menu-locale', locale),

  // Check if running in Electron
  isElectron: true,

  // Get platform information
  platform: process.platform,

  // Storage API for photo sessions
  storage: {
    // Initialize storage - creates root and sessions directories
    init: () => ipcRenderer.invoke('storage-init'),

    // Ensure session directories exist
    ensureSessionDirs: (sessionId) => ipcRenderer.invoke('storage-ensure-session-dirs', sessionId),

    // Write JSON data to a file
    writeJSON: (dirPath, name, data) => ipcRenderer.invoke('storage-write-json', dirPath, name, data),

    // Read JSON data from a file
    readJSON: (dirPath, name) => ipcRenderer.invoke('storage-read-json', dirPath, name),

    // Save a photo file (base64 encoded)
    savePhotoFile: (photosPath, photoId, base64Data, mimeType) =>
      ipcRenderer.invoke('storage-save-photo', photosPath, photoId, base64Data, mimeType),

    // Get a photo as base64
    getPhotoBlob: (photosPath, photoId) => ipcRenderer.invoke('storage-get-photo', photosPath, photoId),

    // Delete a photo file
    deletePhotoFile: (photosPath, photoId) => ipcRenderer.invoke('storage-delete-photo', photosPath, photoId),

    // Clear a directory (remove all contents)
    clearDirectory: (dirPath) => ipcRenderer.invoke('storage-clear-directory', dirPath),

    // Delete a session directory
    deleteSessionDir: (sessionId) => ipcRenderer.invoke('storage-delete-session', sessionId),

    // Get a directory handle (create if needed)
    getDirectoryHandle: (parentPath, name, create) =>
      ipcRenderer.invoke('storage-get-directory', parentPath, name, create),

    // List directory contents
    listDirectory: (dirPath) => ipcRenderer.invoke('storage-list-directory', dirPath),

    // Get storage statistics
    getStorageStats: () => ipcRenderer.invoke('storage-get-stats')
  }
});

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Navigate to a specific app (with optional competition context)
  navigateToApp: (appName, competitionId) => ipcRenderer.invoke('navigate-to-app', appName, competitionId),

  // Go back to the home/landing page
  goHome: () => ipcRenderer.invoke('go-home'),

  // Config management
  getConfig: (key) => ipcRenderer.invoke('get-config', key),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),

  // Open external URL in default browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Open Mapbox token settings dialog
  openMapboxSettings: () => ipcRenderer.invoke('open-mapbox-settings'),

  // Open Mapy.cz API-key settings dialog (Czech maps provider — feedback 2026-04-18)
  openMapySettings: () => ipcRenderer.invoke('open-mapy-settings'),

  // Update menu language
  setMenuLocale: (locale) => ipcRenderer.invoke('set-menu-locale', locale),

  // Competition management
  competitions: {
    list: () => ipcRenderer.invoke('competition-list'),
    create: (name) => ipcRenderer.invoke('competition-create', name),
    setActive: (id) => ipcRenderer.invoke('competition-set-active', id),
    setDiscipline: (id, discipline) => ipcRenderer.invoke('competition-set-discipline', id, discipline),
    delete: (id) => ipcRenderer.invoke('competition-delete', id),
    // Per-competition working folder: every export dialog defaults here
    // (feedback 2026-04-25). Persisted in the competitions index.
    setWorkingDir: (id, workingDir) => ipcRenderer.invoke('competition-set-working-dir', id, workingDir),
    getWorkingDir: (id) => ipcRenderer.invoke('competition-get-working-dir', id),
  },

  // Save map print image via native save dialog
  saveMapImage: (base64Data, defaultDir) => ipcRenderer.invoke('save-map-image', base64Data, defaultDir),

  // Save a photo-sheet PDF via native save dialog. defaultDir is the
  // competition's working folder (set when the user imports a KML).
  savePdf: (base64Data, fileName, defaultDir) =>
    ipcRenderer.invoke('save-pdf', base64Data, fileName, defaultDir),

  // Photo import via native open dialog. Returns the list of file paths
  // the user picked (capped at maxFiles). Renderer then calls
  // `readPhotoFile` for each path to reconstruct File objects.
  openPhotos: (defaultDir, maxFiles) =>
    ipcRenderer.invoke('open-photos', defaultDir, maxFiles),
  readPhotoFile: (filePath) => ipcRenderer.invoke('read-photo-file', filePath),

  // Save KML text via native save dialog. The renderer passes the directory
  // the source KML was imported from (see `getPathForFile`) so the export
  // dialog lands in the user's own project folder (feedback 2026-04-23).
  saveKml: (kmlText, fileName, defaultDir, competitionId) =>
    ipcRenderer.invoke('save-kml', kmlText, fileName, defaultDir, competitionId),

  // Resolve the full filesystem path of a File picked / dropped in the
  // renderer. Electron 32+ removed `File.path`; webUtils replaces it.
  // Returns '' if the File has no disk backing (e.g. generated Blob).
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch { return ''; }
  },

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

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

  // Check if running in Electron
  isElectron: true,

  // Get platform information
  platform: process.platform
});

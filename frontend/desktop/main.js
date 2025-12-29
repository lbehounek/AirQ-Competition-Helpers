const { app, BrowserWindow, protocol, ipcMain, shell, globalShortcut, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Config file path in user data directory
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Load config from file
function loadConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return {};
}

// Save config to file
function saveConfig(config) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save config:', e);
    return false;
  }
}

// Get a config value
function getConfigValue(key) {
  const config = loadConfig();
  return config[key];
}

// Set a config value
function setConfigValue(key, value) {
  const config = loadConfig();
  config[key] = value;
  return saveConfig(config);
}

// Register app:// protocol as privileged before app is ready
// This enables OPFS and other browser APIs that require a secure origin
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

// Keep a global reference of the window object
let mainWindow;

// Determine if we're in development or production
const isDev = !app.isPackaged;

// Get the base path for serving static files
function getResourcePath() {
  if (isDev) {
    return path.join(__dirname, '..');
  }
  return path.join(process.resourcesPath);
}

// Create custom protocol to serve local files
function setupProtocol() {
  protocol.registerFileProtocol('app', (request, callback) => {
    let url = request.url.replace('app://', '');

    // Decode URL
    url = decodeURIComponent(url);

    // Remove leading slash on Windows
    if (process.platform === 'win32' && url.startsWith('/')) {
      url = url.substring(1);
    }

    // Determine which app to serve
    const resourcePath = getResourcePath();
    let filePath;

    if (url.startsWith('photo-helper/')) {
      if (isDev) {
        filePath = path.join(resourcePath, 'photo-helper', 'dist', url.replace('photo-helper/', ''));
      } else {
        filePath = path.join(resourcePath, 'photo-helper', url.replace('photo-helper/', ''));
      }
    } else if (url.startsWith('map-corridors/')) {
      if (isDev) {
        filePath = path.join(resourcePath, 'map-corridors', 'dist', url.replace('map-corridors/', ''));
      } else {
        filePath = path.join(resourcePath, 'map-corridors', url.replace('map-corridors/', ''));
      }
    } else if (url.startsWith('home/')) {
      // Handle home/ path for landing page (fixes Windows URL resolution)
      filePath = path.join(__dirname, 'renderer', url.replace('home/', ''));
    } else {
      // Fallback for any other renderer assets
      filePath = path.join(__dirname, 'renderer', url);
    }

    // For SPA routing in photo-helper and map-corridors, check if file exists
    // Only do this check for the apps, not for the landing page
    // Note: Use require('original-fs') for asar-compatible file checks, or just skip the check
    // and let the protocol handler return a 404 naturally
    if (url.startsWith('photo-helper/') || url.startsWith('map-corridors/')) {
      // Try to check if file exists, with fallback for asar archives
      let fileExists = false;
      try {
        // In packaged app, fs.existsSync may not work for asar files
        // Use synchronous stat which works with asar
        fs.statSync(filePath);
        fileExists = true;
      } catch {
        fileExists = false;
      }

      if (!fileExists) {
        // For SPA routing, serve the app's index.html
        if (url.startsWith('photo-helper/')) {
          if (isDev) {
            filePath = path.join(resourcePath, 'photo-helper', 'dist', 'index.html');
          } else {
            filePath = path.join(resourcePath, 'photo-helper', 'index.html');
          }
        } else if (url.startsWith('map-corridors/')) {
          if (isDev) {
            filePath = path.join(resourcePath, 'map-corridors', 'dist', 'index.html');
          } else {
            filePath = path.join(resourcePath, 'map-corridors', 'index.html');
          }
        }
      }
    }

    callback({ path: filePath });
  });
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    icon: path.join(__dirname, 'icons', 'icon.png'),
    title: 'AirQ Competition Helpers',
    autoHideMenuBar: false
  });

  // Load the landing page
  mainWindow.loadURL('app://home/index.html');

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handle navigation between apps
ipcMain.handle('navigate-to-app', (event, appName) => {
  if (appName === 'photo-helper') {
    mainWindow.loadURL('app://photo-helper/index.html');
  } else if (appName === 'map-corridors') {
    mainWindow.loadURL('app://map-corridors/index.html');
  } else if (appName === 'home') {
    mainWindow.loadURL('app://home/index.html');
  }
});

// Handle going back to home
ipcMain.handle('go-home', () => {
  mainWindow.loadURL('app://home/index.html');
});

// Handle config get/set
ipcMain.handle('get-config', (event, key) => {
  return getConfigValue(key);
});

ipcMain.handle('set-config', (event, key, value) => {
  return setConfigValue(key, value);
});

// Open external URL in default browser
ipcMain.handle('open-external', (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

// Open Mapbox token settings dialog
ipcMain.handle('open-mapbox-settings', () => {
  showMapboxTokenDialog();
});

// Show Mapbox token dialog - single window with input field
async function showMapboxTokenDialog() {
  const currentToken = getConfigValue('mapboxToken') || '';

  const inputWindow = new BrowserWindow({
    width: 520,
    height: 280,
    parent: mainWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; background: #ffffff; margin: 0; }
        h3 { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #1a1a1a; }
        .hint { font-size: 13px; color: #666; margin-bottom: 16px; }
        .hint a { color: #1976D2; text-decoration: none; }
        .hint a:hover { text-decoration: underline; }
        input { width: 100%; padding: 10px 12px; font-size: 14px; border: 1px solid #d0d0d0; border-radius: 6px; outline: none; }
        input:focus { border-color: #1976D2; box-shadow: 0 0 0 2px rgba(25,118,210,0.15); }
        .buttons { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
        button { padding: 9px 18px; font-size: 14px; cursor: pointer; border-radius: 6px; border: 1px solid #d0d0d0; background: #fff; color: #333; }
        button:hover { background: #f5f5f5; }
        button.primary { background: #1976D2; color: white; border: none; }
        button.primary:hover { background: #1565C0; }
      </style>
    </head>
    <body>
      <h3>Mapbox Access Token</h3>
      <div class="hint">Required for satellite imagery. Get a free token at <a href="#" onclick="openMapbox()">mapbox.com</a></div>
      <input type="text" id="token" placeholder="pk.eyJ1Ijo..." value="${currentToken.replace(/"/g, '&quot;')}">
      <div class="buttons">
        <button onclick="window.close()">Cancel</button>
        <button class="primary" onclick="save()">Save</button>
      </div>
      <script>
        function openMapbox() {
          window.electronAPI?.openExternal?.('https://mapbox.com');
        }
        function save() {
          const token = document.getElementById('token').value.trim();
          window.electronAPI?.setConfig?.('mapboxToken', token)
            .then(() => window.close())
            .catch(() => alert('Failed to save token'));
        }
        document.getElementById('token').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') window.close();
        });
        document.getElementById('token').focus();
        document.getElementById('token').select();
      </script>
    </body>
    </html>
  `;

  inputWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  inputWindow.setMenu(null);
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Mapbox Token...',
          click: () => showMapboxTokenDialog()
        }
      ]
    },
    {
      label: 'Navigation',
      submenu: [
        {
          label: 'Home',
          accelerator: 'Alt+Home',
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL('app://home/index.html');
            }
          }
        },
        {
          label: 'Photo Helper',
          accelerator: 'Alt+1',
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL('app://photo-helper/index.html');
            }
          }
        },
        {
          label: 'Map Corridors',
          accelerator: 'Alt+2',
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL('app://map-corridors/index.html');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => {
            if (mainWindow && mainWindow.webContents.canGoBack()) {
              mainWindow.webContents.goBack();
            }
          }
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => {
            if (mainWindow && mainWindow.webContents.canGoForward()) {
              mainWindow.webContents.goForward();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) {
              mainWindow.reload();
            }
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Full Screen',
          accelerator: 'F11',
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.toggleDevTools();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            if (mainWindow) {
              const currentZoom = mainWindow.webContents.getZoomLevel();
              mainWindow.webContents.setZoomLevel(currentZoom + 0.5);
            }
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            if (mainWindow) {
              const currentZoom = mainWindow.webContents.getZoomLevel();
              mainWindow.webContents.setZoomLevel(currentZoom - 0.5);
            }
          }
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.setZoomLevel(0);
            }
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About',
              message: 'AirQ Competition Helpers',
              detail: `Desktop application for FAI Rally Flying competitions.\n\nVersion: ${app.getVersion()}\n\nTools:\n- Photo Helper\n- Map Corridors`
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  setupProtocol();
  createMenu();
  createWindow();

  app.on('activate', () => {
    // On macOS it's common to re-create a window when the dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until the user quits explicitly
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    // Allow navigation within our app protocol
    if (parsedUrl.protocol === 'app:') {
      return;
    }

    // Block all other navigation and open in external browser
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

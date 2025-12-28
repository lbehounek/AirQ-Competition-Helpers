const { app, BrowserWindow, protocol, ipcMain, shell, globalShortcut, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

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
    } else if (url === '' || url === 'index.html') {
      filePath = path.join(__dirname, 'renderer', 'index.html');
    } else {
      filePath = path.join(__dirname, 'renderer', url);
    }

    // Check if file exists, if not try index.html for SPA routing
    if (!fs.existsSync(filePath)) {
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
  mainWindow.loadURL('app://index.html');

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
    mainWindow.loadURL('app://index.html');
  }
});

// Handle going back to home
ipcMain.handle('go-home', () => {
  mainWindow.loadURL('app://index.html');
});

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'Navigation',
      submenu: [
        {
          label: 'Home',
          accelerator: 'Alt+Home',
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL('app://index.html');
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

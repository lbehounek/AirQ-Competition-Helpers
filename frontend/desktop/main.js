const { app, BrowserWindow, protocol, ipcMain, shell, globalShortcut, Menu, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

// HTML-attribute escape for values interpolated into `value="…"`. The previous
// `.replace(/"/g, '&quot;')` inline in the token dialogs defended only the
// attribute terminator; other chars (`<`, `>`, `&`, `'`) could still distort
// the surrounding markup if the template ever changes. Escaping all five is
// defense-in-depth — see PR #42 review.
function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Per-dialog CSP nonce. Modal dialogs are loaded via `data:` URLs which inherit
// none of the `app://` protocol's CSP, so we inline a restrictive policy with
// a nonce that permits only the single inline script shipped in the template.
function newCspNonce() {
  return crypto.randomBytes(16).toString('base64');
}

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

// Resolve app:// URL to local file path
function resolveAppUrl(requestUrl) {
  let url = requestUrl.replace('app://', '');
  url = url.split('?')[0].split('#')[0];
  url = decodeURIComponent(url);
  if (process.platform === 'win32' && url.startsWith('/')) {
    url = url.substring(1);
  }

  const resourcePath = getResourcePath();
  let filePath;
  let baseDir;

  if (url.startsWith('photo-helper/')) {
    baseDir = isDev
      ? path.join(resourcePath, 'photo-helper', 'dist')
      : path.join(resourcePath, 'photo-helper');
    filePath = path.join(baseDir, url.replace('photo-helper/', ''));
  } else if (url.startsWith('map-corridors/')) {
    baseDir = isDev
      ? path.join(resourcePath, 'map-corridors', 'dist')
      : path.join(resourcePath, 'map-corridors');
    filePath = path.join(baseDir, url.replace('map-corridors/', ''));
  } else if (url.startsWith('home/')) {
    baseDir = path.join(__dirname, 'renderer');
    filePath = path.join(baseDir, url.replace('home/', ''));
  } else {
    baseDir = path.join(__dirname, 'renderer');
    filePath = path.join(baseDir, url);
  }

  // Path traversal protection: ensure resolved path stays within base directory
  const resolvedBase = path.resolve(baseDir);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedBase + path.sep) && resolvedFile !== resolvedBase) {
    filePath = path.join(resolvedBase, 'index.html');
  }

  // SPA fallback: if file doesn't exist, serve the app's index.html
  if (url.startsWith('photo-helper/') || url.startsWith('map-corridors/')) {
    try { fs.statSync(filePath); } catch {
      const appName = url.startsWith('photo-helper/') ? 'photo-helper' : 'map-corridors';
      filePath = isDev
        ? path.join(resourcePath, appName, 'dist', 'index.html')
        : path.join(resourcePath, appName, 'index.html');
    }
  }

  return filePath;
}

const CSP = "default-src 'self' app: blob: data:; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' app:; style-src 'self' 'unsafe-inline' app:; img-src 'self' app: blob: data: https:; connect-src 'self' app: blob: data: https:; worker-src 'self' blob:";

// Create custom protocol to serve local files
// Uses protocol.handle() (modern API) to set proper response headers
function setupProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const filePath = resolveAppUrl(request.url);
      const fileUrl = pathToFileURL(filePath).href;
      const original = await net.fetch(fileUrl);
      // Copy response but add our headers
      const headers = new Headers(original.headers);
      headers.set('Content-Security-Policy', CSP);
      if (isDev) {
        headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        headers.set('Pragma', 'no-cache');
      }
      return new Response(original.body, {
        status: original.status,
        statusText: original.statusText,
        headers,
      });
    } catch (err) {
      console.error(`Protocol handler error for ${request.url}:`, err);
      return new Response('Not Found', { status: 404 });
    }
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
      webSecurity: true,
      // Disable V8 bytecode cache in dev so the window always runs the
      // freshly-built bundle. Without this, Electron keeps a compiled copy
      // of the previous bundle on disk and serves it when the HTML loads,
      // which silently eats every hot rebuild. `clearCache()` only touches
      // the HTTP cache — V8's code cache is separate and not covered.
      ...(isDev ? { v8CacheOptions: 'none' } : {})
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

  // Handle external links - open in default browser. Default-deny: only
  // http(s) is routed to the OS browser; data:/file:/blob: are blocked
  // outright so a future regression that allows renderer-initiated
  // window.open can't smuggle a preload-bearing data: window past the
  // safeHandle URL gate.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handle navigation between apps
safeHandle('navigate-to-app', async (event, appName, competitionId) => {
  let qs = competitionId ? `?competitionId=${encodeURIComponent(competitionId)}` : '';
  if (competitionId) {
    const index = readCompetitionsIndex();
    const comp = index.competitions.find(c => c.id === competitionId);
    if (comp && comp.discipline) {
      qs += `&discipline=${encodeURIComponent(comp.discipline)}`;
    }
  }
  // Flush cache on every navigation in dev so rebuilt sub-app bundles
  // replace the old ones. Electron's HTTP cache can otherwise hand the
  // navigating window a stale index.html whose <script src> points at a
  // bundle hash we've since replaced in `dist/`.
  if (isDev && mainWindow) {
    try {
      await mainWindow.webContents.session.clearCache();
    } catch (err) {
      // Don't block navigation on cache-flush failures, but do surface them —
      // a silent failure here reintroduces the stale-bundle bug documented in
      // `.claude/skills/windows-app/SKILL.md`.
      console.warn('[navigate-to-app] session.clearCache() failed; bundle may be stale:', err);
    }
  }
  if (appName === 'photo-helper') {
    mainWindow.loadURL(`app://photo-helper/index.html${qs}`);
  } else if (appName === 'map-corridors') {
    mainWindow.loadURL(`app://map-corridors/index.html${qs}`);
  } else if (appName === 'home') {
    mainWindow.loadURL('app://home/index.html');
  }
});

// Handle going back to home
safeHandle('go-home', () => {
  mainWindow.loadURL('app://home/index.html');
});

// Handle config get/set
safeHandle('get-config', (event, key) => {
  return getConfigValue(key);
});

safeHandle('set-config', (event, key, value) => {
  return setConfigValue(key, value);
});

// Open external URL in default browser
safeHandle('open-external', (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

// Open Mapbox token settings dialog
safeHandle('open-mapbox-settings', () => {
  showMapboxTokenDialog();
});

// Open Mapy.cz token settings dialog (Czech maps provider)
safeHandle('open-mapy-settings', () => {
  showMapyTokenDialog();
});

// Update menu language
safeHandle('set-menu-locale', (event, locale) => {
  // Map 'cz' to 'cs' for internal use
  const menuLocale = locale === 'cz' ? 'cs' : locale;
  if (menuLocale !== currentMenuLocale) {
    createMenu(menuLocale);
  }
});

// ============================================================================
// Photo Sessions Storage IPC Handlers
// ============================================================================

// Get the base path for photo sessions storage
function getPhotoSessionsPath() {
  return path.join(app.getPath('userData'), 'photo-sessions');
}

// Sanitize filename to prevent path traversal
function sanitizeFileName(input) {
  const removedUnsafe = input
    .replace(/[\\/]/g, '-')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  const normalized = removedUnsafe.replace(/[^A-Za-z0-9._-]/g, '-');
  const truncated = normalized.slice(0, 128);
  return truncated.length > 0 ? truncated : 'file';
}

// Defense-in-depth: only accept IPC from frames WE created.
// - `app://` = our main window + sub-apps (photo-helper, map-corridors)
// - `data:text/html` = our own Mapbox/Mapy settings dialogs (modal
//   BrowserWindows we open with a controlled CSP'd template)
//
// `will-navigate` restricts navigation to `app://`, and
// `setWindowOpenHandler` blocks http(s) window.open from the renderer,
// so only frames we control can reach these checks. A compromised
// renderer cannot conjure a fresh data: or app: frame.
//
// `data:text/html` is only legitimately used by the Mapbox/Mapy token
// dialogs created via `new BrowserWindow` in the main process. Those
// register their `webContents.id` in `trustedDataWebContentsIds` for
// the lifetime of the window — we gate any data: sender on membership
// rather than a raw URL prefix so a future regression that opens an
// unrelated `data:` window can't silently widen this gate.
const trustedDataWebContentsIds = new Set();

function isTrustedSender(event) {
  try {
    const senderUrl = event && event.senderFrame && event.senderFrame.url;
    if (typeof senderUrl !== 'string') return false;
    if (senderUrl.startsWith('app://')) return true;
    if (senderUrl.startsWith('data:text/html')) {
      const senderId = event.sender && event.sender.id;
      return typeof senderId === 'number' && trustedDataWebContentsIds.has(senderId);
    }
    return false;
  } catch {
    return false;
  }
}

// Wrap every `ipcMain.handle` so untrusted senders are rejected before the
// handler body runs. Channel name is included in the error so the renderer
// can distinguish a sender-gate failure from a regular handler error.
function safeHandle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      throw new Error(`${channel}: untrusted sender`);
    }
    return fn(event, ...args);
  });
}

// Reject UNC paths (`\\server\share`, `//server/share`) and Windows device
// namespaces (`\\?\`, `\\.\`). A renderer-supplied UNC path as the save
// dialog's `defaultPath` would pre-point the user at an attacker-controlled
// SMB share — one click later the KML lands remote and, on Windows, an
// NTLMv2 handshake to the attacker's host leaks the user's hashed creds.
function isSafeStartDir(abs) {
  if (typeof abs !== 'string' || !abs) return false;
  if (/^(\\\\|\/\/)/.test(abs)) return false;
  if (/^\\\\[?.]\\/.test(abs)) return false;
  return true;
}

// Single source of truth for "renderer gave us a directory string — should we
// trust it as `defaultPath` for a dialog or persist it as workingDir?". Wraps
// the four checks (type, length cap, UNC/device rejection, on-disk presence)
// that were copy-pasted across handlers and easy to forget on new ones.
const MAX_USER_PATH_LEN = 4096;
function validateUserDir(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  if (input.length > MAX_USER_PATH_LEN) return null;
  let abs;
  try { abs = path.resolve(input); } catch { return null; }
  if (!isSafeStartDir(abs)) return null;
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null;
  } catch { return null; }
  return abs;
}

// Allowlist for `read-photo-file`: paths the user explicitly chose in a
// preceding `open-photos` dialog. Without this, a compromised renderer
// (XSS via untrusted KML, image EXIF, or Mapbox-injected content) could
// call `readPhotoFile('C:\\Users\\…\\.ssh\\id_rsa')` and exfiltrate any
// readable file <30 MB. Resetting on `will-navigate` and window destruction
// ensures the allowlist can't outlive the picker context.
const photoOpenAllowlist = new Set();
const PHOTO_OPEN_HARD_CAP = 200;

// Set keys are byte-equal compared, but NTFS is case-insensitive and
// filenames with combining marks can round-trip through Electron in
// either NFC or NFD. Without a normalization step, the picker stores
// `C:\Photos\Img.JPG` while a later `read-photo-file('c:\\photos\\img.jpg')`
// would falsely miss — a self-DoS, not an exfil bypass, but still a
// silently-failing import. Apply NFC + lowercase-on-Windows uniformly
// to both `add` and `has` so the keys collide for any FS-equivalent form.
function normalizePathKey(absPath) {
  const r = absPath.normalize('NFC');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

// Ensure a directory exists
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

// Validate that a path is within the allowed storage directory (prevent path traversal)
function validateStoragePath(inputPath) {
  const rootPath = path.resolve(getPhotoSessionsPath());
  const resolved = path.resolve(inputPath);

  if (!resolved.startsWith(rootPath + path.sep) && resolved !== rootPath) {
    throw new Error(`Access denied: path outside storage directory`);
  }
  return resolved;
}

// Initialize storage - create root and sessions directories
safeHandle('storage-init', async () => {
  const rootPath = getPhotoSessionsPath();
  const sessionsPath = path.join(rootPath, 'sessions');

  ensureDir(rootPath);
  ensureDir(sessionsPath);

  return { rootPath, sessionsPath };
});

// Ensure session directories exist
safeHandle('storage-ensure-session-dirs', async (event, sessionId) => {
  const sessionsPath = path.join(getPhotoSessionsPath(), 'sessions');
  const dirPath = path.join(sessionsPath, sanitizeFileName(sessionId));
  const photosPath = path.join(dirPath, 'photos');

  ensureDir(dirPath);
  ensureDir(photosPath);

  return { dirPath, photosPath };
});

// Write JSON to a file
safeHandle('storage-write-json', async (event, dirPath, name, data) => {
  const safeDirPath = validateStoragePath(dirPath);
  const safeName = sanitizeFileName(name);
  const filePath = path.join(safeDirPath, safeName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
});

// Read JSON from a file
safeHandle('storage-read-json', async (event, dirPath, name) => {
  const safeDirPath = validateStoragePath(dirPath);
  const safeName = sanitizeFileName(name);
  const filePath = path.join(safeDirPath, safeName);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.error('Failed to read JSON:', e);
  }
  return null;
});

// Save a photo file (receives base64 data)
safeHandle('storage-save-photo', async (event, photosPath, photoId, base64Data, mimeType) => {
  const safePhotosPath = validateStoragePath(photosPath);
  const safeId = sanitizeFileName(photoId);

  // Determine file extension from mime type
  let ext = '.jpg';
  if (mimeType) {
    if (mimeType.includes('png')) ext = '.png';
    else if (mimeType.includes('gif')) ext = '.gif';
    else if (mimeType.includes('webp')) ext = '.webp';
  }

  const filePath = path.join(safePhotosPath, safeId + ext);
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
});

// Get a photo as base64
safeHandle('storage-get-photo', async (event, photosPath, photoId) => {
  const safePhotosPath = validateStoragePath(photosPath);
  const safeId = sanitizeFileName(photoId);

  // Try different extensions
  const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', ''];

  for (const ext of extensions) {
    const filePath = path.join(safePhotosPath, safeId + ext);
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString('base64');

      // Determine mime type from extension
      let mimeType = 'image/jpeg';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.webp') mimeType = 'image/webp';

      return { base64, mimeType };
    }
  }

  return null;
});

// Delete a photo file
safeHandle('storage-delete-photo', async (event, photosPath, photoId) => {
  const safePhotosPath = validateStoragePath(photosPath);
  const safeId = sanitizeFileName(photoId);

  // Try different extensions
  const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', ''];

  for (const ext of extensions) {
    const filePath = path.join(safePhotosPath, safeId + ext);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return;
    }
  }
});

// Clear a directory (remove all contents)
safeHandle('storage-clear-directory', async (event, dirPath) => {
  const safeDirPath = validateStoragePath(dirPath);
  if (fs.existsSync(safeDirPath)) {
    const entries = fs.readdirSync(safeDirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(safeDirPath, entry.name);
      if (entry.isDirectory()) {
        fs.rmSync(entryPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(entryPath);
      }
    }
  }
});

// Delete a session directory
safeHandle('storage-delete-session', async (event, sessionId) => {
  const sessionsPath = path.join(getPhotoSessionsPath(), 'sessions');
  const sessionPath = path.join(sessionsPath, sanitizeFileName(sessionId));

  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
});

// Get a directory handle (create if needed)
safeHandle('storage-get-directory', async (event, parentPath, name, create) => {
  const safeParentPath = validateStoragePath(parentPath);
  const safeName = sanitizeFileName(name);
  const dirPath = path.join(safeParentPath, safeName);

  if (create) {
    ensureDir(dirPath);
  } else if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  return dirPath;
});

// List directory contents
safeHandle('storage-list-directory', async (event, dirPath) => {
  const safeDirPath = validateStoragePath(dirPath);
  if (!fs.existsSync(safeDirPath)) {
    return [];
  }

  const entries = fs.readdirSync(safeDirPath, { withFileTypes: true });
  return entries.map(entry => ({
    name: entry.name,
    isDirectory: entry.isDirectory()
  }));
});

// Get storage statistics
safeHandle('storage-get-stats', async () => {
  try {
    const rootPath = getPhotoSessionsPath();

    // Calculate actual usage by walking the directory
    let totalSize = 0;

    function calculateDirSize(dirPath) {
      if (!fs.existsSync(dirPath)) return 0;

      let size = 0;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          size += calculateDirSize(entryPath);
        } else {
          try {
            const stats = fs.statSync(entryPath);
            size += stats.size;
          } catch {
            // Ignore errors for individual files
          }
        }
      }

      return size;
    }

    totalSize = calculateDirSize(rootPath);

    // For native filesystem, we don't have a strict quota
    // Return null for quota to indicate unlimited
    return {
      usage: totalSize,
      quota: null
    };
  } catch (e) {
    console.error('Failed to get storage stats:', e);
    return { usage: null, quota: null };
  }
});

// ============================================================================
// Competition Management IPC Handlers
// ============================================================================

const COMPETITIONS_INDEX_FILE = 'competitions-index.json';

function getCompetitionsIndexPath() {
  return path.join(getPhotoSessionsPath(), COMPETITIONS_INDEX_FILE);
}

function readCompetitionsIndex() {
  const indexPath = getCompetitionsIndexPath();
  try {
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read competitions index:', e);
  }
  return { competitions: [], activeCompetitionId: null, version: 1 };
}

function writeCompetitionsIndex(index) {
  const rootPath = getPhotoSessionsPath();
  ensureDir(rootPath);
  const indexPath = getCompetitionsIndexPath();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

// List all competitions
safeHandle('competition-list', async () => {
  return readCompetitionsIndex();
});

// Create a new competition
safeHandle('competition-create', async (event, name) => {
  const id = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const index = readCompetitionsIndex();

  // Create competition directory (validate path to prevent traversal)
  const competitionsDir = path.join(getPhotoSessionsPath(), 'competitions');
  ensureDir(competitionsDir);
  const compDir = validateStoragePath(path.join(competitionsDir, sanitizeFileName(id)));
  ensureDir(compDir);
  ensureDir(path.join(compDir, 'photos'));

  // Write empty session.json for photo-helper
  const emptySession = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    createdAt: now,
    updatedAt: now,
    mode: 'track',
    competition_name: name,
    sets: {
      set1: { title: 'SP - TPX', photos: [] },
      set2: { title: 'TPX - FP', photos: [] }
    },
    setsTrack: {
      set1: { title: 'SP - TPX', photos: [] },
      set2: { title: 'TPX - FP', photos: [] }
    },
    setsTurning: {
      set1: { title: '', photos: [] },
      set2: { title: '', photos: [] }
    }
  };
  fs.writeFileSync(path.join(compDir, 'session.json'), JSON.stringify(emptySession, null, 2), 'utf8');

  // Set all existing to inactive, add new entry
  index.competitions.forEach(c => { c.isActive = false; });
  const metadata = {
    id,
    name,
    discipline: 'rally',
    createdAt: now,
    lastModified: now,
    photoCount: 0,
    isActive: true
  };
  index.competitions.push(metadata);
  index.activeCompetitionId = id;
  writeCompetitionsIndex(index);

  // Store in config for quick access by menu shortcuts
  setConfigValue('activeCompetitionId', id);

  return metadata;
});

// Set active competition
safeHandle('competition-set-active', async (event, id) => {
  const index = readCompetitionsIndex();
  index.competitions.forEach(c => { c.isActive = (c.id === id); });
  const target = index.competitions.find(c => c.id === id);
  if (!target) {
    throw new Error(`Competition not found: ${id}`);
  }
  index.activeCompetitionId = id;
  writeCompetitionsIndex(index);
  setConfigValue('activeCompetitionId', id);
  return target;
});

// Set the working folder for a competition. This is the user's project
// folder (typically wherever they import the source KML from). Every
// export dialog across all sub-apps defaults to this directory so the
// user keeps their files in one place per race — feedback 2026-04-25:
// "the working folder is the same per competition, not per app".
safeHandle('competition-set-working-dir', async (event, id, workingDir) => {
  if (typeof id !== 'string' || !id) throw new Error('Invalid competition id');
  // The renderer derives `workingDir` from `dirname(savedPath)` after
  // every save dialog. A poisoned path (UNC, device namespace, oversized
  // input) would round-trip back into every subsequent dialog's
  // `defaultPath` — turning a single bad save into a persistent NTLMv2
  // hash leak primitive on Windows. `validateUserDir` enforces the
  // length cap, UNC rejection, and on-disk existence in one place.
  const abs = validateUserDir(workingDir);
  if (!abs) {
    throw new Error('Invalid working directory');
  }
  const index = readCompetitionsIndex();
  const target = index.competitions.find(c => c.id === id);
  if (!target) {
    throw new Error(`Competition not found: ${id}`);
  }
  target.workingDir = abs;
  target.lastModified = new Date().toISOString();
  writeCompetitionsIndex(index);
  return target;
});

// Read the working folder for a competition. Returns null when unset.
safeHandle('competition-get-working-dir', async (event, id) => {
  if (typeof id !== 'string' || !id) return null;
  const index = readCompetitionsIndex();
  const target = index.competitions.find(c => c.id === id);
  if (!target || typeof target.workingDir !== 'string') return null;
  // Re-validate on read-back. An older index file (written before
  // `competition-set-working-dir` enforced UNC rejection) or a
  // hand-edited config could otherwise still feed a poisoned path
  // back into save dialogs.
  return validateUserDir(target.workingDir);
});

// Set discipline for a competition
safeHandle('competition-set-discipline', async (event, id, discipline) => {
  if (discipline !== 'precision' && discipline !== 'rally') {
    throw new Error(`Invalid discipline: ${discipline}`);
  }
  const index = readCompetitionsIndex();
  const target = index.competitions.find(c => c.id === id);
  if (!target) {
    throw new Error(`Competition not found: ${id}`);
  }
  target.discipline = discipline;
  target.lastModified = new Date().toISOString();
  writeCompetitionsIndex(index);
  return target;
});

// Delete a competition
safeHandle('competition-delete', async (event, id) => {
  const index = readCompetitionsIndex();
  const target = index.competitions.find(c => c.id === id);
  if (!target) {
    throw new Error(`Competition not found: ${id}`);
  }

  // Delete competition directory (validate path to prevent traversal)
  const compDir = validateStoragePath(path.join(getPhotoSessionsPath(), 'competitions', sanitizeFileName(id)));
  if (fs.existsSync(compDir)) {
    fs.rmSync(compDir, { recursive: true, force: true });
  }

  // Update index
  index.competitions = index.competitions.filter(c => c.id !== id);
  if (index.activeCompetitionId === id) {
    if (index.competitions.length > 0) {
      index.competitions[0].isActive = true;
      index.activeCompetitionId = index.competitions[0].id;
    } else {
      index.activeCompetitionId = null;
    }
  }
  writeCompetitionsIndex(index);

  // Update config
  if (getConfigValue('activeCompetitionId') === id) {
    setConfigValue('activeCompetitionId', index.activeCompetitionId);
  }

  return { activeCompetitionId: index.activeCompetitionId };
});

// Save map print image via native save dialog. Prefers the directory the
// source KML was imported from (feedback 2026-04-23: every export dialog
// should land in the user's race folder, not our internal storage).
safeHandle('save-map-image', async (event, base64Data, defaultDir) => {
  if (typeof base64Data !== 'string' || base64Data.length === 0) {
    throw new Error('Invalid image data');
  }
  if (base64Data.length > 50 * 1024 * 1024) {
    throw new Error('Image data too large');
  }
  // Apply the same UNC + length + existence checks as `save-kml`. A
  // renderer-poisoned `defaultDir` could otherwise pre-point the dialog
  // at an attacker-controlled SMB share (NTLMv2 hash leak on Windows).
  let startDir = validateUserDir(defaultDir);
  if (!startDir) startDir = app.getPath('documents');
  const fileName = `map-print-${new Date().toISOString().slice(0, 10)}.png`;
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(startDir, fileName),
    filters: [{ name: 'PNG Images', extensions: ['png'] }]
  });
  if (!filePath) return null;
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
  return filePath;
});

// Open one or more photo files via native dialog. Defaults to the
// competition's working folder (feedback 2026-04-25 — same default for
// every export AND import). The renderer only gets file paths back; it
// then asks `read-photo-file` to load each one as base64 so it can
// reconstruct File objects for the existing onFilesDropped pipeline.
//
// Picked paths are added to `photoOpenAllowlist` and ALSO returned. The
// allowlist gates the follow-up `read-photo-file` calls so a compromised
// renderer can't ask for arbitrary files outside what the user just
// explicitly selected.
safeHandle('open-photos', async (event, defaultDir, maxFiles) => {
  const startDir = validateUserDir(defaultDir) || app.getPath('pictures');
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: startDir,
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) return [];
  // Hard server-side ceiling stops a renderer-supplied `maxFiles` of
  // Number.MAX_SAFE_INTEGER from causing the renderer to OOM trying to
  // base64-decode hundreds of 30 MB files in a row. Renderer-side cap is
  // still applied first when valid (slot capacity).
  const requested = (typeof maxFiles === 'number' && maxFiles > 0)
    ? Math.min(maxFiles, PHOTO_OPEN_HARD_CAP)
    : PHOTO_OPEN_HARD_CAP;
  const picked = result.filePaths.slice(0, requested);
  // Each `open-photos` call replaces the allowlist with its own picks.
  // Renderer pattern is `openPhotos() → await Promise.all(readPhotoFile…)`,
  // so the previous batch's reads are always finished before a new
  // open-photos is initiated. This keeps the allowlist bounded (no
  // unbounded growth across a long session) and ensures the renderer
  // can't replay paths from an older batch after a fresh dialog ran.
  photoOpenAllowlist.clear();
  for (const p of picked) {
    try { photoOpenAllowlist.add(normalizePathKey(path.resolve(p))); } catch { /* ignore */ }
  }
  return picked;
});

// Read a single photo file from disk and return base64 + metadata so the
// renderer can construct a File object. Three layers of validation:
// 1) The path must be in `photoOpenAllowlist` (set by a prior `open-photos`).
// 2) `lstat` rejects symlinks so a malicious symlink under the user's
//    Pictures folder can't redirect to ~/.ssh/id_rsa.
// 3) Extension is whitelisted explicitly — the dialog filter is UI only;
//    on Windows users can type `*.*` and pick anything.
const ALLOWED_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png']);
safeHandle('read-photo-file', async (event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('Invalid file path');
  }
  if (filePath.length > MAX_USER_PATH_LEN) {
    throw new Error('Invalid file path');
  }
  let abs;
  try { abs = path.resolve(filePath); } catch { throw new Error('Invalid file path'); }
  if (!photoOpenAllowlist.has(normalizePathKey(abs))) {
    throw new Error('File not in allowlist');
  }
  // `lstat` does NOT follow symlinks, so a symlink targeting a sensitive
  // file outside the allowlist is rejected here even if its parent dir
  // was legitimately picked. `readFileSync` later WOULD follow the link.
  let lst;
  try { lst = fs.lstatSync(abs); } catch { throw new Error('File not found'); }
  if (lst.isSymbolicLink()) throw new Error('Symlinks not allowed');
  if (!lst.isFile()) throw new Error('File not found');
  // 30 MB cap — same order of magnitude as the 20 MB renderer-side check
  // in `isValidImageFile`, with a little headroom for the base64 round-trip.
  if (lst.size > 30 * 1024 * 1024) {
    throw new Error('File too large');
  }
  const ext = path.extname(abs).toLowerCase();
  if (!ALLOWED_PHOTO_EXTS.has(ext)) {
    throw new Error('Unsupported image type');
  }
  const buffer = fs.readFileSync(abs);
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  return {
    name: path.basename(abs),
    mimeType,
    base64: buffer.toString('base64'),
  };
});

// Save a PDF (base64) via native save dialog. Defaults to the
// competition's working directory so photo-sheet PDFs land beside the
// rest of the user's project (feedback 2026-04-25).
safeHandle('save-pdf', async (event, base64Data, fileName, defaultDir) => {
  if (typeof base64Data !== 'string' || base64Data.length === 0) {
    throw new Error('Invalid PDF data');
  }
  // 200 MB ceiling — 18 photos at full quality stay well under this; the
  // limit is here to stop a malformed call from allocating unbounded memory.
  if (base64Data.length > 200 * 1024 * 1024) {
    throw new Error('PDF data too large');
  }
  const safeName = (typeof fileName === 'string' && fileName.trim())
    ? sanitizeFileName(fileName).replace(/\.pdf$/i, '') + '.pdf'
    : `photo-sheet-${new Date().toISOString().slice(0, 10)}.pdf`;
  // Same UNC + length validation as save-kml / save-map-image.
  let startDir = validateUserDir(defaultDir);
  if (!startDir) startDir = app.getPath('documents');
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(startDir, safeName),
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
  });
  if (!filePath) return null;
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
  return filePath;
});

// Save KML text via native save dialog. Prefers the directory the source
// KML was imported from (users care about their own project folders, not
// our internal competition storage). Falls back to the competition folder
// and finally to ~/Documents (feedback 2026-04-23).
safeHandle('save-kml', async (event, kmlText, fileName, defaultDir, competitionId) => {
  if (typeof kmlText !== 'string' || kmlText.length === 0) {
    throw new Error('Invalid KML content');
  }
  if (kmlText.length > 50 * 1024 * 1024) {
    throw new Error('KML content too large');
  }
  const safeName = (typeof fileName === 'string' && fileName.trim())
    ? sanitizeFileName(fileName).replace(/\.kml$/i, '') + '.kml'
    : `corridors_export_${new Date().toISOString().slice(0, 10)}.kml`;

  // 1) User-supplied directory (the folder they imported the KML from) —
  //    `validateUserDir` enforces type, length cap, UNC/device rejection,
  //    and on-disk existence in one place, shared with every other
  //    path-accepting handler so a future tweak to the rules can't miss
  //    a caller.
  let startDir = validateUserDir(defaultDir);
  // 2) Competition folder fallback
  if (!startDir && typeof competitionId === 'string' && competitionId.trim()) {
    const compDir = path.join(getPhotoSessionsPath(), 'competitions', sanitizeFileName(competitionId));
    if (fs.existsSync(compDir)) startDir = compDir;
  }
  // 3) Documents fallback
  if (!startDir) startDir = app.getPath('documents');

  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(startDir, safeName),
    filters: [{ name: 'KML files', extensions: ['kml'] }]
  });
  if (!filePath) return null;
  fs.writeFileSync(filePath, kmlText, 'utf8');
  return filePath;
});

// Show Mapbox token dialog - single window with input field
async function showMapboxTokenDialog() {
  const currentToken = getConfigValue('mapboxToken') || '';
  const nonce = newCspNonce();

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
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none';">
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; background: #ffffff; margin: 0; }
        h3 { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #1a1a1a; }
        .hint { font-size: 13px; color: #666; margin-bottom: 16px; }
        .hint a { color: #1976D2; text-decoration: none; cursor: pointer; }
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
      <div class="hint">Required for satellite imagery. Get a free token at <a id="link-mapbox">mapbox.com</a></div>
      <input type="text" id="token" placeholder="pk.eyJ1Ijo..." value="${escapeHtmlAttr(currentToken)}">
      <div class="buttons">
        <button id="btn-cancel">Cancel</button>
        <button class="primary" id="btn-save">Save</button>
      </div>
      <script nonce="${nonce}">
        var input = document.getElementById('token');
        function save() {
          var api = window.electronAPI;
          if (!api || typeof api.setConfig !== 'function') {
            console.error('[mapbox-dialog] window.electronAPI.setConfig is unavailable');
            alert('Preload bridge unavailable. Please restart the app.');
            return;
          }
          var token = input.value.trim();
          api.setConfig('mapboxToken', token)
            .then(function () { window.close(); })
            .catch(function (err) {
              console.error('[mapbox-dialog] setConfig failed:', err);
              alert('Failed to save token: ' + ((err && err.message) || err));
            });
        }
        document.getElementById('btn-save').addEventListener('click', save);
        document.getElementById('btn-cancel').addEventListener('click', function () { window.close(); });
        document.getElementById('link-mapbox').addEventListener('click', function () {
          if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
            window.electronAPI.openExternal('https://mapbox.com');
          }
        });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') window.close();
        });
        input.focus();
        input.select();
      </script>
    </body>
    </html>
  `;

  // Track this window's webContents.id so the IPC sender gate accepts
  // its `setConfig` calls without trusting *any* `data:text/html` URL.
  const mapboxId = inputWindow.webContents.id;
  trustedDataWebContentsIds.add(mapboxId);
  inputWindow.on('closed', () => { trustedDataWebContentsIds.delete(mapboxId); });

  inputWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  inputWindow.setMenu(null);
}

// Show Mapy.cz API key dialog. Mirrors the Mapbox dialog: single-input window
// that writes to `mapyToken` in the Electron config. The renderer reads that
// key on startup and calls `setProviderToken('mapy', ...)` so the
// `MapStyleSelector` can offer Mapy.com styles.
async function showMapyTokenDialog() {
  const currentToken = getConfigValue('mapyToken') || '';
  const nonce = newCspNonce();

  const inputWindow = new BrowserWindow({
    width: 520,
    height: 300,
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
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none';">
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; background: #ffffff; margin: 0; }
        h3 { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #1a1a1a; }
        .hint { font-size: 13px; color: #666; margin-bottom: 16px; line-height: 1.5; }
        .hint a { color: #1976D2; text-decoration: none; cursor: pointer; }
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
      <h3>Mapy.cz API Key</h3>
      <div class="hint">Enables Czech street/aerial maps (dense village-level labels). Register a free key at <a id="link-mapy">developer.mapy.com</a>.</div>
      <input type="text" id="token" placeholder="your-mapy-api-key" value="${escapeHtmlAttr(currentToken)}">
      <div class="buttons">
        <button id="btn-cancel">Cancel</button>
        <button class="primary" id="btn-save">Save</button>
      </div>
      <script nonce="${nonce}">
        var input = document.getElementById('token');
        function save() {
          var api = window.electronAPI;
          if (!api || typeof api.setConfig !== 'function') {
            console.error('[mapy-dialog] window.electronAPI.setConfig is unavailable');
            alert('Preload bridge unavailable. Please restart the app.');
            return;
          }
          var token = input.value.trim();
          api.setConfig('mapyToken', token)
            .then(function () { window.close(); })
            .catch(function (err) {
              console.error('[mapy-dialog] setConfig failed:', err);
              alert('Failed to save token: ' + ((err && err.message) || err));
            });
        }
        document.getElementById('btn-save').addEventListener('click', save);
        document.getElementById('btn-cancel').addEventListener('click', function () { window.close(); });
        document.getElementById('link-mapy').addEventListener('click', function () {
          if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
            window.electronAPI.openExternal('https://developer.mapy.com/en/rest-api-mapy-com/');
          }
        });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') window.close();
        });
        input.focus();
        input.select();
      </script>
    </body>
    </html>
  `;

  const mapyId = inputWindow.webContents.id;
  trustedDataWebContentsIds.add(mapyId);
  inputWindow.on('closed', () => { trustedDataWebContentsIds.delete(mapyId); });

  inputWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  inputWindow.setMenu(null);
}

// Menu translations
const menuTranslations = {
  en: {
    navigation: 'Navigation',
    home: 'Home',
    photoHelper: 'Photo Editor',
    mapCorridors: 'Photo Placement',
    back: 'Back',
    forward: 'Forward',
    reload: 'Reload',
    view: 'View',
    toggleFullScreen: 'Toggle Full Screen',
    toggleDevTools: 'Toggle Developer Tools',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    resetZoom: 'Reset Zoom',
    settings: 'Settings',
    mapboxToken: 'Mapbox Token...',
    mapyToken: 'Mapy.cz API Key...',
    help: 'Help',
    about: 'About',
    aboutDetail: 'Desktop application for FAI Rally Flying competitions.'
  },
  cs: {
    navigation: 'Navigace',
    home: 'Domů',
    photoHelper: 'Foto editor',
    mapCorridors: 'Umístění fotek',
    back: 'Zpět',
    forward: 'Vpřed',
    reload: 'Obnovit',
    view: 'Zobrazení',
    toggleFullScreen: 'Celá obrazovka',
    toggleDevTools: 'Vývojářské nástroje',
    zoomIn: 'Přiblížit',
    zoomOut: 'Oddálit',
    resetZoom: 'Obnovit zvětšení',
    settings: 'Nastavení',
    mapboxToken: 'Mapbox Token...',
    mapyToken: 'Mapy.cz API klíč...',
    help: 'Nápověda',
    about: 'O aplikaci',
    aboutDetail: 'Desktopová aplikace pro soutěže FAI Rally Flying.'
  }
};

// Current menu locale
let currentMenuLocale = 'cs';

// Create application menu
function createMenu(locale = 'cs') {
  currentMenuLocale = locale;
  const t = menuTranslations[locale] || menuTranslations.cs;

  const template = [
    {
      label: t.navigation,
      submenu: [
        {
          label: t.home,
          accelerator: 'Alt+Home',
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL('app://home/index.html');
            }
          }
        },
        {
          label: t.photoHelper,
          accelerator: 'Alt+1',
          click: () => {
            if (mainWindow) {
              const compId = getConfigValue('activeCompetitionId');
              let qs = compId ? `?competitionId=${encodeURIComponent(compId)}` : '';
              if (compId) {
                const idx = readCompetitionsIndex();
                const comp = idx.competitions.find(c => c.id === compId);
                if (comp && comp.discipline) qs += `&discipline=${encodeURIComponent(comp.discipline)}`;
              }
              mainWindow.loadURL(`app://photo-helper/index.html${qs}`);
            }
          }
        },
        {
          label: t.mapCorridors,
          accelerator: 'Alt+2',
          click: () => {
            if (mainWindow) {
              const compId = getConfigValue('activeCompetitionId');
              let qs = compId ? `?competitionId=${encodeURIComponent(compId)}` : '';
              if (compId) {
                const idx = readCompetitionsIndex();
                const comp = idx.competitions.find(c => c.id === compId);
                if (comp && comp.discipline) qs += `&discipline=${encodeURIComponent(comp.discipline)}`;
              }
              mainWindow.loadURL(`app://map-corridors/index.html${qs}`);
            }
          }
        },
        { type: 'separator' },
        {
          label: t.back,
          accelerator: 'Alt+Left',
          click: () => {
            if (mainWindow && mainWindow.webContents.canGoBack()) {
              mainWindow.webContents.goBack();
            }
          }
        },
        {
          label: t.forward,
          accelerator: 'Alt+Right',
          click: () => {
            if (mainWindow && mainWindow.webContents.canGoForward()) {
              mainWindow.webContents.goForward();
            }
          }
        },
        { type: 'separator' },
        {
          label: t.reload,
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
      label: t.view,
      submenu: [
        {
          label: t.toggleFullScreen,
          accelerator: 'F11',
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          }
        },
        {
          label: t.toggleDevTools,
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.toggleDevTools();
            }
          }
        },
        { type: 'separator' },
        {
          label: t.zoomIn,
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            if (mainWindow) {
              const currentZoom = mainWindow.webContents.getZoomLevel();
              mainWindow.webContents.setZoomLevel(currentZoom + 0.5);
            }
          }
        },
        {
          label: t.zoomOut,
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            if (mainWindow) {
              const currentZoom = mainWindow.webContents.getZoomLevel();
              mainWindow.webContents.setZoomLevel(currentZoom - 0.5);
            }
          }
        },
        {
          label: t.resetZoom,
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
      label: t.settings,
      submenu: [
        {
          label: t.mapboxToken,
          click: () => showMapboxTokenDialog()
        },
        {
          label: t.mapyToken,
          click: () => showMapyTokenDialog()
        }
      ]
    },
    {
      label: t.help,
      submenu: [
        {
          label: t.about,
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: t.about,
              message: 'AirQ Competition Helpers',
              detail: `${t.aboutDetail}\n\nVersion: ${app.getVersion()}\n\nTools:\n- ${t.photoHelper}\n- ${t.mapCorridors}`
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
app.whenReady().then(async () => {
  // Clear disk cache in dev so rebuilt files are always loaded fresh
  if (isDev) {
    const { session } = require('electron');
    await session.defaultSession.clearCache();
  }
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
      // The photo-open allowlist is scoped to the current renderer
      // context — clear it on navigation so paths picked under one app
      // (e.g. photo-helper) can't be replayed by `read-photo-file`
      // after the user navigates to a different app under app://.
      photoOpenAllowlist.clear();
      return;
    }

    // Block all other navigation and open in external browser
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

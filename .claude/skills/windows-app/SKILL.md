---
name: windows-app
description: Build and test the AirQ Competition Helpers desktop Electron app for Windows. Use when building, testing, or deploying the Windows executable.
---

# Windows App Build & Test

Build and test the AirQ Competition Helpers desktop (Electron) app for Windows.

## Project Structure

```
frontend/
├── desktop/           # Electron main process
│   ├── main.js        # Main process entry, IPC handlers, menu
│   ├── preload.js     # Context bridge for renderer
│   ├── renderer/      # Landing page HTML/CSS/JS
│   └── package.json   # Electron dependencies & build config
├── map-corridors/     # Map Corridors React app
├── photo-helper/      # Photo Helper React app
```

## Local Build

Use the build script:

```bash
cd frontend/desktop && bash build.sh          # unpacked directory (always works)
cd frontend/desktop && bash build.sh portable # single portable .exe
```

Or manually:

```bash
# 1. Build sub-apps
cd frontend/map-corridors && VITE_DESKTOP_BUILD=true npm run build
cd frontend/photo-helper && VITE_DESKTOP_BUILD=true npm run build

# 2. Detect Electron version (hoisted in workspace, electron-builder can't find it)
ELECTRON_VERSION=$(node -e "console.log(require('electron/package.json').version)")

# 3. Package
cd frontend/desktop
npx electron-builder --win --dir -c.electronVersion=$ELECTRON_VERSION   # unpacked
npx electron-builder --win -c.electronVersion=$ELECTRON_VERSION          # portable .exe
```

Output: `frontend/desktop/dist/win-unpacked/AirQ Competition Helpers.exe`

### Known Issue: stale bundles after rebuild (dev mode)

When you rebuild a sub-app and re-launch Electron (or navigate between sub-apps
via the launcher), the window can keep running the **previous** JS bundle — the
console will show an `index-<old-hash>.js` in stack traces that doesn't match
what's currently in `dist/`. Symptom: the fix you just made doesn't appear and
reloading doesn't help.

This happens because two separate caches are independent of `dist/`:
1. **Electron HTTP cache** for the `app://` protocol — fetched HTML + JS can be
   reused across window loads.
2. **V8 code cache** — Electron stores parsed bytecode for the previous bundle
   on disk and serves it when the same URL loads, even after the source file
   on disk has changed.

`session.defaultSession.clearCache()` only covers (1). You also need:
- `webPreferences.v8CacheOptions = 'none'` in dev so V8 never caches bytecode.
- `mainWindow.webContents.session.clearCache()` **before every `loadURL`** in
  dev — the startup-time clear doesn't help once the window has navigated.

Both are wired up in `main.js` (`createWindow` + `navigate-to-app` handler).
If you add a new `loadURL` call, mirror the `isDev` clearCache guard. If a
rebuild appears to do nothing, kill every `electron.exe` (`taskkill /IM
electron.exe /F`) before re-running `pnpm dev`.

### Known Issue: "An API access token is required to use Mapbox GL"

This error fires from `setStyle(mapbox://…)` inside `_makeAPIURL`, which reads
the **module-level singleton** `mapboxgl.accessToken`. react-map-gl mirrors the
`mapboxAccessToken` prop into that singleton, but the assignment lags one
microtask behind `mapStyle` prop updates — so if a token and a style change
commit in the same React batch, `setStyle` can run before the new token is
visible and throw.

**Fix** (already applied in `config/mapProviders.ts`): inside
`setProviderToken('mapbox', …)`, synchronously write
`mapboxgl.accessToken = value || ''`. This is the same singleton Mapbox GL
reads during `setStyle`, so any `mapbox://` URL returned by `getStyleForId`
is guaranteed to have the matching token in place. **Do not rely on the
react-map-gl prop alone** when you're the one deciding which style URL to
hand it.

### Known Issue: winCodeSign symlink error

On Windows without Developer Mode, the portable .exe build fails with "Cannot create symbolic link" during winCodeSign extraction. This happens because the winCodeSign archive contains macOS symlinks.

**Fixes:**
- Enable Windows Developer Mode (Settings > For Developers > Developer Mode)
- Or use the unpacked build (`--dir` flag) for local testing — fully functional
- GitHub Actions CI does not have this issue

## GitHub Actions Build

Trigger the Windows build workflow:

```bash
gh workflow run "Build Desktop App" --ref <branch-name>
```

Watch the build progress:

```bash
gh run list --branch <branch-name> --limit 1
gh run watch <run-id> --exit-status
```

Download the artifact:

```bash
gh run download <run-id>
```

## Key Files

- **main.js** - Electron main process:
  - Custom `app://` protocol for serving bundled apps
  - IPC handlers for navigation, config, external links
  - Mapbox token settings dialog
  - Application menu

- **preload.js** - Exposes safe APIs to renderer:
  - `electronAPI.navigateToApp(appName)` - Navigate between apps
  - `electronAPI.getConfig(key)` / `setConfig(key, value)` - Persistent config
  - `electronAPI.openExternal(url)` - Open URL in browser
  - `electronAPI.openMapboxSettings()` - Open token config dialog

- **Config storage** - User config stored in:
  - Windows: `%APPDATA%/airq-competition-helpers/config.json`
  - Mac: `~/Library/Application Support/airq-competition-helpers/config.json`

## Testing Checklist

1. Landing page loads correctly
2. Navigation to Photo Helper works
3. Navigation to Map Corridors works
4. Back to home navigation works (X button)
5. Mapbox token settings dialog opens and saves
6. External links open in default browser
7. Menu items functional (zoom, fullscreen, devtools)
8. Language switch persists across all apps (homepage, photo-helper, map-corridors)
9. Menu labels update when language changes
10. SVG flags display correctly (not emoji)

## Internationalization (i18n)

The app supports Czech (cs/cz) and English (en):

- **Language persistence**: Stored in Electron config (`electronAPI.getConfig('locale')`) - shared across all apps
- **Menu translations**: `main.js` has `menuTranslations` object, updated via `set-menu-locale` IPC
- **React apps**: Each has `I18nContext.tsx` that reads/writes locale via Electron config
- **Homepage**: `renderer/app.js` has full i18n system with `translations` object

When locale changes:
1. React app calls `setLocale()`
2. Saves to Electron config via `electronAPI.setConfig('locale', value)`
3. Calls `electronAPI.setMenuLocale(locale)` to update menu labels

## Versioning & Releasing

The version in `frontend/desktop/package.json` controls the .exe filename (`photo-helper-v${version}.exe`).
The latest release tag is the source of truth for the current version.

### Every build: bump the version

Before every build, bump the patch version in `package.json` to be one patch above the latest `desktop-v*` tag:

```bash
# Check latest tag
git tag --list 'desktop-*' --sort=-v:refname | head -1
# e.g. desktop-v2.0.1 → set package.json version to 2.0.2
```

This ensures every .exe has a unique version, even from feature branches.

### Releasing to GitHub

Create a GitHub Release by pushing a version tag from main:

```bash
git checkout main && git pull
git tag desktop-v2.1.0
git push origin desktop-v2.1.0
```

This triggers `.github/workflows/build-desktop.yml` which:
1. Builds both React apps
2. Packages Windows portable .exe
3. Creates GitHub Release with .exe attached

Version is auto-detected from the tag name (`desktop-v2.1.0` → `2.1.0`).

### Update CHANGELOG.md before every release

`CHANGELOG.md` at the repo root is the single source of truth for what shipped in
each `desktop-v*` release. The release-notes template in
`.github/workflows/build-desktop.yml` links to it from every GitHub Release.

Before tagging a new release — or before merging a PR with `#minor`/`#major`
that will auto-tag — add a section to `CHANGELOG.md`:

```markdown
## [2.5.0] - YYYY-MM-DD

### Added / Changed / Fixed / Security
- One concise bullet per user-visible change, prefixed with the sub-app name
  (**Photo Helper:** / **Map Corridors:** / **Desktop launcher:**) when applicable.
```

Follow [Keep a Changelog](https://keepachangelog.com) conventions. Skip empty
sections. Cross-reference PR numbers where available.

## Code signing — decision: unsigned

The Windows .exe is shipped **unsigned** by design. This is a deliberate
cost-benefit decision, not an oversight.

**Rationale:**
- Attackers routinely buy legitimate OV certs through shell companies or steal
  them from compromised devs (Stuxnet, ShadowHammer, Lazarus). Signing without
  SLSA-style build provenance is security theater.
- OV certs (~$200/yr) only clear SmartScreen *after* reputation-building (weeks,
  thousands of downloads). EV certs (~$400–700/yr + cloud HSM) clear it
  immediately but add significant pipeline complexity.
- Our distribution is small (flying-competition community); the user impact of
  the SmartScreen warning is acceptable given the cost savings.

**User experience:** Windows SmartScreen shows "Windows protected your PC" on
first run. Users click **More info → Run anyway**. This should be documented in
the user-facing README.

**If this decision changes:** the simplest path is to buy an OV cert (Sectigo /
SSL.com), base64-encode the `.pfx` into a `CSC_LINK` GH Actions secret, put the
password in `CSC_KEY_PASSWORD`, and add both to the `env:` block of the "Build
Windows executables" step in `build-desktop.yml`. electron-builder picks them up
automatically — no further config needed.

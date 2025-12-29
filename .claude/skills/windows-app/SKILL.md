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

1. Build the sub-apps first:

```bash
cd frontend/map-corridors && npm run build
cd frontend/photo-helper && npm run build
```

2. Build the desktop app:

```bash
cd frontend/desktop && npm run build
```

The Windows executable will be in `frontend/desktop/dist/`.

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

## Releasing

Create a GitHub Release by pushing a version tag:

```bash
git checkout main && git pull
git tag desktop-v1.3.0
git push origin desktop-v1.3.0
```

This triggers `.github/workflows/build-desktop.yml` which:
1. Builds both React apps
2. Packages Windows portable .exe
3. Creates GitHub Release with .exe attached

Version is auto-detected from the tag name (`desktop-v1.3.0` → `1.3.0`).

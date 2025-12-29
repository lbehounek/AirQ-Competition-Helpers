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
4. Back to home navigation works
5. Mapbox token settings dialog opens and saves
6. External links open in default browser
7. Menu items functional (zoom, fullscreen, devtools)

## Releasing

Releases are auto-tagged on merge to main via GitHub Actions:
- Default: patch version bump
- Add `#minor` to PR title/description for minor bump
- Add `#major` to PR title/description for major bump

# AirQ Competition Helpers - Desktop App

Windows desktop application bundling both **Photo Helper** and **Map Corridors** tools for FAI Rally Flying competitions.

## Overview

This Electron-based desktop app wraps the two web applications into a single Windows executable:

- **Photo Helper**: Photo organization and labeling for competition photos
- **Map Corridors**: Interactive corridor visualization for rally flying

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **pnpm** 10+ (the repo is a pnpm workspace — never use npm)
- **Windows** (for building Windows executables)

## Quick Start

### 1. Install Dependencies

Install once from the workspace root — pnpm links every package:

```bash
cd frontend
pnpm install
```

### 2. Build and Package

```bash
# Build both apps and create BOTH Windows executables
cd frontend/desktop
pnpm run package
```

The outputs will be in the `dist/` folder:
- `photo-helper-vX.Y.Z-setup.exe` — NSIS installer, per-user (no admin rights),
  lets you choose the folder, creates Desktop + Start-menu shortcuts.
  **Recommended download.**
- `photo-helper-vX.Y.Z-portable.exe` — portable executable; re-extracts itself
  into `%TEMP%` on every launch (USB sticks / machines where installing is not
  allowed), which makes it slower to start.

### Alternative Commands

```bash
# Build both apps + both installers (same as above)
pnpm run package

# Only one of the two targets
pnpm run package:nsis
pnpm run package:portable

# Package as directory (faster, for testing)
pnpm run package:dir

# Build only (no packaging) - useful for testing
pnpm run build:apps

# Run in development mode (requires built apps)
pnpm run dev

# Or use the build script (detects the hoisted Electron version for you)
bash build.sh          # unpacked directory
bash build.sh package  # NSIS installer + portable .exe
```

## Project Structure

```
frontend/desktop/
  main.js           # Electron main process
  preload.js        # Secure IPC bridge
  renderer/
    index.html      # Landing page / app selector
  icons/
    icon.svg        # App icon source
    icon.ico        # Windows icon (see below)
    icon.png        # PNG icon for Linux/macOS
  package.json      # Build configuration
  dist/             # Build outputs (generated)
```

## App Icon

The app icon is provided as SVG source (`icons/icon.svg`). For production builds, you need to generate platform-specific icons:

### Windows (.ico)

Convert the SVG to ICO format (256x256, 128x128, 64x64, 48x48, 32x32, 16x16):

Using ImageMagick:
```bash
magick convert icons/icon.svg -define icon:auto-resize=256,128,64,48,32,16 icons/icon.ico
```

Or use online tools like:
- https://realfavicongenerator.net/
- https://cloudconvert.com/svg-to-ico

### Linux/macOS (.png)

```bash
magick convert -background none icons/icon.svg -resize 512x512 icons/icon.png
```

## How It Works

1. **Electron** provides a Chromium-based window to run the web apps
2. **Custom Protocol** (`app://`) serves the built app files securely
3. **Landing Page** allows switching between Photo Helper and Map Corridors
4. **electron-builder** packages everything into Windows executables

### Startup

The bundled sample competition (developer builds only — `sample-data/` is
gitignored, so release builds contain none) is copied in the **background**
after the window opens, not before it. The IPC channels that observe the
competitions index — `competition-list`, `storage-init`, `sample-is-pending`,
`sample-clear-pending`, `navigate-to-app` — await that copy via `sampleReady`
(`main.js`), so nothing can ever see an index without the sample. The logic
itself lives in `lib/sampleCompetition.js` and is unit-tested; the *wiring* —
that each of those five channels is still wrapped in `afterSample` — is pinned by
`__tests__/sampleGate.test.js`, so adding a sixth gated channel means adding it
to that test's `GATED_CHANNELS` list.

## Build Configuration

The build is configured in `package.json` under the `"build"` key:

- **appId**: `com.airq.competition-helpers`
- **Targets**: NSIS installer (assisted: `oneClick: false`, `perMachine: false`,
  `allowToChangeInstallationDirectory: true`, `differentialPackage: false` —
  there is no auto-updater, so the blockmap it would produce is dead weight)
  + Portable executable
- **Architecture**: x64 only

### User data

Both builds store `config.json` and `photo-sessions/` under
`app.getPath('userData')` — on Windows `%APPDATA%\AirQ Competition Helpers`
(Electron derives the folder from `productName`, not from the package name;
confirm the exact string once on Windows). The uninstaller never touches it
(`deleteAppDataOnUninstall: false`), and the two builds share it — so moving
from the portable build to the installer keeps every competition.

### Customizing the Build

Edit `package.json` to modify:
- `productName`: Display name of the application
- `build.win.target`: Add/remove build targets
- `build.nsis`: Installer options

## Troubleshooting

### Build Fails with "Cannot find module"

Install once from the workspace root — pnpm links all three packages:
```bash
cd frontend && pnpm install
```

### App Shows Blank Screen

The web apps must be built before running:
```bash
pnpm run build:apps
pnpm run dev
```

### Icon Not Showing

Ensure `icons/icon.ico` exists. Generate it from the SVG source.

## Development

### Testing Changes

1. Make changes to either web app
2. Run `pnpm run build:apps` to rebuild
3. Run `pnpm run dev` to test in Electron

### Debugging

In development mode, DevTools opens automatically. In production, press `Ctrl+Shift+I` to open DevTools.

## CI/CD & Releases

The desktop app is built and released via GitHub Actions.

### Automatic Builds

The workflow (`.github/workflows/build-desktop.yml`) triggers on:

1. **Manual dispatch** - Run from GitHub Actions UI
2. **Tag push** - Push a `desktop-v*` tag to create a release

### Creating a Release

```bash
# 1. Ensure you're on main with latest changes
git checkout main && git pull

# 2. Create and push a version tag
git tag desktop-v1.2.0
git push origin desktop-v1.2.0
```

This triggers the workflow which:
1. Builds both React apps (photo-helper, map-corridors)
2. Packages a Windows NSIS installer and a portable .exe
3. Creates a GitHub Release with both .exe files attached

### Version Detection

The workflow auto-detects version from:
1. Manual input (if provided in workflow dispatch)
2. Tag name (e.g., `desktop-v1.2.0` → version `1.2.0`)
3. Latest git tag (fallback for manual runs)

### Download

Users download the .exe from:
`https://github.com/lbehounek/AirQ-Competition-Helpers/releases`

## License

See [LICENSE.md](../../LICENSE.md) in the repository root.

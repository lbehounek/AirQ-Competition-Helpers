## OPFS migration overview

This document captures what we implemented to replace the backend with the browser’s Origin Private File System (OPFS), how to reproduce it from a base state, the key design decisions, browser-compatibility constraints, and the Safari fallback strategy.

### Goals
- Remove the backend dependency for file persistence in the Photo Helper app.
- Store photo files and session metadata locally for speed, privacy, and offline use.
- Provide a graceful experience on browsers that lack OPFS write support (notably Safari).

---

## Architecture changes

### Added
- `frontend/photo-helper/src/services/opfsService.ts`
  - Provides the storage API used by the app.
  - Implements OPFS session and photo persistence for Chromium/Edge/Firefox.
  - Detects Safari and applies a metadata-only fallback.

- `frontend/photo-helper/src/hooks/usePhotoSessionOPFS.ts`
  - Drop-in replacement for the previous backend API hook.
  - Exposes the same surface (create/update/delete/reorder/etc.).
  - Produces blob/object URLs for rendering images.

- `build.sh`
  - Helper script to build the frontend into `public_html/` for deployment.

### Updated
- `frontend/photo-helper/src/AppApi.tsx`
  - Switched usage from `usePhotoSessionApi` (backend) to `usePhotoSessionOPFS` (OPFS).

- `dev.sh`
  - Simplified to start frontend only (backend removed).

### Removed
- `frontend/photo-helper/src/services/api.ts`
- `frontend/photo-helper/src/hooks/usePhotoSessionApi.ts`
  - The backend REST layer is no longer used.

---

## Browser compatibility and behavior

### Chromium (Chrome), Edge, Firefox
- Full OPFS write support.
- Photos and session metadata are stored in OPFS:
  - Session JSON at `/sessions/{sessionId}/session.json`.
  - Photos at `/sessions/{sessionId}/photos/{photoId}.jpg`.
- Images render through `blob:` object URLs created from OPFS files.

### Safari (current status)
- OPFS directory APIs initialize, but file write methods are not available.
- We implement a Safari-only fallback:
  - Persist session metadata (titles, ordering, canvas state) in `localStorage`.
  - Photos:
    - ≤ 2MB: stored as base64 in `localStorage` (persisted across reloads).
    - > 2MB: allowed to upload and used immediately via a temporary `objectURL`, but not persisted. On reload the app prompts the user to re‑upload; files are auto-matched by filename and size.

Notes
- The fallback ensures the UX still works on Safari, while keeping the codebase client‑side only.

---

## Key decisions and rationale

1) OPFS-first design (no backend):
   - Faster, private, offline-capable, zero server cost.

2) Safari fallback (metadata-only persistence):
   - Large photos cannot be reliably written by Safari into OPFS.
   - Storing raw photos in `localStorage` is not practical beyond tiny sizes.
   - Chosen compromise: persist metadata; allow re‑upload to restore large photos on future visits.

3) Keep the UX consistent:
   - Drag & drop and editing behaviour remain unchanged.
   - Clear messaging can be added to prompt Safari users to re‑upload if needed.

---

## What we implemented (technical highlights)

- `opfsService.ts`
  - Detects Safari via user agent; sets `isSafari` flag.
  - Session persistence
    - Chromium/Edge/Firefox: write JSON to OPFS using supported APIs.
    - Safari: write session JSON to `localStorage` under a single key.
  - Photo persistence
    - Chromium/Edge/Firefox: store JPEGs under `/photos/` and read as blobs.
    - Safari: two paths
      - ≤ 2MB: base64 in `localStorage` (persisted).
      - > 2MB: do not persist; generate a temporary `objectURL` for current session use only.
  - Delete semantics
    - OPFS: remove file entry.
    - Safari: remove base64 entry from `localStorage` when applicable.
  - Matching hints added to `PhotoMetadata` to support re‑upload restore:
    - `originalSize`, `originalLastModified`, optional `hash` (future).
    - `persisted` flag to signal whether the photo exists in storage.

- `usePhotoSessionOPFS.ts`
  - Creates object URLs from OPFS or from the freshly dropped file in Safari non‑persisted path.
  - Tracks and revokes blob URLs to avoid memory leaks.
  - Persists session updates asynchronously for snappy UI.

---

## Reproducing from a base state (step‑by‑step)

1) Add OPFS service
   - Create `src/services/opfsService.ts` with:
     - OPFS initialization (`navigator.storage.getDirectory()`), session/photo IO, Safari detection.
     - Safari fallback that writes session JSON to `localStorage`, small photos as base64, larger photos session‑only.

2) Replace backend hook
   - Add `src/hooks/usePhotoSessionOPFS.ts` that mirrors the old hook’s interface but calls `opfsService`.
   - Swap imports in `AppApi.tsx` from `usePhotoSessionApi` to `usePhotoSessionOPFS`.

3) Remove backend layer
   - Delete `src/services/api.ts` and `src/hooks/usePhotoSessionApi.ts`.
   - Update `dev.sh` to only run the frontend.

4) Build & run
   - Dev: `./dev.sh` (starts Vite dev server).
   - Prod build: `./build.sh` (outputs to `public_html/`).

---

## Challenges & how we addressed them

1) Safari OPFS write support
   - Symptom: `createWritable()`/`createSyncAccessHandle()` unavailable.
   - Resolution: metadata-only persistence in Safari; allow large photos in-session and prompt re‑upload after reload.

2) Blob URL lifecycle
   - We manage object URLs in the hook and revoke on cleanup to avoid leaks.

3) Session restore (Safari)
   - On reload, photos > 2MB are missing; we rely on metadata (filename+size) to auto-match when the user re‑uploads.
   - Optional future: compute a SHA-256 to improve match reliability.

---

## Known limitations

- Safari will not persist large photos; users must re‑upload on subsequent visits.
- `localStorage` quota is limited; only small photos are stored there.
- OPFS quotas vary by browser and user settings; we surface friendly errors when space runs low.

---

## Testing checklist

- Chromium/Edge/Firefox
  - Upload multiple large photos; reload; verify persistence and rendering.
  - Reorder, edit, and delete; verify data remains consistent after reload.

- Safari
  - Upload ≤ 2MB photo; reload; verify it persists.
  - Upload > 2MB photo; reload; verify prompt to re‑upload; drop the same file; verify auto-match by filename+size.

---

## Future improvements

- Add a small IndexedDB layer for Safari to store medium-size photos reliably.
- Optional hashing (SHA‑256) in a Web Worker for robust auto-matching on re‑upload.
- UX banner for Safari explaining persistence differences and offering a “Bulk restore” button.

---

## Revised deployment strategy (Aug 2025)

We will proceed with a two‑track strategy that balances reliability on desktop and simplicity online:

### 1) Desktop app (Windows) – frontend + backend bundled
- Package the existing frontend and backend together using a wrapper/runtime (options include Electron, Tauri, NW.js, or a lightweight webview host calling the Python backend). 
- The backend keeps full responsibility for session persistence and photo file storage on the local filesystem.
- Benefits: full persistence, high performance, no browser storage limitations, consistent behavior.

Suggested desktop packaging options:
- Electron (JS/TS) − simplest FE integration, mature ecosystem.
- Tauri (Rust backend, JS/TS frontend) − smaller footprint; calls out to Python backend if needed.
- Python + WebView (e.g., PyInstaller + Flask/Uvicorn + webview) − minimal stack divergence if you prefer Python.

### 2) Online deployment – frontend only
- Deploy the frontend statically (no backend). 
- There is **no cross‑session persistence**: users complete all work within a single browser session.
- Optional: store **configuration/metadata only** (no photos) in `localStorage`, such as:
  - app mode (track/turningpoint), aspect ratio, labeling preferences
  - per‑session UI preferences, last used competition name
  - transient canvas adjustments if small enough (be conservative)
- Do **not** store photo binaries online. Users will re‑upload as needed.

Why this split:
- Desktop experience can guarantee persistence and robust handling of large files via the backend.
- The online experience remains lightweight and private (no server), while making it explicit that work should be finished in a single session.

Operational notes:
- Keep the code paths modular so the desktop build points to the backend API, while the online build points to the frontend‑only behavior.
- Document in the UI (help/about) that the online version is per‑session only; optionally, enable storing small **config‑only** data in `localStorage` with a clear toggle.



# Implementation Plan — Photo Map Culling

This plan turns the decisions in [decisions.md](./decisions.md) into ordered
phases with file-level scope. Each phase has explicit exit criteria so it
can be reviewed and merged on its own (or all phases can ship as one PR —
see [Delivery shape](#delivery-shape)).

The plan assumes `feat/candidate-photos` has merged to `main` before
implementation starts — the candidate pool is the handoff foundation
([ADR-005](./decisions.md#adr-005-cross-app-handoff-via-a-one-way-map-picksjson-file)).

---

## Delivery shape

**Recommended:** one feature branch `feat/photo-map-culling`, ordered
commits per phase, **draft** PR opened after Phase 1. Mark ready for review
when Phase 9 completes. Squash on merge.

The first commit-worthy slice is **Phase 0 + Phase 1** (types + EXIF
pipeline + unit tests). Pure data side, zero UI risk, validates the
foundation. Subsequent phases layer UI on a proven base.

---

## Pre-flight checklist

Before opening the branch:

- [ ] `feat/candidate-photos` is merged to `main`. (Soft gate: if it
      slips, the new `useMapPicksSync` hook can still ship as the
      consumer side; the candidate pool feature is required to give
      the picks a UI home but not to define the file contract.)
- [ ] The candidate pool's persistence works end-to-end (manual smoke).
- [ ] `frontend/photo-helper/src/types/api.ts` defines `CandidatePool`
      and `ApiPhoto.flag` as expected.
- [ ] `exifr` latest version checked on npm; note exact version for the
      install (no caret, per global dependency-pinning rule).
- [ ] `@vitest/browser` + Playwright browser provider available for
      installing as devDeps.
- [ ] Sample test photos with **anonymized synthetic GPS coords**
      available: 1× JPEG with GPS, 1× JPEG without GPS, 1× JPEG with
      Orientation=6 (sideways), 1× JPEG with Orientation=1 (already
      rotated), 1× HEIC (for the reject path), 1× misnamed HEIC
      (`.jpg` extension), 1× corrupt JPEG.

---

## Phase 0 — Foundation: types + dependencies

**Scope.** Add the new types and install the EXIF library. No behaviour
change.

**Files touched.**

- `frontend/map-corridors/src/types/markers.ts` — extend `PhotoMarker`,
  preserving the existing `Readonly<...>` immutability wrapper used
  throughout the codebase:
  ```ts
  export type PhotoMarker = Readonly<{
    id: string;
    lng: number;
    lat: number;
    name: string;
    label?: PhotoLabel;
    capturedAt?: Readonly<{
      lng: number;
      lat: number;
      altitude?: number;
      timestamp?: string;
    }>;
    photoId?: string;
  }>;
  ```
  Notes:
  - No `flag` field (per [ADR-017](./decisions.md#adr-017-flag-lives-in-map-picksjson-only-denormalized-to-geojson-properties-at-render-time);
    flag lives only in `map-picks.json`).
  - No `needsPlacement` field (per [ADR-012](./decisions.md#adr-012-no-gps-photo-placement-off-map-tray-pinned-to-map-corner);
    no-GPS photos exist as candidate-pool entries until placed).
- `frontend/map-corridors/src/types/markers.ts` — extend
  `isPhotoMarker` to validate optional `capturedAt` (nested
  `isFinite` lng/lat) and `photoId` (string, non-empty). The existing
  `sanitizePhotoMarkers` array filter then handles upgrade-from-pre-feature
  data without further changes.
- `frontend/photo-helper/src/types/api.ts` — extend `ApiPhoto`:
  ```ts
  export interface ApiPhoto {
    // ...existing fields
    gps?: {
      capturedAt?: { lng: number; lat: number; altitude?: number };
      subjectAt?: { lng: number; lat: number };
      timestamp?: string;
    };
  }
  ```
- `frontend/map-corridors/package.json` — add `exifr` (exact version,
  no caret per global dependency-pinning rule). Optionally `pica` if
  Phase 1 measurement shows plain canvas downscale quality is poor
  (likely not needed for 200×150 popups).
- `frontend/map-corridors/vitest.config.ts` — confirm jsdom environment
  is available; for the `generateThumb` test cases that need real
  Canvas / `createImageBitmap`, the **first attempt** is to use the
  `canvas` npm package as a jsdom shim (already on the
  `onlyBuiltDependencies` allowlist in `pnpm-workspace.yaml`). Only
  if the shim proves inadequate, add `@vitest/browser` + Playwright
  browser provider as a separate `test:browser` script — gated off
  the default `pnpm test` so CI is not forced to install a Chromium
  download. Pin exact versions if/when adopted.
- `frontend/map-corridors/src/hooks/useCorridorSessionOPFS.ts` — extend
  `CorridorsSession` with `noGpsTrayOpen: boolean` (default `true`).
  Expose `setNoGpsTrayOpen` setter from the hook, mirroring the existing
  `setMarkers` pattern. **No `sourceMode` field** — see [ADR-021](./decisions.md#adr-021--implicit-dropzone-routing-no-mode-toggle):
  corridor and photo coexist by default, no mode persisted. **Note on the
  existing `version` field**: it is a per-mutation write counter
  (`session.version + 1` on every persist), not a schema version.
  Backwards compatibility for pre-feature sessions relies on
  `sanitizePhotoMarkers` (extended above) ignoring missing fields,
  not on a schema-version bump.

**Exit criteria.**

- TypeScript compiles in both `map-corridors` and `photo-helper`.
- `pnpm --filter @airq/map-corridors build` and
  `pnpm --filter @airq/photo-helper build` succeed.
- Existing corridor session JSONs from before the change load without
  errors (schema migration path exercised).
- **Bundle-size measured.** Run `pnpm --filter @airq/map-corridors build`
  and inspect the Vite build report. Aim for `exifr` to contribute
  ≤ 15 KB gz (its documented lite-build target is ~9 KB). If
  significantly higher (e.g., > 25 KB), reconsider the library or
  switch to a 5-line manual GPS-only parser. Record the measured
  number in the PR description.
- Test fixture set bootstrapped in
  `frontend/map-corridors/test/fixtures/photos/` with anonymized GPS
  coords.
- A v1→v2 schema migration unit test passes: load a pre-feature
  `corridors-session.json`, ensure new fields default to undefined and
  no console warnings fire.

**Test focus.**

- Unit test: load a v1 corridors-session.json (without new fields) →
  PhotoMarker array reads fine, `capturedAt` is undefined.
- Unit test: a `PhotoMarker` with malformed `capturedAt: { lng: 'foo' }`
  is rejected by the extended `sanitizePhotoMarkers` validator
  (`frontend/map-corridors/src/types/markers.ts`).

---

## Phase 1 — EXIF + thumbnail pipeline (pure module)

**Scope.** A standalone module that takes File objects and produces
`{ photoId, exifGps, thumbnailBlob, originalBlob, failed }`. Pure
domain logic — no UI, no map, no storage. Fully unit-testable.

**New files.**

- `frontend/map-corridors/src/photoImport/extractExif.ts`
  ```ts
  export type ExifData = {
    capturedAt?: { lng: number; lat: number; altitude?: number };
    timestamp?: string;
    orientation?: number;
  };
  export async function extractExif(file: File): Promise<ExifData>;
  ```
- `frontend/map-corridors/src/photoImport/generateThumb.ts`
  ```ts
  export async function generateThumb(
    file: File,
    opts?: { maxWidth?: number; maxHeight?: number; quality?: number }
  ): Promise<Blob>;
  ```
  Decodes via `createImageBitmap(file, { imageOrientation: 'from-image' })`
  so EXIF Orientation is applied by the browser per spec (see
  [ADR-015](./decisions.md#adr-015-apply-exif-orientation-via-createimagebitmap-not-manual-rotation)).
  No manual rotation logic in our code. Downscales to `maxWidth ×
  maxHeight` via either `OffscreenCanvas + drawImage` (good enough for
  200×150) or `pica` for higher-quality intermediate steps. v1 starts
  with plain canvas — pica is only needed if quality is visibly poor at
  popup size, which we'll measure during Phase 1.
- `frontend/map-corridors/src/photoImport/types.ts`
  ```ts
  export type ImportedPhoto = {
    photoId: string;
    file: File;
    thumbnail: Blob;
    exif: ExifData;
  };
  export type ImportResult = {
    ok: ImportedPhoto[];
    failed: { filename: string; reason: string }[];
  };
  ```
- `frontend/map-corridors/src/photoImport/importPhotoFiles.ts`
  ```ts
  export async function importPhotoFiles(
    files: File[],
    opts?: { concurrency?: number; onProgress?: (done: number, total: number) => void }
  ): Promise<ImportResult>;
  ```
  Orchestrates: filter HEIC (reject with reason), filter non-image MIME
  types, generate `photoId`, run extractExif + generateThumb per file with
  `Promise.all` in batches of 8 ([ADR-014](./decisions.md#adr-014-import-throughput-main-thread-throttled-at-8-concurrent)).

**Exit criteria.**

- **Pure code paths** (`extractExif`, `importPhotoFiles` orchestration):
  every branch covered in Vitest + jsdom.
- **Canvas-touching paths** (`generateThumb`): covered in
  `@vitest/browser` mode (added as a dev dep in Phase 0) for at least
  the orientation, (0,0)-boundary, and corrupt-input cases. jsdom does
  not implement Canvas2D or `createImageBitmap`, so these tests cannot
  run in the regular vitest target.
- Test fixtures live in `frontend/map-corridors/test/fixtures/photos/`
  with **synthetic, anonymized** GPS coords (e.g., always (50.0, 14.0)
  base + offsets). Phase 0 bootstraps these so no organizer's real
  home coords get committed.

**Test focus.**

- `extractExif.test.ts` *(vitest + jsdom)*: GPS present, GPS absent,
  GPS `(0,0)` exact, ISO timestamp, orientation tag, HEIC reject by
  content (mis-named `.jpg`).
- `generateThumb.test.ts` *(vitest + jsdom + canvas shim)*: size cap,
  JPEG quality < 30 KB for 4 MP input, corrupt input throws, contentHash
  produced. Single browser-spec test: produces upright JPEG for
  Orientation=6 — we trust `createImageBitmap` for the Orientation=1
  no-op case rather than testing the browser implementation.
- `importPhotoFiles.test.ts` *(vitest + jsdom)*: batch concurrency,
  progress callbacks, failure isolation, mid-batch storage rejection,
  HEIC rejection.

---

## Phase 2 — Storage layer: thumbnails + photo blob writes

**Scope.** Wire the import result into the shared storage abstraction.
Write blobs and thumbs into `competitions/{compId}/photos/` and
`competitions/{compId}/photos/thumbs/`. Surface a `getPhotoThumbBlob`
helper.

**Files touched.**

- `frontend/shared-storage/src/types.ts` — add to `StorageInterface`:
  ```ts
  savePhotoThumb(photosDir: DirectoryHandle, photoId: string, blob: Blob): Promise<void>;
  getPhotoThumb(photosDir: DirectoryHandle, photoId: string): Promise<Blob | null>;
  deletePhotoThumb(photosDir: DirectoryHandle, photoId: string): Promise<void>;
  ```
  These call into `getDirectoryHandle('thumbs', { create: true })` and
  operate on files named `{photoId}.jpg`.
- `frontend/shared-storage/src/opfsStorage.ts` — implement.
- `frontend/shared-storage/src/electronStorage.ts` — implement via the
  existing IPC channels, adding a new `storage-save-thumb` etc. handler in
  `frontend/desktop/main.js`.
- `frontend/desktop/preload.js` — expose the new IPC.

**Exit criteria.**

- Round-trip test: write thumb → read thumb → matches.
- `competitions/{compId}/photos/thumbs/` directory materializes on first
  thumb save.
- Deleting a photo also deletes its thumb (existing
  `deleteSessionDir` already nukes the parent; verify thumb cleanup on
  individual `deletePhotoFile`).

---

## Phase 3 — Photo dropzone routing in map-corridors

**Scope.** Extend the existing dropzone to also accept JPEG/PNG. Route
each dropped file by extension: KML/GPX → existing corridor parser; JPEG/
PNG → `importPhotoFiles`. Run the import pipeline, write blobs/thumbs to
storage, mirror picks to `map-picks.json`. No mode UI (see [ADR-021](./decisions.md#adr-021--implicit-dropzone-routing-no-mode-toggle)).

**Files touched.**

- `frontend/map-corridors/src/App.tsx` — extend dropzone `accept` to
  include image MIME types and `.jpg`/`.jpeg`/`.png` extensions. Add
  per-file routing branch in the drop handler: `parsers/detect.ts` for
  KML/GPX, `importPhotoFiles` for images. Mixed-batch drops are split
  by extension and each branch runs independently.
- `frontend/map-corridors/src/locales/en.json` + `cs.json` — strings
  for the unsupported-file toast ("Unsupported file: {name}") and import
  progress.

**Exit criteria.**

- Dropping a `.kml` continues to work exactly as it does today (no
  regression on the corridor flow).
- Dropping a `.jpg` triggers `importPhotoFiles`; progress visible for
  batches > 10.
- Dropping a mixed batch (1 KML + 30 JPEGs) parses the KML and imports
  the photos in parallel — both end states reflected on the map.
- Dropping an unsupported file (`.txt`, `.bin`) surfaces a toast naming
  the file. No silent failures.
- No mode chip rendered. The header looks identical to today's
  map-corridors chrome aside from any panel-presence reactions from
  Phase 6 (right-side photo list when there are photos).

---

## Phase 4 — Photo markers: GeoJSON layers for static dots, `<Marker>` for picks

**Scope.** Render photo markers in two render paths per
[ADR-016](./decisions.md#adr-016-marker-rendering-split-geojson-layer-for-static-dots-individual-marker-for-picks).
Static visuals (capture dots, ghost markers, rejected dots, dashed
lines) go into Mapbox GeoJSON layers. Draggable subject pins (the picks)
remain individual `<Marker>` components.

**Files touched.**

- `frontend/map-corridors/src/map/photoLayers/CaptureDotsLayer.tsx`
  *(new)* — feeds a GeoJSON source with one feature per `PhotoMarker`
  with `capturedAt !== undefined && flag !== 'pick'`. Properties include
  `photoId`, `flag` (used in paint expressions and click handlers).
- `frontend/map-corridors/src/map/photoLayers/DashedLinesLayer.tsx`
  *(new)* — feeds a GeoJSON source with one LineString per pick where
  `capturedAt !== lng/lat`. Re-emits source data on drag-end only.
- `frontend/map-corridors/src/map/photoLayers/RejectedDotsLayer.tsx`
  *(new)* — separate layer (or filtered sublayer) for `flag === 'reject'`.
  Hide-rejects toggle becomes a paint filter, not a DOM change.
- `frontend/map-corridors/src/map/photoLayers/SubjectPin.tsx` *(new)* —
  individual draggable `<Marker>` per pick.
- `frontend/map-corridors/src/map/MapProviderView.tsx` — mount these
  layers whenever the markers array contains photo-derived entries
  (`marker.photoId !== undefined`); existing corridor-marker rendering
  for KML/GPX flow is unchanged and runs in parallel.

**Paint expressions (sketch).**

- Capture dots: `circle-color` = match-expression on `flag` (grey for
  neutral, dim for rejected if not on its own layer).
- Capture dots: `circle-radius` 4 px.
- Subject pins: 24×24 SVG marker, color by `flag` (typically only `pick`).
- Dashed line: `line-dasharray: [2, 2]`, `line-width: 1`.

**Click handling.**

- `map.on('click', 'photo-capture-dots', e => openPopup(e.features[0].properties.photoId))`.
- Subject pin click handled at the `<Marker>` level.

**Exit criteria.**

- 100 capture dots render at 60 fps on pan/zoom.
- Clicking a capture dot opens the popup (Phase 5).
- Subject pin drag updates `marker.lng/lat`; the active drag's dashed
  line redraws each rAF tick (one line, cheap); non-active dashed
  lines redraw only when their underlying coords change.
- "Hide rejects" toggle (US-13) hides red dots via a Mapbox paint filter,
  zero DOM churn.
- Dev smoke verifies layers persist correctly across React StrictMode
  double-mount and Vite HMR reloads.
- Existing KML-marker rendering unchanged.

See [ADR-016](./decisions.md#adr-016-marker-rendering-split-geojson-layer-for-static-dots-individual-marker-for-picks)
for the library-naming note and the additive-not-replacing nature of
this change for corridor markers.

**Dashed line drag tracking.** During an active subject-pin drag, the
dashed line back to the capture ghost is updated per animation frame
(rAF-throttled GeoJSON source data update for the *active* pin only).
Drag-end commits the final position. Pre-drag and post-drag states use
the cached source data.

**Active drag uses `setDragPan(false)`** during a marker drag so the map
doesn't pan under the user's finger.

---

## Phase 5 — Photo popup with thumbnail and actions

**Scope.** Replace / extend the existing marker popup. Show thumbnail,
filename, timestamp, label picker, and the three action buttons.

**Files touched.**

- `frontend/map-corridors/src/components/PhotoMarkerPopup.tsx` *(new)* —
  pulls thumbnail via `storage.getPhotoThumb`, renders MUI card UI.
- `frontend/map-corridors/src/map/MapProviderView.tsx` — wire the popup
  for photo-mode markers (existing popup unchanged for corridor markers).
- `frontend/map-corridors/src/locales/*.json` — action labels.

**Acceptance (manual).**

- Hover capture dot → small 80×60 tooltip preview.
- Click capture dot → popup with 200×150 thumb + filename + timestamp +
  Include / Skip / Reject.
- Click Include on a no-flag photo → becomes pick, popup closes (or
  refreshes to show the label picker).
- Esc closes the popup.

---

## Phase 6 — No-GPS tray + drag-onto-map

**Scope.** Implement [ADR-012](./decisions.md#adr-012-no-gps-photo-placement-off-map-tray-pinned-to-map-corner):
an off-map tray pinned to the bottom-left of the map holds photos with
no GPS. The user drags a thumbnail from the tray to any point on the
map; on drop, a `PhotoMarker` is created at the drop coordinate and the
entry leaves the tray.

**New / touched files.**

- `frontend/map-corridors/src/components/NoGpsTray.tsx` *(new)* — MUI
  Paper positioned absolutely over the map's bottom-left. Horizontal
  scroll of thumbnails sorted by capture time. Each thumb is HTML5
  draggable; sets `dataTransfer.setData('application/x-airq-no-gps-photo', photoId)`.
- `frontend/map-corridors/src/map/MapProviderView.tsx` — add a drop
  handler on the map container. On drop, call
  `map.unproject([clientX, clientY])` to get `{lng, lat}` and emit
  `onNoGpsPhotoPlaced(photoId, lng, lat)`.
- `frontend/map-corridors/src/App.tsx` — wire `onNoGpsPhotoPlaced`:
  pop the candidate from the no-GPS list, create a `PhotoMarker` with
  `flag: 'pick'` at the drop coord. No `capturedAt`, no ghost.
- `frontend/map-corridors/src/hooks/useCorridorSessionOPFS.ts` — add
  `noGpsTrayOpen: boolean` to `CorridorsSession`.

**Note: no `placeNoGpsPhotos` pure function is needed.** The earlier
viewport-anchored lng/lat strategy is dropped (ADR-012 revised).
No-GPS photos exist only as candidate-pool entries until placed; they
never receive synthetic coordinates.

**Edge case.** If a user starts dragging from the tray while a marker
popup is open, the popup is closed on `dragstart` from the tray to
prevent the drop landing on the popup DOM instead of the map canvas.

**Exit criteria.**

- Import 5 photos with no GPS → 5 thumbs appear in the tray, ordered
  by EXIF timestamp.
- Drag thumb onto map → subject pin appears at exact drop coord, tray
  shrinks by one.
- Drag thumb when a popup is open → popup closes on `dragstart`; drop
  lands on the map underneath.
- Tray empty → collapses to chevron; click chevron re-opens tray (when
  more no-GPS photos arrive).
- Tray state persists across reload (`noGpsTrayOpen` field).
- Tray covers ≤ 20% of map width and ≤ 120 px tall.
- Side panel "No GPS" group lists the same photos until placed.

---

## Phase 7 — Right-side photo list panel

**Scope.** A panel beside the map listing all imported photos, grouped by
flag. Two-way sync with the map.

**New / touched files.**

- `frontend/map-corridors/src/components/PhotoListPanel.tsx` *(new)*.
  MUI list grouped by `pick` / `neutral` / `reject` / `no-gps`. Group
  headers show counts; collapsible.
- `frontend/map-corridors/src/App.tsx` — mount panel iff the markers
  array contains at least one photo-derived entry (`marker.photoId !==
  undefined`); auto-hides when there are no photos.

**Acceptance (manual).**

- All photos appear in their correct group.
- Clicking an item → map flies to the photo's marker and opens its popup.
- Group counts update live as flags change.
- Panel collapses to a drawer on narrow screens.

---

## Phase 8 — Cross-app handoff: `map-picks.json` writer + photo-helper reader

**Scope.** Implement [ADR-005](./decisions.md#adr-005-cross-app-handoff-via-a-one-way-map-picksjson-file).
Map-corridors writes its picks to a dedicated `map-picks.json` per
competition; photo-helper reads it on competition load and on tab
visibility regain.

**New / touched files.**

*Writer (map-corridors):*

- `frontend/map-corridors/src/handoff/mapPicksWriter.ts` *(new)*:
  ```ts
  export type MapPicksFile = {
    version: 1;
    updatedAt: string;
    picks: MapPickEntry[];
  };
  export type MapPickEntry = {
    photoId: string;
    filename: string;
    flag: 'pick' | 'neutral' | 'reject';
    gps?: {
      capturedAt?: { lng: number; lat: number; altitude?: number; timestamp?: string };
      subjectAt?: { lng: number; lat: number };
    };
    label?: PhotoLabel;
  };
  export async function writeMapPicks(
    storage: StorageInterface,
    competitionDir: DirectoryHandle,
    picks: MapPickEntry[]
  ): Promise<void>;
  export async function flushPendingMapPicks(): Promise<void>;
  ```
  Single writer; serialized internally so two rapid calls do not race.
  Debounced 300 ms via a single setTimeout (`scheduleWrite` →
  coalesce). `flushPendingMapPicks()` synchronously executes the
  pending write if one is scheduled.
- `frontend/map-corridors/src/App.tsx` — call `scheduleWriteMapPicks`
  on every flag / label change. Register `pagehide` and `beforeunload`
  listeners to call `flushPendingMapPicks()` synchronously.

*Photo-helper prep (first commit of this branch):*

- Refactor `frontend/photo-helper/src/hooks/usePhotoSessionOPFS.ts`:
  extract the inline canvas-state literal in `buildPhotoFromFile`
  (around line 234) into an exported helper:
  ```ts
  export function createDefaultCanvasState(): ApiPhoto['canvasState'];
  ```
  Pure function, no `File` argument. `buildPhotoFromFile` calls it to
  build photo-helper-originated photos; `useMapPicksSync` (below)
  reuses it.

*Reader (photo-helper):*

- `frontend/photo-helper/src/hooks/useMapPicksSync.ts` *(new)*: ~70 LoC.
  Implements upsert + delete semantics per
  [ADR-019](./decisions.md#adr-019-usemappickssync-upsert-semantics-delete-propagation):
  ```ts
  export function useMapPicksSync(
    competitionDir: DirectoryHandle | null,
    storage: StorageInterface,
    sessionApi: {
      candidates: ApiPhoto[];
      upsertCandidate: (photo: ApiPhoto) => void;
      removeCandidate: (photoId: string) => void;
    }
  ): void;
  ```
  Effect (runs on `competitionDir` change and on
  `document.visibilitychange === 'visible'`):
  1. Read `competitions/{compId}/map-picks.json`; if absent, no-op.
  2. Build a `Set<photoId>` from the read entries.
  3. For each `MapPickEntry`:
     - If `photoId` not in pool: load the blob
       (`storage.getPhotoBlob(photosDir, photoId)`), `URL.createObjectURL`,
       construct `ApiPhoto` via `createDefaultCanvasState()`,
       `upsertCandidate`.
     - If `photoId` already in pool and entry is map-originated
       (`pm-` prefix): `upsertCandidate` with the new
       `flag` / `label` (preserve `canvasState` and other photo-helper
       fields).
  4. For each existing candidate with `photoId.startsWith('pm-')` that
     is **not** in the read set: `removeCandidate(photoId)`. This
     cleans up after deletes in map-corridors.
- `frontend/photo-helper/src/AppApi.tsx` — call `useMapPicksSync` once
  after the competition is loaded.

**Why no lock.** One writer (map-corridors), one reader (photo-helper).
The reader never writes; the writer never reads anyone else's file.
Web mode's "two tabs of the same browser sharing OPFS" risk is
contained: photo-helper read of `map-picks.json` is idempotent and
last-write-wins reads are safe (the worst that happens is a
millisecond-stale read on focus, fixed on the next visibilitychange).

**Exit criteria.**

- Toggle a flag in map tool → after 300 ms debounce, `map-picks.json`
  contains the new flag for the photo.
- Open photo-helper for the same competition → candidate tray contains
  every `pick` photo with default canvas state. Photos already in the
  candidate pool from prior sessions are preserved (no duplicate by
  `photoId`).
- Toggle a flag in map tool, immediately call "Send to editor" → the
  toggle is persisted (Phase 9 enforces the flush).
- Multiple rapid flag changes coalesce into a single write (no torn
  JSON, no `EBUSY` errors).
- Photo IDs from the map writer have the `pm-` prefix; photo-helper
  hook can identify map-origin entries.

---

## Phase 9 — Send-to-editor button

**Scope.** A button at the bottom of the photo list panel: "Send to editor
(N picks)". Navigates only ([ADR-009](./decisions.md#adr-009-send-to-editor-navigates-only)).

**Files touched.**

- `frontend/map-corridors/src/components/PhotoListPanel.tsx` — button.
- `frontend/desktop/preload.js` — already exposes `navigateToApp`.
- `frontend/map-corridors/src/App.tsx` — wire `onClick` to:
  ```ts
  async function onSendToEditor() {
    await flushPendingMapPicks();   // ADR-009 navigation-flush requirement
    if (window.electronAPI?.navigateToApp) {
      window.electronAPI.navigateToApp('photo-helper', competitionId);
    } else {
      window.location.href = `/photo-helper/?competitionId=${competitionId}`;
    }
  }
  ```
- Register a `pagehide` listener that calls `flushPendingMapPicks()`.
  On web, this is best-effort (OPFS writes are async; if the page is
  frozen mid-write, the next session sees the last successful write).
  `beforeunload` is intentionally **not** used — it doesn't await
  async work and only adds the appearance of safety.

**Exit criteria.**

- Button disabled when 0 picks; live count in label.
- Click → flush completes → app switches → candidate tray pre-populated.
- Test: toggle flag, click Send within 50 ms — toggle is persisted
  before navigation (verified via `map-picks.json` content + photo-helper
  candidate tray on arrival).

---

## Phase 10 — Locales (en + cs) + a11y polish

**Scope.** All visible strings localized. Czech uses proper diacritics.

**Files touched.**

- `frontend/map-corridors/src/locales/en.json`
- `frontend/map-corridors/src/locales/cs.json`

**Keys to add (illustrative):**

```
photo.source.modeToggle.corridor    "Corridor (KML/GPX)" / "Trať (KML/GPX)"
photo.source.modeToggle.photo       "Photo (EXIF GPS)"   / "Fotky (EXIF GPS)"
photo.import.dropHere               "Drop photos here, or"
photo.import.addButton              "Add photos"
photo.import.progress               "Importing {{done}} of {{total}}…"
photo.import.heicRejected           "HEIC not supported. Convert to JPEG."
photo.action.include                "Include" / "Vybrat"
photo.action.skip                   "Skip" / "Přeskočit"
photo.action.reject                 "Reject" / "Zamítnout"
photo.hideRejects                   "Hide rejects" / "Skrýt zamítnuté"
photo.list.groupPicks               "Picks" / "Vybrané"
photo.list.groupNeutral             "Neutral" / "Neutrální"
photo.list.groupRejects             "Rejects" / "Zamítnuté"
photo.list.groupNoGps               "No GPS" / "Bez GPS"
photo.sendToEditor                  "Send to editor ({{count}})" / "Otevřít v editoru ({{count}})"
photo.noGpsTray.header              "Photos without GPS" / "Fotky bez GPS"
photo.noGpsTray.dragHint            "Drag onto the map to place" / "Přetáhněte na mapu pro umístění"
photo.noGpsTray.empty               "No photos without GPS" / "Žádné fotky bez GPS"
```

**Exit criteria.**

- All strings rendered via `t()`.
- No hard-coded English in the new components.
- Czech text uses proper diacritics (verified by reviewer).

**Accessibility (label picker requires explicit handling).**

- Label picker (20 buttons A–T or 1–20) uses `aria-pressed` for the
  currently-assigned label and `aria-disabled="true"` for labels already
  taken by another photo.
- Non-color taken indicator: strikethrough + reduced font weight on
  taken-label buttons. Color alone is insufficient for WCAG AA.
- Keyboard navigation: Arrow keys move between label buttons; Enter
  selects; Tab moves out of the grid to the next action.
- Esc closes any popup.
- Focus ring visible on all interactive elements (MUI default + audit).
- Drag-from-tray (Phase 6) has a keyboard-equivalent: focus the
  thumbnail, press Enter, click a point on the map. (Out of scope v1 if
  it adds complexity; document as known a11y gap.)
- Screen reader: each marker / pin has an `aria-label` like
  "Photo 17, label A, picked".

---

## Phase 11 — Manual smoke + bug bash + PR

**Scope.** End-to-end manual run-through against a real photo batch. Fix
edge cases. Move PR out of draft.

**Smoke script.**

1. Open desktop launcher, create a new competition "Smoke Test", select
   discipline Rally.
2. Open Photo Placement.
3. Drop 30 JPEGs with GPS → 30 dots appear, map fits bounds, photo
   side panel appears.
4. Drop 5 more JPEGs without GPS → 5 orange `?` markers along bottom.
5. Click a GPS dot → popup with thumb. Click Include → becomes pin at
   capture point. Drag pin 100 m away → dashed line + ghost marker
   appear.
6. Assign label A.
7. Click a no-GPS marker → drag to corridor → orange disappears, becomes
   normal pin.
8. Reject 3 photos. Toggle "Hide rejects" → red dots disappear.
9. Open right-side panel → verify counts: 1 pick / 4 neutral / 3 rejects /
   4 no-GPS.
10. Click "Send to editor (1)" → photo-helper opens, candidate tray
    contains the 1 pick.
11. Drag tray photo into slot A → label persists.
12. Return to Photo Placement → photo is still flagged pick, in slot A in
    photo-helper. Drag it back to tray in photo-helper → flag becomes
    pick in map tool after reload (or via mirror).
13. Reload the app entirely → all state survives.
14. Drop a `.heic` file → friendly error toast.
15. Drop a corrupt `.jpg` → it appears in the failure list, import does
    not abort.
16. Fresh install, no Mapbox token configured → after dropping photos,
    the token-config CTA surfaces prominently. After dismissing, photo
    rendering still works with the OSM fallback (or shows a clear
    "configure a map provider" empty state if no fallback ships).
17. Re-import the same folder a second time → "N photos already
    imported, M new" toast; no duplicate thumbs in the right-side panel.

**PR description checklist.**

- Decision links to each ADR.
- Screenshots / GIFs of the four marker states.
- Test plan checked items.
- Known limitations (HEIC, etc.).

---

## Test plan summary

### Unit (Vitest)

- `extractExif.test.ts` *(vitest+jsdom)* — GPS, no-GPS, (0,0) exact,
  HEIC reject (by extension + by content), corrupt input.
- `generateThumb.test.ts` *(@vitest/browser)* — size, orientation
  correctness on Orientation=1 (already-rotated) and Orientation=6
  (sideways), JPEG quality, corrupt input.
- `importPhotoFiles.test.ts` *(vitest+jsdom)* — concurrency-of-8,
  progress callbacks, failure isolation, mid-batch savePhotoFile
  rejection.
- `mapPicksWriter.test.ts` — debounce coalescing, `flushPendingMapPicks`
  synchronously executes pending writes, idempotent `writeMapPicks`.
- `useMapPicksSync.test.ts` — projects `MapPickEntry` to `ApiPhoto`
  with default `canvasState`; merges (no duplicate by photoId);
  re-reads on visibilitychange.
- `photoMarker.persistence.test.ts` — round-trip through
  `corridors-session.json` with `capturedAt`, `photoId`. Malformed
  `capturedAt` rejected by `sanitizePhotoMarkers`.
- `markerLayers.test.ts` — GeoJSON source data is correct for capture
  dots, rejected dots, dashed lines.

### Integration (manual; recorded in PR)

- Smoke script above.

### Cross-app contract coverage

The `map-picks.json` contract is the load-bearing handoff between the
two apps. Primary coverage comes from per-side unit tests that exercise
the contract from each direction:

- `mapPicksWriter.test.ts` (map-corridors side): writes a fixture
  picks set, asserts the produced `map-picks.json` matches the
  expected shape and content.
- `useMapPicksSync.test.ts` (photo-helper side): given a fixture
  `map-picks.json`, asserts the hook upserts / deletes correctly and
  preserves photo-helper-originated entries (`pm-` namespace check).

A full cross-app integration test (booting both apps against a
shared OPFS shim) is **recommended** but not blocking; if the per-side
unit tests stay tight and the Phase 11 manual smoke exercises the
end-to-end path, the integration test can land as a follow-up.

---

## Risks and mitigations

Risks already resolved by an ADR are not repeated here — see ADR-005
(write race), ADR-009 (navigation race), ADR-015 (EXIF double-rotation),
ADR-016 (marker perf), ADR-018 (OPFS quota policy), ADR-019 (deletion
propagation).

| Risk | Severity | Mitigation |
|---|---|---|
| `exifr` bundle larger than expected | MED | Phase 0 measures actual contribution and records in PR. Soft target ≤ 15 KB gz; if > 25 KB, switch to a manual GPS-only parser (~5 lines). |
| `pica` added but bloats map-corridors bundle | LOW | v1 starts without `pica` — plain canvas downscale to 200×150 is adequate for popup thumbs. Only add if Phase 1 measurement shows visible quality regression. |
| Mapbox token not configured on first app open | MED | Photo culling is useless without a map. Surface the token-config CTA prominently when the user has imported photos but no token is set. Fallback to OpenStreetMap raster tile (no token needed) — see [Open question](#open-implementation-questions). |
| User accidentally clicks "Send to editor" with 0 picks | LOW | Button disabled when picks = 0. |
| Coordinate precision at high zoom (sub-meter) | LOW | float64 throughout. The existing `dragMovedPxRef` click-vs-drag threshold of 8 px (≈ 1.2 m at zoom 19) is shared by all marker types in `MapProviderView`; do not lower it globally. If photo-mode subject pins prove to misclassify drag-as-click, add a per-marker threshold prop rather than changing the default. |
| Browser drag-and-drop quirks on Windows | LOW | Already exercised by existing dropzone code. Reuse `react-dropzone`. |
| `competitionService.saveSessionPhotos` re-fetches all blobs on every save | MED | At 100 photos this can add 200–400 ms per save. Track a dirty-photo set; only re-fetch blob URLs for changed photos. |
| Photo blob orphans after OPFS eviction | LOW | On session load, validate each `photoId` has a corresponding file in `photos/`. Surface a non-blocking banner if any are missing. |
| HEIC by content but `.jpg` extension | LOW | `extractExif` checks file content (magic bytes), not just extension. Test fixture covers misnamed HEIC. |
| StrictMode double-mount drops GeoJSON source registrations in dev | LOW | Smoke against `pnpm dev` before merge; pattern is documented in `react-map-gl` issues. Production builds aren't affected. |
| Cross-tab photo write collision (same content, two tabs) | LOW | `pm-` namespace prevents accidental collisions across apps; deliberate cross-tab duplication is last-write-wins (acceptable). `savePhotoFile` is documented as last-write-wins. |
| `getPathForFile` Electron-only | LOW | Map-corridors photo import path uses the standard browser File API; no Electron-only path needed (unlike photo-helper's existing `read-photo-file` IPC for some edge cases). Document in Phase 3. |

---

## Rollback plan

If a serious issue surfaces post-merge:

1. **Feature flag the toggle** (`?photoMode=1` URL parameter gates
   visibility of the `Source` chip). Default off until confidence
   restored.
2. **Data is safe.** Existing corridor sessions never reference the new
   fields; reverting the feature doesn't lose corridor work.
3. **Photo data orphans.** If we revert and users had photos under
   `competitions/{compId}/photos/`, they remain on disk but no UI shows
   them. Photo-helper still sees them in the candidate pool (forward
   compat).
4. **No DB migration to undo.** Schema additions are backwards-compatible
   (all new fields optional).

---

## Open implementation questions

These are not blocking design, but should be answered during early
implementation by the implementer:

1. **Debounce window for candidate pool mirror.** 300 ms is a guess.
   Profile under rapid flag toggles and adjust.
2. **MapLibre clustering threshold.** At what zoom level do clusters
   form? Default likely fine; revisit if dense competitions feel busy.
3. **Thumbnail max dimensions.** 200×150 is a guess for popup; pick
   smaller for tooltip (80×60?). Confirm with design pass.
4. **No-GPS tray scroll vs. wrap behavior** at very high counts (50+
   no-GPS photos). v1 ships horizontal scroll only. If hit, add a
   "scroll to next" affordance or wrap to two rows.
5. **Photo-helper change for `gps` field display**. Out of scope for v1
   (just metadata); but consider a small footer line on printed photos in
   v2 showing "subject coords".
6. **OSM-tile fallback when Mapbox token is absent**. Mentioned in the
   risk table as a mitigation, but the exact tile source and attribution
   need confirming.
7. **`extractExif` HEIC-by-content detection** — verify `exifr` accepts a
   magic-byte sniff or whether we need a separate prefix check.

---

## Phase 12 — Photo variants (side-by-side compare)

**Why now.** Organisers commonly shoot the same turn point 2–3× (insurance
against motion blur, framing, or a passing aircraft in front of the
subject). The per-photo Include/Skip/Reject flow forces a row-by-row
judgement; users wanted an "eyes side-by-side, then pick" affordance.
Originally deferred to v2 ([decisions.md → Deferred](decisions.md#decisions-explicitly-deferred-to-v2));
promoted because the workflow is now hot.

**Scope.** Manual selection (Ctrl/Cmd+click + Shift+click range) of 2–3
variants in `PhotoListPanel`, then a side-by-side `Dialog` to pick the
winner. Winner is auto-promoted to `flag='pick'`; losers move to
`flag='reject'`, which (Step 2 of this phase) hides them from the map
entirely. The rejected losers remain in the "Odmítnuté" list group as the
undo path — files stay in OPFS.

**Out of scope.**
- Auto-clustering by GPS proximity + timestamp. Manual only for v1.
- Persistent variant-group records. Selection is ephemeral.
- Bidirectional sync with Photo Helper. Cross-app contract unchanged
  ([ADR-005](decisions.md#adr-005--cross-app-handoff-via-a-one-way-map-picksjson-file)) —
  only picks reach the editor.

**Files touched.**
- `frontend/map-corridors/src/map/MapProviderView.tsx` — render filter
  rejects markers (`flag !== 'reject'`).
- `frontend/map-corridors/src/map/photoLayers/captureFeatures.ts` —
  matching filter on the ghost-dot + dashed-line projections so the
  capture marker disappears with its pin.
- `frontend/map-corridors/src/components/PhotoListPanel.tsx` — selection
  state, Ctrl/Cmd/Shift handling, "Srovnat varianty (N)" footer button.
  New pure helpers `toggleSelection` / `computeRangeSelection`.
- `frontend/map-corridors/src/components/PhotoCompareModal.tsx` — new MUI
  Dialog rendering N tiles side-by-side. Loads full-res via
  `usePhotoFullUrl`.
- `frontend/map-corridors/src/components/usePhotoFullUrl.ts` — new sibling
  hook of `usePhotoThumbUrl`.
- `frontend/map-corridors/src/App.tsx` — owns modal state +
  `handleCompareResolve` (single `persistMarkers` write so a reload
  mid-resolve can never observe a half-applied state).
- `frontend/map-corridors/src/locales/{cs,en}.json` — `photo.list.compareSelected`,
  `photo.list.compareLimitTip`, `photo.list.clearSelection`,
  `photo.compare.*`.

**Smoke addendum (extends Phase 11 script).**

a. Drop 3 JPGs whose GPS sits within ~50 m of the same turn point.
b. Ctrl-click 3 rows in the panel → "Srovnat varianty (3)" appears.
c. Click → modal opens, full-res images side-by-side.
d. Press `2` (or click "Vybrat tuto" on tile 2) → modal closes.
   Map shows 1 pin (blue, pick); the other 2 variants' pins are gone;
   "Odmítnuté" group shows the 2 losers.
e. Hard reload → state survives.
f. Un-reject one loser from the panel → its marker reappears.
g. Click "Send to editor (1)" → Photo Helper receives only the winner.

---

## Phase 13 — Active-photo highlight (map ↔ list sync)

**Why now.** Users lose track of which map marker maps to which side-panel
row. We already had `activePhotoMarkerId` (the photo whose popup is open) but
it was private to `MapProviderView`, so the list couldn't reflect it. See
[ADR-023](decisions.md#adr-023--active-photo-highlight-map-marker--list-row-sync).

**Scope.** Lift `activePhotoMarkerId` to `App.tsx` as one source of truth.
Highlight the active photo on both surfaces: glow + scale on the map marker,
filled tint on the list row (auto-scroll + group auto-expand). Lifecycle is
popup-tied; clears on close, delete, or reject. Variant `selectedIds` is
untouched and stays visually distinct (left border vs. fill).

**Out of scope.**
- A persistent selection separate from the popup (rejected — one concept).
- Highlighting no-GPS tray photos (they have no marker).

**Files touched.**
- `frontend/map-corridors/src/App.tsx` — owns `activePhotoMarkerId`; passes it
  + `onActivePhotoMarkerChange` to `MapProviderView` and a derived `activePhotoId`
  to `PhotoListPanel`. `onMarkerClick` (→ `flyToPhotoMarker`) sets it via the
  callback, so list clicks update the highlight for free.
- `frontend/map-corridors/src/map/MapProviderView.tsx` — now controlled (reads
  `props.activePhotoMarkerId`, requests via `onActivePhotoMarkerChange`); marker
  glow + `scale(1.3)` + `zIndex` when active; prune effect extended to clear on
  `flag === 'reject'` as well as deletion.
- `frontend/map-corridors/src/components/PhotoListPanel.tsx` — `activePhotoId`
  prop; row tint (`alpha(primary, 0.14)`); `scrollIntoView` on the active row;
  group auto-expand effect; new exported pure helper `groupKeyForPhotoId`.

**Tests.** `__tests__/groupKeyForPhotoId.test.ts` — picks/neutral/rejects
mapping, unknown id → null, no-GPS photo → null.

**Smoke addendum.**

a. Import several GPS photos → markers + list rows appear.
b. Click a marker on the map → its list row tints and scrolls into view; the
   row's group expands if it was collapsed.
c. Click a different list row → camera flies, old highlight clears, the new
   marker glows + scales above its neighbours.
d. Close the popup / click empty map → both highlights clear.
e. Reject the active photo (popup or variant compare) → marker vanishes and the
   highlight clears (no orphan tint).
f. Ctrl-click rows for variant compare → left-border accent still reads
   distinctly from the active fill (a row can show both).

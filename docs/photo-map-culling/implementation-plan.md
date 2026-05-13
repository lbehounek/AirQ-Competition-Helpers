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

- `frontend/map-corridors/src/types/markers.ts` — extend `PhotoMarker`:
  ```ts
  export type PhotoMarker = {
    id: string;
    lng: number;
    lat: number;
    name: string;
    label?: PhotoLabel;
    capturedAt?: {
      lng: number;
      lat: number;
      altitude?: number;
      timestamp?: string;
    };
    photoId?: string;
  };
  ```
  (No `needsPlacement` field — per [ADR-012](./decisions.md#adr-012-no-gps-photo-placement-off-map-tray-pinned-to-map-corner)
  a no-GPS photo is *not* a PhotoMarker until placed.)
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
- `frontend/map-corridors/package.json` — add `@vitest/browser` and a
  Playwright browser provider to `devDependencies` (canvas tests can't
  run in jsdom). Pin exact versions.
- `frontend/map-corridors/vite.config.ts` — add a `test.browser` block
  for the canvas-touching test suite (the jsdom suite stays as today).
- `frontend/map-corridors/src/hooks/useCorridorSessionOPFS.ts` —
  bump session JSON schema version + add migration shim that defaults the
  new fields to `undefined` on load.

**Exit criteria.**

- TypeScript compiles in both `map-corridors` and `photo-helper`.
- `pnpm --filter @airq/map-corridors build` and
  `pnpm --filter @airq/photo-helper build` succeed.
- Existing corridor session JSONs from before the change load without
  errors (schema migration path exercised).
- **Bundle-size budget verified.** Run `pnpm --filter @airq/map-corridors build`
  and inspect the Vite build report; the new `exifr` import contributes
  ≤ 12 KB gz. If higher, switch to manual EXIF parser (5 lines for GPS-only)
  or accept and document.
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

```
extractExif.test.ts                                    (vitest + jsdom)
  ✓ extracts lat/lng from JPEG with GPS
  ✓ returns capturedAt: undefined for JPEG without GPS
  ✓ treats (0,0) exact GPS as absent (not (0, 0.0001))
  ✓ returns timestamp from DateTimeOriginal in ISO format
  ✓ returns orientation tag
  ✓ rejects HEIC by extension AND by content (mis-named .jpg HEIC)

generateThumb.test.ts                                  (@vitest/browser)
  ✓ produces JPEG at most maxWidth × maxHeight
  ✓ output is upright for camera-sideways JPEG (Orientation=6)
  ✓ output is upright for phone-pre-rotated JPEG (Orientation=1)
     — guards against double-rotation
  ✓ JPEG quality 0.7 produces < 30 KB for typical 4 MP input
  ✓ rejects corrupt JPEG with thrown reason (caught by importPhotoFiles)

importPhotoFiles.test.ts                               (vitest + jsdom)
  ✓ runs in parallel batches of 8 (verifies concurrency, not wall-clock)
  ✓ surfaces per-file progress
  ✓ collects failures without aborting the batch
  ✓ rejects HEIC at the top
  ✓ rejects non-image MIME types
  ✓ simulated savePhotoFile rejection mid-batch → failure list contains
     the file, no orphan marker
```

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

## Phase 3 — Mode toggle + photo dropzone in map-corridors

**Scope.** Add the visible `Corridor / Photo` chip to the map header. Wire
the dropzone to accept JPEG/PNG in photo mode. Run `importPhotoFiles` and
write to storage. Persist mode in corridor session JSON.

**Files touched.**

- `frontend/map-corridors/src/components/SourceModeToggle.tsx` *(new)* —
  MUI `ToggleButtonGroup` with two options. Persists to session.
- `frontend/map-corridors/src/App.tsx` — mount toggle, branch dropzone
  behaviour.
- `frontend/map-corridors/src/hooks/useCorridorSessionOPFS.ts` — add
  `sourceMode: 'corridor' | 'photo'` field to `CorridorsSession`.
- `frontend/map-corridors/src/locales/en.json` + `cs.json` — strings.

**Exit criteria.**

- Toggle renders correctly in light theme (matches existing chrome).
- Dropping a `.kml` file in photo mode shows a friendly toast: "KML is for
  Corridor mode — switch sources to import a corridor."
- Dropping `.jpg` in photo mode → import pipeline runs, progress visible.
- Mode survives reload.

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
  layers in photo mode; preserve existing corridor-marker rendering for
  KML/GPX flow.

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
- Subject pin drag updates `marker.lng/lat`; dashed line redraws via
  GeoJSON source-data update on **drag-end** (not per-tick).
- "Hide rejects" toggle (US-13) hides red dots via a Mapbox paint filter,
  zero DOM churn.
- Existing KML-marker rendering unchanged.

**Note on library naming.** The React binding entry point is
`react-map-gl/mapbox` (Mapbox GL), not `maplibre-gl`. Earlier doc
references to "MapLibre clustering" were imprecise — the existing
infrastructure uses Mapbox GL. MapLibre remains in deps as a fallback
style provider but is not the marker-mount layer.

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

**Exit criteria.**

- Import 5 photos with no GPS → 5 thumbs appear in the tray, ordered
  by EXIF timestamp.
- Drag thumb onto map → subject pin appears at exact drop coord, tray
  shrinks by one.
- Tray empty → collapses to chevron; click chevron re-opens tray (when
  more no-GPS photos arrive).
- Tray state persists across reload.
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
- `frontend/map-corridors/src/App.tsx` — mount panel in photo mode;
  hidden in corridor mode.

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

*Reader (photo-helper):*

- `frontend/photo-helper/src/hooks/useMapPicksSync.ts` *(new)*: ~50 LoC.
  ```ts
  export function useMapPicksSync(
    competitionDir: DirectoryHandle | null,
    sessionApi: { addCandidatePhotos: (apiPhotos: ApiPhoto[]) => void; existingPhotoIds: Set<string> }
  ): void;
  ```
  Effect:
  1. On `competitionDir` change: read `map-picks.json`, project each
     `MapPickEntry` whose `photoId` is *not* in `existingPhotoIds` into
     an `ApiPhoto` with default `canvasState` (using existing
     `createDefaultCanvasState()` helper), and push into the candidate
     pool.
  2. Subscribe to `document.visibilitychange`; re-run the read on
     `visible`.
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
- Register `pagehide` and `beforeunload` listeners that synchronously
  invoke `flushPendingMapPicks()` as a belt-and-suspenders safeguard for
  back-button navigation, tab close, refresh.

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
2. Open Photo Placement → switch to Photo source mode.
3. Drop 30 JPEGs with GPS → 30 dots appear, map fits bounds.
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

### Cross-app contract test (mandatory, not optional)

This is the load-bearing assumption of the feature, so it gets a
real test:

- Boot map-corridors against a temporary OPFS competition directory.
- Toggle a flag → wait for debounced write → verify `map-picks.json`
  shape and content.
- Boot photo-helper against the same dir. Invoke `useMapPicksSync` and
  assert the candidate pool receives the corresponding `ApiPhoto`.
- Add a regression case: photo-helper-originated photos in the
  candidate pool are not overwritten by map-side picks (namespace
  check on `pm-` prefix).
- Test in `frontend/test/cross-app/` as a new test target, running
  against an OPFS shim so it works in CI.

---

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| `exifr` tree-shake doesn't kick in → 30 KB+ added | MED | Phase 0 gates on a measured ≤ 12 KB gz contribution. Fall back to inline canvas EXIF parser (~5 lines for GPS-only) if size unacceptable. |
| `pica` added but bloats map-corridors bundle | LOW | v1 starts without `pica` — plain canvas downscale to 200×150 is adequate for popup thumbs. Only add `pica` if Phase 1 measurement shows visible quality regression at popup size. |
| Marker render perf at 100+ photos | HIGH | Resolved by ADR-016 (GeoJSON layers for static dots; `<Marker>` only for picks). Phase 4 exit criterion verifies 60 fps at 100 dots. |
| Concurrent writers to a single JSON file | RESOLVED | ADR-005 (revised) uses one-way `map-picks.json`: one writer (map-corridors), one reader (photo-helper). No lock needed. |
| Navigation race: debounced write lost on app switch | RESOLVED | ADR-009 (revised) requires `await flushPendingMapPicks()` before navigation + `pagehide`/`beforeunload` listeners. |
| EXIF orientation double-rotation on phone-pre-rotated photos | RESOLVED | ADR-015: use `createImageBitmap(file, { imageOrientation: 'from-image' })` — the browser handles both conventions per spec. |
| OPFS quota at high photo counts | MED | Hard pre-flight check: `getStorageEstimate().usage + estimatedBatch > 0.8 * quota` blocks the drop with a friendly modal. Existing `isStorageLow` warning continues to fire. |
| Mapbox token not configured on first app open | MED | Photo source mode is useless without a map. Surface the token-config CTA prominently. Fallback to OpenStreetMap raster tile (no token needed) if token absent. |
| User accidentally clicks "Send to editor" with 0 picks | LOW | Button disabled when picks = 0. |
| Coordinate precision loss when dragging at high zoom | LOW | float64 throughout. Existing `dragMovedPxRef` threshold of 8 px equals ~1.2 m at zoom 19 — could misclassify a precise placement as click. Lower threshold to 3 px for photo-mode subject pins. |
| Browser drag-and-drop API quirks on Windows | LOW | Already exercised by existing dropzone code. Reuse `react-dropzone`. |
| `competitionService.saveSessionPhotos` re-fetches all blobs on every save | MED | Existing dedup-by-id at line 591 helps but every persistence still iterates all pools. At 100 photos this can add 200–400 ms per save. Mitigation: track a dirty-photo set; only re-fetch blob URLs for changed photos. |
| Photo blob orphans after OPFS eviction | LOW | On session load, validate each `photoId` in the candidate pool has a corresponding file in `photos/`. Surface a non-blocking banner if any are missing. |
| Web tab × two = OPFS shared origin race | MED | Mitigated by ADR-005's single-writer-per-file design. Photo-helper reads on visibilitychange so a stale read self-heals within a focus cycle. |
| HEIC by content but `.jpg` extension | LOW | `extractExif` checks file content (magic bytes), not just extension. Test fixture covers misnamed HEIC. |

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

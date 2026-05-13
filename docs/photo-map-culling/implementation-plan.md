# Implementation Plan — Photo Map Culling

This plan turns the decisions in [decisions.md](./decisions.md) into ordered
phases with file-level scope. Each phase has explicit exit criteria so it
can be reviewed and merged on its own (or all phases can ship as one PR —
see [Delivery shape](#delivery-shape)).

The plan assumes `feat/candidate-photos` has merged to `main` before
implementation starts — the candidate pool is the handoff foundation
([ADR-005](./decisions.md#adr-005-cross-app-handoff-via-shared-candidate-pool)).

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

- [ ] `feat/candidate-photos` is merged to `main`.
- [ ] The candidate pool's persistence works end-to-end (manual smoke).
- [ ] `frontend/photo-helper/src/types/api.ts` defines `CandidatePool`
      and `ApiPhoto.flag` as expected.
- [ ] `exifr` latest version checked on npm; note exact version for the
      install (no caret, per global dependency-pinning rule).
- [ ] Sample test photos available: 1× JPEG with GPS, 1× JPEG without GPS,
      1× JPEG with bad orientation, 1× HEIC (for the reject path),
      1× corrupt JPEG.

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
      heading?: number;
      timestamp?: string;
    };
    photoId?: string;
    needsPlacement?: boolean;
  };
  ```
- `frontend/photo-helper/src/types/api.ts` — extend `ApiPhoto`:
  ```ts
  export interface ApiPhoto {
    // ...existing fields
    gps?: {
      capturedAt?: { lng: number; lat: number; altitude?: number; heading?: number };
      subjectAt?: { lng: number; lat: number };
      timestamp?: string;
    };
  }
  ```
- `frontend/map-corridors/package.json` — add `exifr` (exact version).
- `frontend/map-corridors/src/hooks/useCorridorSessionOPFS.ts` —
  bump session JSON schema version + add migration shim that defaults the
  new fields to `undefined` on load.

**Exit criteria.**

- TypeScript compiles in both `map-corridors` and `photo-helper`.
- `pnpm --filter @airq/map-corridors build` and
  `pnpm --filter @airq/photo-helper build` succeed.
- Existing corridor session JSONs from before the change load without
  errors (schema migration path exercised).

**Test focus.**

- Unit test: load a v1 corridors-session.json (without new fields) →
  PhotoMarker array reads fine, `capturedAt` is undefined.

---

## Phase 1 — EXIF + thumbnail pipeline (pure module)

**Scope.** A standalone module that takes File objects and produces
`{ photoId, exifGps, thumbnailBlob, originalBlob, failed }`. Pure
domain logic — no UI, no map, no storage. Fully unit-testable.

**New files.**

- `frontend/map-corridors/src/photoImport/extractExif.ts`
  ```ts
  export type ExifData = {
    capturedAt?: { lng: number; lat: number; altitude?: number; heading?: number };
    timestamp?: string;
    orientation?: number;
  };
  export async function extractExif(file: File): Promise<ExifData>;
  ```
- `frontend/map-corridors/src/photoImport/generateThumb.ts`
  ```ts
  export async function generateThumb(
    file: File,
    opts?: { maxWidth?: number; maxHeight?: number; quality?: number; orientation?: number }
  ): Promise<Blob>;
  ```
  Uses canvas + `pica` (already in workspace via photo-helper; verify
  tree-shake). Honours the EXIF orientation tag so the popup shows
  upright.
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
  `Promise.all` in batches of 8 ([ADR-015](./decisions.md#adr-015-import-throughput-main-thread-throttled-at-8-concurrent)).

**Exit criteria.**

- 95%+ unit test coverage on the pipeline.
- All edge cases covered: GPS present, GPS absent, GPS `(0,0)` (treated as
  absent), bad orientation tag (canvas correction verified), HEIC rejected
  with reason, corrupt JPEG → failure list.
- Mock fixture set checked into `frontend/map-corridors/test/fixtures/`.

**Test focus.**

```
extractExif.test.ts
  ✓ extracts lat/lng from JPEG with GPS
  ✓ returns capturedAt: undefined for JPEG without GPS
  ✓ treats (0,0) GPS as absent
  ✓ returns timestamp from DateTimeOriginal in ISO format
  ✓ returns orientation tag

generateThumb.test.ts
  ✓ produces JPEG at most 200×150 px
  ✓ rotates 90/180/270 based on orientation tag
  ✓ quality 0.7 produces < 30 KB for typical 4 MP input

importPhotoFiles.test.ts
  ✓ runs in parallel batches of 8
  ✓ surfaces per-file progress
  ✓ collects failures without aborting the batch
  ✓ rejects HEIC at the top
  ✓ rejects non-image MIME types
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

## Phase 4 — Marker rendering: capture/subject distinction

**Scope.** Extend `MapProviderView` to render capture-vs-subject markers
correctly. Three marker visual states ([decisions.md §UI](./decisions.md)):

- **Capture-only** (no flag yet): small grey dot at `capturedAt`.
- **Picked** (flag = `pick`): coloured pin at `lng/lat`, ghost marker at
  `capturedAt` with dashed line between (when they differ).
- **Rejected** (flag = `reject`): red ✗ with 40% opacity.
- **Needs placement** (no GPS): orange `?` glyph at viewport-anchored coord.

**Files touched.**

- `frontend/map-corridors/src/map/MapProviderView.tsx` — extend marker
  rendering loop (currently lines 332-375). Add a helper:
  ```tsx
  function renderPhotoMarker(marker: PhotoMarker): ReactNode {
    if (marker.needsPlacement) return <NeedsPlacementMarker {...} />;
    const hasCapture = marker.capturedAt !== undefined;
    const flag = lookupFlag(marker.id);
    if (flag === 'reject') return <RejectedDot ... />;
    if (flag === 'pick') return (
      <>
        <SubjectPin draggable onDragEnd={...} />
        {hasCapture && capturedDiffers(marker) && (
          <>
            <CaptureGhostMarker />
            <DashedLine from={marker.capturedAt} to={marker} />
          </>
        )}
      </>
    );
    return <CaptureDot />;
  }
  ```
- `frontend/map-corridors/src/map/markers/` *(new directory)* — small
  presentational components: `CaptureDot`, `CaptureGhostMarker`,
  `SubjectPin`, `RejectedDot`, `NeedsPlacementMarker`, `DashedLine`
  (rendered via a tiny GeoJSON layer).

**Exit criteria.**

- All four visual states render correctly with sample data.
- Dragging a `SubjectPin` updates `marker.lng/lat` (not `capturedAt`).
- Dashed line redraws on every drag tick (or on drag-end, depending on
  performance).
- Clicking a marker still opens the popup (Phase 5).

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

## Phase 6 — No-GPS placement strategy

**Scope.** Implement [ADR-013](./decisions.md#adr-013-no-gps-photo-placement-strategy):
photos without GPS arrive in a row along the bottom of the viewport,
ordered by capture time.

**New / touched files.**

- `frontend/map-corridors/src/photoImport/placeNoGpsPhotos.ts` *(new)*:
  ```ts
  export function placeNoGpsPhotos(
    photos: ImportedPhoto[],
    viewport: { bounds: [[number, number], [number, number]]; width: number; height: number },
    opts?: { spacingPx?: number; bottomMarginPx?: number }
  ): Array<{ photoId: string; lng: number; lat: number }>;
  ```
  Pure function. Sorts by `exif.timestamp` (fallback: filename
  alphabetical). Computes lng/lat for each photo from the viewport bounds
  + a screen-space offset (so they appear ~`bottomMarginPx` from the
  bottom edge, `spacingPx` apart horizontally). Wraps to a second row
  above if total width exceeds viewport width.
- `frontend/map-corridors/src/App.tsx` — call `placeNoGpsPhotos` for
  photos that come back from `importPhotoFiles` with no `exif.capturedAt`,
  set `marker.needsPlacement = true`, and place at the computed coords.
  Then add to `markers[]` as PhotoMarkers.

**Exit criteria.**

- Drop a batch of 5 photos with no GPS → all visible along the bottom of
  the map, ordered by capture time.
- Each marker is independently draggable; on first drag, `needsPlacement`
  flips to `false` and the marker behaves like a normal subject pin.
- Side panel "No GPS" section lists the same photos with a `?` indicator.

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

## Phase 8 — Cross-app handoff: candidate pool mirror

**Scope.** Implement [ADR-005](./decisions.md#adr-005-cross-app-handoff-via-shared-candidate-pool).
Every flag change in the map tool writes to
`session.candidates.photos[]` in the photo-helper session JSON.

**New / touched files.**

- `frontend/map-corridors/src/handoff/candidatePoolMirror.ts` *(new)*:
  ```ts
  export async function syncToCandidatePool(
    storage: StorageInterface,
    competitionDir: DirectoryHandle,
    markers: PhotoMarker[],
    flags: Record<string, CandidateFlag>
  ): Promise<void>;
  ```
  Reads photo-helper's `session.json`, replaces `candidates.photos` with
  the photo-mode selection, writes back. Debounced; idempotent.
- `frontend/map-corridors/src/App.tsx` — call `syncToCandidatePool` on
  every flag change (debounced 300 ms).

**Exit criteria.**

- Set a flag in map tool → open photo-helper after debounce flush →
  candidate tray reflects the flag.
- Set a flag in photo-helper → photo-helper writes back to its own
  session; map tool reads back on next focus (or via a periodic poll —
  TBD; simplest is "stale until user toggles").
- No corrupted JSON under rapid flag changes (debounce + sequential
  write).
- Photo IDs match between the two sessions (same `photoId` key).

---

## Phase 9 — Send-to-editor button

**Scope.** A button at the bottom of the photo list panel: "Send to editor
(N picks)". Navigates only ([ADR-010](./decisions.md#adr-010-send-to-editor-navigates-only)).

**Files touched.**

- `frontend/map-corridors/src/components/PhotoListPanel.tsx` — button.
- `frontend/desktop/preload.js` — already exposes `navigateToApp`.
- `frontend/map-corridors/src/App.tsx` — wire `onClick` to
  `electronAPI?.navigateToApp('photo-helper', { competitionId })` for
  Electron, or `window.location.href = '/photo-helper/?competitionId=…'`
  for web.

**Exit criteria.**

- Button disabled when 0 picks; live count in label.
- Click → app switches; candidate tray pre-populated.

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
photo.needsPlacement                "Drag to place" / "Přetáhněte na pozici"
```

**Exit criteria.**

- All strings rendered via `t()`.
- No hard-coded English in the new components.
- Czech text uses proper diacritics (verified by reviewer).
- Keyboard navigation: Tab through the popup actions; Esc closes popup.
- Focus visible on all interactive elements.

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
- Known limitations (HEIC, drone, etc.).

---

## Test plan summary

### Unit (Vitest)

- `extractExif.test.ts` — GPS, no-GPS, (0,0), bad orientation, HEIC reject,
  corrupt input.
- `generateThumb.test.ts` — size, orientation correction, quality.
- `importPhotoFiles.test.ts` — concurrency, progress, failure isolation.
- `placeNoGpsPhotos.test.ts` — ordering, spacing, wrap, viewport math.
- `candidatePoolMirror.test.ts` — read-modify-write idempotency, flag
  propagation, debounce semantics.
- `photoMarker.persistence.test.ts` — round-trip through
  `corridors-session.json` with `capturedAt`, `photoId`, `needsPlacement`.

### Integration (manual; recorded in PR)

- Smoke script above.

### Cross-app contract test

- Write a test that boots both photo-helper and map-corridors in a
  shared OPFS context, sets flag in map, asserts photo-helper sees it.
  (Optional v1 — manual smoke is acceptable initial coverage.)

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `exifr` tree-shake doesn't kick in → 30 KB+ added | Verify via Vite build report after Phase 0. Fall back to inline canvas EXIF parser if size unacceptable. |
| `pica` not available from map-corridors (workspace boundary) | Import directly; or add `pica` to map-corridors `dependencies` (it's already in photo-helper). Cost is duplicate dep declaration only — same file ends up bundled once. |
| Concurrent writes to `session.json` (map and photo-helper open in two windows) | v1 assumes single-window apps (Electron is). Document the assumption. Add file-level write retry with stat check. |
| OPFS quota at high photo counts | Existing `isStorageLow` warning fires. New "Many photos (N, ~N MB)" warning in photo mode after 50 photos. |
| User accidentally clicks "Send to editor" with 0 picks | Button disabled when picks = 0. |
| Coordinate precision loss when dragging at high zoom | MapLibre returns float64; we store float64. No issue. |
| Browser drag-and-drop API quirks on Windows | Already exercised by existing dropzone code in photo-helper / map-corridors. Reuse the same dropzone library (react-dropzone). |

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
4. **Should "needsPlacement" markers re-anchor to current viewport on
   pan/zoom**, or stay where they were initially placed? ADR-013 says
   stay; revisit if it feels off in smoke testing.
5. **Photo-helper change for `gps` field display**. Out of scope for v1
   (just metadata); but consider a small footer line on printed photos in
   v2 showing "subject coords".

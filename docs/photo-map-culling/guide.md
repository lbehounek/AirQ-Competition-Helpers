# Photo Map Culling — User & Developer Guide

Single-file **developer** reference for the **photo-map-culling** feature (merged
to `main`; ships in the desktop 2.2x+ releases). For an end-user, task-oriented
walkthrough of the whole app — including set-split and PDF export — see the
[**User Manual**](../USER_MANUAL.md); this guide is the as-built technical
reference. Covers:

- [User workflow](#user-workflow): the natural locate → select → label → print flow
- [Visual language](#visual-language): what every pin / color / shape means
- [Data schemas](#data-schemas): in-memory + on-disk types
- [On-disk file layout](#on-disk-file-layout): how the per-competition directory is structured
- [Cross-app handoff](#cross-app-handoff): how map-corridors talks to photo-helper
- [Deferred work](#deferred-work): what's intentionally not done yet
- [Source map](#source-map): where to look for what

For ADR-level design rationale see
[`decisions.md`](./decisions.md); for the planned phase order see
[`implementation-plan.md`](./implementation-plan.md). This guide is the
**as-built** reference — the others are design history.

---

## User workflow

```
┌─────────────┐   ┌──────────┐   ┌───────────┐   ┌──────────┐
│  1. Locate  │ → │ 2. Select│ → │ 3. Label  │ → │ 4. Print │
│  (drop JPGs)│   │ Inc/Skip │   │ A–T / 1–20│   │ map +    │
│             │   │ /Reject  │   │           │   │ answer   │
└─────────────┘   └──────────┘   └───────────┘   └──────────┘
       │
       └── 1b. Place no-GPS photos by dragging from the bottom-left tray
```

### 1. Locate

Drop a batch of JPEG/PNG files onto the map (single dropzone, no mode
toggle — see [ADR-021](./decisions.md#adr-021--implicit-dropzone-routing-no-mode-toggle)).

- Files with EXIF GPS → grey circle appears at the capture coords. Live
  progress in the top bar; success/failure summary in a snackbar.
- Files **without** GPS → bottom-left "Bez GPS" tray. Drag a thumbnail
  from the tray onto any spot on the map to place it.
- HEIC files → rejected ([ADR-006](./decisions.md#adr-006--no-heic-support-in-v1)).
- Any other extension → toast: "Unsupported file: {name}".

The same dropzone also accepts `.kml` / `.gpx` for the corridor — file
type routes automatically. A mixed batch (1 KML + 30 JPGs) imports both
in parallel.

### 2. Select

Click any photo dot → popup with thumbnail + three buttons:

| Action | Effect |
|---|---|
| **Include** | `flag = 'pick'` — pin turns blue. Popup stays open so you can label next. |
| **Skip** | Clears any prior flag (used to undo a Reject). Popup closes. |
| **Reject** | `flag = 'reject'` — pin turns red, faded. Popup closes. |

You can also drag the pin to the actual subject location of the photo
(where the object IS, not where the camera was). Once moved, a ghost
dot + dashed line appear at the EXIF capture spot — that's how you tell
at a glance which photos have been **processed** vs **untouched**.

### 3. Label

In the same popup, the **A–T** grid (Rally) or **1–20** grid (Precision)
lets you assign a letter/number to the photo. The pin then turns
**yellow** — matches the existing KML-marker color — to signal "this
photo is on the answer sheet".

- Labels are unique per competition; taken letters show as disabled
  with strikethrough.
- Click the currently-assigned letter again to clear it.

### 4. Print

The standard map-corridors **Print Map** button captures the map
including all photo pins (yellow + labelled). The **Show Answer Sheet**
dialog lists photos in label order — same flow as the existing KML
marker answer sheet, just sourced from photos now too.

The right-side **Photos** panel shows live counts in four groups:
**Picks** / **Neutral** / **Rejects** / **No GPS**. Click an item → map
flies to that photo and the popup opens. The **Send to editor (N)**
footer button at the bottom flushes any pending writes and navigates to
photo-helper for cropping/leveling.

---

## Visual language

| Visual element | Meaning |
|---|---|
| **Hollow circle, grey ring** | Imported with GPS; user hasn't touched it yet. Pin sits at the EXIF capture point. |
| **Hollow circle, blue ring** | Picked (`flag = 'pick'`) but the user hasn't dragged the subject pin yet. |
| **Hollow circle, red ring (faded)** | Rejected (`flag = 'reject'`). Still at the capture point. |
| **Hollow circle, yellow ring** | Labelled. Ready for the answer sheet. (Often paired with picked.) |
| **Filled circle + shadow** | Same colors apply, but **filled = "moved"** — user has dragged the pin to the subject location. "Processed." |
| **Tiny grey dot (50% opacity)** | A ghost at the original EXIF capture point. Appears only when the photo has been moved. |
| **Dashed grey line** | Connects ghost (capture) → live pin (subject). Same membership rule as the ghost — moved photos only. |
| **Yellow square pin** | Existing **KML / click-placed** marker. Unchanged from the original map-corridors flow. |
| **Orange `?` thumbnail (bottom-left tray)** | Imported photo with no EXIF GPS, awaiting placement via drag. |

### Color summary

```
                  unmoved (hollow)        moved (filled)
neutral           ○ grey                  ● grey
pick              ○ blue                  ● blue
reject            ○ red (faded)           ● red (faded)
labelled          ○ yellow                ● yellow
```

**Yellow always wins** — if a marker is labelled, it shows yellow
regardless of its flag. This matches the KML marker color and signals
"on the answer sheet".

---

## Data schemas

### `PhotoMarker` — in-memory marker (one per imported photo)

```ts
type PhotoMarker = Readonly<{
  id: string                     // === photoId for EXIF imports, `pm-<uuid>`
  lng: number                    // Subject location (answer-sheet coord)
  lat: number
  name: string                   // Filename
  label?: 'A' | … | 'T' | '1' | … | '20'
  capturedAt?: Readonly<{        // EXIF source — absent for no-GPS placements
    lng: number
    lat: number
    altitude?: number
    timestamp?: string           // ISO 8601
  }>
  photoId?: string               // `pm-<uuid>` — links to OPFS files
  flag?: 'pick' | 'reject'       // absent = neutral
}>
```

Lives in `corridors-session.json:markers[]`. KML/click-placed markers
have `photoId === undefined` and `capturedAt === undefined`.

### `NoGpsPhoto` — tray entry, awaiting placement

```ts
type NoGpsPhoto = Readonly<{
  photoId: string
  filename: string
  timestamp?: string             // for tray sort order
}>
```

Lives in `corridors-session.json:noGpsPhotos[]`. Becomes a `PhotoMarker`
with `flag: 'pick'` (no `capturedAt`) once the user drags it onto the map.

### `MapPicksFile` — cross-app handoff (`map-picks.json`)

```ts
type MapPicksFile = {
  version: 1
  updatedAt: string              // ISO 8601
  picks: MapPickEntry[]
}
type MapPickEntry = {
  photoId: string                // always `pm-` prefix
  filename: string
  flag: 'pick' | 'neutral' | 'reject'   // denormalized (absent → 'neutral')
  gps?: {
    capturedAt?: { lng: number; lat: number; altitude?: number; timestamp?: string }
    subjectAt?: { lng: number; lat: number }  // present only if moved
  }
  label?: string
}
```

Written debounced (300 ms) by map-corridors; read by photo-helper on
competition load + on `visibilitychange === 'visible'`.

### `ApiPhoto.gps` — photo-helper side (currently informational)

```ts
interface ApiPhoto {
  // …existing fields…
  flag?: 'pick' | 'neutral' | 'reject'
  gps?: {
    capturedAt?: { lng; lat; altitude? }
    subjectAt?: { lng; lat }
    timestamp?: string
  }
}
```

Set by `useMapPicksSync` when it inserts a map-originated photo into the
candidate pool. Photo-helper uses `flag` for tray filtering and may
later use `gps` for cross-reference in the printed PDF.

---

## On-disk file layout

OPFS (web) and Electron native filesystem use the same layout:

```
photo-sessions/
└── competitions/
    └── {competitionId}/
        ├── session.json                 ← photo-helper's ApiPhotoSession
        ├── map-picks.json               ← cross-app handoff (Phase 8)
        ├── corridors/
        │   ├── session.json             ← map-corridors' CorridorsSession
        │   └── original-kml.json        ← captured KML text for re-export
        └── photos/
            ├── {photoId}                ← original photo bytes (no ext)
            ├── {photoId}                 …more photos…
            └── thumbs/
                ├── {photoId}.jpg        ← 200×150 thumbnail
                └── {photoId}.jpg         …
```

- **photoId convention**: `pm-<uuid>` for map-imported photos,
  `photo-<timestamp>-<rand>` for photo-helper-imported photos. The
  `pm-` prefix is load-bearing — `useMapPicksSync` uses it to decide
  ownership of entries during cleanup.
- **Storage abstraction**: see
  [`@airq/shared-storage`](../../frontend/shared-storage/src/types.ts).
  The `StorageInterface` has `savePhotoFile`, `savePhotoThumb`,
  `getPhotoBlob`, `getPhotoThumb`, etc. — backed by OPFS in the browser
  and by `fs` in Electron via IPC.

### `CorridorsSession` shape (relevant fields)

```ts
type CorridorsSession = {
  id: string
  version: number                // per-mutation write counter, not schema version
  // …other corridor fields…
  markers: readonly PhotoMarker[]              // KML clicks AND imported photos
  groundMarkers: readonly GroundMarker[]       // FAI canvas signs (precision)
  noGpsPhotos: readonly NoGpsPhoto[]           // tray entries awaiting placement
  noGpsTrayOpen: boolean                       // tray collapse state
}
```

---

## Cross-app handoff

**Bidirectional** via two mirror files, one per writer.

```
                  ┌──────────────────────┐
                  │   map-picks.json     │
   ┌──writes──►   │   (flag, gps, label) │   ──reads──┐
   │              └──────────────────────┘            │
┌──┴────────────┐                              ┌──────▼───────────┐
│ map-corridors │                              │  photo-helper    │
└──────▲────────┘                              └──────┬───────────┘
       │       ┌──────────────────────────────┐      │
       └──reads──   photo-helper-picks.json   ◄──writes──┘
               │   (label only — newer-wins)  │
               └──────────────────────────────┘
```

| File | Writer | Reader | Owns |
|---|---|---|---|
| `map-picks.json` | map-corridors | photo-helper | flag, gps, label (with `labelUpdatedAt`) |
| `photo-helper-picks.json` | photo-helper | map-corridors | label (with `labelUpdatedAt`) |

Each file has exactly one writer (no write race). Both files include a
per-photo `labelUpdatedAt` ISO timestamp; the reader applies the remote
label only when `remote.labelUpdatedAt > local.labelUpdatedAt`. Equal
timestamps → local wins (deterministic tie-break that protects edits
in-flight when a `visibilitychange` happens to land on the same ms).

### Writers

- **map-corridors** — `frontend/map-corridors/src/handoff/mapPicksWriter.ts`.
  `scheduleWriteMapPicks` debounces 300 ms; `flushPendingMapPicks` is
  called by the "Send to editor" button + `pagehide`.
- **photo-helper** — `frontend/photo-helper/src/handoff/editorPicksWriter.ts`.
  Symmetric: `scheduleWriteEditorPicks` / `flushPendingEditorPicks`.
  Only `pm-`-prefixed candidates emit entries (photo-helper-originated
  photos stay in the editor and never propagate).

### Readers

- **photo-helper** — `frontend/photo-helper/src/hooks/useMapPicksSync.ts`.
  Upsert + delete semantics per
  [ADR-019](./decisions.md#adr-019--usemappickssync-upsert-semantics-delete-propagation).
  Label changes propagate via the same newer-wins rule.
- **map-corridors** — `frontend/map-corridors/src/hooks/useEditorPicksSync.ts`.
  Read-only-update — never inserts markers (the editor file isn't a
  source of new photos). Newer-wins label updates only.

### Known limitations

- Cross-app **label-collision prevention** is implicit through the
  pm- label sync: editor-set labels show up on the map's local markers
  after the next read, automatically appearing in `usedLabels`. Two
  CORNER cases aren't covered:
  - **KML-click-placed markers** in map-corridors that use a letter
    photo-helper has independently claimed for one of its **non-pm-**
    photos. Map's local `usedLabels` won't include the editor-only
    photo's letter. Mitigation: the editor's picker rejects the
    collision when the user goes to assign.
  - **Symmetric** of the above. Same reasoning, opposite direction.
  Both are rare in the typical workflow (most photos flow map → editor).
  Add `claimedLabels: string[]` to both files if this surfaces in practice.

---

## Deferred work

Things intentionally NOT done in v1, in rough priority order:

1. **Browser-mode tests for Canvas + EXIF Orientation.** The two
   `.todo` placeholders in
   `frontend/map-corridors/src/__tests__/generateThumb.test.ts`
   (real-pixel JPEG output + Orientation=6 rotation) require
   `@vitest/browser` + Playwright. Worth doing once a regression appears.
3. **Re-import dedup UI.** ADR-020 specifies SHA-1 content-hash dedup;
   the writer side records the hash but the import path doesn't yet
   check it. A re-imported photo today gets a new `pm-` id + new disk
   entry. Wire by hashing during `importPhotoFiles` and looking up in
   `map-picks.json` before insert.
4. **Hover preview tooltip.** Doc plan envisions 80×60 mini-thumb on
   marker hover, distinct from the popup-on-click. Nice-to-have.
5. **Keyboard equivalent for tray drag.** WCAG concern noted in
   [Phase 10](./implementation-plan.md). Focus thumb → Enter → click
   map. Out of scope v1.
6. **OPFS quota pre-flight warning.** ADR-018. Soft warning at 50%
   used, hard gate at 80%. Currently the import silently proceeds and
   relies on disk-full failures bubbling up.

---

## Source map

| Where | What |
|---|---|
| `frontend/map-corridors/src/photoImport/` | Pure import pipeline: `extractExif`, `generateThumb`, `importPhotoFiles`, storage wrapper `importPhotosToStorage`. Tested in `__tests__/`. |
| `frontend/map-corridors/src/handoff/mapPicksWriter.ts` | Debounced JSON writer; pure projection helpers `buildMapPickEntry` / `buildMapPicks`. |
| `frontend/map-corridors/src/map/photoLayers/` | `captureFeatures.ts` (ghost + dashed-line projections + `isPhotoMoved`) and `CaptureDotsLayer.tsx` (passive Mapbox overlay layers — name kept for import stability; export is `PhotoOverlayLayers`). |
| `frontend/map-corridors/src/components/PhotoMarkerPopup.tsx` | Click-on-pin popup. Thumb + Include / Skip / Reject + label picker. |
| `frontend/map-corridors/src/components/NoGpsTray.tsx` | Bottom-left tray for no-GPS imports. Drag emits `application/x-airq-no-gps-photo`. |
| `frontend/map-corridors/src/components/PhotoListPanel.tsx` | Right-side groups + "Send to editor" footer. |
| `frontend/map-corridors/src/components/usePhotoThumbUrl.ts` | Shared thumb-loading hook with URL revocation. |
| `frontend/map-corridors/src/components/groupPhotosByFlag.ts` | Pure helper for the side-panel groups. |
| `frontend/map-corridors/src/map/MapProviderView.tsx` | The map shell. Photo-marker render branch is `?.filter(m => !!m.photoId).map(...)` near the bottom of the JSX tree. |
| `frontend/map-corridors/src/hooks/useCorridorSessionOPFS.ts` | Owns the session JSON + resolves `photosDir`, `competitionDir`. |
| `frontend/photo-helper/src/hooks/useMapPicksSync.ts` | Counterpart reader hook. Mounted in `AppApi.tsx`. |
| `frontend/shared-storage/src/photoThumbs.ts` | Thumbnail storage helpers `savePhotoThumb` / `getPhotoThumb` / `deletePhotoThumb`. Same impl behind both OPFS and Electron backends. |

---

## Quick smoke matrix

Manual checks against a live Electron build (no automated browser
tests for these yet):

1. Drop 3 JPGs with GPS → 3 hollow grey circles at their EXIF coords.
2. Hover a circle → cursor goes pointer.
3. Click a circle → popup appears with thumb + filename + 3 buttons + label grid.
4. Click **Include** → circle gets blue ring. Popup stays open.
5. Assign label **A** → circle turns yellow + label badge appears next to it.
6. Drag the pin 100 m away → fills in (still yellow), ghost dot + dashed line appear at EXIF spot.
7. Click another circle → previous popup closes, new one opens (no double-click).
8. **Send to editor (1)** → photo-helper opens, candidate tray contains the labelled photo.
9. Drop 2 no-GPS JPGs → bottom-left tray appears with 2 thumbs.
10. Drag a tray thumb onto the map → blue filled circle at drop point. Tray shrinks.
11. Reload the page → all state survives (markers, tray entries, labels, flags).

---

*Last updated against branch `feat/photo-map-culling` commit ~`c1a8f8e`. When
the as-built state drifts from this doc, update the doc.*

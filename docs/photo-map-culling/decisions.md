# Architecture Decision Records — Photo Map Culling

Each ADR captures one locked design decision. Status is **Accepted** unless
otherwise noted. Format follows the lightweight ADR template (context →
options → decision → consequences).

When implementation reveals an ADR is wrong, update its status to
**Superseded** and add a new ADR underneath rather than rewriting history.

---

## ADR-001 — Extend map-corridors rather than build a new app

**Status:** Accepted

**Context.** The new tool needs a map, photo-on-map markers, drag, popup,
discipline-aware label generation, KML/GPX awareness, OPFS persistence, and
a competition-aware launcher entry. map-corridors already has every one of
those. photo-helper has none. A third app would mean a fourth workspace
package, a second copy of `react-map-gl` + MapLibre + Mapbox + token
wiring, a new launcher tile, a new icon, and a new build target.

**Options.**

1. **Extend `map-corridors`** so its dropzone and marker layer accept
   both KML/GPX (corridor) and JPEG/PNG (photos), side by side in the
   same view (see [ADR-021](#adr-021--implicit-dropzone-routing-no-mode-toggle)).
2. **Extend `photo-helper`** with a map tab. Pulls MapLibre into a canvas
   editor that today has zero map dependencies.
3. **New sub-app** `photo-scout` (or similar). Standalone Vite package +
   launcher tile.

**Decision.** Option 1. Extend `map-corridors`.

**Consequences.**

- map-corridors becomes "the map app", not strictly "the corridor app". The
  user-facing label `Photo Placement` / `Umístění fotek` already fits both
  flows (see [ADR-010](#adr-010-no-rename-photo-placement--umístění-fotek-stays)).
- The dropzone, marker layers, and side panel all support photo inputs
  alongside the existing corridor inputs — no mode toggle ([ADR-021](#adr-021--implicit-dropzone-routing-no-mode-toggle)).
- The internal package name `@airq/map-corridors` is **not** renamed —
  doing so would touch every workspace dependency, the desktop launcher's
  protocol handler, and the build pipeline for ~zero user benefit.
- Subsequent ADRs assume Option 1 as the baseline.

---

## ADR-002 — Explicit mode toggle

**Status:** Superseded by [ADR-021](#adr-021--implicit-dropzone-routing-no-mode-toggle)

**Context.** The dropzone needs to accept either KML/GPX (corridor mode) or
JPEG/PNG (photo mode). It could auto-route by file MIME type silently, or
expose an explicit mode toggle.

**Options.**

1. **Implicit routing** — sniff file type on drop, branch internally. No
   visible UI for the mode.
2. **Explicit mode toggle** — segmented control / chip at the top of the
   map header. The toggle disambiguates UX (panels, tooltips, defaults) that
   depend on which source the user is working with.

**Decision.** Option 2 for v1. — **Superseded.** See ADR-021 — the user wants
corridor and photo to work together without switching, which makes the toggle
a friction point rather than a clarification.

**Consequences.** (no longer in effect)

---

## ADR-003 — PhotoMarker keeps single canonical position + optional `capturedAt`

**Status:** Accepted

**Context.** Two coordinates per photo:
1. **Capture location** — where the camera was when the photo was taken
   (from EXIF GPS).
2. **Subject location** — where the *object* in the photo actually is
   (user-placed, the legally-relevant coordinate for corridor checks).

The data model could be:

**Options.**

1. **Single `lng/lat` field, optional `capturedAt: { lng, lat, … }`
   metadata.** The single field always means "subject location". For
   EXIF-imported photos, `capturedAt` is populated; the subject starts at
   the same coordinates and may diverge after drag.
2. **Two equal fields:** `subject: { lng, lat }` and `captured: { lng, lat }`,
   both required for EXIF photos.
3. **Discriminated union** of `KmlMarker` (one position) and `PhotoMarker`
   (two positions).

**Decision.** Option 1.

**Consequences.**

- Zero migration of existing logic in `MapProviderView`, the corridor
  legality check, or the answer-sheet exporter — they all read `lng/lat`
  unchanged, which still means "subject".
- `capturedAt` is opt-in metadata. KML/GPX-clicked markers leave it
  undefined.
- The dashed-line + ghost-marker UI key is `marker.capturedAt !== undefined
  && marker.capturedAt.lng !== marker.lng` (or lat).
- See full type in [implementation-plan.md → Phase 0](./implementation-plan.md#phase-0--foundation-types--dependencies).

---

## ADR-004 — EXIF library: `exifr` (lite build)

**Status:** Accepted

**Context.** Browser-side EXIF extraction from JPEG. Need GPS lat/lng,
timestamp, orientation, optionally altitude. Bundle size matters for
map-corridors (already carries MapLibre + Mapbox + react-map-gl).

**Options.**

| Library | Min+gz | GPS API | HEIC | Maintained |
|---|---|---|---|---|
| `exifr` (lite) | ~9 KB | `gps()` helper | yes | yes |
| `piexifjs` | ~20 KB | manual DMS → DD | no | yes |
| `exif-js` | ~14 KB | manual | no | abandoned 2019 |
| `browser-image-compression` (with EXIF preserve) | ~50 KB | indirect | partial | yes |

**Decision.** `exifr` lite build. Import only what's used:

```ts
import { gps, parse } from 'exifr/dist/lite.esm.mjs';
const gpsCoords = await gps(file);
const tags = await parse(file, {
  pick: ['DateTimeOriginal', 'GPSAltitude', 'Orientation'],
});
```

**Consequences.**

- Adds ~9 KB gzipped to map-corridors bundle.
- HEIC tag extraction works but display does not — see
  [ADR-006](#adr-006-no-heic-support-in-v1).
- Tree-shake verified via Vite build report after install.
- Library is added to `frontend/map-corridors/package.json` with an exact
  pinned version (no caret), per the global dependency-pinning rule.

---

## ADR-005 — Cross-app handoff via a one-way `map-picks.json` file

**Status:** Accepted (revised after design review)

**Context.** Photos selected in the map tool need to appear in
photo-helper's candidate tray without a manual export/import step. The
candidate pool shipped in `feat/candidate-photos` (`ApiPhoto[]` under
`session.candidates.photos`) is the right *consumer-side* shape. The
question is who writes to it and how.

**Options.**

1. **Map-corridors writes directly into photo-helper's `session.json`'s
   `candidates.photos[]`** on every flag change.
2. **Map-corridors writes a separate `map-picks.json`** with the minimal
   fields it owns (`photoId`, `filename`, `flag`, `gps`, optional `label`).
   Photo-helper's competition-load hook reads it on init and on
   `visibilitychange`, projects each entry into a full `ApiPhoto` with
   default `canvasState`, and merges into the candidate pool.
3. **Push at "Send to editor" time** only — batch transfer on click.

**Decision.** Option 2.

**Why Option 1 was rejected.** `ApiPhoto` requires fields map-corridors
doesn't own (`canvasState`, `sessionId`, `url`); direct writing would
couple the writer to photo-helper's full session schema and race in
two-tab web mode (shared OPFS, no lock primitive in `@airq/shared-storage`).
A consumer-side projection is cheaper and keeps both apps' schemas
independent.

**Consequences.**

- New file: `competitions/{compId}/map-picks.json`. Schema:

  ```ts
  type MapPicksFile = {
    version: 1;
    competitionId: string;        // self-identifying — survives dir moves
    updatedAt: string;            // ISO
    picks: MapPickEntry[];
  };
  type MapPickEntry = {
    photoId: string;              // namespaced — see below
    filename: string;
    contentHash: string;          // SHA-1, for dedup on re-import (ADR-020)
    flag: 'pick' | 'neutral' | 'reject';
    gps?: {
      capturedAt?: { lng: number; lat: number; altitude?: number; timestamp?: string };
      subjectAt?: { lng: number; lat: number };
    };
    label?: PhotoLabel;
  };
  ```

- **One writer, one reader per file.** Map-corridors writes
  `map-picks.json`; photo-helper reads it. Photo-helper never writes
  back. No file-level lock needed.
- Photo-helper gets a new lightweight hook `useMapPicksSync`
  (~50 LoC) that:
  1. On competition load, reads `map-picks.json`; for each entry not
     already represented by `photoId` in `session.candidates.photos`,
     creates an `ApiPhoto` with default `canvasState` and pushes it.
  2. On `visibilitychange` (tab regained focus), re-reads and merges.
- "Send to editor" remains a pure navigation; see
  [ADR-009](#adr-009-send-to-editor-navigates-only).
- The earlier framing "photo-helper requires zero code changes" is
  rescinded. The addition is small but real.

**Photo ID namespace.** Photos imported by map-corridors use a `pm-`
prefix in their `photoId` (e.g., `pm-1736283921-x9k3`). Photos created
or dropped directly in photo-helper continue to use today's scheme
(`photo-${ts}-${rand}` or `crypto.randomUUID()`). This guarantees no
collision when both apps write into the same
`competitions/{compId}/photos/` directory, and lets photo-helper's hook
identify map-origin photos at a glance.

**Future-proofing.** If a third producer ever needs to write picks
(e.g., a CLI batch tool), `map-picks.json` is the protocol; the file
owner is the *current* producer, not "the map app forever". The photoID
namespace makes multi-producer coexistence possible later.

---

## ADR-006 — No HEIC support in v1

**Status:** Accepted

**Context.** iPhones default to HEIC/HEIF capture. EXIF parsing works fine
with `exifr` for HEIC. **Display** of HEIC in non-Safari browsers requires
a decoder (`heic2any` ≈ 600 KB) or extraction of the embedded JPEG
thumbnail.

**Options.**

1. **Ship HEIC support** via `heic2any` or thumbnail extraction.
2. **No HEIC support in v1.** Document as known limitation. Reject HEIC
   files at import time with a friendly error.

**Decision.** Option 2. User-confirmed: iPhone capture is not expected for
this user base; the 600 KB cost is not justified by usage.

**Consequences.**

- Drag-dropping a `.heic` / `.heif` file shows a toast: "HEIC not supported.
  Please convert to JPEG (iPhone: Settings → Camera → Formats → Most
  Compatible)."
- en + cs locales include this message.
- A future ADR will revisit if user feedback shows demand.

---

## ADR-007 — Default subject pin position: at the capture point

**Status:** Accepted

**Context.** When a user clicks Include on a photo, where should the
draggable subject pin start?

**Options.**

1. **At the capture point.** Pin and ghost marker overlap; dashed line is
   zero-length until user drags.
2. **Centered on the map.** Forces an explicit drag-to-place gesture.
3. **At a small offset from capture** (e.g., 50 m north). Hint that
   subject is somewhere nearby.

**Decision.** Option 1. User-confirmed.

**Consequences.**

- An aviation photographer flying past a landmark usually captures and
  subject locations that differ by hundreds of meters — so in practice
  almost every pick triggers one drag. The "default at capture point"
  is not a no-drag shortcut; it's a *legible* starting state that
  makes the dashed-line/ghost-marker UI obvious without a tutorial.
- The dashed-line indicator only appears once the user drags.
- Any default other than capture point (e.g., map center) would force
  every pick to be dragged from a position with no semantic meaning.

---

## ADR-008 — Discipline support: both Rally and Precision

**Status:** Accepted

**Context.** Should photo culling be enabled only for Rally, or both Rally
and Precision?

**Decision.** Both. Label generation is already discipline-aware
(`@airq/shared-discipline`); reuse it as-is.

**Consequences.**

- Rally photos get labels A–T (max 20).
- Precision photos get labels 1–20 (max 20).
- The label picker renders the correct alphabet based on the active
  competition's `discipline`.

---

## ADR-009 — "Send to editor" navigates only

**Status:** Accepted

**Context.** When the user clicks "Send to editor (N picks)", what happens?

**Options.**

1. **Navigate only.** Photos are already represented in `map-picks.json`
   (see [ADR-005](#adr-005-cross-app-handoff-via-a-one-way-map-picksjson-file));
   the button just switches apps and photo-helper's hook reads the file.
2. **Navigate + auto-fill slots.** Promote N picks into the print grid
   slots automatically.
3. **Navigate + open the candidate tray expanded.**

**Decision.** Option 1. User-confirmed. Slot assignment is the editor's
job; auto-filling would couple two concerns and hide which photo went where.

**Consequences.**

- The map tool never writes to `session.sets`; it only writes
  `map-picks.json` (and its own `corridors-session.json` for marker
  state).
- photo-helper opens normally; the new `useMapPicksSync` hook
  pre-populates the candidate tray on load.
- **Navigation must flush pending writes.** `map-picks.json` writes are
  debounced (see Phase 8). If the user toggles a flag and immediately
  clicks "Send to editor", the renderer is torn down before the debounce
  fires — the last toggle is lost. Implementation requirement: on click,
  `await flushPendingMapPicks()` *before* the navigation call. This is
  the only reliable path on web (OPFS writes are async; neither
  `pagehide` nor `beforeunload` can await them). On Electron the
  same await suffices because IPC is sequential per channel.
- A `pagehide` listener triggers the same flush as a defence against
  tab close / back-button. The flush is best-effort there — if it
  doesn't complete before the page is frozen, the next session sees
  state from the last successful write.

---

## ADR-010 — No rename. "Photo Placement" / "Umístění fotek" stays

**Status:** Accepted

**Context.** Once map-corridors hosts both KML-driven and photo-driven
flows, the original name "MapCorridors" feels narrow. The desktop launcher
already labels this app **Photo Placement** / **Umístění fotek** (per
`TODO.md` — Done 2026-03-27).

**Decision.** Keep the existing user-facing label. Keep the internal
package name `@airq/map-corridors`. No rename.

**Consequences.**

- No churn in workspace deps, launcher entries, protocol handlers.
- "Photo Placement" semantically covers both KML-corridor placement and
  EXIF-photo placement.

---

## ADR-011 — Thumbnail storage in `photos/thumbs/`

**Status:** Accepted

**Context.** Map popups need fast preview. Original photos are 4–10 MB
each; loading 50 of them for popups is unacceptable. A pre-computed
thumbnail per photo solves it.

**Options.**

1. **Inline data URL in PhotoMarker.** Persisted in `corridors-session.json`.
2. **Separate `photos/thumbs/{photoId}.jpg` directory** in the competition
   dir, alongside the original photos.

**Decision.** Option 2.

**Reasoning.** Inline data URLs balloon the session JSON (a 50 KB JPEG
becomes ~67 KB base64 per photo; 100 photos × 67 KB = 6.7 MB JSON to
parse on every load). Separate files load lazily into popups via
`storage.getPhotoBlob()` and benefit from any caching layer.

**Consequences.**

- New subdirectory `competitions/{compId}/photos/thumbs/` materializes on
  first import.
- Thumb is generated once at import via canvas + `pica` downscale to
  ~200×150 JPEG quality 0.7. Approximate size: 15–25 KB each.
- Storage adds ~2 MB per competition for 100 photos (negligible).
- Thumb generation is part of the import pipeline; failure to generate a
  thumb degrades to "show filename" but does not block import.

---

## ADR-012 — No-GPS photo placement: off-map tray pinned to map corner

**Status:** Accepted (revised after design review)

**Context.** Some photos arrive without GPS. They still need to be
visible so the user can drag them to position. An earlier v1 design
(viewport-anchored lower-edge placement) was rejected because markers
anchored to fake screen-projected coords would drift off-screen on pan
and lie about what `PhotoMarker.lng/lat` means.

**Decision.** Off-map tray pinned to a map corner (bottom-left), holding
thumbnails ordered by capture time, each draggable directly *onto* the
map.

**Reasoning.**

- The semantic is honest: a thumbnail in the tray means "no decided
  location", not "located at fake-coord-x".
- Drag-and-drop affordance is clearer than "find the orange dot and
  drag it".
- The right-side photo list panel (US-12) covers discoverability; the
  on-map tray covers the "drag from here onto the map" affordance.
- `PhotoMarker.lng/lat` only exists for *placed* photos. A no-GPS photo
  doesn't get a `PhotoMarker` until placed — it lives in
  `session.candidates` only.

**Consequences.**

- Drag-end on the map (anywhere) for an in-tray photo → create
  `PhotoMarker` at the drop coordinate, flag = `pick`, remove from tray.
- Tray is collapsed/expanded via header click; state persists in
  `corridors-session.json` field `noGpsTrayOpen: boolean`.
- Photos in the tray are *not* `PhotoMarker[]` entries — they are
  candidate-pool entries with no `subjectAt`. This keeps the marker
  type clean.
- The earlier proposed `needsPlacement` flag on `PhotoMarker` is
  removed — no `PhotoMarker` without coordinates exists at all.
- Drag from tray fires a custom HTML5 drag event with the photoId; the
  map's drop handler reads the projected lng/lat from the event
  (`map.unproject([clientX, clientY])`) and creates the marker.

**Edge cases.**

- Tray empties → header dims but tray remains visible. Once empty,
  collapse to a chevron icon to free map area.
- User imports more no-GPS photos later → they append to the tray,
  sorted by capture time.
- User drags a placed pin back to the tray? Out of scope v1 (single
  direction: tray → map). Demotion uses the existing Reject flag.

---

## ADR-013 — Atomic per-photo import (no partial-batch state)

**Status:** Accepted

**Context.** A 50-photo import might fail mid-way (storage error,
corrupted file, etc.). What's the recovery story?

**Options.**

1. **All-or-nothing batch.** Roll back all writes if any fails.
2. **Per-photo atomic.** Each photo's import is independent: EXIF →
   thumbnail → blob save → marker creation. If photo 23 fails, photos 1–22
   are kept; photo 23 reports in an error list.

**Decision.** Option 2.

**Consequences.**

- Import returns a result shape `{ ok: PhotoMarker[]; failed: { file: string; reason: string }[] }`.
- A toast surfaces the failure count after import: "47 imported, 3
  failed (see details)".
- A details modal lists failure reasons (e.g., "RIMG0172.JPG: invalid
  JPEG").
- Failed files do not pollute storage with half-written blobs (the save
  step is the last step in the per-photo pipeline).

---

## ADR-014 — Import throughput: main-thread, batched at 8 concurrent

**Status:** Accepted

**Context.** 100 photos × (EXIF read + thumb generation + blob save) is
non-trivial work. Web Workers would parallelize CPU cleanly but add
complexity.

**Options.**

1. **Web Worker pool.** Send each file to a worker for EXIF + decode +
   thumb; main thread does storage writes.
2. **Main-thread with `Promise.all` over batches of 8.**

**Decision.** Option 2 for v1.

**Reasoning.** Per photo: ~30 ms EXIF parse (mostly I/O, parallelizes
freely) + ~80 ms canvas decode + downscale + JPEG encode (CPU,
single-threaded). For 100 photos: I/O overlapped, CPU sequential at
~80 ms × 100 ≈ **8 s wall-clock**. Batching at 8 wide caps peak memory,
not wall-clock — `Promise.all` doesn't multi-core JS compute. A progress
bar makes 8 s tolerable.

**Consequences.**

- Progress bar shows N of M during the operation.
- UI is responsive between photo bursts but pulses every ~80 ms while
  a photo is decoding. Acceptable for v1.
- Concurrency of 8 caps peak in-flight decoded `ImageBitmap`s to
  protect memory (8 × ~50 MB decoded pixels = ~400 MB peak).
- If real-world batches exceed 30 s, revisit with `OffscreenCanvas` in
  a Worker pool — only `OffscreenCanvas` actually lets canvas work
  multi-thread.

---

## ADR-015 — Apply EXIF orientation via `createImageBitmap`, not manual rotation

**Status:** Accepted

**Context.** Photos can be stored with two conflicting conventions:

- **Already-rotated pixels with `Orientation = 1`** — modern phones,
  most JPEGs exported from HEIC, social-media output. The image is
  upright as-is.
- **Sideways pixels with `Orientation = 6/8`** — older cameras, some
  raw camera dumps. The image must be rotated for display.

If we manually rotate based on the EXIF Orientation tag, half the
photos will be double-rotated.

**Decision.** Use `createImageBitmap(file, { imageOrientation: 'from-image' })`
to decode. The browser handles both conventions per the HTML spec —
it reads the Orientation tag and produces an upright `ImageBitmap`. We
then `drawImage` the result onto the thumbnail canvas without any
manual rotation logic.

**Consequences.**

- `generateThumb` does not need an `orientation` parameter.
- Test fixtures must include both conventions: one phone-pre-rotated
  (`Orientation = 1`, already-rotated pixels) and one camera-sideways
  (`Orientation = 6`).
- `extractExif` still reads the Orientation tag (for completeness in
  the data model), but no consumer in v1 uses it.
- Browser support: shipped in all evergreen browsers since 2021.
  Electron's Chromium is current; web users on ancient browsers are
  out of scope.

---

## ADR-016 — Marker rendering split: GeoJSON layer for static dots, individual `<Marker>` for picks

**Status:** Accepted

**Context.** `react-map-gl/mapbox` `<Marker>` is a React-component-
per-marker pattern. Each instance is a DOM node plus a `move` listener.
At 50+ markers, pan/zoom performance starts to degrade noticeably; at
100 it's unacceptable. A competition can easily produce 100 photos.

**Options.**

1. **One `<Marker>` per photo.** Simple, but 100+ markers tank pan
   performance.
2. **All markers in a single Mapbox GeoJSON source with `circle` and
   `symbol` layers.** Fast at any count, but loses individual React
   component lifecycles — interactions go through `queryRenderedFeatures`.
3. **Split.** Static markers (capture dots, ghost markers, rejected
   dots, dashed lines) → GeoJSON layers. Draggable subject pins →
   individual `<Marker>` components.

**Decision.** Option 3.

**Reasoning.** The vast majority of markers in a session are
non-draggable (capture dots and rejected markers). Picks are a
minority (typically 9–20 out of 30–100). Splitting along the
draggable/static line gives:

- Performant pan/zoom at any photo count.
- Rich drag UX for the photos that need it.
- Clean separation of concerns: layer composition for visualization,
  React component for interaction.

**Consequences.**

- New components: `CaptureDotsLayer`, `DashedLinesLayer`,
  `RejectedDotsLayer`, `SubjectPin`.
- Click handling on layers goes through
  `map.on('click', 'photo-capture-dots', handler)` +
  `queryRenderedFeatures`.
- The "Hide rejects" toggle (US-13) becomes a Mapbox paint filter —
  fast, no DOM churn.
- Phase 4 of the implementation plan is rescoped accordingly.

**Note on library naming.** Photo layers use whichever map engine
`MapProviderView` is mounted on (currently `mapbox-gl` via
`react-map-gl/mapbox` — confirmed at `MapProviderView.tsx` line 2).
The workspace also ships `maplibre-gl` and `@vis.gl/react-maplibre`
for non-Mapbox tile providers; if a future engine swap lands, GeoJSON
`circle` / `line` paint expressions are spec-compatible across both
renderers. **The new GeoJSON layers are purely additive** — existing
KML-clicked corridor markers continue to render as individual
`<Marker>` components unchanged, so the corridor flow has no
regression surface.

---

## ADR-017 — `flag` lives in `map-picks.json` only, denormalized to GeoJSON properties at render time

**Status:** Accepted

**Context.** The visual `flag` (`pick` / `neutral` / `reject`) needs to
be (a) persisted so it survives reload, and (b) available to the Mapbox
paint expressions on the static-dot GeoJSON layers so the right colour
renders without a per-feature DOM update.

The naive choice would be: store `flag` on `PhotoMarker` (in
`corridors-session.json`) *and* on `MapPickEntry` (in `map-picks.json`).
That duplicates the data, and every flag toggle writes both files.
`corridors-session.json` includes markers + geojson + leftSegments + …
— at 100 photos it can be hundreds of KB. Writing the whole blob on
every keystroke is a write storm.

**Decision.** `flag` lives **only** in `map-picks.json`. `PhotoMarker`
does **not** carry a flag field.

For rendering, App.tsx maintains an in-memory `Map<photoId, flag>` fed
by the latest `map-picks.json` state, and **denormalizes** the flag
into the GeoJSON feature properties when building the source data
passed to `CaptureDotsLayer` / `RejectedDotsLayer`. The Mapbox paint
expression matches on `feature.properties.flag` exactly as it would
have if the flag were persisted on the marker.

**Consequences.**

- One write per flag toggle (just `map-picks.json`).
- Source data for static layers is rebuilt when the in-memory flag map
  changes, which is cheap (a Map lookup per feature) and only fires
  when something the user did changed state.
- `PhotoMarker` stays minimal: `id`, `lng`, `lat`, `name`, `label?`,
  `capturedAt?`, `photoId?`. No state-machine field.
- Photos without an entry in `map-picks.json` default to flag `neutral`
  at render time.
- Removes the consistency invariant that a duplicated `flag` field
  would otherwise force the code to maintain by hand.

---

## ADR-018 — OPFS quota: hard pre-flight gate, soft warning band

**Status:** Accepted

**Context.** A 100-photo competition is ~500 MB of original blobs +
~5 MB of thumbs. Web browsers grant OPFS quota of roughly 60% of free
disk with no warning before eviction. Once eviction starts, partial
deletes leave a session that points at gone files. Today's only
mechanism is the `isStorageLow` warning, which fires *after* the user
has already imported.

**Options.**

1. Warn only (today's behaviour). User can blunder past it and lose data.
2. **Hard pre-flight gate**: before a bulk import, sum estimated bytes
   and call `getStorageEstimate()`. If `usage + estimated > 0.8 * quota`,
   block the drop with a modal that shows the deficit. If `usage +
   estimated > 0.5 * quota`, warn but allow.
3. Throttle: split the import into smaller batches and check after each.

**Decision.** Option 2. Hard pre-flight gate at 0.8 of quota; soft
warning band at 0.5.

**Consequences.**

- New helper `await checkQuotaForImport(estimatedBytes): { ok: true } | { ok: false; deficitBytes; usage; quota }`.
- The modal at the blocked state offers two actions: "Free space"
  (links to the existing storage-management UI) and "Cancel".
- The warning state is a non-blocking toast with the bytes/quota
  delta visible.
- Per-photo size estimate uses `file.size + 25 KB` (the thumb).
  Slightly over-estimates so we don't push past quota under
  measurement error.
- Electron filesystem has no quota; the gate is a no-op there but the
  same code path runs (it just always returns `{ ok: true }` for
  Electron's storage backend).

---

## ADR-019 — `useMapPicksSync` upsert semantics, delete propagation

**Status:** Accepted

**Context.** Round 1 spec'd `useMapPicksSync` as "for each entry not
already in `existingPhotoIds`, push into the candidate pool". That
covers the *initial* import case but breaks for:

- A photo flag changes in map-corridors after photo-helper has already
  loaded the entry. The hook re-reads `map-picks.json` on
  `visibilitychange` but `existingPhotoIds.has(photoId)` is true, so
  nothing happens. Photo-helper's tray shows a stale flag.
- A photo is deleted in map-corridors (entry removed from `map-picks.json`).
  Photo-helper still has it in its candidate pool — no clean-up.

**Decision.** Upsert + delete.

- **On read:** for every entry in `map-picks.json`:
  - If `photoId` not in pool → insert (today's behaviour).
  - If `photoId` in pool and origin is map (`pm-` prefix) → **update**
    the flag and any other map-owned fields. Do not touch
    `canvasState`, `label`, or any photo-helper-owned fields.
- **On read:** for every `pm-`-prefixed `photoId` *in* the pool but
  *not* in `map-picks.json` → **remove from the pool** (clean-up).
  Photos without the `pm-` prefix (photo-helper-originated) are
  untouched.

**Consequences.**

- Flag changes propagate within one focus cycle.
- Deletes propagate cleanly.
- The `pm-` namespace becomes load-bearing for "is it safe to remove?"
  decisions — the prefix is the policy boundary.
- The hook is still ~50 LoC; just an upsert + a set-difference instead
  of a one-shot insert.

---

## ADR-020 — Photo re-import: skip duplicates by content hash

**Status:** Accepted

**Context.** User drops a folder of photos, then later drops the same
folder again (perhaps after re-organising files outside the app, or
re-dragging the wrong set). What happens?

**Options.**

1. **Overwrite** by `photoId` — but photoIds are generated fresh on
   import, so a re-import produces new IDs. Doesn't help.
2. **Detect duplicate by filename + size** — fast but fragile (same
   filename can wrap different content; size is a weak signal).
3. **Detect duplicate by content hash** (SHA-1 of the file bytes) —
   robust; cost is one file read per imported photo, parallel with
   EXIF parse.
4. **Always import as new** with fresh photoId — disk fills, user
   confusion at duplicate thumbs.

**Decision.** Option 3. Compute a content hash during import and key
deduplication on it.

**Consequences.**

- `MapPickEntry` gains a `contentHash: string` field for fast
  duplicate checks across batches.
- On import: for each file, compute SHA-1; if `contentHash` matches an
  existing `MapPickEntry`, skip with toast "N photos already imported,
  M new".
- Hash compute is ~10 ms per 5 MB JPEG via `crypto.subtle.digest` —
  fully overlapped with EXIF + thumb work.
- The toast offers an "Import as duplicate anyway" override for the
  edge case where the same content is needed twice (rare).

---

## ADR-021 — Implicit dropzone routing (no mode toggle)

**Status:** Accepted (supersedes [ADR-002](#adr-002--explicit-mode-toggle))

**Context.** ADR-002 introduced an explicit `Corridor / Photo` mode toggle.
On reflection, the toggle conflicts with the actual user mental model:
corridor checking and photo culling are part of one workflow ("place
markers inside the corridor"), not two separate apps inside the same app.
Forcing the user to pick a mode before they can drop a file is friction
without information gain — the file extension already disambiguates.

The data model in [ADR-003](#adr-003--photomarker-keeps-single-canonical-position--optional-capturedat)
and the simultaneous-rendering criterion in [US-9](./user-stories.md#us-9--corridor-and-photo-work-coexist-on-one-map)
already say corridor markers and EXIF-derived photo markers coexist on the
same `markers[]` array. The toggle adds nothing to that coexistence; it
only gates which dropzone handler runs on the next drop.

**Options.**

1. **Implicit routing** — single dropzone accepts everything; file type
   determines which pipeline runs. No mode UI.
2. **Keep the toggle** (ADR-002 as-is).
3. **Auto-select toggle by recent activity** — toggle exists but switches
   itself based on the last dropped file type.

**Decision.** Option 1.

**Consequences.**

- No `Corridor / Photo` chip in the map header.
- No `sourceMode: 'corridor' | 'photo'` field on `CorridorsSession`. No
  `setSourceMode` setter.
- The dropzone accepts both `.kml`/`.gpx` and `.jpg`/`.jpeg`/`.png`.
  Routing happens after drop, by file extension (with MIME-type fallback
  for safety). Mixed-batch drops are supported — KMLs go to the corridor
  parser, JPEGs to `importPhotoFiles`.
- The photo list side panel appears when there is ≥ 1 imported photo, and
  hides when there are none. Corridor-related controls stay always-visible
  (they're already part of map-corridors' baseline UI). No conditional
  panel toggling based on a mode.
- The HEIC reject error toast ([ADR-006](#adr-006--no-heic-support-in-v1))
  fires on drop regardless of any prior file activity.
- Wrong-file-type messaging changes: instead of "KML in photo mode, switch
  sources" (a mode-aware message), it's just "Unsupported file: foo.bin"
  for genuinely unsupported types — KML in any state is welcome, JPEG in
  any state is welcome.
- One fewer commit in Phase 3 (no toggle component); the photo dropzone
  routing folds into the existing dropzone handler.
- `noGpsTrayOpen` is unaffected — its visibility is data-driven (open iff
  the no-GPS bucket is non-empty by default), not mode-driven.

---

## Visual state matrix — flag × GPS presence

This table enumerates every visual state a photo can be in, to keep the
UI specification and the Phase 4/5 test plans aligned.

| GPS | Flag = `pick`   | Flag = `neutral`     | Flag = `reject`        |
|---|---|---|---|
| **With GPS** | Subject pin at `lng/lat`; ghost capture marker + dashed line iff drag has occurred | Small grey capture dot | **Hidden from the map entirely** (per [ADR-022](#adr-022--variant-compare-side-by-side-modal--reject-hides-marker)). Row remains in the "Odmítnuté" list group as the undo path |
| **No GPS** | Subject pin at user-dropped `lng/lat`; no capture ghost or dashed line | Thumbnail in the off-map tray ([ADR-012](#adr-012-no-gps-photo-placement-off-map-tray-pinned-to-map-corner)) | Same hide rule once the photo has a marker; the off-map tray entry itself is unaffected |

The `neutral`-with-GPS state is the on-import default for every photo
that has GPS. The `neutral`-no-GPS state is "still in the tray, awaiting
placement". A click on Skip in the popup for a *placed* photo demotes
its `pick` back to `neutral` and removes the subject pin (keeping the
capture dot if GPS exists; sending it back to the tray if not).

Click semantics per state:

| Visual | Click action | Right-click |
|---|---|---|
| Capture dot (GPS / neutral) | Open popup with thumb + Include/Skip/Reject | Quick label submenu |
| Subject pin (pick) | Open popup with thumb + label picker + Demote/Reject | Quick label submenu |
| Red × (reject) | Open popup with Restore | — |
| Tray thumb (no-GPS / neutral) | Open popup with Reject | Reject |
| Tray thumb (no-GPS / reject) | Open popup with Restore | Restore |

---

## ADR-022 — Variant compare: side-by-side modal + reject-hides-marker

**Context.** Field feedback (2026-05-24): organisers shoot the same turn
point 2–3 times for insurance. The per-photo Include/Skip/Reject popup
forces a serial judgement; users want an "eyes side-by-side, then pick the
best" affordance. Originally listed below as deferred-to-v2 — promoted
because the workflow is now common.

**Decision.**

1. **Selection is manual + ephemeral.** No persistent "variant group"
   record. Multi-select lives in `PhotoListPanel` local state
   (`selectedIds: readonly string[]`); Ctrl/Cmd+click toggles, Shift+click
   extends a range over the visible row order. Hard-capped at
   `MAX_COMPARE_VARIANTS = 3`.

2. **Reject hides the marker.** Render filter in `MapProviderView` (and
   in `buildGhostFeatures` / `buildDashedLineFeatures` so the ghost +
   dashed line disappear with the pin). Rejected photos remain in the
   "Odmítnuté" list group — that is the undo path. Files are *not*
   deleted from OPFS. This supersedes the previous "Red × at capture,
   40% opacity, hidden when 'Hide rejects' is on" entry in the visual
   state matrix below — there is no "Hide rejects" toggle anymore; reject
   simply hides.

3. **Winner promotion is auto.** The picked tile in the compare modal
   becomes `flag='pick'`, losers become `flag='reject'`. The mutation
   happens in a single `persistMarkers` write so a hard-reload mid-resolve
   cannot observe a half-applied state.

4. **Cross-app contract unchanged.** [ADR-005](#adr-005--cross-app-handoff-via-a-one-way-map-picksjson-file) and
   [ADR-017](#adr-017--flag-lives-in-map-picksjson-only-denormalized-to-geojson-properties-at-render-time)
   already say "only `pick` reaches Photo Helper." Variants change which
   photos earn the pick, not the wire format.

**Why not auto-clustering.** GPS + timestamp clustering is on the v2
list; we could land it as a *suggestion* layer over the manual selection
later without rewriting Phase 12.

**Why not a persistent variant-group record.** Selection state is what the
user is doing *right now*. Persisting the group adds a join table to OPFS
and a UI surface for "ungroup this variant set" — both are scope creep for
zero workflow gain, because rejecting is reversible from the list panel
already.

**Why 3 max.** Two columns reads at any laptop width; three is workable.
Four side-by-side photos are too cramped to make a "best of" call at
typical screen widths, and field reports cap at 2–3 shots per point.

**Files implementing this ADR.** See Phase 12 in `implementation-plan.md`.

---

## Decisions explicitly deferred to v2

These are recorded so they're not re-debated during v1 review.

- ~~**Side-by-side compare modal.** Out of scope.~~ Shipped in Phase 12,
  see [ADR-022](#adr-022--variant-compare-side-by-side-modal--reject-hides-marker).
- **Time-cluster suggestion** ("photos taken within 30 s — pick best").
- **Keyboard shortcuts** (I/S/R, ←/→).
- **Manual EXIF correction** (overriding GPS for individual photos).
- **HEIC support.** Revisit if user demand emerges (ADR-006).
- **Web Workers for import.** ADR-014.


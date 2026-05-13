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

1. **Extend `map-corridors`** with a new "Photo source" mode. Single mode
   toggle in the existing UI.
2. **Extend `photo-helper`** with a map tab. Pulls MapLibre into a canvas
   editor that today has zero map dependencies.
3. **New sub-app** `photo-scout` (or similar). Standalone Vite package +
   launcher tile.

**Decision.** Option 1. Extend `map-corridors`.

**Consequences.**

- map-corridors becomes "the map app", not strictly "the corridor app". The
  user-facing label `Photo Placement` / `Umístění fotek` already fits both
  flows (see [ADR-010](#adr-010-no-rename-photo-placement--umístění-fotek-stays)).
- A new `Photo source` mode toggle ships in the map-corridors header.
- The internal package name `@airq/map-corridors` is **not** renamed —
  doing so would touch every workspace dependency, the desktop launcher's
  protocol handler, and the build pipeline for ~zero user benefit.
- Subsequent ADRs assume Option 1 as the baseline.

---

## ADR-002 — Explicit mode toggle

**Status:** Accepted

**Context.** The dropzone needs to accept either KML/GPX (corridor mode) or
JPEG/PNG (photo mode). It could auto-route by file MIME type silently, or
expose an explicit mode toggle.

**Options.**

1. **Implicit routing** — sniff file type on drop, branch internally. No
   visible UI for the mode.
2. **Explicit mode toggle** — segmented control / chip at the top of the
   map header. The toggle disambiguates UX (panels, tooltips, defaults) that
   depend on which source the user is working with.

**Decision.** Option 2 for v1.

**Consequences.**

- One chip pair in the map header: `Corridor` / `Photo`.
- The right-side panel content varies by mode (photo list in photo mode;
  nothing or corridor info in corridor mode).
- Toggle state persists in the corridor session JSON.
- v2 may revisit auto-routing once we see which mode dominates.

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

**Why Option 1 was rejected after review.**

- `ApiPhoto` is *photo-helper-specific*: it requires `sessionId`, `url`,
  `label`, and a fully-populated `canvasState` with brightness, contrast,
  whitebalance, labelPosition, circle, etc. Map-corridors does not own
  those concepts. Writing them forces map-corridors to fabricate defaults
  that only photo-helper's hook should own. If photo-helper later adds a
  required `canvasState` field, the map writer silently produces invalid
  records.
- Writing `session.json` directly means map-corridors must round-trip the
  *entire* photo-helper schema (`mode`, `setsTrack`/`setsTurning`,
  `version`, `updatedAt`, `competition_name`). Any unknown field added to
  photo-helper's schema is at risk of being dropped on the next map
  write.
- In web mode, the user can open `/photo-helper/` and `/map-corridors/`
  in two tabs of the same browser; they share the OPFS root. Two
  concurrent writers to `session.json` with debounce → unbounded
  read-modify-write race. `@airq/shared-storage` exposes no lock API.

**Consequences.**

- New file: `competitions/{compId}/map-picks.json`. Schema:

  ```ts
  type MapPicksFile = {
    version: 1;
    updatedAt: string;            // ISO
    picks: MapPickEntry[];
  };
  type MapPickEntry = {
    photoId: string;              // namespaced — see below
    filename: string;
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

**Context.** Should photo mode be enabled only for Rally, or both Rally and
Precision?

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
  clicks "Send to editor", the renderer is torn down by the
  Electron `loadURL` (or web `window.location.href` set) before the
  debounce fires — the last toggle is lost. Implementation requirement:
  on click, `await flushPendingMapPicks()` *before* the navigation call.
  Equivalently, hook into `beforeunload` / `pagehide` to flush
  synchronously. Both belt and suspenders are cheap.

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
visible so the user can drag them to position. The earlier v1 strategy
(viewport-anchored lower-edge placement) was rejected on review:

- Markers placed at viewport-anchored lng/lat lie about what
  `PhotoMarker.lng/lat` means (it should be the subject location, not a
  fake screen-projected coord).
- Map pan/zoom does not rearrange the placements, so a no-GPS marker
  can end up off-screen with no way to find it without the side panel —
  defeating the "see them on the map" benefit.
- Multiple no-GPS markers in the same competition pile up at unrelated
  lng/lat values that have no semantic meaning.
- The original ADR self-flagged "if it feels off, v2 can pin them to
  current viewport" — the design owner expected to redo it. Don't ship
  the version you expect to redo.

**Options reconsidered.**

1. **Lower viewport edge, viewport-anchored.** Rejected, above.
2. **Stacked at corridor route midpoint or map center.** Pile-up problem.
3. **Off-map tray pinned to a map corner** (e.g., bottom-left dock).
   Tray holds thumbnails ordered by capture time, each draggable directly
   *onto* the map.

**Decision.** Option 3.

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

**Reasoning (honest version).** Per photo: ~30 ms EXIF parse (mostly
I/O, parallelizes freely) + ~80 ms canvas decode + downscale + JPEG
encode (CPU, single-threaded JS event loop). For 100 photos: I/O fully
overlapped, CPU sequential at ~80 ms × 100 ≈ **8 s wall-clock**.
Batching 8 wide changes peak memory (and bursty I/O), not wall-clock —
`Promise.all` does not multi-core JavaScript compute. That's tolerable
for a one-time per-competition operation, with a progress bar to make
it tolerable to look at.

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

## Visual state matrix — flag × GPS presence

This table enumerates every visual state a photo can be in, to keep the
UI specification and the Phase 4/5 test plans aligned.

| GPS | Flag = `pick`   | Flag = `neutral`     | Flag = `reject`        |
|---|---|---|---|
| **With GPS** | Subject pin at `lng/lat`; ghost capture marker + dashed line iff drag has occurred | Small grey capture dot | Red `×` at capture, 40% opacity, hidden when "Hide rejects" is on |
| **No GPS** | Subject pin at user-dropped `lng/lat`; no capture ghost or dashed line | Thumbnail in the off-map tray ([ADR-012](#adr-012-no-gps-photo-placement-off-map-tray-pinned-to-map-corner)) | Thumbnail in the off-map tray with a red overlay; same "Hide rejects" filter applies |

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

## Decisions explicitly deferred to v2

These are recorded so they're not re-debated during v1 review.

- **Side-by-side compare modal.** Out of scope.
- **Time-cluster suggestion** ("photos taken within 30 s — pick best").
- **Keyboard shortcuts** (I/S/R, ←/→).
- **Manual EXIF correction** (overriding GPS for individual photos).
- **HEIC support.** Revisit if user demand emerges (ADR-006).
- **Web Workers for import.** ADR-014.

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
- Dashed lines redraw on **drag-end** (not drag-tick) via source-data
  update.
- The "Hide rejects" toggle (US-13) becomes a Mapbox paint filter —
  fast, no DOM churn.
- Phase 4 of the implementation plan is rescoped accordingly.

**Note on library naming.** The codebase imports from
`react-map-gl/mapbox` (Mapbox GL), not `maplibre-gl`. Earlier doc
references to "MapLibre" were imprecise — the existing infrastructure
uses Mapbox GL via react-map-gl. MapLibre is also in the deps for
non-Mapbox tile providers but isn't the React-binding entry point.

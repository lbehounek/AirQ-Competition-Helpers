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
  flows (see [ADR-011](#adr-011-no-rename-photo-placement--umístění-fotek-stays)).
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
  pick: ['DateTimeOriginal', 'GPSAltitude', 'GPSImgDirection', 'Orientation'],
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

## ADR-005 — Cross-app handoff via the shared candidate pool

**Status:** Accepted

**Context.** Photos selected in the map tool need to appear in
photo-helper's tray without a manual export/import step.

**Options.**

1. **Mirror to `session.candidates.photos[]`** on every flag change. The
   photo-helper tray reads from there as it already does.
2. **Bespoke handoff format** (e.g., a new `selectedPhotos[]` array in the
   shared session). photo-helper learns to read both.
3. **Push at "Send to editor" time** only — batch transfer when user
   clicks the button.

**Decision.** Option 1. The candidate pool shipped in
`feat/candidate-photos` already models exactly this concept (photos in
selection, with `pick` / `neutral` / `reject` flag). Reuse it.

**Consequences.**

- Every flag change in the map tool triggers a debounced write to the
  photo-helper session JSON. The two writers (map-corridors session +
  photo-helper session) share the same `competitions/{compId}/` dir and
  the same `@airq/shared-storage` abstraction; sequential read-modify-write
  with retry is sufficient (single-window apps).
- "Send to editor" becomes a pure navigation, not a data transfer — see
  [ADR-010](#adr-010-send-to-editor-navigates-only).
- Photo-helper does not need any changes to consume the photos — they
  arrive shaped exactly as the existing candidate pool expects.

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

## ADR-007 — No drone XMP support

**Status:** Accepted

**Context.** Drone photos (DJI especially) embed gimbal yaw / pitch in XMP
metadata, which could be used to auto-suggest subject offset direction.

**Decision.** Drones are not part of the competition photography workflow.
Not supported. The `capturedAt.heading` field exists in the data model for
future-proofing only; nothing reads it in v1.

**Consequences.**

- No XMP parsing added to the EXIF pipeline.
- No bearing arrow on map markers in v1.

---

## ADR-008 — Default subject pin position: at the capture point

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

- For photos where the user is OK with capture ≈ subject (rare but
  possible), zero clicks are needed beyond Include.
- The dashed-line indicator only appears once the user drags.

---

## ADR-009 — Discipline support: both Rally and Precision

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

## ADR-010 — "Send to editor" navigates only

**Status:** Accepted

**Context.** When the user clicks "Send to editor (N picks)", what happens?

**Options.**

1. **Navigate only.** Photos already live in the candidate pool (see
   [ADR-005](#adr-005-cross-app-handoff-via-shared-candidate-pool));
   button just switches apps.
2. **Navigate + auto-fill slots.** Promote N picks into the print grid
   slots automatically.
3. **Navigate + open the candidate tray expanded.**

**Decision.** Option 1. User-confirmed. Slot assignment is the editor's
job; auto-filling would couple two concerns and hide which photo went where.

**Consequences.**

- The map tool never writes to `session.sets`; only to
  `session.candidates`.
- photo-helper opens normally and the user drags from tray to slots as
  today.

---

## ADR-011 — No rename. "Photo Placement" / "Umístění fotek" stays

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

## ADR-012 — Thumbnail storage in `photos/thumbs/`

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

## ADR-013 — No-GPS photo placement strategy: lower viewport edge, capture-time order

**Status:** Accepted

**Context.** Some photos arrive without GPS. They still need to be visible
on the map so the user can drag them to position. Three options:

**Options.**

1. **Center of the corridor route midpoint** (if corridor loaded) or map
   center (if not).
2. **Along the lower edge of the visible map viewport**, ordered
   left-to-right by EXIF `DateTimeOriginal`.
3. **Stacked at a fixed off-map "tray" position** like a UI element pinned
   to the map corner.

**Decision.** Option 2.

**Reasoning.**

- Predictable regardless of whether a corridor is loaded.
- Each photo gets a distinct position; no pile-up that would prevent
  grabbing.
- Visible immediately without scrolling.
- Capture-time ordering is meaningful — neighbouring photos in time are
  often neighbouring photos on the ground.

**Consequences.**

- Markers are rendered with viewport-anchored coordinates initially. When
  the user drags one, it converts to a normal map-anchored pin.
- "Needs placement" visual: orange/yellow + `?` glyph, no dashed line back
  to a capture point (no capture point exists).
- Spacing ~80 px between markers; wrap to a row above if too many to fit
  in viewport width.
- Map pan/zoom **does not** rearrange the no-GPS markers — they stay where
  they were placed (initial viewport coords). User pans to find them if
  needed. (Trade-off: simple to implement; if it feels off, v2 can pin them
  to current viewport.)
- They are also listed in the right-side panel under "No GPS" for
  discoverability.

---

## ADR-014 — Atomic per-photo import (no partial-batch state)

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

## ADR-015 — Import throughput: main-thread, throttled at 8 concurrent

**Status:** Accepted

**Context.** 100 photos × (EXIF read + thumb generation + blob save) is
non-trivial work. Web Workers would parallelize cleanly but add
complexity.

**Options.**

1. **Web Worker pool.** Send each file to a worker for EXIF + decode +
   thumb; main thread does storage writes.
2. **Main-thread with `Promise.all` over batches of 8.**

**Decision.** Option 2 for v1.

**Reasoning.** 100 photos at ~150 ms each (typical EXIF + canvas
downscale) = ~15 s wall-clock, batched 8 wide = ~2 s on modern hardware.
That's tolerable for a one-time per-competition operation. Worker pool can
come if it proves slow on real data.

**Consequences.**

- A progress bar shows N of M during the operation.
- The UI is responsive but not fully idle — canvas work blocks for tens
  of ms per photo. Acceptable for v1.
- If a future profile shows > 30 s on real batches, revisit with workers.

---

## Decisions explicitly deferred to v2

These are recorded so they're not re-debated during v1 review.

- **Side-by-side compare modal.** Out of scope.
- **Time-cluster suggestion** ("photos taken within 30 s — pick best").
- **Auto-suggest subject from heading.** Needs `capturedAt.heading` data,
  which is captured but not consumed in v1.
- **Keyboard shortcuts** (I/S/R, ←/→).
- **Manual EXIF correction** (overriding GPS for individual photos).
- **HEIC support.** Revisit if user demand emerges (ADR-006).
- **Drone XMP / gimbal yaw.** ADR-007.
- **Web Workers for import.** ADR-015.

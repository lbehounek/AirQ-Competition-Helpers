# User Stories — Photo Map Culling

Primary role: **Competition organizer**. They shoot the photos, run them
through the helpers, and produce both the printed photo sheet and the
answer sheet.

Format:

> **As a** [role], **I want** [action], **so that** [benefit].

Each story has acceptance criteria phrased so they can be checked against a
manual run or written as a test. Stories link to the relevant ADRs in
[decisions.md](./decisions.md) where the design is locked.

---

## US-1 — Import GPS-tagged photos onto a map

**As an** organizer, **I want** to drag-and-drop a batch of 30–100 photos
that have GPS EXIF data onto the map app, **so that** I see them in their
geographic context immediately and skip the blind Explorer-thumbnail step.

**Acceptance criteria**

- Photo source mode is selectable via an explicit toggle at the top of
  map-corridors ([ADR-002](./decisions.md#adr-002-explicit-mode-toggle)).
- In photo source mode, the dropzone accepts `.jpg`, `.jpeg`, `.png`.
- After drop, the map zooms (fit-bounds) to enclose all photos with GPS.
- Each photo with GPS appears as a small grey dot at its capture location.
- Import progress is visible (progress bar / count) for batches > 10 photos.
- Files without GPS are still imported, surfaced in an off-map tray
  pinned to the map corner ([ADR-012](./decisions.md#adr-012-no-gps-photo-placement-off-map-tray-pinned-to-map-corner), [US-8](#us-8--work-with-photos-that-have-no-gps)).
- Existing KML/GPX corridor data, if loaded, remains visible alongside photos.

**Out of scope:** HEIC files trigger an error toast ([ADR-006](./decisions.md#adr-006-no-heic-support-in-v1)).

---

## US-2 — Preview a photo before deciding

**As an** organizer, **I want** to quickly preview the photo behind a map
dot, **so that** I can decide whether it's a usable shot without opening a
separate viewer.

**Acceptance criteria**

- Hovering a capture dot shows a small thumbnail tooltip (~80×60 px).
- Clicking a capture dot opens a popup with a larger thumbnail (~200×150),
  filename, capture time, and action buttons (Include / Skip / Reject).
- The thumbnail loads instantly because it was pre-generated at import time
  ([ADR-011](./decisions.md#adr-011-thumbnail-storage-in-photosthumbs)).
- Popup can be dismissed by clicking elsewhere on the map or pressing Esc.

---

## US-3 — Include a photo in the final selection

**As an** organizer, **I want** to mark a photo as "use this one", **so
that** it propagates downstream to the photo editor (for cropping/printing)
and the corridor check.

**Acceptance criteria**

- Clicking "Include" in the popup flips the photo's flag to `pick`.
- The grey capture dot becomes a coloured pin at the same location, marked
  for subject placement.
- The flag change is persisted to `map-picks.json` within 300 ms (debounced).
- Photo-helper, on next competition load (or tab focus), reads
  `map-picks.json` and adds the photo to its candidate tray with
  `flag: 'pick'` ([ADR-005](./decisions.md#adr-005-cross-app-handoff-via-a-one-way-map-picksjson-file)).
- The pin is visually distinct from corridor-derived markers (different
  default colour or border style).

---

## US-4 — Skip a photo

**As an** organizer, **I want** to mark a photo as "not for this batch but
maybe later", **so that** it stays accessible but doesn't clutter the final
selection.

**Acceptance criteria**

- Clicking "Skip" in the popup sets the photo's flag to `neutral`.
- The capture dot stays grey; no subject pin appears.
- The photo appears in the right-side list under "Neutral".
- Photo is **not** included in the count sent to the editor.

---

## US-5 — Reject a photo

**As an** organizer, **I want** to mark a photo as "actively bad" (blurry,
wrong subject, etc.), **so that** it's visually flagged out without being
deleted (in case I change my mind).

**Acceptance criteria**

- Clicking "Reject" sets the photo's flag to `reject`.
- The dot turns red with low opacity (≤ 40%).
- A "Hide rejects" toggle in the toolbar hides red dots from the map.
- Rejects also appear in the photo-helper tray as `reject`, matching the
  existing candidate-pool semantics.

---

## US-6 — Move the subject pin from capture point to actual subject

**As an** organizer, **I want** to drag a photo's pin from where I was
standing to where the photographed object actually is, **so that** the
corridor legality check and answer sheet use the right coordinates.

**Acceptance criteria**

- On Include, the subject pin defaults to the capture point
  ([ADR-007](./decisions.md#adr-007-default-subject-pin-position-at-capture-point)).
- The pin is draggable; on drag-end, its `lng/lat` updates.
- The original capture point becomes a small ghost marker (dimmer than the
  pin), with a dashed line connecting them, so the relationship is visible.
- If the user doesn't drag, the ghost marker and pin overlap and the line
  collapses to zero length.
- The pin's coordinates are the ones used by the corridor legality check
  and answer-sheet generator.

---

## US-7 — Assign a competition label

**As an** organizer, **I want** to assign a letter (A–T) or number (1–20)
to each picked photo, **so that** it maps to the competition's photo grid
and answer sheet.

**Acceptance criteria**

- Discipline (Rally vs Precision) is inherited from the active competition
  ([ADR-008](./decisions.md#adr-008-discipline-support-both-rally-and-precision)).
- Rally uses letters A–T, Precision uses numbers 1–20 (existing
  `getLabelsForDiscipline` from `@airq/shared-discipline`).
- The popup shows a label picker. Already-assigned labels are visually
  marked as taken.
- Labels appear as small badges on the pin on the map.
- Removing a label frees it for reuse.

---

## US-8 — Work with photos that have no GPS

**As an** organizer who occasionally has photos without GPS metadata, **I
want** to see them as draggable thumbnails on the map surface, **so that**
I can grab one and place it where it belongs without hunting for it in a
hidden sidebar.

**Acceptance criteria**

- Photos without GPS appear as thumbnails in an **off-map tray** pinned
  to the bottom-left corner of the map view, layered above the map but
  not anchored to map coordinates.
- Tray scrolls horizontally; thumbnails are ordered left-to-right by
  EXIF `DateTimeOriginal` (with filename as a tiebreaker for photos
  missing time).
- Tray height ≤ ~120 px so it does not dominate the map.
- A thumbnail in the tray can be dragged onto any point on the map. On
  drop, a normal subject pin (flag = `pick`) is created at the projected
  lng/lat (`map.unproject([clientX, clientY])`) and the thumbnail leaves
  the tray.
- Each thumbnail offers click-to-popup (label assignment, mark
  rejected, etc.) without leaving the tray.
- When the tray is empty, it collapses to a small chevron icon so the
  map surface is fully visible.
- Tray collapsed/expanded state persists across reload via
  `corridors-session.json:noGpsTrayOpen`.
- These same photos are also listed in the right-side panel under a
  "No GPS" section ([US-12](#us-12--filter-the-photo-list-by-flag-or-no-gps)).
- Strategy locked in [ADR-012](./decisions.md#adr-012-no-gps-photo-placement-off-map-tray-pinned-to-map-corner).

---

## US-9 — Switch between corridor and photo source without losing work

**As an** organizer, **I want** to flip between corridor-mode (KML/GPX) and
photo-mode without losing data in either, **so that** I can review both in
the same session.

**Acceptance criteria**

- The mode toggle is a non-destructive UI control. Switching does not
  delete markers or photos.
- Both corridor markers and photo-derived markers can be visible
  simultaneously (the toggle controls the *input* surface, not visibility).
- The toggle's state persists per-competition in the corridor session JSON.

---

## US-10 — Send selections to the photo editor

**As an** organizer, **I want** a one-click action to jump to the photo
editor after I've finished culling, **so that** I can immediately start
cropping/labeling without manually opening a different app.

**Acceptance criteria**

- A "Send to editor (N picks)" button is visible when ≥ 1 photo has flag
  `pick`.
- Clicking it navigates the app to photo-helper via the existing
  `electronAPI.navigateToApp('photo-helper', { competitionId })` IPC
  (Electron) or `/photo-helper/?competitionId=…` URL (web).
- **No** explicit data transfer happens at click time — data already lives
  in the shared candidate pool ([ADR-009](./decisions.md#adr-009-send-to-editor-navigates-only)).
- On arrival in photo-helper, the candidate tray contains all picked
  photos, ready for slot assignment.

---

## US-11 — Persistence across restarts

**As an** organizer, **I want** my culling work to survive app restarts,
browser refreshes, and computer reboots, **so that** I can pause and resume
without re-importing.

**Acceptance criteria**

- All picked / neutral / rejected flags persist in
  `competitions/{compId}/corridors-session.json` and mirror to the
  photo-helper `session.json`'s `candidates.photos[]`.
- Thumbnails persist in `competitions/{compId}/photos/thumbs/{photoId}.jpg`.
- Original photo blobs persist in `competitions/{compId}/photos/{photoId}`.
- Subject pin coordinates and label assignments survive reload.
- Reload after a force-quit mid-import recovers cleanly (partial photos
  are visible if their full save completed; partial ones are discarded).

---

## US-12 — Filter the photo list by flag or "no GPS"

**As an** organizer working with 50+ photos, **I want** to filter the photo
list to just picks, just rejects, or just no-GPS, **so that** I can focus
on one decision at a time.

**Acceptance criteria**

- A right-side photo list panel renders alongside the map.
- The panel groups photos by flag: Picks / Neutral / Rejects / No GPS.
- Clicking a list item flies the map to that photo and opens its popup.
- Clicking a flag group header collapses/expands the group.
- The panel can be collapsed into a drawer on narrow viewports.

---

## US-13 — Reject filter / Hide rejects

**As an** organizer who has triaged a batch and rejected some, **I want**
to hide the red rejected dots on the map, **so that** I can see the surface
without visual noise — but still revisit rejects from the side panel if I
change my mind.

**Acceptance criteria**

- A "Hide rejects" toggle in the toolbar.
- When on, red dots are hidden from the map. Rejects still appear in the
  side panel (under their group).
- The toggle's state persists per-session.

---

## US-14 — Per-competition isolation

**As an** organizer running back-to-back competitions, **I want** photos
imported into competition A to not appear in competition B, **so that** I
don't accidentally print one event's photos for another.

**Acceptance criteria**

- All photo data is scoped under `competitions/{compId}/`.
- Switching active competition via the launcher reloads photos for the new
  one only.
- No global photo bucket exists.

---

## US-15 — Replace the existing manual-click marker workflow when desired

**As an** organizer who has used the old click-on-map workflow, **I want**
to still be able to fall back to it if EXIF data is unavailable or
unreliable, **so that** the new feature never traps me.

**Acceptance criteria**

- The corridor source mode (click-to-place) is fully preserved.
- It is the default mode for a fresh competition without any photo imports.
- Switching to photo mode never disables the click-to-place behaviour for
  the corridor markers already on the map; new EXIF markers and click-placed
  markers coexist on the same `markers[]` array.

# Changelog

All notable changes to the AirQ Competition Helpers desktop app are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file tracks the **Windows desktop bundle** (tagged `desktop-v*`). Sub-app
changes (Photo Helper, Map Corridors) reach end users only when bundled into a
new desktop release.

## [2.31.4] - 2026-09-12

### Security
- **Map Corridors:** updated the map engine (MapLibre GL) past a critical
  cross-site-scripting flaw in its HTML sanitiser. No fix exists in the old 5.x
  line, so this is a major engine update, 5.19 to 6.9.
- **Desktop launcher:** updated Electron to 39.8.10, closing three flaws in the
  framework itself — a context-isolation bypass, a custom-protocol issue and a
  sandboxed-iframe popup bypass.
- Refreshed the build- and test-time dependency tree. The project's own security
  pins had aged into the vulnerable range and, being exact rather than
  conditional, were blocking the very patches they existed to deliver. Known
  advisories across the project drop from 90 to 7 — none critical, and the two
  remaining are in a build-time package with no published fix.

Nothing here changes how the apps behave. The map engine update is the only
change that touches what you see, and it is a like-for-like replacement.

## [2.31.1] - 2026-09-09

Fixes a serious map error found in the real course files from the **MZB 2026
rally**. Where a course draws a leg as a *dashed* line — many short separate
line pieces instead of one continuous line — the app used to delete those
pieces and join whatever survived with a straight line. On that course it drew
one straight corridor from TP 4 to TP 6, ignoring TP 5 entirely, put the TP 5
marker 6.4 km away from where TP 5 actually is, and measured the route 13.4 km
(11 %) shorter than it really is. Five of the eight legs were wrong, and
nothing warned about any of it.

**If you have printed maps, answer sheets or distance tables from a course
whose legs are drawn dashed, re-generate them.** The new warning banner tells
you when a file is of that kind.

### Fixed
- **Map Corridors:** legs drawn as dashed lines are recognised and rebuilt into
  one continuous route before anything else runs. Previously each dash shorter
  than 500 m was discarded as map decoration, and dashes longer than that were
  each treated as a separate piece of route with a hole between them — so a
  dashed leg either vanished or produced no corridor at all, whatever the dash
  length. Isolated decorative marks are still discarded as before.
- **Map Corridors:** no corridor is ever drawn along a straight line the app
  invented to bridge a hole in the route. One case slipped through this check —
  the case where both ends of the corridor landed on the same invented line,
  which is exactly what produced the straight TP 4 to TP 6 corridor.
- **Map Corridors:** en-route photos are matched to the nearest leg. A photo
  falling just outside its own leg's corridor — 42 m outside, in one measured
  case — used to be barred from that leg entirely and attached to a completely
  different one, up to 26 km away. On the MZB course 6 of 18 photos were
  attributed to the wrong turning point.
- **Photo Helper:** the answer-sheet letter you assign to a photo on the map is
  kept when the photo sheet is generated. It used to be replaced by a letter
  derived purely from the photo's position in the grid, so the printed sheet
  could disagree with the answer sheet. Photos with no assigned letter still
  get one from their position.
- **Map Corridors:** where a course passes close to itself, a turning point's
  gate line can cross the route twice. The app now takes the crossing nearest
  the turning point instead of an arbitrary one.
- **Map Corridors:** a leg shorter than the gate distance (5 NM after SP, 1 NM
  after each turning point) no longer pushes its gate past the next turning
  point, which used to produce a corridor running backwards, or silently delete
  two legs at once. The gate is placed within its own leg; if the leg is too
  short for even that, you are told.
- **Map Corridors:** GPX files recorded with the receiver paused (several track
  segments inside one track) now load. They previously produced an empty track
  and nothing rendered at all.
- **Map Corridors:** turning points named `TP-3`, `CP_15` and similar are
  recognised, and `TP 10` now sorts after `TP 9` rather than by its digits
  alone. Any placemark that looks like a waypoint but is not recognised is
  reported instead of silently ignored.

### Added
- **Map Corridors:** a warning banner above the map listing everything the app
  had to work around in your course file — legs rebuilt from dashes, holes in
  the route, unrecognised placemarks, and every leg for which no corridor could
  be drawn, with the reason. Every one of these used to happen silently, which
  is why a whole competition could be flown on a wrong map without anyone
  seeing a problem.

## [2.31.0] - 2026-09-05

The desktop app now ships as a proper Windows **installer** alongside the
portable `.exe`. The installer is the recommended download: the portable build
unpacks its whole contents into a temporary folder on every launch, which is
the main reason the app felt slow to open on older laptops; the installed build
does not. Internally, the launcher also no longer copies the developer-only
sample competition before opening its window (release builds bundle none).

### Added
- **Desktop launcher:** `photo-helper-vX.Y.Z-setup.exe` — an installer that
  installs for the current user only (no administrator rights needed), lets you
  choose the install folder, and creates Desktop and Start-menu shortcuts.
  Existing competitions are untouched: both builds keep their data in the same
  per-user folder, so switching from the portable build to the installer keeps
  everything, and uninstalling never deletes it.

### Changed
- **Desktop launcher:** the portable build is still published, now named
  `photo-helper-vX.Y.Z-portable.exe`, for USB sticks and machines where
  installing is not allowed.
- **Map Corridors:** render performance. The map view and the photo list panel
  are now memoized, and App hands them referentially stable props, so the eleven
  App state values neither of them reads (import progress, snacks, dialogs, the
  drop-hint overlay, preview/compare state) no longer re-render either one.
  Previously a single imported file re-rendered the whole map tree and every
  list row.
- **Map Corridors:** photo pins. Each photo marker is now its own memoized
  `PhotoMarkerPin` with a value-comparable prop contract, so dragging one pin, a
  zoom frame, or an unrelated state change re-renders only the pins whose own
  values changed instead of rebuilding all N marker subtrees. Pin styling moved
  into a pure, unit-tested `photoMarkerStyle` module; the rendered map is
  pixel-identical.
- **Map Corridors:** photo list rows. Rows are memoized on a closure-free
  contract, so a typical panel re-render touches only the one or two rows whose
  highlight changed rather than rebuilding ~120 MUI rows with three fresh
  closures each.
- **Map Corridors:** thumbnail loading. A photo row now loads its thumbnail only
  once it is (nearly) on screen, instead of every mounted row fetching at mount
  — including rows inside the default-collapsed "Odmítnuté" group. On the
  desktop app each of those was an IPC round-trip plus a synchronous file read
  on the main process. Viewers without IntersectionObserver keep the old eager
  behaviour.
- **Map Corridors:** corridor matching. Marker↔corridor matching is now
  incremental: a flag toggle, label or rename costs no geometry work at all, and
  a marker drag re-matches only that one marker. A session load or a corridor
  change still matches everything.
- **Map Corridors:** marker auto-fan. The per-frame recompute during a zoom now
  runs only while overlapping markers are actually fanned out. Fanned dots still
  track the basemap every frame (the placed-photo-drifts-on-zoom fix is intact);
  a cluster that first forms while zooming out now fans when the zoom settles
  rather than mid-animation.
- **Photo Helper:** editing a photo is now noticeably smoother on large sheets.
  Dragging a slider updates the photo you are editing live, but the change is
  saved once when you let go instead of on every pixel of the drag — so the grid
  behind the editor no longer stutters while you adjust brightness, zoom,
  sharpness or white balance.
- **Photo Helper:** the competition list file is no longer rewritten on every
  single edit. It is still updated immediately when you rename a competition or
  add/remove photos, and always before you switch competition, close the app, or
  go back to the menu.
- **Photo Helper:** the photo sheet is much lighter to work with. Previously
  every single change — even just moving the mouse and pausing — made every
  photo on the page redraw itself. Now only the photo you actually touched
  redraws, so editing a full sheet no longer slows the whole window down.
- **Photo Helper:** photo previews in the grid are now rendered at the size they
  are actually displayed at, instead of always at the largest size. Small
  thumbnails (the candidate tray) do far less work, and previews stay just as
  sharp on high-resolution and scaled Windows displays — including when you drag
  the window to a second monitor with different scaling.
- **Photo Helper:** the candidate tray now renders lightweight thumbnails
  instead of a full photo editor per candidate. Each tray thumb is a ~20 KB
  320x240 JPEG, generated once from the photo in memory, persisted at
  `competitions/{id}/photos/thumbs/{photoId}.jpg` and cached (≤400 in memory, 2
  generations in flight). A 40-candidate session no longer pays 40
  full-resolution decodes, 80 canvases, 40 window listeners and 40 idle timers.
  Map-originated (`pm-`) candidates reuse the thumbnail the map app already
  wrote at import.
- **Photo Helper:** tray thumbs show the **source photo, centre-cropped** —
  pan/zoom/brightness/white-balance/circle adjustments are visible when you open
  the photo, not in the tray. Thumbs no longer stretch the image into the tile.
- **Photo Helper:** thumbnail synthesis (`generateThumb`/`fitWithin`) moved into
  `@airq/shared-storage` so the editor and the map app share one implementation;
  the map app's import path is unchanged.
- **Photo Helper:** PDF export now matches what you see. Photo adjustments in
  the exported PDF are rendered with the same GPU shader the live preview uses,
  so the printed sheet matches what you tuned in the editor. Previously the
  export used a separate CPU implementation with a different white-balance gain,
  an inverted tint direction and a different sharpen kernel. Consequences:
  re-exporting an existing competition will look different from older exports
  (intended); sharpen strength is resolution-relative, so the 1600 px export
  sharpens more finely than the 600 px editor view for the same slider value;
  Auto white balance is resolved into explicit temperature/tint by the editor
  before export.
- **Photo Helper:** the window no longer freezes during a PDF export. The export
  renders one photo at a time and yields between them, so the app stays
  responsive, shows a progress bar with "Rendering photo 3 of 9…", and a second
  click on Generate during an export no longer starts a parallel one.
- **Photo Helper:** starts with 65% less JavaScript. The PDF export engine
  (@react-pdf/renderer and its pdfkit/fontkit tree, ~1.6 MB) and the guided-tour
  library are now downloaded the first time you actually export or start a tour,
  instead of on every launch. Eager JavaScript drops from 2,482 kB to 868 kB
  (802 kB to 266 kB compressed) — the difference is most noticeable on the first
  launch after installing or updating.
- **Both apps:** now split their bundles into cache-stable vendor chunks (React,
  MUI, pica / the map engine), so a release that only changes app code no longer
  invalidates the ~2 MB of library code in the browser cache, and the browser
  compiles the chunks in parallel.
- **Map Corridors:** first-load size is essentially unchanged (-1.7%): the map
  engine is needed by the very first screen and cannot be deferred. Its startup
  cost is a map-runtime issue, not a bundling one.
- **Internal:** New shared build helper `frontend/vite.chunks.ts` with a
  build-time guard (`assertLazyOnly`) that FAILS `vite build` if a lazily-loaded
  library (@react-pdf/*, driver.js) ever becomes part of the initial download
  again, or if the chunk graph gains a cycle. This closes a trap in which an
  innocuous manualChunks rule silently re-attached the whole PDF renderer to the
  first paint while the build stayed green.
- **Internal:** The PDF generator moved to `utils/pdfGeneratorImpl.ts` behind a
  lazy facade at the original `utils/pdfGenerator.ts` path, so every current and
  future importer gets the deferred load automatically.
- **Internal:** The onboarding tours split into a pure `run*Tour(driverFactory,
  ...)` and a lazy `start*Tour(...)`, which finally makes the open/close-editor
  choreography (the 450 ms / 80 ms timers, the boolean back-compat argument,
  onDestroyed) unit-testable.
- **Internal:** Map Corridors now imports individual `@turf/*` subpackages
  instead of the `@turf/turf` barrel, and drops the unused `maplibre-gl` /
  `@vis.gl/react-maplibre` dependencies (119 packages out of the lockfile; zero
  bundle impact — every map import already went through `react-map-gl/mapbox`).

### Fixed
- **Desktop launcher:** when a window asked for a program file left over from an
  older build, the app answered with its own start page instead of saying the
  file was missing, which surfaced as a baffling script error. It is now
  reported as a plain "not found".
- **Photo Helper:** the zoom slider sometimes failed to keep the value you
  dragged it to — releasing the handle could leave the old zoom saved. The final
  value is now always the one that is stored.
- **Photo Helper:** a change made just before closing the editor, switching
  photo with the arrows, switching competition or leaving the app could be lost.
  Every one of those now saves what you had in progress first.
- **Photo Helper:** editing the same photo from both control panels (right side
  and bottom) could make one panel silently undo a setting the other had just
  changed. Each panel now saves only the setting you touched.
- **Photo Helper:** photos are no longer loaded and decoded twice when a
  competition opens, and a photo that is already loaded is no longer re-loaded
  from scratch every few minutes. Opening the editor, switching aspect ratio and
  moving a photo out of the tray are all quicker, with fewer "Loading…" flashes.
- **Photo Helper:** when the high-quality redraw of a photo took a moment, an
  older version could occasionally finish last and paint over the newer one,
  showing a stale image. The newest version now always wins.
- **Photo Helper:** switching competitions no longer leaves the previous
  competition's photo directory in use for a moment — the editor clears the
  resolved directories before resolving the new ones, so nothing can be read
  from or written into the wrong competition.
- **Photo Helper:** deleting a candidate now removes its thumbnail file too,
  instead of leaving ~20 KB stranded per deleted photo; an in-flight thumbnail
  generation for a just-deleted photo can no longer resurrect it.
- **Desktop:** a missing photo file is now reported as a proper 'not found'
  instead of a generic error, so a first-time thumbnail read is no longer
  indistinguishable from a real read failure (it also stops the map app logging
  a warning for every thumbnail it has yet to create).
- **Desktop:** loading photos is faster and much lighter on memory — decoding a
  photo received from the app's file layer no longer builds a
  multi-million-entry temporary array per photo.
- **Photo Helper:** high-quality resizing no longer copies the full-resolution
  photo into an intermediate canvas before every resize (a ~48 MB allocation per
  resize, twice for the multi-pass path) — the decoded image now goes straight
  to pica.
- **Photo Helper:** the resize cache is bounded by a 16 MP pixel budget (≈64 MB)
  instead of an unbounded 20 entries, which could hold well over a gigabyte
  after one PDF export on a 4 GB laptop. The PDF export no longer evicts the
  editor's cached photos.
- **Photo Helper:** the PDF export releases its GPU context as soon as the last
  photo is rendered rather than holding it through PDF composition and the save
  dialog, and refuses to use the GPU when a photo exceeds the driver's texture
  limit or the context is lost — those cases fall back to the CPU path instead
  of printing a black or stretched cell.

## [2.30.1] - 2026-07-28

Maintenance release. Nearly all of the work is internal — the Photo Helper build
now genuinely typechecks, roughly 2,100 lines of unreachable code are gone, and
every `any` has been removed from the package — and the desktop build is now
tagged *and* built automatically on merge, where previously the tag was created
but the build had to be started by hand. That sweep uncovered the handful of real
defects below.

### Fixed
- **Photo Helper:** the close button on the photo editor showed an untranslated
  tooltip in Czech — the English string was there, the Czech one was missing.
- **Photo Helper:** a competition whose `session.json` was malformed — hand-edited,
  or left half-written by a crash — could poison the rebuilt competition list with
  a nonsense title or date, which then misordered the list. The recovery path now
  validates each field and falls back to the folder name and the current time
  rather than propagating bad data.
- **Photo Helper:** a failed write to the desktop config file (where the language
  setting is stored) was discarded without a trace, so a language that quietly
  reset on next launch left nothing to diagnose it by. The failure is now
  reported to the console. The write itself can still fail — this only makes it
  visible.

### Removed
- **Photo Helper:** the **Reset session** button, which was permanently greyed out
  and could never be clicked — it was wired to a function the competition system
  no longer provides. Nothing changes in practice; the underlying feature has to
  be built on the competition system before the button can return.

## [2.30.0] - 2026-07-26

### Fixed
- **Photo Helper:** in a **precision** competition, a set holding **10 photos**
  in landscape showed only **9 on screen** — the 10th was hidden behind the 3×3
  grid, then appeared on the exported PDF, which lays 10 photos out as 5×2. The
  screen now uses the same grid as the printed sheet, so what you arrange is
  what you get. (Precision sheets can hold 10; the layout switch warns before
  moving a full portrait set to landscape.) The empty-set drop zone also no
  longer advertises room for 10 photos in landscape when only 9 fit.
- **Map Corridors:** **photo names now appear on the exported / printed map.**
  Previously the print drew only the answer-sheet label (A…T / 1…20), which is
  set only by clicking through the marker popup grid — so a photo you renamed
  to *TP1* printed as an anonymous yellow dot, and so did every un-labelled
  track photo. Each dot now carries the most useful identifier it has: the
  custom name with the answer-sheet label in front when both are set
  (`A - TP1`), the custom name on its own, the label on its own when the photo
  was labelled but never renamed (`A`), and the camera filename when it has
  neither. So no dot stays anonymous, and a labelled dot is not padded out with
  a camera serial number nobody reads — a 20-photo rally where nothing was
  renamed no longer prints a wall of `DSC_…` pills across the track. (The
  **KML** export additionally keeps the original filename in parentheses;
  Google Earth is where you trace a pin back to a file.) Names that would land
  on top of each other — photos shot at the same turning point, which the print
  draws without the on-screen marker fan — are stacked downwards so they stay
  readable.
- **Map Corridors:** renaming a photo or marker quickly could save a **truncated
  name**. Each keystroke saved the whole competition, and on the web build those
  saves could finish out of order — so the file ended up holding whichever one
  happened to land last, not the one you typed last. Saves are now written
  strictly in order.
- **Map Corridors:** dropping a second batch of photos **while the first import
  was still running** could import the same files twice, as two blobs and two
  markers. The second batch now waits for the first to finish, so re-dropping a
  folder mid-import is correctly reported as duplicates instead of doubling
  them. Photos are never discarded — they queue, and the progress bar counts the
  whole burst.
- **Photo Helper (web build only):** opening the editor from Map Corridors in a
  browser lost the **discipline**, so a precision competition was laid out as a
  rally — letter labels instead of numbers, and a spurious second answer sheet.
  The desktop app was never affected.
- **Map Corridors:** importing a folder where **some** photos have GPS and some
  don't could **lose every photo that landed on the map**, leaving only the
  no-GPS ones in the tray. The map pins and the "Bez GPS" list were saved as two
  separate writes, and the second one could be built from a copy of the
  competition taken before the first — silently undoing it. Both are now saved
  together, so either the whole import lands or none of it does. An import where
  every photo has GPS was never affected, which is why this went unnoticed.
- **Map Corridors:** a photo whose file could not be **read** during import is
  now reported as a failed import ("could not be opened — check it is still
  available") instead of being silently filed under **Bez GPS**. A failed read
  looks exactly like "this photo has no coordinates" to the EXIF reader, so a
  GPS-tagged photo could quietly land in the no-GPS tray — and stay there for
  good, since re-importing the file was then rejected as a duplicate.
- **Map Corridors:** a photo can no longer appear **both** on the map and in the
  **Bez GPS** list. A session carrying that state showed a permanent ghost tray
  row duplicating a photo that was already placed, and the photo-count badge
  double-counted it; the tray entry is now dropped when the session loads.

### Added
- **Map Corridors:** **Ctrl + arrow keys** now rotate and tilt the map, matching
  what organizers expect from Google Earth's Ctrl+drag look-around. `Shift +
  arrows` continues to work and remains the documented binding (macOS reserves
  Ctrl+←/→ for switching desktops). Every other Ctrl combination stays with the
  browser — Ctrl+R still reloads, Ctrl+←/→ still moves the caret while renaming
  a photo.

## [2.29.0] - 2026-07-20

### Fixed
- **Map Corridors:** fixed **Print map** failing with *"Image data too large"*
  on machines with Windows display scaling above 100 %. The A4 print capture
  rendered at the display's pixel ratio (up to 4× the pixels at 200 % scaling)
  and the resulting PNG blew past the desktop app's transfer limit. The
  exported image is now always exactly A4 at 300 DPI regardless of display
  scaling, and it travels to the save dialog as raw bytes instead of an
  inflated base64 string. ([#110])

### Added
- **Map Corridors:** the map now answers **Google Earth keyboard controls**
  regardless of where you last clicked — arrow keys pan, **Shift+←/→** rotates,
  **Shift+↑/↓** tilts, **Page Up/Page Down** and **+/−** zoom, **N** faces
  north, **U** looks straight down, **R** resets the view. Hold a key to keep
  moving. Keys never interfere with typing or open dialogs/dropdowns. ([#111])

[#110]: https://github.com/lbehounek/AirQ-Competition-Helpers/pull/110
[#111]: https://github.com/lbehounek/AirQ-Competition-Helpers/pull/111

## [2.28.0] - 2026-06-30

### Added
- **Guided onboarding tour.** The launcher, Map Corridors and the Photo Editor
  now walk new organizers through the whole workflow — starting with the basics
  (load route & photos → sort track/turning → split the sets → send → lay out &
  export the PDF) and then the detailed features: placing No-GPS photos on the
  map, answer-sheet labels, comparing variants, map tools, page layout, and the
  photo-editing modal (brightness/contrast/sharpness/white balance/zoom/crop).
  It appears once automatically and can be replayed anytime from the **?**
  button. Discipline-aware (rally vs precision) and available in English and Czech.

## [2.27.1] - 2026-06-30

### Fixed
- **Photo Helper:** fixed the editor opening to a **blank white screen** (most
  often right after *Send to editor*, including when a set split was set). An
  initialization-order bug crashed the editor before it could render; it now
  loads normally. Added an automated guard so this class of crash can't ship
  unnoticed again.

## [2.27.0] - 2026-06-30

### Added
- **Map Corridors → Photo Helper:** you can now choose *where the answer-sheet
  pages split*, by the **route's turning point**. In Map Corridors' right-side
  photo list, use the **"Set 2 starts at"** selector and pick a turning point
  (TP1, TP2, … — read straight from the loaded route, so it works even when none
  of your photos are turning-point photos). Every photo whose position **along
  the route** is at or after that TP goes to **set 2**; the rest stay in **set 1**
  (rally only; precision is single-set). The chosen TP is marked with a scissors
  badge on the map, and a **"Set 2"** divider appears in the pick groups so you
  can see the cut without opening the editor. Change the selection later and the
  editor re-flows the already-placed photos to match, keeping each photo's crop
  and label; anything that doesn't fit a full sheet lands in the candidate tray.
  Choose **"No split"** for one set (the prior set 1 → set 2 → tray fill).
- **Photo Helper:** if re-sorting photos into the new set split can't be saved
  (e.g. storage full), the editor now shows a recoverable warning instead of
  silently leaving photos on the wrong sheet — and the rest of the sync still
  completes. It retries automatically on the next sync.

## [2.26.8] - 2026-06-19

### Changed
- **Map Corridors:** the side-panel photo list now splits selected photos into
  two groups — **"Turning points – selected"** and **"Track photos – selected"** —
  instead of one combined "Picks" group, so it's clear at a glance which picks are
  turning-point photos and which are track photos. Dragging a row between the two
  pick groups re-flags the photo (turning ↔ track). The Neutral / Rejected /
  No-GPS groups and the "Send to editor" handoff are unchanged.

## [2.26.7] - 2026-06-19

### Fixed
- **Map Corridors:** a photo placed from the no-GPS tray is now covered by
  re-import dedup too — its content hash carries onto the map marker, so
  re-importing the same file no longer creates a duplicate.

## [2.26.6] - 2026-06-19

### Added
- **Photo Helper:** turning-point sheets can now hold a **"no photo" placeholder**
  for a genuinely missing photo. Click **"Insert 'no photo'"** on an empty slot to
  reserve that position — the surrounding SP/TP/FP numbering stays correct, the
  cell shows a blank frame with "No photo", and it prints the same blank labeled
  cell in the PDF (no more padding the gap with a white image). Drag to reorder or
  delete it like any photo.

## [2.26.5] - 2026-06-19

### Changed
- **Photo Helper:** the burned-in photo labels are now sized per discipline —
  track-photo numbers are 20% smaller and turning-point labels 35% smaller than
  before — in both the editor preview and the printed PDF.
- **Photo Helper:** when a PDF export can't render some photos it now shows a
  clear, actionable message (how many photos and how to recover them) instead of
  a raw technical alert. Render failures usually mean a photo's image bytes were
  lost — re-import those photos or remove the affected cells, then export again.

## [2.26.4] - 2026-06-19

### Fixed
- **Map Corridors:** a photo imported **without GPS** can now be re-categorised
  after you place it on the map. Clicking its marker opens the full
  Track / Turning-point / Skip / Reject + label popup — previously that popup
  only appeared for photos that had EXIF GPS, so a placed no-GPS photo was stuck
  on whatever category it was dropped with.
- **Map Corridors:** the *Poslat do editoru* panel now warns when no-GPS photos
  are still sitting in the tray (they only transfer once dropped on the map), and
  a failed tray placement shows an error instead of silently dropping the photo —
  addressing "one fewer photo reached the editor than I selected".
- **Map Corridors:** *Poslat do editoru* now writes the current selection at the
  moment you click it, fixing a case where a photo placed just before pressing it
  (typically a no-GPS photo dragged onto the map — often the last one, the finish
  point) was counted in the button but didn't actually transfer to the editor.
- **Photo Helper:** deleting a photo from a print set no longer deletes the
  shared image file it came from, so re-sending those photos from Map Corridors
  brings them ALL back. Previously, deleting placed photos and then re-sending
  returned fewer than were picked (e.g. 9 picked → 7 returned), because the
  set-delete stranded the map's image bytes (the same guard already protected the
  candidate-tray delete; the set-delete path was missed).
- **Map Corridors:** a placed photo no longer drifts from its spot while you
  zoom. Co-located ("fanned") photos kept a stale screen offset during a
  continuous zoom; the offset now updates every frame so the dot stays anchored
  to the map.
- **Map Corridors:** the no-GPS photo tray auto-scrolls while you drag a
  thumbnail — nudge the cursor to the strip's left/right edge and it rolls that
  way, so thumbnails outside the visible window are reachable mid-drag.
- **Photo Helper:** the TP / track-photo number labels are smaller; they had
  grown oversized on both the on-screen previews and the printed sheets.

### Added
- **Map Corridors:** importing the same photo twice is now a no-op — a file whose
  contents match a photo already in the competition (or another file in the same
  drop) is skipped instead of creating a duplicate, and the original (with its
  placement, flag, and edits) is left untouched. A short note reports how many
  duplicates were skipped.
- **Photo Helper:** the editor's **Add photos** import also skips duplicates now —
  re-adding a file already in the competition (the candidate tray or any print
  set) is a no-op instead of creating a second copy, with a short note on what was
  skipped.
- **Photo Helper:** candidate-tray thumbnails now show the photo filename next to
  the move/delete buttons, for easier orientation.
- **Photo Helper:** the toolbar **Add photos** control is more prominent so the
  manual-import entry point is easy to find.

## [2.26.1] - 2026-05-31

### Fixed
- **Photo Helper:** you can now drag a photo from the candidate tray onto an
  **empty** set. Previously the drop only worked once the set already had at
  least one photo — dropping onto an empty set did nothing. The empty-set drop
  zone now accepts tray drops (landing in the first slot) and shows the same
  highlight, while native file drops keep working as before. (#102)

## [2.26.0] - 2026-05-31

### Changed
- **Photo Helper:** photos sent from Map Corridors now land directly in the
  matching set instead of all piling into the candidate tray. A **track** pick
  fills the track sets and a **turning** pick fills the turning sets (set 1
  first, then set 2; once both are full the rest stay in the tray for manual
  placement). The editor never switches discipline on you — picks for the view
  you're not currently looking at fill silently and appear when you switch to
  that discipline. Once a photo is in a set it belongs to the editor: later
  re-categorising or un-picking it on the map no longer moves it.

## [2.25.3] - 2026-05-31

### Fixed
- **Map Corridors:** photos in the side-by-side compare view now appear in
  shooting order (by original filename, then EXIF capture time) instead of the
  order you happened to click or select them. Affects both compare routes — the
  right-panel selection and the map's **⇄ N** cluster pill / Compare bar — and
  the 1/2/3 keyboard shortcuts stay aligned with the tile numbering. (#99)

## [2.25.2] - 2026-05-31

### Fixed
- **Map Corridors:** a precisely-placed photo marker no longer drifts off its
  true point when you zoom out past a transient overlap and back. The marker now
  snaps back to its anchor once it un-fans, instead of staying stuck at its last
  fan offset. (#98)

## [2.25.0] - 2026-05-31

### Added
- **Map Corridors:** you can now drag a "Bez GPS" photo row from the right-side
  panel straight onto the map to place it — it lands at the drop point as a
  track pick (blue), the same as dragging from the bottom no-GPS tray. Clicking
  the row (provisional pin at map centre) and double-clicking it (full-res
  preview) still work as before. (#95)

## [2.24.0] - 2026-05-31

### Added
- **Map Corridors:** compare co-located photos straight from the map. Each
  fanned cluster shows a small **⇄ N** pill at its centre — click it to open the
  photos side-by-side and pick the best one (2–3 open immediately; larger groups
  drop into a selection to trim down). You can also **Ctrl/Cmd/Shift-click** any
  dots to multi-select them (highlighted with a ring); a floating **Compare**
  bar then opens the side-by-side view. Both routes feed the existing compare
  modal (winner stays, the rest move to Odmítnuté). (#94)

## [2.23.1] - 2026-05-31

### Fixed
- **Map Corridors:** rejected photos no longer reappear in PNG and KML exports.
  The live map already hid them, but both export paths rendered the unfiltered
  marker list, so a rejected co-located variant reprinted as a duplicate dot at
  its original EXIF location. Exports now ship exactly what is visible on the
  map. (#93)

## [2.23.0] - 2026-05-31

### Fixed
- **Map Corridors:** fixed a white-screen crash when rotating the map and then
  tilting it (an `Invalid LngLat (NaN, NaN)` error thrown by the auto-fan
  projection). The fan now guards against off-screen / NaN projections. (#92)

## [2.22.0] - 2026-05-31

### Added
- **Map Corridors:** when zoomed in, dragging a marker (photo, KML/click,
  ground, or no-GPS provisional pin) toward the edge of the map now auto-pans
  the map in that direction, with the dot staying under the cursor — so you can
  move a marker anywhere, even off the current screen, in one continuous motion
  (no more zoom-out / place / zoom-in / nudge dance). (#91)

## [2.21.0] - 2026-05-30

### Added
- **Map Corridors:** a Google-Earth-style **compass** button appears at the
  top-left of the map whenever it is rotated; its needle shows the live bearing
  and clicking it eases the map back to north-up. Pressing **N** does the same
  (suppressed while typing in an input). (#90)

## [2.20.0] - 2026-05-30

### Added
- **Map Corridors:** picked photos can now be categorised as **track** or
  **turning-point** photos. The marker popup's single *Vybrané* button is
  replaced by two pick buttons — *Fotka trati* / *Fotka otočného bodu*
  (English *Track photo* / *Turning-point photo*). The chosen category shows in
  the marker's ring colour — blue for track, purple for turning-point — and is
  highlighted in the popup. The category travels with the photo across the
  handoff into Photo Helper, so the editor knows which print set each photo
  belongs to. Picking does not auto-place the photo; the existing "Send to set"
  / "Send to TP photos" controls still do that. Sessions saved before this
  release load their existing picks as track photos (no picks are lost). (#87)

## [2.19.0] - 2026-05-30

### Added
- **Map Corridors:** double-click a photo to open a full-resolution preview
  (single-photo lightbox). Works on the thumbnail inside a map dot's popup and
  on a photo row in the right-side panel — press Esc or click outside to close.
- **Map Corridors:** photos taken at the same or a nearby point no longer stack
  into one unclickable blob. Overlapping dots now automatically fan out into a
  small circle around their shared location, with thin leader lines tying each
  one back to the spot, so every photo stays individually clickable. The fan
  recomputes as you zoom and pan, and collapses once the dots are far enough
  apart on their own.
- **Map Corridors:** neutral / unselected photo dots are now high-contrast
  **amber** instead of near-invisible grey, and all markers are bigger (18px)
  with a larger transparent click/tap halo so they are easier to grab.
- **Photo Editor:** the photo modal gains prev/next arrows and
  ArrowLeft/ArrowRight keyboard navigation within the current set/pool, plus a
  new "Send to TP photos" candidate-tray button that switches to turning-point
  mode and places the photo.
- **Desktop launcher:** you can now rename an existing competition inline.

### Changed
- **Map Corridors / Photo Editor:** the app-switch button moved to the top-left
  and is now a labelled button ("Editor fotek" / "Umístění fotek") instead of a
  bare icon.
- **Photo Editor:** the editor expands full-width on wide screens (removed the
  previous 75% cap); the candidate-tray star/deny flagging UI is hidden (that
  workflow lives in Map Corridors).
- **Desktop launcher:** the app now opens maximised (filling the screen) on
  every launch instead of a fixed-size window. (#85)

## [2.18.0] - 2026-05-24

### Added
- **Map Corridors:** no-GPS photos can now be placed by clicking. A no-GPS row
  (no longer greyed out) drops a draggable pin at the centre of the current map
  view; the photo stays under "Bez GPS" until you pick a category in the popup
  (Vybrané/Neutrální/Odmítnuté), which places it at the dragged spot. Closing
  the popup cancels.
- **Map Corridors:** drag a photo row from one group onto another to
  recategorise it — drag a row onto Vybrané, Neutrální or Odmítnuté to change
  its flag. (Dropping onto its own group or onto "Bez GPS" does nothing.)

## [2.17.2] - 2026-05-24

### Fixed
- **Map Corridors:** rejecting a photo and then trying to re-allow it no longer
  fails — clicking a rejected photo's row now re-opens its popup (it had closed
  instantly), so you can set it back to Vybrané/Neutrální. Regression from 2.17.0.

## [2.17.1] - 2026-05-24

### Changed
- **Map Corridors:** the marker popup's action buttons now use the same names as
  the photo-list groups — *Vybrané / Neutrální / Odmítnuté* (was *Vybrat /
  Přeskočit / Odmítnout*; English *Picked / Neutral / Rejected*). Behaviour is
  unchanged; rejecting a photo still moves it to the "Odmítnuté" group and
  removes its pin from the map.

## [2.17.0] - 2026-05-24

### Added
- **Map Corridors:** the currently active photo is now highlighted on both the
  map and the right-side list, kept in sync. Clicking a photo's marker (or its
  list row) gives the marker a glow + slight zoom and tints its row; the list
  scrolls to that row and expands its group if collapsed. Closing the popup
  clears the highlight. Rejecting or deleting the active photo clears it too.

## [2.16.0] - 2026-05-24

### Added
- **Map Corridors:** side-by-side variant compare. When organisers shoot the
  same turn point 2–3× for insurance, Ctrl/Cmd+click (Shift+click for a range)
  the rows in the photo list to select the variants, then "Srovnat varianty (N)"
  opens a modal showing them full-res next to each other. Picking a winner
  (click or keys `1`/`2`/`3`) promotes it to a pick and rejects the others in a
  single atomic write. Rejected losers stay in the "Odmítnuté" list group as the
  undo path — files are never deleted.

### Changed
- **Map Corridors:** rejected photos are now hidden from the map entirely
  (pin, ghost capture dot and dashed line all disappear) instead of rendering as
  a faded red `×`. The row remains under "Odmítnuté" so the reject is reversible.

## [2.15.1] - 2026-05-24

### Fixed
- **Map Corridors:** hardened the photo `displayName` invariants introduced in
  2.15.0 (neither shipped in a Windows build yet, so no user impact). The
  KML `<name>` composition is now a single unit-tested helper
  (`buildPhotoMarkerKmlName`), and loading a session strips an empty or
  redundant custom name so the photo list and the KML export can't disagree
  about what a corrupt label means. The no-GPS list and tray also share one
  sort comparator, so identical filenames tie-break the same way everywhere.

## [2.15.0] - 2026-05-24

### Changed
- **Map Corridors:** renaming an imported photo now keeps the original camera
  filename instead of overwriting it. The custom name (e.g. `TP1`) shows as the
  primary label in the photo list, marker popup, KML export and the Photo
  Helper tile, while the original filename (`DSC_0123.JPG`) is preserved
  underneath. KML `<name>` becomes `TP1 (DSC_0123.JPG)`. Reported by Martin
  Hrivna 2026-05-17.
- **Map Corridors:** the right-side photo list and the no-GPS tray are now
  ordered by the original camera filename (numeric-aware, so `IMG_9` precedes
  `IMG_10`). Because ordering keys on the immutable filename, renaming a photo
  no longer moves it — previously the no-GPS tray re-sorted on the new name.
  Capture time becomes the tie-break for identical filenames.

## [2.13.6] - 2026-05-17

### Changed
- **Map Corridors:** clicking the X badge on a photo (either in the
  right-side list or in the no-GPS tray) now opens a confirmation
  dialog before removing. The pencil rename icon sits right next to
  the X and a misclick used to be irreversible; user feedback
  2026-05-17 asked for the safety net. Cancel restores the prior
  state; the dialog header is "Smazat fotografii?" and shows the
  current display name (incl. any rename made before clicking X).

## [2.13.5] - 2026-05-17

### Fixed
- **Photo Helper:** filename renames performed in Map Corridors AFTER
  the first "Poslat do editoru" now propagate to the candidate tile
  in the editor instead of being silently dropped. `syncMapPicksOnce`'s
  update branch previously diffed only `flag` and `label`; a renamed
  photo already in the editor pool kept its old filename forever.
  Adds `setCandidateFilename` to the session contract and a filename
  diff in the update branch (one-way: map authoritative for `pm-`
  filenames). User feedback 2026-05-17.

## [2.13.4] - 2026-05-17

### Added
- **Map Corridors:** rename imported photos directly in the right-side
  photo list. Click the new pencil icon on any row, type a workflow-
  friendly name (e.g. `TP1`), press Enter to save or Esc to cancel.
  The new name replaces the camera-assigned filename throughout: KML
  export, the marker tooltip, and Photo Helper's candidate tile (via
  the existing `entry.filename` field in `map-picks.json` — no schema
  change). Reported by Martin Hrivna 2026-05-16.

## [2.13.3] - 2026-05-17

### Fixed
- **Map Corridors → Photo Helper handoff (round 2):** "Poslat do editoru
  (N)" now actually transfers only the N picks shown in the button
  count, not the entire marker set. Reported by Martin Hrivna after
  2.13.2 testing: with 4 photos and 2 flagged, all 4 were arriving in
  the editor. Fix filters `buildMapPicks` to `flag === 'pick'`; the
  cleanup pass in `useMapPicksSync` then drops a photo from the editor
  whenever it's un-picked on the corridor side.
- **Photo Helper:** deleting a `pm-`-prefixed candidate (i.e., one
  pushed in from Map Corridors) no longer destroys the underlying OPFS
  file. The bytes live under the shared `competitions/{compId}/photos/`
  directory and Map Corridors needs them to re-serve the photo on the
  next handoff. Symptom pre-fix: delete in editor + re-Send → silent
  skip → "nepropíše se žádná". Map Corridors' photo-list X button
  remains the canonical place for permanent pm- deletion.

## [2.13.2] - 2026-05-16

### Fixed
- **Photo Helper:** map → editor handoff now lands all selected photos
  instead of just the last one. Reported by Martin Hrivna: selecting 3
  photos in Map Corridors and clicking "Poslat do editoru (3)" delivered
  only the last one, with the remainder appearing one-per-minimize cycle
  thereafter. Root cause was a stale-closure read of `currentCompetition`
  inside `updateCurrentCompetition`; sequential `addExistingCandidate`
  calls during `syncMapPicksOnce` each rebuilt their update on the same
  pre-update snapshot, so `setCurrentCompetition`'s last-write-wins
  dropped the earlier inserts. Fixed by routing the read through a
  synchronously-updated ref so chained async calls see prior updates.

## [2.8.3] - 2026-05-06

### Fixed
- **Desktop launcher:** include `lib/**/*` in the electron-builder `files`
  allowlist so `lib/pathValidation.js` (extracted from `main.js` in the
  silently-tagged `desktop-v2.8.1` / `desktop-v2.8.2`) ships inside the
  asar. Without it, the .exe crashes on launch with
  `Error: Cannot find module './lib/pathValidation'`. The 2.8.1 / 2.8.2
  desktop tags were never released to GitHub, so end users were
  unaffected — 2.8.3 is the first release that would have actually
  shipped the latent bug.

## [2.8.0] - 2026-04-25

This release consolidates the silently-tagged `desktop-v2.7.0`–`v2.7.5`
range (no per-tag CHANGELOG entries were written). Major themes:
**security hardening of the Electron main process**, **persistent
per-competition working folders**, and **round-1/round-2 user
feedback**.

### Security
- **Photo-import IPC hardening (defence-in-depth):** every renderer-supplied
  path is now mediated through a per-window `photoOpenAllowlist` populated
  by `open-photos` and gated in `read-photo-file`. Closes a renderer-XSS-
  to-arbitrary-file-read primitive (≤30 MB) that the prior comment
  *claimed* was protected but wasn't.
  - `lstatSync` + `isSymbolicLink()` rejection prevents symlink redirection
    from a legitimately-picked file under `~/Pictures` to e.g.
    `~/.ssh/id_rsa`.
  - Explicit `.jpg`/`.jpeg`/`.png` extension allowlist closes the
    Windows `*.*` filter bypass (renderer could otherwise label arbitrary
    bytes as `image/jpeg`).
  - Hard server-side cap of 200 photos per `open-photos` call stops a
    `Number.MAX_SAFE_INTEGER` `maxFiles` from base64-OOM'ing the renderer.
  - Single `validateUserDir(input)` helper now applied uniformly to
    `competition-set-working-dir`, `competition-get-working-dir`,
    `open-photos`, `save-map-image`, `save-pdf`, **and** `save-kml`
    (4096-char length cap, UNC/device-namespace rejection, on-disk
    existence). Previously only `save-kml` had the UNC guard, leaving the
    other handlers exposed to NTLMv2 hash-leak primitives via poisoned
    `defaultPath`.
  - Allowlist Set keys normalized via NFC + lowercase-on-Windows so
    case- and Unicode-form variations of the same FS-equivalent path
    collide on lookup (eliminates self-DoS false-negatives).
  - `safeHandle` IPC sender gate tightened: `data:text/html` callers must
    now be in a `trustedDataWebContentsIds` Set populated by the legitimate
    Mapbox/Mapy token dialogs and cleared on `closed`. URL-prefix matching
    alone is no longer sufficient.
  - `setWindowOpenHandler` flipped to default-deny (only http(s) routes
    to `shell.openExternal`). (PR #50, plus follow-up review fixes)
- **Dependencies:** Bumped `@xmldom/xmldom` 0.8.12 → 0.8.13 (closes
  [GHSA-j759-j44w-7fr8](https://github.com/advisories/GHSA-j759-j44w-7fr8),
  [GHSA-x6wf-f3px-wcqx](https://github.com/advisories/GHSA-x6wf-f3px-wcqx),
  [GHSA-f6ww-3ggp-fr8h](https://github.com/advisories/GHSA-f6ww-3ggp-fr8h),
  [GHSA-2v35-w6hq-6mfw](https://github.com/advisories/GHSA-2v35-w6hq-6mfw))
  and `postcss` 8.5.8 → 8.5.10 (closes
  [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)).
  Both are dev-only / build-time, but the previous workspace-root
  override `@xmldom/xmldom: "^0.8.12"` was actively pinning the
  resolution inside the vulnerable range — bumped to exact `"0.8.13"`
  per the post-axios 2026-03-31 exact-pin rule. (PR #51)

### Added
- **Photo Helper:** Persistent per-competition working folder across all
  open/save dialogs. The folder the user picks in *any* dialog (KML
  import, PNG save, PDF save, photo open) is promoted to the
  competition's working dir, and every subsequent dialog defaults
  there — so a user can steer the persistent default by simply
  navigating in any dialog. (PR #48)
- **Photo Helper:** Per-file failure surfacing on photo import. The
  `openPhotosViaElectron` flow now returns
  `{ files, failures, cancelled, workingDirPersistFailed }`; the new
  `useElectronPhotoImport` React hook (shared by `DropZone`,
  `GridSizedDropZone`, `PhotoGridSlotEmpty`) renders distinct user-
  visible Alerts for dialog failure, partial-read failure (e.g.
  4-of-9 photos couldn't be read), and working-folder persistence
  regression. Previously all three failure modes were silently swallowed
  into `console.error`. (PR #50)
- **Photo Helper / Map Corridors:** Round-1 and round-2 user feedback
  changes — KML signs pin, PDF header improvements, export tweaks,
  i18n strings, plus dropzone disable when an import is in flight
  (cross-component shared via `useSyncExternalStore` to prevent
  concurrent slot-empty instances racing the photo-open allowlist).
  (PR #46, PR #47)

### Fixed
- **Photo Helper:** Photo-set overflow error messages were
  English-only — translated. Czech with proper diacritics. (PR #49)
- **Photo Helper:** Parallelized per-file `readPhotoFile` calls
  (`Promise.all`) so a 9-photo import overlaps the renderer-side
  base64 decode with main-side reads — shaves several seconds off
  large imports. (PR #50)
- **Internal:** Three inline copies of dirname extraction (in
  `App.tsx`, `pdfGenerator.ts`, `electronPhotoImport.ts`) disagreed
  on edge cases — drive-letter root (`C:\file.txt`), POSIX root
  (`/file.kml`), UNC, mixed/trailing separators. Consolidated into
  a single `dirnameOf` in `@airq/shared-storage` with 15 unit tests
  pinning every previously-divergent edge case. (PR #50)

### Changed
- **Repo hygiene:** `.gitignore` extended to cover Claude Code
  scheduled-tasks lock files (`.claude/*.lock`), local PR diff
  dumps (`/pr*.diff`), and the root-level `/public/` static deploy
  bundle. None of these had ever been intended for the repo; they
  were just cluttering `git status` after every review session.
  (PR #52)

## [2.6.2] - 2026-04-18

### Security
- **Dependencies:** Patched `protocol-buffers-schema` prototype pollution
  ([GHSA-j452-xhg8-qg39](https://github.com/advisories/GHSA-j452-xhg8-qg39),
  CVE-2026-5758, CVSS 6.5). Pulled in transitively via `pbf` →
  `mapbox-gl` / `maplibre-gl` / `@mapbox/vector-tile`, all consumed by
  Map Corridors. Applied as a pnpm workspace override pinning
  `protocol-buffers-schema@<3.6.1` to exact `3.6.1` — matching the
  supply-chain rule of exact-version pinning after the axios 2026-03-31
  incident. (PR #45)

## [2.6.1] - 2026-04-18

### Changed
- **Internal:** Removed the legacy Python backend and associated
  backend-mode frontend code. Electron-only distribution is the sole
  supported path. Also deleted a stale migration doc. No user-visible
  behaviour change, but the bundle is leaner. (PR #44)

## [2.6.0] - 2026-04-18

### Note
Re-tag of the 2.5.0 content plus post-merge CHANGELOG commit. No
user-visible changes beyond 2.5.0.

## [2.5.0] - 2026-04-18

### Added
- **Map Corridors:** Multi-provider map style selector replacing the old
  Streets/Satellite toggle. Users can now pick between **Mapy.com**, **Mapbox
  Streets**, and **OpenStreetMap (CARTO Voyager)** for street maps, and
  **Mapbox Satellite**, **Mapy.com Aerial**, and **ESRI Satellite** for
  aerial imagery. Each category shows a dropdown when more than one provider
  is configured. Mapy.com is the default street layer because its
  village-level Czech labels are denser than Mapbox defaults. (PR #42)
- **Map Corridors:** Prominent city labels on printed A4 — settlement /
  place / town / city symbol layers on vector styles get `text-size` boosted
  1.8× with a 2 px white halo so small towns remain legible at print scale.
  Raster styles (Mapy.cz, OSM, ESRI) bake labels into their tiles and read
  well as-is. (PR #42, feedback 2026-04-18)
- **Desktop launcher:** New **Settings → Mapy.cz API klíč…** menu entry that
  mirrors the existing Mapbox Token dialog. Enables Czech-focused street /
  aerial maps. Token persists in the Electron user config. (PR #42)
- **Monorepo env:** Root `.env` at the repo root is now read by both
  map-corridors and photo-helper sub-apps (`envDir: <repo-root>`), so
  `VITE_MAPBOX_TOKEN` / `VITE_MAPYCZ_TOKEN` can be configured once.

### Fixed
- **Map Corridors:** Mapbox GL race fix — `setStyle('mapbox://…')` could
  throw "An API access token is required" when both the style URL and the
  token arrived in the same React commit, because react-map-gl's mirror of
  `mapboxgl.accessToken` lags one microtask behind its `mapStyle` prop.
  `setProviderToken('mapbox', …)` now writes the Mapbox GL module singleton
  synchronously, closing the race.
- **Map Corridors:** `import.meta.env.VITE_*` reads were cast through
  `(import.meta as any)?.env?.VITE_…` which defeated Vite's static-replace
  regex, leaving literal `"VITE_MAPY_TOKEN"` string lookups in the bundle.
  Symptom: Mapy.com never appeared in the selector regardless of `.env`
  content. Reads are now in the direct dot-form Vite recognises.
- **Desktop launcher:** Stale-bundle episodes after a rebuild traced back to
  V8's code cache (separate from Electron's HTTP cache). `clearCache()` only
  flushes (1). Fixed with `webPreferences.v8CacheOptions: 'none'` in dev
  plus a per-`loadURL` `session.clearCache()` call on navigation — documented
  in `.claude/skills/windows-app/SKILL.md` under a new "Known Issue"
  section. Production builds are unaffected.
- **Map Corridors:** Session migration from legacy
  `baseStyle: 'streets' | 'satellite'` to the new `mapStyleId` field no
  longer silently discards corrupted values. Malformed records now log a
  warning and fall back to a default instead of pretending to succeed.
  The migration logic was extracted to a pure helper with unit tests so
  this code path — which touches every upgrading user's persisted state —
  is pinned against regressions.

### Security
- **Desktop launcher:** Both token-input dialogs (Mapbox + Mapy.cz) hardened:
  - HTML-attribute escaping now covers `& < > " '` instead of only `"`.
  - Each dialog's inline HTML now carries a strict `Content-Security-Policy`
    meta tag with a crypto-random per-dialog nonce, so inline scripts can
    only run from the template we shipped.
  - Inline `onclick=` handlers replaced with `addEventListener` bindings that
    the CSP explicitly permits, removing the most common XSS foothold.
- **Map Corridors:** Mapy.cz API key is now `encodeURIComponent`-wrapped in
  tile URLs so a key containing `&`, `#`, or whitespace cannot inject extra
  query parameters or corrupt the URL. Defense-in-depth against tampered
  config values.
- **Map Corridors:** Production bundles no longer log token prefixes — the
  four-char debug preview is now guarded by `import.meta.env.DEV`.

### Changed
- **Map Corridors:** `CorridorsSession.baseStyle` field renamed to
  `mapStyleId` (string). One-way migration reads either field from legacy
  sessions on load; `baseStyle` is no longer written to new sessions.
  Readers of the session type should use `mapStyleId` via `getStyleForId()`
  from `config/mapProviders`.
- **Map Corridors:** Error handling audit from the PR code review — fire-
  and-forget OPFS writes, swallowed IPC errors, and bare `.catch(() => …)`
  token-fallback branches now log on failure so broken persistence no
  longer looks like a silent success in the console.

### Tests
- **Map Corridors:** Test count 99 → 132 (+33 cases, 3 new files):
  - `mapProviders.test.ts` extended — token-clearing paths, subscribe/notify
    leak check, monotonic snapshot, `isMapStyleId` / `normalizeStyleId`,
    Mapbox-URL-never-embeds-token invariant, URL-encoded Mapy API key,
    `MAP_STYLE_IDS` drift guard.
  - `sessionMigration.test.ts` — migration precedence (new schema > legacy
    baseStyle > default), malformed records, empty-string and non-string
    mapStyleId handling.
  - `boostSettlementLabels.test.ts` — layer matching, expression wrapping,
    undefined-text-size skip, partial-mutation fix (halo applied even when
    text-size write throws).
- `pnpm audit` still reports **zero vulnerabilities** across the workspace
  (trivy `pnpm-lock.yaml` scan confirms 0 in shipped deps). Semgrep baseline
  scan against `main`: 0 findings on changed files.

## [2.4.1] - 2026-04-16

### Security
- Resolved all 64 Dependabot vulnerabilities (3 critical, 32 high, 25 moderate,
  4 low) flagged on `main`:
  - **Removed** unused direct deps `jspdf` and `fabric` from `photo-helper` —
    neither was imported anywhere in the codebase. Kills both criticals and
    most jspdf/fabric highs at the source.
  - **Bumped direct deps to exact patched versions:** `vite` 7.3.0 → 7.3.2
    (photo-helper + map-corridors; fixes CVE-2026-39363/39364/39365);
    `electron` ^39.2.7 → 39.8.8 (fixes 11 Electron CVEs).
  - **Added pnpm `overrides`** in the workspace root for remaining
    transitive-only chains (all dev/build-time, not shipped in the .exe):
    `@xmldom/xmldom` ≥ 0.8.12, `flatted` ≥ 3.4.2, `lodash` ≥ 4.18.1,
    `picomatch` ≥ 4.0.4, `tar` ≥ 7.5.11, `yaml@<1.10.3` → ≥ 1.10.3,
    `brace-expansion` per-major patched versions.
- `pnpm audit` now reports **zero vulnerabilities** across the workspace.

## [2.4.0] - 2026-04-16

### Fixed
- **Photo Helper:** `Apply to All` button in competition / desktop mode silently
  did nothing. The handler was a no-op stub added in `497870d` to satisfy the
  interface but never implemented; all photo adjustments now propagate across
  both sets as expected.

### Changed
- **Photo Helper:** Extracted duplicated canvas-patch logic from all three photo
  session hooks (`useCompetitionSystem`, `usePhotoSessionOPFS`,
  `usePhotoSessionApi`) into a shared, typed `canvasStatePatch` utility. Setting
  names are now a compile-checked `CanvasSetting` union (typos → compile errors),
  values are narrowed to `number`, non-finite values (NaN/Infinity) are rejected,
  and `DEFAULT_CANVAS_STATE` is frozen with independent nested objects to prevent
  shared-reference leaks.

### Added
- **Photo Helper:** Vitest test suite — 32 unit tests covering the canvas-patch
  utility and session-level transformer, including NaN handling, nested-reference
  independence, set-level patching and immutability.

## [2.3.0] - 2026-04-16

### Added
- **Map Corridors:** Ground markers (canvas markers) with FAI-standard shapes —
  users can place markers with correct competition dimensions alongside existing
  corridor features. (PR #38)

### Fixed
- **Map Corridors:** Correctness, validation and type issues flagged in the
  ground-markers review, including a pass to eliminate `any` from the touch-input
  surface.

## [2.2.0] - 2026-04-16

### Added
- **Map Corridors:** Map print with A4 300 DPI offscreen rendering — users can
  export print-ready A4 maps at the resolution required for paper navigation.
  (PR #37)

### Fixed
- **Map Corridors:** pixelRatio handling, path-traversal input validation, error
  handling and test coverage (PR #37 review).

## [2.1.0] - 2026-04-16

### Added
- **Map Corridors:** Precision vs. rally discipline selector per competition —
  corridor generation, KML naming and pin styling now adapt to the selected
  discipline. (PR #36)

### Fixed
- **Map Corridors:** TP1 naming (no space) in precision KMLs, with added test
  coverage for the naming pattern.
- **Map Corridors:** SC-gate geometry interference, KML pin colors, overlapping
  labels, and bright-yellow pin visibility.
- **Map Corridors:** Input validation for discipline selection; build script
  switched to pnpm.

## [2.0.2] - 2026-04-03

### Added
- Shared storage across competitions, in-app navigation buttons,
  delete-competition flow, and removal of the in-app language switcher (locale
  now persists at the Electron-config level across all apps). (PR #34)
- Unified competition management: the desktop launcher owns the active
  competition and passes it to sub-apps via URL params.
- Cleanup banner in the launcher; competition name displayed in Photo Placement.
- Apps renamed: **Photo Helper → Photo Editor**, **Photo Corridors → Photo
  Placement** (display names only; internal package names unchanged).

### Changed
- Homepage header flattened to `#1565C0` across all apps; Photo Placement header
  now matches Photo Editor style.
- Release-artifact naming convention: `photo-helper-vX.Y.Z.exe`.
- CI: replaced `anothrNick/github-tag-action` with an in-repo composite action.

### Fixed
- CSP relaxed to allow WebAssembly (required for PDF generation).
- Path validation, sessionId bug, cleanup edge case (PR #34 review).
- White text color on the Photo Placement title.

## [2.0.1] - 2026-03-05

### Changed
- Migrated the frontend monorepo to **pnpm workspaces** for shared dependency
  management across the three packages (photo-helper, map-corridors, desktop).
  (PR #31)

## [2.0.0] - 2025-12-30

First v2 release — Windows desktop bundle becomes the primary distribution
format.

### Added
- **Electron desktop wrapper** that bundles Photo Helper and Map Corridors into
  a single Windows portable `.exe`, with a landing page that routes to each
  sub-app.
- **Storage abstraction layer** providing OPFS for the web build and Electron
  native filesystem for the desktop build — same API, two backends. (PR #25)
- **Language persistence** (Czech/English) shared across all apps via Electron
  config; menu labels update on locale change.
- **Mapbox token configuration dialog** in the desktop launcher.
- Auto-generated app icons (multi-resolution `.ico` / `.png`).
- GitHub Actions workflow for Windows builds, with auto-tagging of `desktop-v*`
  releases on PR merge (`#major` / `#minor` / default `patch`).
- `app://` custom protocol registered as privileged to support OPFS in Electron.

### Fixed
- React hooks rule violation (`useImperativeHandle` before early return) in the
  map provider.
- FP naming and drag/drop in OPFS mode.
- Mapbox token dialog height (no longer scrolls on small screens).
- Blob-URL revocation leaks across mode switches; layout mode, mode-specific
  photo buckets and migration references in Photo Helper.

### Security
- Harden Vite dev server against path-traversal.
- Tighten photo-helper types (remove `any` on idle-timer surface, add global
  activity listeners).

[2.4.1]: https://github.com/lbehounek/AirQ-Competition-Helpers/releases/tag/desktop-v2.4.1
[2.4.0]: https://github.com/lbehounek/AirQ-Competition-Helpers/releases/tag/desktop-v2.4.0
[2.3.0]: https://github.com/lbehounek/AirQ-Competition-Helpers/releases/tag/desktop-v2.3.0
[2.2.0]: https://github.com/lbehounek/AirQ-Competition-Helpers/releases/tag/desktop-v2.2.0
[2.1.0]: https://github.com/lbehounek/AirQ-Competition-Helpers/releases/tag/desktop-v2.1.0
[2.0.2]: https://github.com/lbehounek/AirQ-Competition-Helpers/releases/tag/desktop-v2.0.2
[2.0.1]: https://github.com/lbehounek/AirQ-Competition-Helpers/releases/tag/desktop-v2.0.1
[2.0.0]: https://github.com/lbehounek/AirQ-Competition-Helpers/releases/tag/desktop-v2.0.0

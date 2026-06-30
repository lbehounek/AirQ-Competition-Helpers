# AirQ Competition Helpers — User Manual

A task-oriented guide for **competition organizers** preparing FAI Rally Flying
(and Precision) photo material. It covers the two tools end-to-end:

- **Map Corridors** — load the route, locate and cull your photos on the map,
  categorize them, and choose where the answer-sheet pages split.
- **Photo Helper** — lay the selected photos into print sets, fine-tune each
  image, and export the printable PDF.

The two tools share data automatically, so the natural flow is **Map Corridors →
Photo Helper**. Everything is stored on your computer (no account, no internet
required); see [Data & persistence](#data--persistence).

> For the design rationale and developer internals, see
> [`photo-map-culling/guide.md`](./photo-map-culling/guide.md) and the ADRs in
> [`photo-map-culling/decisions.md`](./photo-map-culling/decisions.md). For the
> story-level acceptance criteria, see
> [`photo-map-culling/user-stories.md`](./photo-map-culling/user-stories.md).

---

## 1. Install & launch

1. Download the latest `photo-helper-vX.Y.Z.exe` from the project's GitHub
   **Releases** page (Windows 10/11, 64-bit). It is a **portable** executable —
   no installation, just run it.
2. The app is unsigned by design, so on first run Windows SmartScreen shows
   *"Windows protected your PC."* Click **More info → Run anyway**.
3. The launcher opens with two tiles — **Photo Helper** and **Map Corridors** —
   plus a language switch (English / Čeština) and Mapbox token settings.

### One-time map setup (Mapbox token)

Map Corridors draws on map tiles. Open **Mapbox settings** from the launcher (or
the in-app settings) and paste your Mapbox access token once; it is stored
locally and reused. Without a token the map background may not render, though
the rest of the workflow still works.

---

## 2. Pick a competition & discipline

- Choose or create a **competition** — each one is an isolated workspace with its
  own photos, route, and settings. Switching competitions never mixes data.
- Choose the **discipline**: **Rally** (two answer sheets, set 1 / set 2) or
  **Precision** (a single sheet). The discipline changes which controls appear —
  e.g. the set-split selector is Rally-only.

---

## 3. Map Corridors — locate & cull on the map

### 3.1 Load the route

Drag a **KML/GPX** route file onto the map. Map Corridors builds the route
(SP → TP1 … TPn → FP) and its navigation corridors. The turning points it reads
from the route drive the set-split selector later.

### 3.2 Import photos

Drag a batch of **JPG/PNG** photos onto the same dropzone (routing is by file
type — no mode toggle):

- Photos **with GPS EXIF** drop as grey dots at their capture location; the map
  fits-bounds to show them all. A progress indicator appears for large batches.
- Photos **without GPS** collect in a **"No GPS" tray** at the edge of the map.
  Drag each onto its real location to place it (or click a tray row to drop a
  provisional pin you then move).

Re-importing the same file is skipped automatically (content-hash dedup), so you
can safely re-drop a folder without creating duplicates.

### 3.3 Decide on each photo

Click a photo's dot (or its row in the right-side list) to open its popup:

| Action | Meaning |
|---|---|
| **Track photo** (blue) | Keep it as an en-route photo → editor's track sets. |
| **Turning-point photo** (purple) | Keep it as a turning-point photo → editor's TP sets. |
| **Neutral** | Undecided — not sent to the editor. |
| **Rejected** | Discard — not sent to the editor. |
| **Label (A, B, …)** | Assign the answer-sheet label for scoring. |

- **Double-click** the thumbnail for a full-resolution preview.
- **Move the subject pin**: drag the dot to the actual subject if the capture
  point isn't where the feature is.
- **Compare variants**: Ctrl/Cmd-click (or Shift-click a range) several photos
  of the same turn, then **Compare** to pick the best one side-by-side.

### 3.4 The right-side photo list

Photos are grouped by decision: **Turning points – selected**, **Track photos –
selected**, **Neutral**, **Rejected**, **No GPS**. You can:

- **Drag a row between the two pick groups** to re-flag turning ↔ track.
- **Rename** a photo (pencil) to a workflow name like `TP1` — the custom name
  follows it into the editor without touching the original filename.
- **Delete** a photo from the competition (✕).

### 3.5 Choose where the sheets split (Rally)

Use the **"Set 2 starts at"** selector at the top of the list and pick a route
turning point (TP1, TP2, …):

- Every photo whose position **along the route** is at or after that TP goes to
  **set 2**; the rest stay in **set 1** — for both track and turning photos.
- The chosen TP gets a **scissors badge** on the map, and a **"Set 2"** divider
  appears in the pick groups so you can see the cut.
- Choose **"No split"** for a single set (the default fill).

The turning points come from the **route**, so this works even if none of your
photos are turning-point photos. Precision competitions are single-set and don't
show this control.

### 3.6 Send to the editor

Click **Send to editor (N)** — N is the number of picked photos. The selections
(and the split) cross to Photo Helper, which opens with the sets pre-filled. If
some no-GPS photos are still in the tray (not placed), the panel warns you,
because photos left in the tray don't transfer.

---

## 4. Photo Helper — lay out, edit, export

### 4.1 The sets

For Rally you get **Set 1** and **Set 2** (the two answer-sheet pages); Precision
has one. Photos sent from Map Corridors arrive already routed:

- Track vs turning-point by the category you chose.
- Set 1 vs Set 2 by the split you chose (or the default fill if none).
- Anything that doesn't fit a full sheet waits in the **candidate tray** below —
  drag it into any open slot.

If you **change the split** back in Map Corridors and return, the editor
re-flows the placed photos to match, **keeping each photo's crop and label**.

### 4.2 Edit a photo

Click a slot to edit: **brightness, contrast, sharpness, white balance**, plus
crop/zoom/pan. Labels (TP numbers / letters) are burned into the print at a
size tuned per discipline. Adjustments are non-destructive and persist.

### 4.3 "No photo" placeholders

For a turning point you have no photo of, click **Insert "no photo"** on an empty
slot. It reserves the position with a blank labelled cell so the surrounding
SP/TP/FP numbering stays correct. Placeholders print as a blank labelled cell and
never block export.

### 4.4 Add or remove photos manually

Use **Add photos** to import directly into the editor (duplicates are skipped).
Removing a photo that came from the map only removes it from the sheet — the
shared image stays available so re-sending from Map Corridors still works.

### 4.5 Export the PDF

Click **Export PDF**. The grids print at the chosen layout (portrait/landscape)
with Czech characters supported. If any photo's image data is missing, the export
shows a clear, actionable message (re-import or remove the affected cells) rather
than a raw error.

---

## 5. Data & persistence

- Everything is stored locally in the browser/Electron **OPFS** (Origin Private
  File System), per competition — photos, route, decisions, labels, and the
  split all survive restarts.
- The two tools hand off through a single `map-picks.json` file per competition
  (one-way, Map Corridors → Photo Helper). **Unpicking** a photo in Map Corridors
  removes it from the editor on the next sync.
- No backend, no account, no internet (beyond map tiles) is required.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| *"Windows protected your PC"* on launch | Click **More info → Run anyway** (the app is unsigned by design). |
| Map background is blank | Set your **Mapbox token** in settings. |
| A no-GPS photo didn't reach the editor | It's still in the **No GPS tray** — drag it onto the map to place it, then re-send. |
| "Set 2 starts at" selector is missing | You're in **Precision** (single-set), or the **route has no turning points** loaded. |
| Fewer photos arrived than expected | Check the panel's no-GPS warning; only **picked** photos transfer. |
| PDF export reports missing images | Re-import the affected photos in the editor, or remove those cells, then export again. |

---

## 7. Glossary

- **SP / TP / FP** — Start Point / Turning Point / Finish Point of the route.
- **Track photo** — an en-route photo (between turning points).
- **Turning-point photo** — a photo of a turning point.
- **Set 1 / Set 2** — the two answer-sheet pages (Rally).
- **The break / set-split** — the route turning point where set 1 ends and set 2
  begins.
- **Candidate tray** — the holding area in the editor for photos not yet placed
  in a slot.
- **Placeholder** — a reserved "no photo" slot for a missing turning point.

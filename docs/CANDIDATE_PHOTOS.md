# Candidate Photos — design doc

Status: implementation in PR `feat/candidate-photos`. Doc is the single source
of truth for the contract; if implementation diverges, update the doc.

---

## Why

Today the photo-helper conflates two things:

- **Workspace** — the photos the user is considering.
- **Print layout** — the photos that will appear on the PDF.

Both live in the same 9-or-10-slot grid. Drop more than capacity and the user
gets an error. So they pre-cull mentally before dragging in, and any post-drop
"actually, let's try this other shot" requires deleting one slot photo before
adding the candidate. The actual competition workflow is the opposite:
shoot/collect 20–40 candidate photos, then cull to 9 (or 9+9) once you can see
edits applied.

The fix is a **candidate pool**: a slotless holding area, visually distinct
from the final grid, that participates in the same edit model but is not
printed.

## Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Drop heuristic | Smart: `>= capacity → candidates`, `< capacity → slots` | No new prompt; today's small-drop UX preserved |
| Reject state | 3-state: `pick` / `neutral` / `reject` | User asked for it. Rejects stay visible but greyed; filter to hide |
| Compare view | Out of scope for v1 | User said deferrable |
| Post-export cleanup | Offer to delete unused candidates after successful PDF | Storage hygiene |
| Pool scope | Global per session (not per mode) | Simpler; mode-switching while culling is rare. v2 can split if needed |
| PR strategy | Single feature PR, draft | User asked |

## Out of scope for v1

- Side-by-side compare modal with synced zoom
- "Apply edit to all candidates" (apply-to-all stays slot-only)
- Auto-pick suggestions (sharpness/exposure scoring)
- Keyboard shortcuts (P/X/U)
- Cross-app candidate sharing with map-corridors

---

## Data model

### Type changes (`src/types/api.ts`)

```ts
export type CandidateFlag = 'pick' | 'neutral' | 'reject';

export interface ApiPhoto {
  // ...existing fields unchanged
  flag?: CandidateFlag;          // only meaningful while in candidates pool
}

export interface CandidatePool {
  photos: ApiPhoto[];            // unordered logically; preserves insert order
}

export interface ApiPhotoSession {
  // ...existing fields unchanged
  sets: { set1, set2 };
  candidates?: CandidatePool;    // NEW — optional for backward compat
  setsTrack?, setsTurning?       // unchanged
}
```

**Why optional `candidates`:** older sessions on disk don't have it. Code
that reads it does `session.candidates?.photos ?? []`. Code that writes it
always normalizes to `{ photos: [] }` so subsequent reads are stable.

**Why optional `flag`:** when a photo is in a slot, the flag is meaningless
(slot membership is the commitment). When promoted from tray → slot, flag is
cleared. When demoted from slot → tray, flag is set to `'pick'` (it was good
enough to slot once, so it's a strong candidate by default).

**Why global, not per-mode:** the mode buckets (`setsTrack`, `setsTurning`)
exist so a mode switch preserves slot membership. Candidates are a workspace
concept — the user is choosing photos for *this competition*, not for a
specific mode. Splitting candidates per mode complicates the model and only
helps users who mid-cull switch from rally-track to turning-point on the same
batch, which is an edge case. Keep it simple.

### Persistence

`competitionService.ts` already touches `sets`, `setsTrack`, `setsTurning` in:

- `sanitizeSessionForStorage` — strip `blob:` URLs before write
- `saveSessionPhotos` — write photo blobs to disk
- `loadSessionPhotos` — rebuild `blob:` URLs on load

All three extend to handle `session.candidates` the same way. The candidate
photos use the same `photos/` directory in the competition folder — photo IDs
are unique across slots and candidates, so there's no collision.

`calculatePhotoCount` is **unchanged** — competition metadata's `photoCount`
is the *slot* count (what the user sees as "ready to print"). Candidate count
is shown separately in the tray header.

---

## UI

### Tray placement

Above Set 1 in `AppApi.tsx`. Hidden when `candidates.photos.length === 0` so
existing UX is untouched for users who don't use the feature.

```
┌─ Candidates (23 total) ──────────────────────────────────── [collapse] ┐
│ Filter: [All ▼] · Sort: [Upload time ▼]                                 │
│   ★ Picks (8) · Neutral (12) · ✗ Rejects (3)                            │
│ [thumb][thumb][thumb][thumb][thumb][thumb][thumb][thumb][thumb] →       │
│ [thumb][thumb][thumb][thumb][thumb][thumb][thumb][thumb][thumb] →       │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Set 1: SP – TP3 ────────────────────────────────────────────────────┐
│ [A][B][C][D][E][F][G][H][I]                                          │
└──────────────────────────────────────────────────────────────────────┘
```

### Thumb anatomy

- Image
- Small flag badge: `★` (yellow), no badge (neutral), `✗` (red)
- Click → opens the same `PhotoEditorApi` modal as slot photos
- Right-click / long-press → context menu (Pick / Neutral / Reject / Delete / Send to Set 1 / Send to Set 2)
- Draggable → drag source for slot promotion

### Filter

Click a pill (or use the dropdown) to filter the tray view:

| Filter | Shows |
|---|---|
| All (default) | Picks + Neutral; Rejects greyed (50% opacity) |
| Picks | Only `flag === 'pick'` |
| Neutral | Only `flag !== 'pick' && flag !== 'reject'` |
| Rejects | Only `flag === 'reject'` |
| Hide rejects | Picks + Neutral, no greyed rejects |

V1 ships **All** + **Hide rejects** toggle. Pill filters can come later if
the toggle isn't enough.

### Sort

V1: upload time only (filename as tiebreaker). User-defined drag-reorder
within the tray is a v1 stretch — implement if drag wiring is already in
place; otherwise defer.

---

## Drag/drop interactions

`dataTransfer` payload encodes source via a `kind` field:

```
text/plain  = JSON.stringify({ kind: 'slot', setKey, index, photoId })
              or { kind: 'tray', photoId }
```

| Source | Target | Effect |
|---|---|---|
| Tray thumb | Empty slot | Promote: insert at slot index, shift others; clear flag |
| Tray thumb | Occupied slot | **Swap**: target slot's photo goes back to tray as `pick`; tray photo takes the slot, flag cleared |
| Slot photo | Tray (any drop within tray container) | Demote: photo enters tray with `flag = 'pick'` |
| Slot photo | Slot (same set) | Existing reorder behavior, unchanged |
| Slot photo | Slot (other set, rally-track) | Out of scope — two-step (slot → tray → slot) |
| Tray thumb | Tray | No-op in v1 (manual sort deferred) |

### Smart drop heuristic

Pre-processing of incoming files in `addPhotosToSet` and the initial-drop path
(`onInitialFilesDropped`):

```
remaining = capacity(targetSet) - currentPhotoCount(targetSet)
if files.length <= remaining:
    fill targetSet (today's behavior)
else:
    all files → candidates
```

For the initial empty-session drop (no specific target set), the target is
`set1`. So dropping 30 files on a fresh competition → all to candidates. 9
files → fills set1.

For the rally turning-point initial drop, the existing `distributeRallyDrop`
helper distributes across set1 + set2 (capacity = 20). The smart heuristic
applies at that total-capacity level: drop ≤ 20 distributes; drop > 20 routes
to candidates.

---

## Map-pick auto-routing

Picks handed off from **map-corridors** already carry a discipline category in
their flag (`pick-track` / `pick-turning`, see the handoff `WireFlag`). On
**first import** `useMapPicksSync` routes them straight into the matching
discipline's sets instead of the candidate tray — the category the user already
chose on the map is honoured, so they don't re-sort everything by hand in the
editor.

Routing lives in the pure helper `routeImportedPickIntoSets`
(`utils/candidateTransitions.ts`); the hook wrapper is
`useCompetitionSystem.importPickToSets`.

**Fill policy — `set1 → set2 → tray`.** set1 fills to `getGridCapacity` first,
overflow spills into set2, and once both are full the photo stays in the
candidate tray (flag preserved) for manual placement. **Precision** discipline
is single-set, so set2 is skipped and overflow from set1 goes straight to the
tray.

**Mode policy — never auto-switch.** `pick-track` → track sets, `pick-turning`
→ turning sets, regardless of which discipline the user is currently viewing. A
pick for the **active** mode is written to `session.sets` (visible immediately)
and mirrored into the active bucket; a pick for the **inactive** mode is written
to that mode's bucket (`setsTrack` / `setsTurning`) with `url: ''` — exactly
like every other inactive-bucket photo — so it surfaces, with a freshly
regenerated blob URL, when the user switches to that discipline. The user's
current view is never yanked around.

**Idempotency.** A placed photo loses its tray flag and leaves the candidate
pool, so the candidates-only dedup in the sync can't see it. `AppApi` therefore
feeds `useMapPicksSync` a `placedIds` set (all `pm-` ids living in any set
bucket); the insert path skips any id already in it, so a re-sync on
`visibilitychange` never re-inserts a duplicate. A same-run guard
(`placedThisRun`) covers a duplicated row within a single file.

**Known consequences (consistent with hand-promotion).** Once a `pm-` photo is
placed in a set it is **detached** from the continuous map-pick mirror: a later
un-pick, re-categorisation, label, or filename edit in map-corridors is **not**
propagated, and the photo stops round-tripping through `editor-picks.json`
(which only carries candidates). This is identical to what already happens when
a user manually promotes a map candidate into a slot — placement transfers
ownership of the photo to the editor.

---

## Editor modal behavior

The modal works identically for tray and slot photos. The only differences:

- **Label** passed to the editor is `''` for tray photos (no slot index yet).
  The label-position picker still works; canvasState persists.
- **"Apply to all"** in the modal applies to **slots only** (v1). Tray photos
  are skipped. A tooltip clarifies: "Applies to photos in print sets, not
  candidates."

Edits to tray photos travel with the photo id when promoted. `canvasState` is
already on the photo object, so this is automatic.

---

## PDF export

`buildPdfSets` is **unchanged**. It reads only `session.sets.set1` and
`set2`. Tray photos never reach the PDF.

Post-export, if the export succeeds and the tray is non-empty:

```
Dialog: "Delete N unused candidate photos?"
Body:   "You have N candidate photos that aren't in the final set.
         Removing them frees ~NN MB and keeps storage tidy."
Buttons: [Keep candidates]  [Delete N candidates]
```

Estimate ~3 MB per photo (matches the existing `estimateCompetitionSize`
heuristic). Dialog dismisses if the user closes the PDF preview without
acting.

---

## Edge cases

| Case | Handling |
|---|---|
| Mode switch (track ↔ turningpoint) | Candidates persist (global pool). Slot transitions via existing per-mode bucket logic. |
| Discipline = precision (single-set track) | "Send to Set 2" hidden in context menu. Tray + Set 1 only. |
| Layout flip with slot at threshold | `getGridCapacity` guard in `addPhotosToSet` still fires. Swap with a slot photo at the 9-vs-10 boundary uses the same guard. |
| Reset session | Existing reset clears slots; extend to clear candidates and revoke their blob URLs. |
| Delete competition | Existing path deletes the competition dir incl. all photos. Unchanged. |
| Storage limit reached | Existing `isStorageLow` warning fires. New: tray header shows "⚠ Many candidates (47, ~140 MB)" once count > 30 OR `isStorageLow === true`. |
| Shuffle button | Unchanged — shuffles slots only. Tooltip clarifies. |
| Apply-to-all (brightness etc.) | Slot-only, as today. Out of scope to extend to candidates. |
| 20MB image cap | Unchanged — applies whether dropping to slots or candidates. |
| Blob URL lifecycle | Tray photos get URLs the same way slot photos do (`getPhotoURL`). On removal: revoke. On mode switch: candidates' URLs are NOT revoked (global pool, stays loaded). |

---

## Implementation phasing (single PR, ordered commits)

1. Types (`api.ts`)
2. `competitionService` persistence (sanitize / save / load)
3. Hook surface: `useCompetitionSystem` candidate operations + smart-drop
4. Hook surface: `usePhotoSessionOPFS` mirror (legacy path parity)
5. `CandidateTray` component
6. `PhotoGridApi` drop-target accepts `kind=tray`; tray accepts `kind=slot`
7. `AppApi` mounts tray, wires actions, post-export cleanup dialog
8. Locales (en + cs with diacritics)
9. Unit tests (smart-drop, state transitions, persistence roundtrip)

Single PR, single squash on merge.

---

## Test plan

### Unit (vitest)

- `smartDropRoute.test.ts` — given (files, target-set, currentCount, capacity), return either `{ kind: 'slot', files }` or `{ kind: 'tray', files }`. Cover boundary at exactly `capacity`.
- `candidateTransitions.test.ts` — `promoteToSlot`, `demoteToTray`, `swap`, `setFlag` — start state → end state on a session shape.
- `competitionServiceRoundtrip.test.ts` — sanitize → write JSON → read JSON → load. Candidates survive with empty URLs after sanitize, get URLs back on load.

### Manual smoke (recorded as a check in the PR)

1. Drop 30 photos on empty session → all in tray, slots empty.
2. Drag 5 tray thumbs into set1 → labels A–E appear.
3. Drag a slot photo back to tray → label disappears; tray badge shows `★`.
4. Drag a tray thumb onto an occupied slot → swap; old slot photo back in tray.
5. Flag a tray photo as reject → greyed, badge `✗`. Toggle "Hide rejects" → vanishes.
6. Export PDF → only slot photos appear. Dialog offers to delete N candidates.
7. Switch mode track ↔ turningpoint → candidates unchanged; slots swap as today.
8. Refresh page → tray repopulates from OPFS with flags + canvasState intact.

---

## Risks / future work

- **OPFS quota:** 30+ candidates × ~3 MB = ~100 MB. Plus existing slot photos. The `isStorageLow` warning handles this, but if it becomes a real pain point, candidate photos could be stored at a lower resolution (decode + downscale on import) since they're only seen as thumbnails. Out of scope for v1.
- **Per-mode candidates:** if users complain about cross-mode pool confusion, split into `setsTrack.candidates` / `setsTurning.candidates` mirroring slots. Migration is straightforward.
- **Compare view:** the deferred 1v1 / 2x2 compare modal would slot in naturally — open from a multi-select in the tray.
- **Auto-suggest picks:** ML/heuristic-based pick scoring (sharpness, faces, exposure) — possible future.

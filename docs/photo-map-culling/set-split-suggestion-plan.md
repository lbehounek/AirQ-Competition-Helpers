# Plan: set1↔set2 split at a user-chosen turning point

**Status:** IMPLEMENTED + REBASED onto current `main` (2026-06-22). Green gate:
shared-handoff + map-corridors `tsc -b` clean, photo-helper `tsc --noEmit`
clean; vitest map-corridors **728 ✓** (+2 todo) / photo-helper **478 ✓**
(counts rose: main's placeholder/dedup suites now run alongside this branch's).
Phases: shared-handoff `MapPickEntry.set` → photo-helper honor + reflow →
map-corridors break selection. Decision **(b)** (reconcile on break change)
shipped; reflow is active-discipline-only (see "photo-helper side" below).
**See the "Reinvestigation (2026-06-22)" section at the bottom** for the rebase,
the transfer-path invariants now integrated, the panel-visualization reframe
(decided: *visualize-break-only*), and the open placeholder edge case.
**Builds on:** PR #100 (`feat/map-picks-auto-route-sets`, merged), which auto-routes
imported picks into their discipline's sets with a `set1 → set2 → tray`
capacity fill.
**Owner decisions (2026-05-31, this session):**
- The set1/set2 boundary is **a turning point the user designates** — not a
  guessed/heuristic cut. (This replaces the earlier "largest-gap heuristic +
  draggable divider" draft, which was scrapped: there is nothing to *guess* and
  nothing to *drag* when the break is an explicit TP.)
- The break is chosen **in map-corridors** (that's where the route + TPs live).
- Overflow (one side of the break has more photos than a sheet holds) →
  **the surplus goes to the candidate tray**, never silently dropped, never
  cross-spilled into the other set.
- Moving the break **re-flows already-placed photos** — the editor *reconciles*
  to the map's per-photo `set` every sync (decision **(b)**), not just at first
  import. **The map owns set membership** (pure reconcile): the editor user
  reorders within a sheet and crops freely, but cross-sheet membership is the
  corridors break's call.

---

## The model, in one line

> The user marks one turning point as the **set break** in map-corridors;
> photos before it go to **set1**, photos from it onward go to **set2**, per
> discipline. The editor just obeys the per-photo set the map sends, capping
> each sheet and sending the surplus to the tray.

Rally only — precision is single-sheet, so it ignores the break.

## Division of labour

| App | Owns | Why |
|---|---|---|
| **map-corridors** | the break choice + computing each photo's set | the route order, GPS, and TP markers all live here |
| **photo-helper** | capacity + overflow→tray | the sheet size (`getGridCapacity`) is an editor concept |

The map sends a **per-photo set assignment**; the editor never needs to know
what a TP is or how route order is computed. That keeps the editor dumb and
avoids cross-app ordering drift.

## Handoff change (`frontend/shared-handoff/src/types.ts`)

Add an optional field to `MapPickEntry` (additive, versioned — old files just
omit it and fall back to PR #100 behavior):

```ts
set?: 'set1' | 'set2'   // target sheet within the photo's discipline.
                        // Absent → editor uses set1→set2→tray spillover (PR #100).
```

map-corridors computes `set` from `(break TP position, photo's route order)` and
writes it on every `pick-track` / `pick-turning` entry once a break is chosen.

## map-corridors side (the bulk of the work)

1. **Designate the break.** A toggle/context action on a turning-point marker:
   "Set break here." Exactly one break per route (we only have set1+set2 → one
   cut). Visualize which TP is the break.
2. **Compute per-photo `set`.** In route order (the existing shooting-order
   comparator — filename, then EXIF time), every photo *before* the break TP →
   `set1`; the break TP and everything *after* → `set2`. (Convention: the break
   TP's own turning photo lands in **set1**, i.e. it closes the first leg —
   confirm.)
3. **Apply per discipline.** The single break position partitions **track**
   photos across track set1/set2 **and** **turning** photos across turning
   set1/set2. (Turning photos often fit one sheet, so the break may only matter
   for track in practice — but the rule is consistent.)
4. Write `set` into `map-picks.json` entries; re-write when the break moves.

## photo-helper side — reconcile, not imperative insert (decision **(b)**, locked)

PR #100 places picks **imperatively, one at a time** and then **detaches** them
(placed photos ignore later map edits). To let a *break move* re-flow the sheets,
the editor instead **reconciles** — every sync, it makes each discipline's two
sheets match the map's per-photo `set`. Import is just the first reconcile
(empty sheets → filled); a later break change is another reconcile. One code
path. This **supersedes** PR #100's import-time-only routing for `pm-` photos.

**Ownership (locked decision, 2026-05-31):** the **map owns set membership**
(pure reconcile). In the editor the user reorders *within* a sheet and crops
freely; to move a photo *across* sheets they change the break in corridors. No
per-photo dirty flag, always converges. (The rejected alternative was
"manual editor cross-sheet move detaches the photo.")

### Reconcile algorithm (pure, per discipline, per sync)

Inputs: the discipline's `pm-` photos wherever they currently are (set1 / set2 /
tray), each with its current `ApiPhoto` state and its desired `entry.set`; plus
the non-`pm-` photos already in the sheets; plus `cap = getGridCapacity`.

1. Desired set1 = `pm-` photos with `entry.set === 'set1'`, in **route order**;
   desired set2 likewise. (`entry.set` absent → fall back to PR #100
   `set1→set2→tray` spillover for that photo — back-compat while the map doesn't
   emit `set` yet.)
2. For each sheet: keep its **non-`pm-` (manual) photos in place**, then append
   the desired `pm-` photos in route order up to `cap`. **Surplus `pm-` photos →
   tray.** Never cross-spill into the other sheet.
3. **Preserve editor-owned state on every move:** a moved photo carries its
   existing `canvasState` (crop/zoom/brightness) and `label` — reconcile moves
   the *existing object*, it never recreates it. (Regression trap: a careless
   re-flow would wipe the user's crops when the break moves.)
4. **No-op when already satisfied:** if the computed sheets+tray equal the
   current state, return the session unchanged (don't bump `version`) — prevents
   sync churn and write loops. Deterministic ⇒ converges in one pass.

`reconcileDisciplineSets(session, mode, capacity) → ApiPhotoSession`, alongside
the existing pure helpers in `candidateTransitions.ts`. Active vs inactive
mode-bucket handling and blob-URL rules are exactly as PR #100
(`url: ''` for the inactive bucket, revoke orphans).

`useMapPicksSync` stops calling per-photo `importPickToSets` for category picks
and instead, after upserting the candidate/photo objects, runs the reconcile
per affected discipline. `placedIds` is no longer a "skip" guard but feeds the
reconcile's "where is each photo now" input.

## Conventions (locked)

- **Break TP → set1.** The break TP's own photo closes leg 1.
- **Break applies to both disciplines** (track *and* turning), same cut — turning
  may rarely need it, but the rule is uniform.
- **No break chosen → exactly today's behavior** (PR #100 spillover). Safe default.

## Test plan (when built)

- map-corridors: break selection persists; per-photo `set` computed correctly
  from route order around the break; re-write on break move; precision never
  emits `set`.
- shared-handoff: `set` round-trips; `isMapPickEntry` accepts/validates it;
  absent `set` still valid (back-compat).
- photo-helper `reconcileDisciplineSets`: desired partition by `entry.set` in
  route order; manual (non-`pm-`) photos stay put; surplus → tray (no
  cross-spill); **moved photo keeps its `canvasState` + `label`**; no-op when
  already satisfied (no `version` bump); absent `set` → PR #100 spillover;
  converges in one pass on re-sync; **break move re-flows placed photos**,
  including pulling a tray-overflow photo back into a now-roomy sheet and
  pushing a now-over-capacity photo out to the tray.

## Phasing

1. **shared-handoff:** add optional `set` (+ validator). No behavior change.
2. **photo-helper:** introduce `reconcileDisciplineSets` and switch
   `useMapPicksSync` from per-photo `importPickToSets` to per-discipline
   reconcile. Falls back to PR #100 spillover while the map emits no `set`, so
   it's shippable before the map side exists.
3. **map-corridors:** break-selection UI on TP markers + per-photo `set`
   computation from route order + visualization. Lights the feature up end to
   end and exercises the re-flow path.

---

## Reinvestigation (2026-06-22)

Trigger: main shipped (a) the **picks-panel split** (`b438053`, desktop 2.26.8)
— the corridors right-side list now splits picks into **turning-point** vs
**track** groups, and dragging a row between them re-flags the photo
(`groupPhotosByFlag` → `flagForGroup` → `recategorize`) — and (b) a series of
**photo-transfer bug fixes**. This branch predated both (merge-base `9902bb3`,
~25 commits behind), so it was reinvestigated against current `main`.

### Rebase done (green baseline)

Rebased `feat/set-split-tp-break` onto `d8233a2`. Conflicts were minor and
textual: an import block in `useCompetitionSystem.ts` (kept both
`insertPlaceholderIntoSet` from main and `reconcilePlacedToDesiredSet` from this
branch) and `CHANGELOG.md` (this branch's speculative `2.27.0` entry was moved
under `## [Unreleased]`, since it is now behind main's released `2.26.8`).
All other commits replayed clean. Backup ref: `backup/set-split-pre-rebase`.

### Transfer-path invariants integrated / verified

The merged fixes established invariants this branch's reworked sync path must
honor. Status after rebase:

1. **Write-at-click-time** (`2280360`) — *fixed in rebase*. The fix added an
   explicit `scheduleWriteMapPicks(buildMapPicks(markers))` inside
   `handleSendToEditor` (written after this branch's base), so the rebase left
   it calling `buildMapPicks(markers)` **without** the break id while the
   debounced `[markers]` effect already passed `breakId`. A break toggled in the
   same render as "Send" would be dropped from the authoritative handoff file.
   Now both call sites compute `breakId` identically (null for precision) and
   pass it. Commit `fix(map-corridors): stamp TP set-break on the click-time
   send write`.
2. **`pm-` / shared-blob ownership** (`3e60785`) — *verified compatible*.
   `reconcilePlacedToDesiredSet`'s overflow re-adds to the tray
   (`{ ...photo, flag: categoryFlag }`); it never deletes blobs, so the
   `isMapOwned = id.startsWith('pm-')` delete guard is untouched. A reflow must
   not look like a delete — confirmed it doesn't.
3. **Mode-bucket mirroring** (`setsTrack`/`setsTurning`) — *already correct*.
   `reconcilePlacedToDesiredSet` mirrors into the active bucket, matching
   `insertPlaceholderIntoSet`'s pattern.
4. **Content-hash dedup** (`26d1da2`/`cfdae84`/`07bcdec`) — *no interaction*.
   `entry.set` carries no hash (correct; stays off-wire). Reconcile moves
   existing objects, never re-imports, so the `seen`/`contentHash` sets are
   unaffected.

### Reframe (DECIDED: visualize-break-only)

Key insight: **turning/track and set1/set2 are orthogonal axes.** The panel
split categorizes on turning/track (→ `flag`, crosses the wire, editor routes by
flag). `set1/set2` is a second axis — answer-sheet pagination — carried on the
separate `entry.set` field. So "do sets like the panel does turning/track" must
NOT become per-photo set assignment (that explodes into a 2×2 turning×set /
track×set grid and contradicts the locked "single break, map owns membership"
decision, and is more tedious than one break click).

**Decision (owner, 2026-06-22): visualize-break-only.** Keep the TP-break as the
assignment engine (domain-correct: a rally answer sheet breaks at a leg/TP
boundary; one click splits everything). Surface its *result* in the existing
`PhotoListPanel`: draw a `set1 │ set2` divider inside the **turning-point picks**
and **track picks** groups, at the position the break dictates, reusing
`groupPhotosByFlag`'s route-ordered lists. The break is still **set/moved from
the map** (popup "Split sets here" + scissors badge); the panel only *shows* the
split. Editor stays dumb (obeys `entry.set`).

Implementation sketch (map-corridors only — editor unchanged):
- Extract the break partition logic from `buildMapPickEntry`/`buildMapPicks` into
  a small pure helper (e.g. `partitionPicksBySet(markers, breakPhotoId)` in route
  order) so both the writer and the panel compute the same split from one source
  of truth.
- `PhotoListPanel`: within `picksTurning` and `picksTrack`, render the photos in
  route order with a `set1 │ set2` divider after the last set1 photo (a labelled
  separator row, not a new collapsible group — avoids the 2×2 blowup and keeps
  drag-to-recategorize on the existing flag groups). Rally + break-chosen only;
  hidden for precision and when no break is set.
- No wire/editor change; no new `flag`/`set` semantics. Pure additive UI.

#### Implemented (2026-06-22)

- New `src/setSplit/partitionPicksBySet.ts` — single source of truth:
  `partitionPicksBySet(markers, breakPhotoId)` (route-order cut + break
  convention) and `setBreakDividerIndex(orderedIds, setByPhotoId)` (the
  "before the first set2 row preceded by a set1 row" boundary rule). Both pure +
  unit-tested (`__tests__/partitionPicksBySet.test.ts`).
- `buildMapPicks` refactored to consume `partitionPicksBySet` (DRY — the writer
  and the panel now read the *same* partition; behavior byte-identical, existing
  `buildMapPicks — set-break assignment` tests still green).
- `PhotoListPanel` gains `setBreakPhotoId?` prop; computes `setByPhotoId` and
  renders a `<SetBreakDivider>` (scissors + "Set 2 / Sada 2", tied to the map's
  scissors badge) inside `picksTurning` / `picksTrack` only, and only where the
  group straddles the cut. `App.tsx` passes the prop (`null` for precision).
  i18n: `photo.list.setBreakDivider` (en/cs).
- Gate: map-corridors `tsc -b` clean, vitest **740 ✓** (+2 todo). photo-helper
  untouched. The break is still set/moved from the map popup — the panel only
  visualizes.

### Placeholder × reflow capacity — RESOLVED (2026-06-22)

Sets can contain `isPlaceholder` photos (`url:''`, id `placeholder-…`, from
`48251c7`). `reconcilePlacedToDesiredSet` only acts on `pm-` entries (a
placeholder carries no `entry.set`, so it is never the *subject* of a reflow),
but a placeholder occupying a slot counts toward the target sheet's length.

**Decision: a placeholder counts as an occupied slot.** When a break move would
push a real `pm-` pick into a sheet that's full *including* a placeholder, the
real pick **overflows to the candidate tray** (re-flagged, surfaced for manual
resolution) — it does **not** evict the placeholder or exceed the printable
grid. Rationale: a placeholder is a deliberate reservation for a *missing*
turning point; it cannot itself be sent to the tray (`demoteSlotToCandidate`
blocks placeholders), and the reflow cannot know an incoming photo corresponds
to that specific missing TP, so auto-evicting would be a destructive guess.
`routeImportedPickIntoSets`' first-import gate counts placeholders the same way,
so the two paths are consistent. The user resolves the conflict by removing the
placeholder (if that TP now has a photo) and dragging the tray pick in.

Pinned by `candidateTransitions.test.ts` — a reflow into a placeholder-full
sheet overflows the pick to the tray (placeholder untouched, grid not exceeded),
and a reflow into a sheet a placeholder leaves room in places the pick normally.
Code intent documented at the `targetLen` capacity gate in
`reconcilePlacedToDesiredSet`.

---

## TP-selector reframe (2026-06-22, user feedback)

Live-testing feedback: clicking a *photo* on the map to set the break was
undiscoverable and conceptually wrong — **the break is a property of the route's
turning points, not of a photo.** The user's words: "set TP where photos change —
not photo, but TP… there should be a controller 'photos change at TPx'."

**Decisions (owner):**
- **Semantics: "Set 2 starts at TP-X".** You pick the *first* turning point of
  set 2. This flips the internal convention from inclusive (break TP closed
  set 1) to **exclusive — the break TP is the first TP of set 2**: in route order
  the break TP and everything after → `set2`, everything strictly before →
  `set1`. (Free to change — feature is unreleased. The flip also makes "set 2
  starts at TP1" representable, which the inclusive convention could not.)
- **Panel selector is the sole input.** A `Set 2 starts at [ TP… ▾ ]` dropdown in
  the right-side `PhotoListPanel`, listing the turning-point picks in route order
  (TP1, TP2, … with the competition label in parens). "No split" clears it.
  Rally only (hidden for precision and when there are no turning points).
- **The per-photo map popup button is removed** (one way to set it). The map
  keeps the teal halo + scissors badge on the break TP as *read-only*
  confirmation.

**Implemented:**
- `partitionPicksBySet`: exclusive cut (`i < breakIndex ? set1 : set2`); doc
  updated. New pure `listSetBreakOptions(markers)` → turning-point picks in route
  order as `{ photoId, tpNumber, name, label? }`. Both unit-tested; the
  `buildMapPicks`/divider machinery is unchanged (still reads the partition).
- `PhotoListPanel`: `onSetBreakChange` prop + the selector. `App.tsx`:
  `handleSetBreakChange` (direct set/clear) wired to the panel; the popup
  `onPhotoSetBreak` wiring removed.
- `PhotoMarkerPopup` / `MapProviderView`: removed the "Split sets here" button
  and its props; kept the break badge. i18n: added `photo.list.setBreakLabel`
  / `setBreakNone` / `setBreakOption` (en/cs), removed `photo.popup.setBreak`
  / `clearBreak`.
- Gate: map-corridors `tsc -b` clean, vitest **748 ✓** (+2 todo). photo-helper
  untouched (set1/set2 still mean the same sheets; only *which* picks map to them
  changed, and that's computed map-side).

---

## Route-TP reframe (2026-06-29, user feedback)

Live testing surfaced the real model error: a competition can have **only track
photos** (no turning-point photos), so a break anchored on a turning-point
*photo* had nothing to attach to and the selector stayed empty. The user: "set
TP where photos change… the app should figure out which photos are after TP X."

**Decision (owner): split by the ROUTE's turning points, not by photos.**
- The break is stored as `setBreakWaypointName` (e.g. `"TP4"`), replacing the
  photo-based `setBreakPhotoId`. The route's waypoints already exist:
  `buildRouteWaypoints(session.exactPoints)` → ordered `SP, TP1…TPn, FP`.
- `partitionPicksByRouteTP(markers, waypoints, name)` projects each pick's GPS
  onto the route line (`@turf/turf` `nearestPointOnLine`) to get its
  distance-along-route, and compares to the break TP's chainage: at/after → set2,
  before → set1. Works with track-only sets. Same `photoId → set` map downstream,
  so `buildMapPicks`, the divider, and the editor are unchanged.
- `listRouteTpOptions(waypoints)` → TP1…TPn (excludes SP = all-set2, FP = empty
  set2). The panel selector lists these by name; the map shows a scissors badge
  at the chosen TP's coordinate (read-only). The per-photo popup control and the
  photo-based break model (`isSetBreakValid`, the `setMarkers` auto-clear) are
  removed — the break is independent of photo flags now.
- Edge cases: unprojectable pick (non-finite coords) → set1; stale break name
  (route reloaded) → graceful no-split (empty partition + value guard in the
  Select). The panel divider is best-effort when filename order ≠ route order
  (route doubles back) — exact in the common case.

**Gate:** map-corridors `tsc -b` clean, vitest **743 ✓** (+2 todo;
`setBreakValidity.test.ts` removed, `partitionPicksByRouteTP`/`listRouteTpOptions`
covered). photo-helper untouched (set1/set2 unchanged; only which picks map to
them, computed map-side). Desktop 2.27.0.

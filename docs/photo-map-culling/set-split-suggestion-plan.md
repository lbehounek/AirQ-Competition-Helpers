# Plan (DRAFT): set1↔set2 split at a user-chosen turning point

**Status:** DRAFT — awaiting sign-off. Not implemented.
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

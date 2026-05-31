# Plan (DRAFT): Suggested set1↔set2 split for rally imports

**Status:** DRAFT — awaiting sign-off. Not implemented.
**Depends on:** PR #100 (`feat/map-picks-auto-route-sets`), which ships the
baseline `set1 → set2 → tray` capacity fill. This doc designs the *next* layer:
making the set1/set2 boundary land on a **meaningful route point** instead of
"wherever set1 filled up."
**Owner decisions (2026-05-31, this session):**
- Split owner: **C — the editor suggests + draggable divider.** The map sends
  order (+ optional markers); the editor owns capacity and proposes the cut.
- Default cut: **largest route gap, TP-aware.**

---

## Why

set1/set2 are two **sheets** of the answer PDF; the photos on them are in route
order (filename, then EXIF time). The natural sheet boundary is *where one leg of
the route ends and the next begins* — a turning point, or a big jump in
distance/time between consecutive shots. PR #100's capacity fill cuts at photo
#9/#10 regardless, so the user re-drags photos to move the boundary to a real
point on every import. This feature picks a sensible boundary automatically and
lets the user nudge it.

**Scope: rally only.** Precision is single-sheet (set2 unused), so there is no
boundary to choose — this feature is inert for precision. Applies independently
within each rally discipline: track photos split across track set1/set2, turning
photos across turning set1/set2.

## Knowledge boundary (why C, not B)

- **The editor owns capacity** (9 / 10 per sheet, layout- and mode-dependent via
  `getGridCapacity`). A rally discipline holds up to ~2×cap; "everything in
  set1" is physically impossible, so the split must be capacity-aware → editor.
- **The map owns route semantics** (order, GPS, where TPs are). It can *hint*
  the meaningful cut but must not assert a hard set assignment, or set-capacity
  rules leak into the map app (and would have to be suppressed for precision).

So: **map hints where the cut is meaningful; editor decides where it's legal and
applies it.** Degrades gracefully — with zero map changes, the editor already
has per-photo `gps` on each `pm-` candidate and can run the gap heuristic alone.

## The suggested-cut heuristic (TP-aware largest gap)

Input: the discipline's fresh picks in route order `P[0..n-1]`, each with
`gps.capturedAt {lng,lat}` and/or `gps.timestamp`. Let `cap = getGridCapacity`
for that mode.

1. **No split needed** when `n ≤ cap` → all into set1.
2. **Legal window for the cut index `k`** (photos `[0..k-1]` → set1, `[k..n-1]`
   → set2): `max(1, n - cap) ≤ k ≤ min(cap, n-1)`. Outside this, a sheet would
   overflow. If `n > 2·cap`, the surplus beyond `2·cap` spills to the tray
   (PR #100 behavior) before the split is computed.
3. **Score each adjacent gap** `g(i)` between `P[i-1]` and `P[i]` for `i` in the
   legal window:
   - primary: **haversine distance** between the two coords (subjectAt
     preferred, else capturedAt);
   - fallback when either coord is missing: **EXIF time delta**;
   - **TP-aware boost:** if a route marker / turning point sits at this boundary
     (see "Optional map hint" below), multiply the score so a real leg-end wins
     ties against an incidental gap.
4. **Pick `k` = argmax g(i)** within the window. Ties → the `k` closest to the
   window midpoint (most balanced sheets).
5. **Fallback** when all gaps are missing/equal (no GPS, no times): even split,
   `k = clamp(round(n/2), window)`.

Pure, unit-testable: `suggestSetSplit(orderedPicks, cap, markers?) → k`.

## Optional map hint (additive, later)

To make "TP-aware" explicit rather than gap-inferred, extend `MapPickEntry`
(versioned, additive — `frontend/shared-handoff/src/types.ts`) with an optional
boundary marker, e.g. `legBreakBefore?: boolean` or `legIndex?: number`, set by
map-corridors where the route crosses a turning point. The editor prefers these
as cut points and falls back to the gap heuristic when absent. **Not required
for v1** — the gap heuristic works on the `gps` the picks already carry.

## UI: draggable divider

In the rally two-sheet view, render a boundary control between set1 and set2
positioned at the suggested `k`, labelled e.g. *"Suggested split — drag to
adjust."* Dragging it re-partitions the ordered list (clamped to the legal
window; it can't push a sheet over capacity).

**Lifecycle / the hard constraint:** the divider only makes sense while the two
sheets still hold the imported photos *in import order*. Once the user manually
reorders, swaps, or deletes within a sheet, "slide the boundary" is ill-defined.
So:
- The divider is **live only in a pristine, import-ordered state** (track a
  `splitDirty` flag per discipline; set it on any manual slot mutation).
- Once dirty, the divider locks/hides and placement is just normal drag-drop.

**MVP fallback** if the live divider is too much for a first cut: apply the
suggested split at import and show a one-time hint *"Split placed after photo N —
drag photos to adjust"*, reusing existing drag-drop. Ship the heuristic value
first, add the interactive divider second.

## Where it plugs into the shipped code

PR #100 places picks **one at a time** in `syncMapPicksOnce` via
`routeImportedPickIntoSets` (set1→set2→tray). The split needs the **whole
discipline batch** to choose `k`, so:

- In `syncMapPicksOnce`, before the per-photo loop, group the **fresh** inserts
  (not in `placedIds`/candidates) by discipline, in route order, and compute
  `k = suggestSetSplit(...)` per discipline.
- Replace per-photo spillover with a batch placement that fills set1 with
  `[0..k-1]` and set2 with `[k..]` (tray for surplus past `2·cap`). Keep the
  single-photo path as the fallback for incremental, post-batch arrivals
  (one new pick after the initial import just appends per current rules).
- `routeImportedPickIntoSets` stays the primitive; add
  `applySuggestedSplit(session, mode, orderedPhotos, k)` alongside it, both pure.

Ordering source of truth: reuse the existing **filename-then-EXIF** comparator
(the same one the map-compare "shooting order" fix uses, commit `b8af505` /
#99 era) so editor and map agree.

## Test plan (when built)

- `suggestSetSplit`: no-split (`n≤cap`); legal-window clamping; largest-gap
  pick; TP-marker boost beats a larger incidental gap; even-split fallback (no
  GPS); `n>2·cap` surplus → tray then split the rest.
- Batch placement: pristine import fills both sheets at `k`; precision ignores
  (single sheet); idempotent re-sync (placedIds) doesn't re-split.
- Divider (if built): drag clamps to legal window; `splitDirty` locks it after a
  manual mutation.

## Open questions for sign-off

1. **Divider now or MVP hint first?** (Recommend MVP hint → divider as a
   fast-follow.)
2. **Ship the gap-only heuristic (zero map changes) first, add the explicit
   `legIndex` map hint later?** (Recommend yes.)
3. **Distance vs time weighting** when both exist — pure distance, or a blend?
   (Recommend distance-primary; time only as fallback.)

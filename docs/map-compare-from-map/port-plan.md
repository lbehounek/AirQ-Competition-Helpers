# Port plan — "Compare co-located photos from the map" (supersedes PR #84)

## Background

PR #84 (`feat/map-ux-maximize-preview-autofan`) is **stale and conflicting**
(`mergeable: CONFLICTING`, 25 commits behind `main`, still a draft). Its branch
name lists three features, but it was rebased down to **one commit**:

> `993e74f feat(map-corridors): compare co-located photos from the map (cluster pill + modifier-select)`

The other features the branch name implies (big photo preview, maximize window,
auto-fan) already landed on `main` independently — including the auto-fan
projection-guard fixes (#91/#92) and the edge-pan marker-drag refactor (#91),
which are exactly what #84 collides with.

**Decision:** rather than merge/rebase #84 and untangle conflicts (which would
also leave dangling references to the removed `draggingPhotoMarkerId` state that
git would *not* flag), we re-apply the feature cleanly on top of current `main`,
reusing #84's already-written logic and rewiring only the parts that main's
refactor changed. Then close #84 referencing the new PR.

## The feature (unchanged scope from #84)

Compare co-located (overlapping) photos straight from the map. Two entry points,
both feeding the **existing** compare modal via `onCompareVariants`:

1. **Cluster pill** — each fanned cluster shows a small `⇄ N` pill at its
   screen-space centroid (where the leader lines converge). Click → compare the
   cluster's photos. ≤3 opens the side-by-side modal directly; >3 drops them
   into a selection so the floating bar can trim down.
2. **Modifier multi-select** — Ctrl/Cmd/Shift-click any dots to multi-select
   (purple ring highlight). A floating **Compare** bar appears (enabled for 2–3,
   disabled-with-hint over the cap, mirroring `PhotoListPanel`). Plain click
   still opens the photo popup and clears any pending selection.

## What main already provides (reuse, don't recreate)

| Asset | Location (on `main`) | Note |
|---|---|---|
| `handleCompareVariants` | `App.tsx:747` | Compare-modal handler — already exists (side panel uses it). |
| `onCompareVariants` prop | `App.tsx:1391` → **`PhotoListPanel`** | Currently wired to the panel only, **not** MapProviderView. |
| `MAX_COMPARE_VARIANTS = 3` | `components/PhotoListPanel.tsx:115` (exported) | Import from here — no new constant. |
| i18n `photo.list.compareSelected / compareLimitTip / clearSelection` | `locales/{cs,en}.json` | Already present. |
| `computeMarkerFan` | `map/photoLayers/markerFan.ts` | **Unchanged on main since base** → #84's clusters diff cherry-picks cleanly. |
| `buildMarkerFan` + `safeUnproject` | `map/photoLayers/useMarkerFan.ts` | NaN-guarded projection boundary from #91/#92. Cluster centroids must route through `safeUnproject`. |
| `useEdgePanDrag` / `MarkerDragHandle` | `map/useEdgePanDrag.ts`, `map/MarkerDragHandle.tsx` | New drag system that replaced inline handlers. `DragHandleConfig.onClick?: () => void` fires bare (no event). |

## The one real design decision (region 4)

#84 put its Ctrl/Cmd/Shift-click logic **inside an inline `onClick` handler that
main has since deleted**. On main, a marker tap routes through
`MarkerDragHandle` → `useEdgePanDrag`, and the click callback is:

```ts
// useEdgePanDrag.ts:41
onClick?: () => void          // fires bare — NO event, NO modifier keys
// invoked at line 178:  else st.cfg.onClick?.()
```

To support modifier-click selection we must **forward modifier state through the
drag controller**. Chosen approach (minimal, matches the codebase's typed-
boundary style, e.g. `ProjectionMap`):

```ts
// useEdgePanDrag.ts
export type ClickMods = { ctrl: boolean; meta: boolean; shift: boolean }
onClick?: (mods: ClickMods) => void
```

- Capture modifiers from the pointer event at the click decision point
  (`onPointerUp`, line ~178) and pass them to `onClick`.
- Backward-compatible: existing callers (`onClick={() => setActivePhotoMarkerId(m.id)}`)
  keep working — the arg is optional to read.

This is the only non-mechanical change; everything else is additive.

## Change set (branch off current `main`)

Branch: `feat/map-compare-selection`

1. **`map/photoLayers/markerFan.ts`** — *cherry-pick #84 verbatim.* Add
   `MarkerCluster { ids, centroid }`, add `clusters` to `MarkerFanResult`, push
   one per fanned group in `computeMarkerFan`. (File unchanged on main → clean.)

2. **`map/photoLayers/useMarkerFan.ts`** — add `FanCluster { ids,
   centroidLngLat, count }` + `clusters` to `UseMarkerFanResult` + `EMPTY`.
   **Rewire onto main:** compute clusters inside `buildMarkerFan`, routing each
   centroid through the existing **`safeUnproject`** (drop a cluster whose
   centroid can't unproject) — *not* #84's raw `map.unproject`, which would
   reintroduce the off-horizon white-screen crash #91/#92 fixed.

3. **`map/useEdgePanDrag.ts`** — extend `DragHandleConfig.onClick` to
   `(mods: ClickMods) => void` and forward modifier keys (see above).
   `MarkerDragHandle.tsx` needs no change (it spreads `DragHandleConfig`).

4. **`map/MapProviderView.tsx`** — the bulk. Additive unless noted:
   - Add `onCompareVariants?: (markers: readonly PhotoMarker[]) => void` to props.
   - Add map-side selection state: `selectedPhotoMarkerIds`, `togglePhotoSelection`,
     `clearPhotoSelection`, prune-on-disappear effect, Esc-to-clear effect,
     `markersByIdForCompare`, `selectedCompareMarkers`, `compareOrSelect`.
   - `<MapGL onClick={() => selectedPhotoMarkerIds.length && clearPhotoSelection()}>`
     (add alongside main's existing `onMove` — keep both).
   - In the photo-marker loop: add `const isSelected = selectedPhotoMarkerIds.includes(m.id)`;
     merge the dot `boxShadow`/`transform` to layer the purple selected-ring with
     the active glow (keep main's `position:'relative'`); bump `style` zIndex for
     `isActive || isSelected`.
   - **Rewire the marker `onClick`** to the new modifier-aware callback:
     `onClick={(mods) => (mods.ctrl||mods.meta||mods.shift) ? togglePhotoSelection(m.id)
     : (clearPhotoSelection(), setActivePhotoMarkerId(m.id))}`.
   - Render the **cluster pill** (`photoFan.clusters.map(...)` → `<Marker>` with the
     `⇄ N` button) gated on `props.onCompareVariants`. Place near the existing
     fan-leaders `<Source>`/`<Layer>` (~line 519).
   - Render the **floating compare bar** before `</MapGL>` (alongside main's
     reset-north compass — keep both).
   - Import `MAX_COMPARE_VARIANTS` from `../components/PhotoListPanel`.

5. **`App.tsx`** — one line: pass `onCompareVariants={handleCompareVariants}` to
   the **`MapProviderView`** element (handler already exists; only the panel gets
   it today).

6. **`locales/en.json` + `cs.json`** — add `photo.map.comparePill` +
   `photo.map.compareAction` (the only two new keys; the `photo.list.*` ones
   already exist).

7. **`__tests__/markerFan.test.ts`** — cherry-pick #84's two new cases (clusters
   reported with ids+centroid; no clusters when nothing overlaps).

8. **`CHANGELOG.md`** — port #84's bullet under the existing "Map Corridors"
   block.

## Verification

- `pnpm --filter <map-corridors> test` (vitest) — incl. the new markerFan cases.
- `pnpm --filter <map-corridors> build` (`tsc -b && vite build`) — type-check;
  confirms the `onClick` signature change compiles at every call site and no
  dangling `draggingPhotoMarkerId` survives.
- `pnpm --filter <map-corridors> lint`.
- Manual (per CLAUDE.md — green tests don't prove UI): overlapping dots show the
  `⇄ N` pill; pill compares; Ctrl/Cmd/Shift-click rings dots and shows the bar;
  plain click opens popup + clears selection; Esc clears; tilt/rotate the map
  with a cluster near the horizon → no white screen (the `safeUnproject` guard).

## Risks / fresh-perspective self-check

- **Centroid above horizon:** #84's raw `unproject` is the main trap; the plan
  explicitly routes through `safeUnproject`. New test idea: a cluster centroid
  that unprojects to non-finite should be dropped, not thrown.
- **Modifier capture point:** must read modifiers at pointer-up (the click
  decision), and confirm a *drag* never fires `onClick` (existing `st.moved`
  guard already handles this — verify the modifier change doesn't bypass it).
- **Selection vs active glow coexistence:** a marker can be both selected and
  active — the layered `boxShadow` array must render both; covered in manual QA.
- **Pill stacking / zIndex:** pill `<Marker zIndex:3>` must sit above dots
  (`zIndex:2` when active) and below popups — verify ordering.
- **`onCompareVariants` optional:** all new map UI is gated on the prop, so other
  embeddings of MapProviderView (if any) stay unaffected.

## Estimate

Without AI: ~4–6 h (diagnose the conflict surface, design the controller
change, port + test). Log actuals with `/time-log` after implementation.

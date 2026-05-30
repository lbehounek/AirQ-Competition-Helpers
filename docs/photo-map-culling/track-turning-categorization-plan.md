# Plan: Categorize map picks as Track vs Turning-Point photos

**Status:** IMPLEMENTED (2026-05-30, branch `feat/track-turning-categorization`).
Green gate: `tsc -b` (map-corridors) + `tsc --noEmit` (photo-helper) clean;
vitest map-corridors 633 ✓ / photo-helper 436 ✓ / desktop 63 ✓.
**Owner feedback (2026-05-30):** "it would be good in corridors app, to be able to
distinguish between track and TP photos by categorizing them to track
photos/turning photos category, once they are selected" + auto-route those into
the photo editor's track vs turning-point sets.

This is the **A3** item from the 2026-05-30 UX pass. The other items (C1, B5, B3,
A1, A2, C2, B4, B2) shipped on branch `feat/ux-pass-markers-editor-launcher`.
A3 was attempted there and **reverted** because the editing channel became
unreliable mid-session; it must be redone cleanly. Nothing about A3 is committed.

## Design decisions (already approved by the user)

1. **Replace the single `pick` flag with two pick categories:** `pick-track`
   and `pick-turning`. `reject` and neutral (absent flag) stay as-is.
2. **Legacy migration:** an existing persisted `flag: 'pick'` becomes
   `pick-track` (the common case; the user re-categorizes turning-point photos
   via the popup). Lossless and reversible.
3. **Auto-route through the handoff:** the category rides on the cross-app
   handoff so the editor knows track vs turning. Do **NOT** silently auto-promote
   arriving picks into the editor's print sets (that would move photos into a
   mode bucket hidden from the current view). The category travels on the
   candidate's flag; the existing tray "Send to Set" / "Send to TP photos"
   controls (shipped in B2) do the actual placement.

## Visual language

- Track pick marker ring: blue `#1976d2` (current pick color — keep).
- Turning-point pick marker ring: purple `#7b1fa2`.
- Neutral: amber `#fb8c00` (shipped in A1). Reject: red `#d32f2f`. Label: gold `#facc15`.

---

## Change surface (exhaustive — file : what)

### 1. Flag type — `frontend/map-corridors/src/types/markers.ts`
- `export type PhotoFlag = 'pick' | 'reject'` → `'pick-track' | 'pick-turning' | 'reject'`.
- `PHOTO_FLAG_SET` set: `['pick','reject']` → `['pick-track','pick-turning','reject']`.
- **Add** an exported migration helper (append at end of file):
  ```ts
  /** v1 stored a bare `flag: 'pick'`; the flag was split into pick-track /
   *  pick-turning. A legacy `pick` becomes `pick-track`. MUST run BEFORE the
   *  isPhotoMarker guard on load or previously-picked photos get dropped. */
  export function migrateLegacyPhotoFlag(m: unknown): unknown {
    if (m && typeof m === 'object' && (m as { flag?: unknown }).flag === 'pick') {
      return { ...(m as object), flag: 'pick-track' }
    }
    return m
  }
  ```

### 2. OPFS load migration — `frontend/map-corridors/src/hooks/useCorridorSessionOPFS.ts`
- Import `migrateLegacyPhotoFlag` from `../types/markers`.
- In `sanitizeMarkers` (the `raw.filter(isPhotoMarker)` path), map FIRST:
  `return raw.map(migrateLegacyPhotoFlag).filter(isPhotoMarker)`.
  Without this, a v1 session's `flag:'pick'` markers fail the guard and are
  silently dropped on load.

### 3. Grouping — `frontend/map-corridors/src/components/groupPhotosByFlag.ts`
- `if (m.flag === 'pick') picks.push(m)` →
  `if (m.flag === 'pick-track' || m.flag === 'pick-turning') picks.push(m)`.
  (Both categories count as "picks"; the existing 4-group panel stays.)

### 4. Recategorize — `frontend/map-corridors/src/recategorize/recategorize.ts`
- `flagForGroup`: `case 'picks': return 'pick'` → `return 'pick-track'`
  (dropping into the picks panel section defaults to track; re-categorize via popup).

### 5. Variant resolution — `frontend/map-corridors/src/photoVariants/resolveVariantFlags.ts`
- Winner: `flag: 'pick' as const` → keep the winner's existing category if it was
  already a pick, else default to track:
  `flag: (m.flag === 'pick-turning' ? 'pick-turning' : 'pick-track') as const`.

### 6. Popup UI — `frontend/map-corridors/src/components/PhotoMarkerPopup.tsx`
- Props: replace `onInclude: () => void` with
  `onIncludeTrack: () => void` + `onIncludeTurning: () => void`.
- Destructure both; compute `isPickTrack`/`isPickTurning` from `marker.flag`.
- Replace the single "Picked" button with two:
  - Track: `<Check/>` icon, `color={isPickTrack ? 'primary' : 'default'}`,
    label `t('photo.popup.pickTrack')`.
  - Turning: `<Flag/>` icon (add to `@mui/icons-material` import),
    `color={isPickTurning ? 'secondary' : 'default'}`,
    label `t('photo.popup.pickTurning')`.
  - Keep Skip + Reject unchanged.

### 7. App handlers — `frontend/map-corridors/src/App.tsx`
- Import `PhotoFlag` from `./types/markers` (type-only).
- `setPhotoFlag(markerId, flag: 'pick' | 'reject' | null)` → `flag: PhotoFlag | null`.
- Split `handlePhotoInclude` into `handlePhotoIncludeTrack` (sets `'pick-track'`)
  and `handlePhotoIncludeTurning` (sets `'pick-turning'`). Keep skip/reject.
- `handlePhotoSetFlag` signature → `PhotoFlag | null`.
- `handleProvisionalCommit(flag: 'pick' | 'reject' | null)` → `PhotoFlag | null`.
- Pass `onPhotoIncludeTrack` / `onPhotoIncludeTurning` to `<MapProviderView>`
  (replacing `onPhotoInclude`).

### 8. MapProviderView — `frontend/map-corridors/src/map/MapProviderView.tsx`
- Import `PhotoFlag` (type-only) from `../types/markers`.
- Props: `onPhotoInclude?` → `onPhotoIncludeTrack?` + `onPhotoIncludeTurning?`.
- `onProvisionalCommit?: (flag: 'pick' | 'reject' | null)` → `(flag: PhotoFlag | null)`.
- Popup wiring: `onInclude={() => props.onPhotoInclude?.(m.id)}` →
  `onIncludeTrack` / `onIncludeTurning` calling the respective props.
- flyTo center: `marker.flag === 'pick'` → `(marker.flag === 'pick-track' || marker.flag === 'pick-turning')`.
- ring color: `: m.flag === 'pick' ? '#1976d2'` →
  `: m.flag === 'pick-track' ? '#1976d2'\n: m.flag === 'pick-turning' ? '#7b1fa2'`.
- Provisional commit default button: `onProvisionalCommit?.('pick')` → `('pick-track')`.

### 9. Handoff writer — `frontend/map-corridors/src/handoff/mapPicksWriter.ts`
- `if (m.flag !== 'pick') continue` →
  `if (m.flag !== 'pick-track' && m.flag !== 'pick-turning') continue`.
  (The `flag` value itself is then written through as-is.)

### 10. Shared handoff wire type — `frontend/shared-handoff/src/`
- `types.ts`: `WireFlag = 'pick' | 'neutral' | 'reject'` →
  `'pick' | 'pick-track' | 'pick-turning' | 'neutral' | 'reject'`.
  **Keep bare `pick`** for backward compat (old `map-picks.json` files).
- `guards.ts`: `WIRE_FLAGS` set gains `'pick-track'`, `'pick-turning'`.

### 11. Photo-helper candidate flag — `frontend/photo-helper/src/types/api.ts`
- `CandidateFlag = 'pick' | 'neutral' | 'reject'` →
  `'pick' | 'pick-track' | 'pick-turning' | 'neutral' | 'reject'` (keep `pick` for back-compat).

### 12. Photo-helper handoff consume — `frontend/photo-helper/src/hooks/useMapPicksSync.ts`
- Normalize legacy on read: when building/reconciling a candidate from a
  `MapPickEntry`, map `entry.flag === 'pick'` → `'pick-track'` so a candidate
  always carries an explicit category after crossing the handoff. Use that
  normalized value in both the create path and the `setCandidateFlag` reconcile.

### 13. i18n — `frontend/map-corridors/src/locales/{en,cs}.json`
- Add under `photo.popup`:
  - en: `pickTrack: "Track photo"`, `pickTurning: "Turning-point photo"`.
  - cs: `pickTrack: "Fotka trati"`, `pickTurning: "Fotka otočného bodu"` (diacritics!).
- The old `photo.popup.include` key can stay (harmless) or be removed.

### 14. Tests
- **Update** every flag-assertion suite in `frontend/map-corridors/src/__tests__/`
  that uses `flag: 'pick'` → `'pick-track'` (or `'pick-turning'` where testing
  the turning path): `groupPhotosByFlag`, `mapPicksWriter`, `recategorize`,
  `resolveVariantFlags`, `markersDisplay`, `markerSanitize`,
  `provisionalPlacement`, `activePhoto`, `groupKeyForPhotoId`, `markerVisibility`,
  `handoffRoundTrip`. (tsc will list every site — run `npx tsc -b` and fix what
  it flags.)
- **Add** `migrateLegacyPhotoFlag.test.ts`: legacy `pick`→`pick-track`; reject /
  the two new categories / neutral untouched; non-objects pass through; and a
  "guard now accepts the migrated marker (no data loss)" case.
- **Add** a `groupPhotosByFlag` case asserting BOTH categories land in `picks`.
- Photo-helper: confirm `useMapPicksSync` tests still pass; add a legacy-`pick`
  normalization case if one doesn't exist.

---

## Order of work (each step compiles + tests green before the next)

1. shared-handoff `WireFlag` + `WIRE_FLAGS` (no consumers break — additive).
2. markers.ts `PhotoFlag` + `PHOTO_FLAG_SET` + `migrateLegacyPhotoFlag`.
   → `npx tsc -b` in map-corridors now lists every break (≈30 sites) — that list
   IS your worklist for steps 3–9.
3. OPFS migration (step 2 above, #2).
4. Logic sites: groupPhotosByFlag, recategorize, resolveVariantFlags,
   mapPicksWriter, MapProviderView flyTo + ring (#3,4,5,9,8-partial).
5. Popup UI + App handlers + MapProviderView props/wiring (#6,7,8).
6. i18n keys (#13).
7. photo-helper CandidateFlag + useMapPicksSync normalize (#11,12).
8. Tests (#14).
9. Full green gate: `npx tsc -b` (map-corridors), `npx tsc --noEmit -p tsconfig.json`
   (photo-helper), `npx vitest run` in map-corridors + photo-helper + desktop.

## Risk notes
- Biggest risk is the **shared-handoff contract** — both apps consume it from
  source, so a mismatch compile-fails (good). Keeping bare `pick` in the union
  preserves old handoff files.
- The **OPFS migration ordering** (migrate before guard) is the data-loss
  trap — get it right and unit-test it.
- This change touches ~14 files + ~11 test files. Do it in small verified
  commits, not one batch. Verify each `Edit` landed (the 2026-05-30 session lost
  several edits to a flaky tool channel — re-read after editing).

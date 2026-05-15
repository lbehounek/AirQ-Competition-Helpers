# Tech Debt

Tracked items to clean up when time allows. Roughly ordered by
**(impact / leverage) ÷ effort**. Not exhaustive — add to it as new items
surface in code review / release notes.

---

## Open

### 1. Pin remaining `^` ranges to exact versions
- **Why:** CLAUDE.md global rule ("Always use exact versions … reason: axios
  supply chain attack 2026-03-31"). We pin new deps exact, but most existing
  ones still use caret ranges: `@emotion/*`, `@mui/*`, `react`, `react-dom`,
  `@types/*`, `eslint`, `typescript`, `@vitejs/plugin-react`, etc.
- **Action:** Walk each `package.json` in the workspace, replace `^X.Y.Z` with
  the resolved exact version from the lockfile, run `pnpm install
  --frozen-lockfile` to verify. Do it one workspace at a time to keep the diff
  reviewable.
- **Effort:** ~1 hour.
- **Tags:** `security`, `hygiene`

### 2. Code-split vite bundles
- **Why:** Both production builds emit the 500 kB chunk warning:
  - `photo-helper/dist/assets/index-*.js` — **2.4 MB** (775 kB gzipped)
  - `map-corridors/dist/assets/index-*.js` — **2.2 MB** (638 kB gzipped)
  Slow initial paint, especially on the web build. Desktop users don't feel
  it (local file load), but web / first-visit traffic does.
- **Action:** Add `build.rollupOptions.output.manualChunks` in both
  `vite.config.*` to split MUI, map libraries (maplibre/mapbox), and PDF
  renderer into their own chunks. Verify the .exe still loads.
- **Effort:** ~1–2 hours.
- **Tags:** `perf`, `ux`

### 3. Remove lingering `as any` in `useCompetitionSystem`
- **Why:** Two stub placeholders remain in the return object at
  `frontend/photo-helper/src/hooks/useCompetitionSystem.ts` (lines ~848–849):
  `addPhotosToTurningPoint: (...) as any` and `refreshSession: (...) as any`.
  These were added to satisfy the interface shared with `usePhotoSessionOPFS`
  / `usePhotoSessionApi`. Same class of bug as `applySettingToAll` was before
  PR #39 — a no-op stub that silently does nothing in competition mode.
- **Action:** Either (a) implement them properly in the competition system,
  or (b) widen the consuming interface to mark them optional and remove the
  stubs. Option (b) is faster and safer.
- **Effort:** ~30 min for option (b); ~2–4 hours for option (a).
- **Tags:** `types`, `correctness`

### 4. Hook-level regression tests for `applySettingToAll` wiring
- **Why:** PR #39 extracted `applySettingToAllInSession` and tested that pure
  function heavily, but we still don't test the *hook's* call to it. A future
  rebase/refactor re-introducing a no-op stub (the exact class of bug #39
  fixed) would again pass CI. The utility tests wouldn't catch it.
- **Action:** Add `@testing-library/react` + `@testing-library/react-hooks` as
  dev deps; write one render-hook test per hook asserting that calling
  `applySettingToAll('brightness', 50)` produces a session state with all
  photos patched. Pin deps exact.
- **Effort:** ~2 hours.
- **Tags:** `tests`, `regression`

### 5. ESLint 9 → 10 upgrade
- **Why:** ESLint 10 is the current latest major; we're on `^9.33.0`. Not
  urgent — 9.x is still supported — but the further we drift, the bigger the
  migration when forced.
- **Action:** Bump eslint to 10.x in photo-helper + map-corridors; run
  `pnpm lint` in both; fix any rule-config breakage.
- **Effort:** ~1 hour (usually painless, occasionally rule renames bite).
- **Tags:** `deps`, `hygiene`

### 6. Provider-level tests for `LabelingContext` lock behavior
- **Why:** PR #56 added defense-in-depth to `LabelingProvider` — `setLabeling`
  silently no-ops when `isPrecision && labeling.id !== 'numbers'` and the
  context exposes `isLocked: true` for precision. The new test file only
  covers the pure helper (`resolveDefaultLabeling`); the guard and `isLocked`
  are untested. A future refactor that re-enables letter switching for
  precision would pass CI even though the rules-compliance contract regresses.
- **Action:** Add a small RTL test that mounts `LabelingProvider` with
  `window.location.search = '?discipline=precision'` (jsdom), asserts
  `isLocked === true`, calls `setLabeling(LETTERS_OPTION)`, and asserts
  `currentLabeling.id === 'numbers'` (i.e. the call was ignored). Pairs well
  with item #4 if the dev-deps are added there first.
- **Effort:** ~30 min once `@testing-library/react` is in (see #4).
- **Tags:** `tests`, `regression`, `precision`

### 7. ID-based lookup in `LABELING_OPTIONS` constants
- **Why:** PR #56 introduced
  `const LETTERS_OPTION = LABELING_OPTIONS[0]` and
  `NUMBERS_OPTION = LABELING_OPTIONS[1]` in
  `frontend/photo-helper/src/contexts/LabelingContext.tsx`. If anyone reorders
  `LABELING_OPTIONS` (e.g. for UI grouping or to default-show numbers first),
  the named constants silently flip and `resolveDefaultLabeling` returns the
  wrong option for both disciplines. Coupled with the missing Provider tests
  (#6), this would not be caught by CI.
- **Action:** Replace the index lookups with id-based lookups —
  `LABELING_OPTIONS.find(o => o.id === 'letters')!` and `… 'numbers'` — or
  add a module-scope `console.assert(LABELING_OPTIONS[0].id === 'letters')`
  guard. The find approach is preferred (reorder-safe by construction).
- **Effort:** ~5 min.
- **Tags:** `correctness`, `hygiene`

### 8. macOS multi-file clipboard paste (`NSFilenamesPboardType`)
- **Why:** `frontend/desktop/main.js` `readClipboardFilePaths` only reads
  `public.file-url` on macOS, which is a single file. A multi-file Finder
  copy (⌘-click multi-select → ⌘C) populates `NSFilenamesPboardType` — a
  binary or XML property-list array of paths — and would currently paste
  only the first file. Acceptable today because we ship Windows-only (see
  "Signed Windows .exe" below), but the moment we add a macOS build the
  paste UX silently regresses for power users.
- **Action:** When macOS distribution lands, add a plist parser
  (`simple-plist` or a hand-rolled `<array><string>…</string></array>`
  XML reader, since the structure is fixed) and a third branch in
  `readClipboardFilePaths` that calls `clipboard.readBuffer('NSFilenamesPboardType')`
  before the `public.file-url` fallback. Re-add `NSFilenamesPboardType`
  to the format-availability check at the same time.
- **Effort:** ~1–2 hours (parser + tests + a Finder-tested QA pass).
- **Tags:** `mac`, `ux`, `clipboard`

---

## Deferred (documented but not scheduled)

### Signed Windows .exe
- **Decision:** stay unsigned (`frontend/photo-helper` is a small-distribution
  app for the flying-competition community). Full rationale and swap-in path
  recorded in `.claude/skills/windows-app/SKILL.md` → "Code signing —
  decision: unsigned". Revisit if distribution scales beyond a few hundred
  users or enterprise installs start rejecting unsigned binaries via
  AppLocker.

---

## Format

Each open item: why / action / effort / tags. Deferred items: just decision +
pointer to where the rationale lives. Close an item by moving it to a
"Resolved YYYY-MM" section at the bottom with a one-line note and the PR
number, or by deleting it outright once the PR lands and the commit message
explains the move.

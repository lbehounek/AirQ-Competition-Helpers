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

### 9. Re-point `map-corridors/src/utils/serialQueue.ts` at `@airq/shared-storage`
- **Why:** `createSerialQueue` now lives in `frontend/shared-storage/src/serialQueue.ts`
  (photo-helper's `competitionService` needs the same ordering primitive).
  map-corridors still carries its own byte-identical copy, so a fix to one
  will not reach the other.
- **Action:** Reduce `map-corridors/src/utils/serialQueue.ts` to
  `export { createSerialQueue, type SerialQueue } from '@airq/shared-storage'`
  — `useSerialQueue.ts`, `importQueue.ts`, `mapPicksWriter.ts` and
  `serialQueue.test.ts` then keep compiling unchanged. Delete the duplicated
  implementation and its now-redundant test.
- **Effort:** ~15 minutes.
- **Tags:** `dry`, `hygiene`

### 11. Two more copies of the in-memory `StorageInterface` double
- **Why:** `src/__tests__/support/inMemoryStorage.ts` now holds the shared
  double, but `competitionServiceRoundtrip.test.ts` and
  `useCompetitionSystem.candidates.test.tsx` still define their own
  near-identical copies (they differ only in whether the blob entry carries a
  `mime` field). Three definitions is where they start disagreeing about
  `NotFoundError` semantics, which the service branches on.
- **Action:** Delete both inline copies and import from
  `./support/inMemoryStorage`.
- **Effort:** ~20 minutes.
- **Tags:** `dry`, `tests`

### 12. Stabilize the candidate-tray toolbar callbacks
- **Why:** `CandidateThumb` is now `React.memo`'d and its image is a memoized
  `CandidateThumbImage` (WP2c replaced the per-thumb `PhotoEditorApi` with a
  plain `<img>`), so a tray render no longer redraws any canvas. But
  `CandidateTray` still passes freshly-built
  `onClick` / `onDragStart` / `onSetFlag` / `onDelete` / `onSendToSet` /
  `onSendToTP` arrows per thumb, so the memo itself never skips: the thumb's
  MUI chrome still re-renders for every candidate on every tray render, and
  the tray is the one unbounded list in the app.
- **Action:** `useCallback` the five dispatchers in `CandidateTray` keyed on
  the photo id (or hand each thumb the photo and let it call a stable
  `(photoId, …)` dispatcher), then assert with a render counter that adding a
  candidate re-renders only the new thumb.
- **Effort:** ~45 minutes.
- **Tags:** `performance`

### 13. Pause the edited photo's grid slot while the modal is open
- **Why:** After WP2b a slider tick redraws two canvases: the modal editor and
  the same photo's grid slot, which is completely hidden behind the dialog.
  Halving that is the last cheap win on the drag path.
- **Action:** Thread `pausedPhotoId={selectedPhoto?.photo.id}` from `AppApi`
  through `PhotoGridApi` → `PhotoGridSlot` → `PhotoEditorApi`, and early-return
  from `renderCanvas` while paused; redraw once on unpause (the modal's exit
  already refreshes the session).
- **Effort:** ~30 minutes plus a redraw-count test.
- **Tags:** `performance`

### 14. `pnpm --filter @airq/photo-helper lint` is red on 16 pre-existing errors
- **Why:** Lint has never been green in this package, so it cannot be used as a
  CI gate and new errors are easy to miss. Current breakdown:
  `react-refresh/only-export-components` ×11 (every context file plus
  `PhotoEditorApi.tsx`, which exports `BASE_WIDTH` / `renderPhotoOnCanvas` /
  `cropImageToAspectRatio` / `drawCircle` alongside the component —
  `pdfGenerator.ts` imports them), `react-hooks/set-state-in-effect` ×4
  (`imageCache.ts` `useCachedImage`, `PhotoControls.tsx` ×2 prop-sync effects,
  `CleanupModal.tsx`), `react-hooks/refs` ×1 (`useClipboardPaste.ts`),
  `prefer-const` ×1 (`onboarding/photoHelperTour.ts`).
- **Action:** Decide per rule. The `react-refresh` ones want the non-component
  exports moved into sibling modules (`contexts/aspectRatioOptions.ts`,
  `components/photoRender.ts`) with the import sites updated — mechanical but
  wide. The `set-state-in-effect` ones are the documented "adjust state during
  render with a previous-value guard" refactor. Then turn lint into a gate.
- **Effort:** ~3 hours, best done as its own PR so the diff is reviewable.
- **Tags:** `tooling`, `lint`

### 15. Defer full-resolution blob URLs for candidate photos on session load
- **Why:** `competitionService.loadSessionPhotos` reads EVERY candidate's
  full-resolution file and mints a `blob:` URL for it at session load. On
  Electron each read is an IPC round-trip carrying the file as base64. Since
  WP2c the tray no longer needs those URLs to paint — it renders ~20 KB
  thumbnails — so for a 20-40 candidate session this is now the dominant
  "slow to open a competition with photos" cost, and nothing consumes the
  result until the user opens a candidate in the modal or promotes it to a slot.
- **Action:** Load candidate bytes lazily (on modal open / promotion) and keep
  the eager path for slot photos only. The thumbnail tier already covers the
  tray, and `useCandidateThumbUrl` falls back gracefully for a photo whose
  `url` is `''`. Needs care around `saveSessionPhotos`, which re-reads
  `photo.url` via `fetch(blob:)`, and around `revokeSessionBlobUrls`.
- **Effort:** ~2-3 hours plus round-trip tests.
- **Tags:** `performance`, `electron`

### 16. Make `storage-get-directory` signal a miss the way `storage-get-photo` does
- **Why:** `desktop/main.js` `storage-get-photo` now rejects with a
  `NotFound:`-prefixed message and `ElectronStorage.getPhotoBlob` maps that onto
  a `NotFoundError` (WP2c), which is what the shared `getPhotoThumb` needs to
  return `null` on a miss. `storage-get-directory` with `create: false` still
  throws a plain `Directory not found: …`, so a missing `thumbs/` subdirectory
  is *also* only recognised as a miss by message shape further up the stack.
- **Action:** Have `storage-get-directory` return `null` for a `create: false`
  miss (or reject with the same `NotFound:` marker) and map it in
  `ElectronStorage.getDirectoryHandle` to a `NotFoundError`. Owned by the
  desktop lane — `frontend/desktop/main.js` is outside the renderer packages.
- **Effort:** ~30 minutes including a `desktop/__tests__` case.
- **Tags:** `electron`, `correctness`
- **Partly done 2026-09 (renderer half).** `ElectronStorage.getDirectoryHandle`
  now maps the miss to a `NotFoundError`, matching on EITHER the shared
  `NotFound:` marker or the current `Directory not found:` wording, so it works
  against a main process of either vintage (`electronStorageNotFound.test.ts`).
  That unblocks `getPhotoThumb` / `deletePhotoThumb` and
  `flushPendingWrites`' drop-on-missing-directory on desktop. What REMAINS is
  the main-process half — emitting the `NotFound:` marker from
  `storage-get-directory` so the renderer can stop matching on prose.

### 17. Pre-generate candidate thumbnails at import time
- **Why:** The first tray render of an existing session (or a fresh 40-photo
  drop) generates up to N thumbnails in the background at concurrency 2 —
  skeletons show meanwhile. Every later session reads ~20 KB files instead.
- **Action:** In `useCompetitionSystem.addPhotosToCandidates`, after the photo
  persists, fire-and-forget
  `generateThumb(file, CANDIDATE_THUMB_OPTS)` → `storage.savePhotoThumb(...)`
  per fresh file. Needs the competition `photos/` dir, which the hook does not
  hold today (pass it from `AppApi`, or resolve it via `competitionService`).
  Produces byte-identical files to the lazy path, so it is a pure optimisation.
- **Action gate:** only worth doing if the first tray paint of a large drop
  actually feels slow on the target laptop.
- **Effort:** ~45 minutes.
- **Tags:** `performance`

### 18. Crop `tempCanvas` to the visible viewport in `renderPhotoOnCanvas`
- **Why:** `PhotoEditorApi.renderPhotoOnCanvas` builds its intermediate effect
  buffer at the whole SCALED image size, not the visible viewport. At zoom 3 the
  PDF path therefore asks pica to UPSCALE a 12 MP photo to 4800×3600 (lanczos3 +
  unsharp over 17 MP), then uploads and reads back ~69 MB through WebGL — while
  only 1600×1200 of it is ever drawn. This is the single largest remaining
  per-photo cost for both the screen editor and the PDF export now that effects
  moved to the GPU (WP2d). It is also what makes the new
  `MAX_TEXTURE_SIZE` guard fire on 4096-limit Intel/ANGLE machines, silently
  dropping those photos to the CPU path.
- **Action:** Crop the temp canvas to `canvas.width × canvas.height` at offset
  `(-x, -y)` before the resize/effects passes. Assert the drawn pixels are
  unchanged for a zoom-1 and a zoom-3 case.
- **Effort:** ~2–3 hours including a before/after User Timing measurement.
- **Tags:** `performance`, `memory`

### 19. Align the CPU render fallback with the WebGL shader
- **Why:** Since WP2d the PDF export renders through the same shader as the live
  preview, so print == preview — but only while WebGL is available. The CPU
  fallback in `PhotoEditorApi.tsx` is still a DIFFERENT implementation:
  temperature gain 1.5/unit vs the shader's 3.825, an INVERTED tint sign for
  negative tint, and a linear 3×3 sharpen kernel vs the shader's 5-tap
  quadratic-in-strength one. A machine without WebGL therefore still prints
  something the user never previewed.
- **Action:** Port the shader's arithmetic into the CPU path (or vice versa) and
  pin both with a numeric fixture test. While there, decide the fate of the CPU
  `auto` grey-world white balance: the shader has no `auto` uniform and the
  editor resolves `auto` into explicit temperature/tint on mount, so the CPU
  branch is the only place it still exists.
- **Effort:** ~3 hours.
- **Tags:** `correctness`, `rendering`

### 21. `types/index.ts` `ImageAdjustments` has no importer left
- **Why:** WP2d deleted `utils/imageProcessing.ts`'s dead `applyImageAdjustments`
  (a third divergent brightness/contrast implementation), which was the last
  consumer of the `ImageAdjustments` type in `src/types/index.ts`
  (brightness/contrast/scale). Note this is NOT the same type as the
  `ImageAdjustments` exported by `utils/webglUtils.ts`, which is live and
  carries the five shader uniforms — the duplicate name is itself the trap.
- **Action:** Delete the orphaned type, or rename one of the two so a future
  reader cannot import the wrong one.
- **Effort:** ~10 minutes.
- **Tags:** `types`, `cleanup`

---

## Resolved 2026-09

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

  **Resolved 2026-09 (WP2e bundle splitting).** Shared helpers live in
  `frontend/vite.chunks.ts`; both `vite.config.ts` files now carry a
  `manualChunks` rule table plus the `assertLazyOnly` build guard.

  Measured (Vite 7.3.2 / Rollup 4.59.0, `VITE_DESKTOP_BUILD=true`):

  - **photo-helper — the real win.** Eager JS **2,482 kB → 868 kB**
    (gzip **802 kB → 266 kB**): index 291 + vendor-react 197 + vendor-mui 344
    + vendor-pica 36. `@react-pdf/renderer` and its pdfkit/fontkit/crypto-js
    tree moved into an async `pdfGeneratorImpl-*.js` (1,600 kB, gzip 535 kB)
    fetched on first export, and driver.js into `driver.js-*.js` (21.5 kB) on
    first tour. That is ~1.6 MB of parse/compile + module evaluation removed
    from every launch — largest on the first launch after an install/upgrade,
    before V8's code cache is warm.
  - **map-corridors — NO meaningful first-load byte reduction** (2,521 →
    2,482 kB, **−1.7%**). `mapbox-gl` (1.70 MB) is required by the first
    screen: `App` renders `MapProviderView` unconditionally, so it cannot be
    deferred here. The gains are parallel compile of independent module
    scripts and vendor chunks whose hashes survive app-code releases. The map's
    startup cost (worker compile, `workerCount=2`) is the real map-corridors
    number and belongs to whichever WP owns its runtime — it is NOT a
    chunking problem.
  - CSS is deliberately excluded from `manualChunks`, so each app still emits a
    single `index-*.css` of exactly the baseline size (13,109 B / 45,235 B) and
    the cascade order cannot shift.

  **Do not "finish the job" by giving the PDF renderer its own manual chunk.**
  Rollup's `addStaticDependenciesToManualChunk` makes a manual chunk absorb the
  shared commonjs helper, which re-attaches the whole 1.6 MB tree to the entry —
  a green build that silently undoes the split. That trap is now a BUILD
  FAILURE (`assertLazyOnly` in `frontend/vite.chunks.ts`, unit-tested in
  `map-corridors/src/__tests__/viteChunks.test.ts`); the 500 kB warnings that
  remain on `vendor-map` and the async PDF chunk are expected, and
  `chunkSizeWarningLimit` must not be raised to hide them.

### 20. Let `renderPhotoOnCanvas` take resize options / `skipResizeCache`
- **Why:** The resize options are hard-coded inside `renderPhotoOnCanvas`, so
  the PDF export cannot ask for different sharpening or opt out of the resize
  cache directly — it has to wrap its whole render pass in
  `withResizeCacheSuspended` (a module-level counter) instead. That works, but
  it is action-at-a-distance for what should be one argument.
- **Action:** Add an optional options bag (resize options + `skipResizeCache`)
  and have `pdfGenerator` pass it, then drop the suspension wrapper if nothing
  else needs it.
- **Effort:** ~1 hour.
- **Tags:** `api`, `cleanup`

  **Resolved 2026-09 (per-call resize-cache bypass).** `renderPhotoOnCanvas`
  takes a 16th `skipResizeCache` argument that becomes
  `IntelligentResizeOptions.skipCache`; `pdfGeneratorImpl` passes `true` and the
  module-level `withResizeCacheSuspended` counter is gone. The sharpening
  options stay hard-coded — nothing asks for different ones yet. This also fixed
  a real defect the wrapper had: because the export now yields between photos,
  the process-wide suspension also disabled caching for any editor redraw the
  user triggered mid-export. Pinned by "a bypassing call does not disable
  caching for a CONCURRENT one" in `highQualityResize.test.ts`.

### 10. `React.memo` the photo canvases now that `handlePhotoUpdate` is stable
- **Why:** `AppApi.handlePhotoUpdate` became a `useCallback` with stable deps
  during the persistence work, and the editor's live preview moved into
  `PhotoEditorModalBody`. That removes the two reasons memoisation would not
  have held for `PhotoGridApi` / `CandidateTray` / `PhotoEditorApi` — but they
  are still unmemoised, and `AspectRatioContext.getCanvasSize` returns a fresh
  object on every render, which sits in `PhotoEditorApi`'s render deps and
  would defeat `React.memo` on its own.
- **Action:** Memoise `getCanvasSize`'s result in `AspectRatioContext`, then
  wrap the three components in `React.memo` and measure a grid redraw count
  before/after.
- **Effort:** ~1–2 hours including measurement.
- **Tags:** `performance`

  **Resolved 2026-09 (WP2b render memoization).** `AspectRatioContext` now
  memoizes its value and all three size helpers, `PhotoEditorApi`,
  `PhotoGridApi`, the new `PhotoGridSlot`/`PhotoGridSlotEmpty` and
  `CandidateThumb` are `React.memo`'d, the per-editor idle listeners collapsed
  into one `useUserActivity` store, and grid canvases size to their measured
  cell instead of a flat 600. Redraw counts are pinned by
  `PhotoEditorApi.redraw.test.tsx` and `PhotoGridApi.memo.test.tsx`. Residual
  work split out as items 12 and 13.


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

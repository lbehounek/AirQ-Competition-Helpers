# Changelog

All notable changes to the AirQ Competition Helpers desktop app are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file tracks the **Windows desktop bundle** (tagged `desktop-v*`). Sub-app
changes (Photo Helper, Map Corridors) reach end users only when bundled into a
new desktop release.

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

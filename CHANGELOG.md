# Changelog

All notable changes to the AirQ Competition Helpers desktop app are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file tracks the **Windows desktop bundle** (tagged `desktop-v*`). Sub-app
changes (Photo Helper, Map Corridors) reach end users only when bundled into a
new desktop release.

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

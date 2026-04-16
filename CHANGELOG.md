# Changelog

All notable changes to the AirQ Competition Helpers desktop app are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file tracks the **Windows desktop bundle** (tagged `desktop-v*`). Sub-app
changes (Photo Helper, Map Corridors) reach end users only when bundled into a
new desktop release.

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

/**
 * Single source of truth for marker dimensions across the three surfaces:
 * the live editor map, the printed/PNG map capture, and the KML export.
 *
 * Sizes were uniformly enlarged by ~50% (feedback 2026-05-10 — markers were
 * too small to read on a printed competition map and in Google Earth at
 * normal zoom). Tweak here, not at call sites.
 */

/* ──────────────────────────────────────────────────────────────────────
 *  Live on-screen map (MapProviderView.tsx)
 *  Pixel sizes for the small DOM markers placed at marker lat/lng.
 *  Previous values are left as a // comment so the +50% history is
 *  visible without a git blame round-trip.
 * ────────────────────────────────────────────────────────────────────── */
export const LIVE_MARKER_DOT_PX = 12             // was 8
export const LIVE_MARKER_DOT_BORDER_RADIUS_PX = 6 // was 4
export const LIVE_GROUND_MARKER_ICON_PX = 24     // was 16

/* ──────────────────────────────────────────────────────────────────────
 *  Printed / PNG map capture (mapCapture.ts)
 *  Multiplied by `scaleX` at use sites to match the print canvas size.
 * ────────────────────────────────────────────────────────────────────── */
export const PRINT_MARKER_DOT_RADIUS = 15        // was 10
export const PRINT_GROUND_ICON_SIZE = 60         // was 40

/* ──────────────────────────────────────────────────────────────────────
 *  KML export (kmlMerge.ts)
 *  Values written into <IconStyle><scale> in the exported KML so Google
 *  Earth / Maps render markers at a comparable size.
 * ────────────────────────────────────────────────────────────────────── */
export const KML_GROUND_MARKER_ICON_SCALE = 0.9  // was 0.6
export const KML_PHOTO_MARKER_ICON_SCALE = 1.65  // was 1.1

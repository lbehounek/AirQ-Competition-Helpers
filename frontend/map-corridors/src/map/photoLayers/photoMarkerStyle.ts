// Pure style derivation for the photo marker pins.
//
// Extracted verbatim from the inline JSX that used to live in
// MapProviderView's photo-marker loop. Two reasons it is its own module:
//
//  1. The colour/shadow rules are the only *logic* in that subtree, and they
//     are worth unit-testing without a map.
//  2. Every style object that carries no per-marker value becomes a
//     module-level constant with ONE identity for the app's lifetime. That
//     matters because react-map-gl's <Marker> applies `style` from a
//     `useEffect([style])`: a fresh object literal per render re-runs that
//     effect on every render of every pin.

import type { CSSProperties } from 'react'
import type { PhotoFlag, PhotoLabel } from '../../types/markers'
import { LIVE_MARKER_DOT_PX, LIVE_MARKER_HIT_PX } from '../../utils/markerSizes'

/**
 * Ring (border) colour for a photo pin.
 *
 * Yellow = "labelled, answer-sheet ready" — matches the KML marker colour so a
 * user scanning the map sees one consistent visual for "this is going on the
 * score sheet" regardless of origin. Unlabelled photos colour by flag.
 * Unflagged ("neutral") photos use a high-contrast amber instead of the old
 * grey (#616161), which was nearly invisible on both street and satellite
 * basemaps — feedback 2026-05-30 ("brown dots, invisible").
 *
 * Returns a CSS colour string; never null (an unflagged, unlabelled pin is amber).
 */
export function photoMarkerRingColor(input: { label?: PhotoLabel; flag?: PhotoFlag }): string {
  return input.label ? '#facc15'
    : input.flag === 'pick-track' ? '#1976d2'
    : input.flag === 'pick-turning' ? '#7b1fa2'
    : input.flag === 'reject' ? '#d32f2f'
    : '#fb8c00'
}

/**
 * Layered box-shadow halos for a photo pin: active = white + blue glow;
 * selected-for-compare = purple ring (distinct from the blue active glow, and
 * the two stack when a marker is both). Else the subtle moved-photo shadow.
 *
 * Returns the joined CSS `box-shadow` value, or the string `'none'` when no
 * clause applies — `'none'` (not `''`) so the property always resets cleanly.
 * Note the moved shadow is deliberately dropped while active or selected: the
 * bigger halos already imply depth and stacking all three looked muddy.
 */
export function photoMarkerBoxShadow(s: {
  isActive: boolean
  isSelected: boolean
  moved: boolean
}): string {
  return [
    s.isSelected ? '0 0 0 3px #ffffff, 0 0 0 5px #9c27b0' : null,
    s.isActive ? '0 0 0 3px rgba(255,255,255,0.9), 0 0 10px 4px rgba(25,118,210,0.65)' : null,
    !s.isActive && !s.isSelected && s.moved ? '0 1px 2px rgba(0,0,0,0.25)' : null,
  ].filter(Boolean).join(', ') || 'none'
}

/**
 * The full inline style for a pin's visible dot div.
 *
 * `moved` (subject coords ≠ EXIF capture coords) fills the dot solid in the
 * ring colour; an unmoved dot stays hollow white — the "awaiting placement" vs
 * "processed" cue. Active scales to 1.3, selected-only to 1.15; both animate
 * through the shared 120 ms transition.
 *
 * Returns a NEW object on every call (a plain style literal, as before); the
 * caller memoizes it on the four primitives that feed it.
 */
export function photoMarkerDotStyle(s: {
  moved: boolean
  ringColor: string
  isActive: boolean
  isSelected: boolean
}): CSSProperties {
  return {
    width: LIVE_MARKER_DOT_PX,
    height: LIVE_MARKER_DOT_PX,
    borderRadius: '50%',
    background: s.moved ? s.ringColor : '#ffffff',
    border: `2px solid ${s.ringColor}`,
    position: 'relative',
    boxShadow: photoMarkerBoxShadow(s),
    transform: s.isActive ? 'scale(1.3)' : s.isSelected ? 'scale(1.15)' : undefined,
    transition: 'transform 120ms ease, box-shadow 120ms ease',
    cursor: 'pointer',
  }
}

/* ──────────────────────────────────────────────────────────────────────
 *  Static style constants — ONE identity for the app's lifetime.
 *
 *  react-map-gl's <Marker> applies `style` inside a `useEffect([style])`, and
 *  its `applyReactStyle` helper returns early on a falsy style — it never
 *  RESETS keys it is not given. Two consequences encoded here:
 *
 *   • A fresh `{ zIndex: 2 }` literal per render would re-run that effect on
 *     every render; a shared constant makes the dep genuinely stable.
 *   • The un-raised case must stay `undefined` (never `{}`): today a pin that
 *     was once active keeps `zIndex: 2` in the DOM until unmount, and passing
 *     an empty object would not change that either — but passing `{ zIndex: 0 }`
 *     or similar WOULD change the stacking. Keep `undefined`; see PhotoMarkerPin.
 * ────────────────────────────────────────────────────────────────────── */

/** Raised above neighbouring pins — the active (popup open) or compare-selected pin. */
export const RAISED_MARKER_STYLE: CSSProperties = { zIndex: 2 }

/** The "Compare N" cluster pill sits above every pin, including a raised one. */
export const FAN_PILL_MARKER_STYLE: CSSProperties = { zIndex: 3 }

/** The pill's button chrome — purple, matching the pick-turning ring colour. */
export const FAN_PILL_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  height: 22,
  padding: '0 8px',
  borderRadius: 11,
  border: '1px solid #7b1fa2',
  background: '#9c27b0',
  color: '#ffffff',
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
  boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
  whiteSpace: 'nowrap',
}

/**
 * Transparent click/tap halo — enlarges the hit target a few px beyond the
 * visible dot so markers are easier to grab without making the dot itself huge
 * (feedback 2026-05-30). Absolutely positioned and centred on the dot, so it
 * affects neither layout nor the label offset.
 */
export const HIT_HALO_STYLE: CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: LIVE_MARKER_HIT_PX,
  height: LIVE_MARKER_HIT_PX,
  transform: 'translate(-50%, -50%)',
  borderRadius: '50%',
  background: 'transparent',
  cursor: 'pointer',
}

/** The A..T / 1..20 label chip rendered beside a labelled pin. */
export const PHOTO_LABEL_STYLE: CSSProperties = {
  position: 'absolute',
  transform: 'translate(10px, -6px)',
  background: 'rgba(255,255,255,0.85)',
  borderRadius: 4,
  padding: '1px 4px',
  fontSize: 14,
  lineHeight: '18px',
  fontWeight: 600,
  color: '#111',
  border: '1px solid #e5e7eb',
}

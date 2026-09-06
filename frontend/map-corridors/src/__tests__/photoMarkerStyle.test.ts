// Pins the photo-pin style rules that were extracted verbatim out of
// MapProviderView's inline JSX (WP2f). The map renders these values directly,
// so a drift here is a visual regression with no other guard.

import { describe, expect, it } from 'vitest'
import {
  FAN_PILL_BUTTON_STYLE,
  FAN_PILL_MARKER_STYLE,
  HIT_HALO_STYLE,
  PHOTO_LABEL_STYLE,
  RAISED_MARKER_STYLE,
  photoMarkerBoxShadow,
  photoMarkerDotStyle,
  photoMarkerRingColor,
} from '../map/photoLayers/photoMarkerStyle'
// Second import of the same module — used to prove the constants are shared
// references (module identity), not per-import copies.
import * as styleAgain from '../map/photoLayers/photoMarkerStyle'
import { LIVE_MARKER_DOT_PX, LIVE_MARKER_HIT_PX } from '../utils/markerSizes'

describe('photoMarkerRingColor', () => {
  it('returns answer-sheet yellow for a labelled pin regardless of flag', () => {
    expect(photoMarkerRingColor({ label: 'A' })).toBe('#facc15')
    expect(photoMarkerRingColor({ label: 'A', flag: 'reject' })).toBe('#facc15')
    expect(photoMarkerRingColor({ label: 'A', flag: 'pick-track' })).toBe('#facc15')
  })

  it('colours unlabelled pins by flag, amber when unflagged', () => {
    expect(photoMarkerRingColor({ flag: 'pick-track' })).toBe('#1976d2')
    expect(photoMarkerRingColor({ flag: 'pick-turning' })).toBe('#7b1fa2')
    expect(photoMarkerRingColor({ flag: 'reject' })).toBe('#d32f2f')
    expect(photoMarkerRingColor({})).toBe('#fb8c00')
  })
})

describe('photoMarkerBoxShadow', () => {
  it("returns the literal 'none' when no halo applies", () => {
    expect(photoMarkerBoxShadow({ isActive: false, isSelected: false, moved: false })).toBe('none')
  })

  it('renders only the subtle depth shadow for a moved-but-idle pin', () => {
    expect(photoMarkerBoxShadow({ isActive: false, isSelected: false, moved: true }))
      .toBe('0 1px 2px rgba(0,0,0,0.25)')
  })

  it('stacks the selected ring before the active glow and drops the moved shadow', () => {
    const shadow = photoMarkerBoxShadow({ isActive: true, isSelected: true, moved: true })
    expect(shadow).toBe(
      '0 0 0 3px #ffffff, 0 0 0 5px #9c27b0, 0 0 0 3px rgba(255,255,255,0.9), 0 0 10px 4px rgba(25,118,210,0.65)',
    )
    // The moved shadow must NOT appear once a halo is on it.
    expect(shadow).not.toContain('0 1px 2px rgba(0,0,0,0.25)')
  })
})

describe('photoMarkerDotStyle', () => {
  const base = { moved: false, ringColor: '#fb8c00', isActive: false, isSelected: false }

  it('fills solid in the ring colour when moved, hollow white otherwise', () => {
    expect(photoMarkerDotStyle(base).background).toBe('#ffffff')
    expect(photoMarkerDotStyle({ ...base, moved: true }).background).toBe('#fb8c00')
  })

  it('always borders in the ring colour at the shared dot size', () => {
    const s = photoMarkerDotStyle({ ...base, ringColor: '#1976d2' })
    expect(s.border).toBe('2px solid #1976d2')
    expect(s.width).toBe(LIVE_MARKER_DOT_PX)
    expect(s.height).toBe(LIVE_MARKER_DOT_PX)
    expect(s.borderRadius).toBe('50%')
    expect(s.transition).toBe('transform 120ms ease, box-shadow 120ms ease')
    expect(s.cursor).toBe('pointer')
  })

  it('scales up for active, less for selected-only, not at all when idle', () => {
    expect(photoMarkerDotStyle({ ...base, isActive: true }).transform).toBe('scale(1.3)')
    expect(photoMarkerDotStyle({ ...base, isSelected: true }).transform).toBe('scale(1.15)')
    // Active wins when a pin is both.
    expect(photoMarkerDotStyle({ ...base, isActive: true, isSelected: true }).transform).toBe('scale(1.3)')
    expect(photoMarkerDotStyle(base).transform).toBeUndefined()
  })

  it('returns a fresh object per call (the caller memoizes, not this helper)', () => {
    expect(photoMarkerDotStyle(base)).not.toBe(photoMarkerDotStyle(base))
    expect(photoMarkerDotStyle(base)).toEqual(photoMarkerDotStyle(base))
  })
})

describe('static style constants', () => {
  it('are shared module-level references (stable <Marker> style identity)', () => {
    // The whole point of hoisting them: react-map-gl re-applies `style` from a
    // useEffect keyed on identity, so a per-render literal would re-run it.
    expect(styleAgain.RAISED_MARKER_STYLE).toBe(RAISED_MARKER_STYLE)
    expect(styleAgain.FAN_PILL_MARKER_STYLE).toBe(FAN_PILL_MARKER_STYLE)
    expect(styleAgain.FAN_PILL_BUTTON_STYLE).toBe(FAN_PILL_BUTTON_STYLE)
    expect(styleAgain.HIT_HALO_STYLE).toBe(HIT_HALO_STYLE)
    expect(styleAgain.PHOTO_LABEL_STYLE).toBe(PHOTO_LABEL_STYLE)
  })

  it('carry the exact literals copied out of MapProviderView', () => {
    expect(RAISED_MARKER_STYLE).toEqual({ zIndex: 2 })
    expect(FAN_PILL_MARKER_STYLE).toEqual({ zIndex: 3 })
    expect(FAN_PILL_BUTTON_STYLE).toEqual({
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
    })
    expect(HIT_HALO_STYLE).toEqual({
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: LIVE_MARKER_HIT_PX,
      height: LIVE_MARKER_HIT_PX,
      transform: 'translate(-50%, -50%)',
      borderRadius: '50%',
      background: 'transparent',
      cursor: 'pointer',
    })
    expect(PHOTO_LABEL_STYLE).toEqual({
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
    })
  })
})

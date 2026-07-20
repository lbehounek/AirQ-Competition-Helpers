import { describe, it, expect, vi } from 'vitest'
import { interpretMapKey, applyMapKeyAction } from '../map/keyboardNav'
import type { MapCamera, MapKeyAction } from '../map/keyboardNav'

// ---------------------------------------------------------------------------
// interpretMapKey — the Google-Earth key map (see keyboardNav.ts header)
// ---------------------------------------------------------------------------
describe('interpretMapKey', () => {
  const key = (k: string, shift = false) => interpretMapKey({ key: k, shiftKey: shift })

  it('plain arrows pan by 100px in screen space', () => {
    expect(key('ArrowUp')).toEqual({ type: 'pan', dx: 0, dy: -100 })
    expect(key('ArrowDown')).toEqual({ type: 'pan', dx: 0, dy: 100 })
    expect(key('ArrowLeft')).toEqual({ type: 'pan', dx: -100, dy: 0 })
    expect(key('ArrowRight')).toEqual({ type: 'pan', dx: 100, dy: 0 })
  })

  it('shift+left/right rotates bearing by 15° (ccw / cw)', () => {
    expect(key('ArrowLeft', true)).toEqual({ type: 'rotate', delta: -15 })
    expect(key('ArrowRight', true)).toEqual({ type: 'rotate', delta: 15 })
  })

  it('shift+up/down tilts pitch by 10°', () => {
    expect(key('ArrowUp', true)).toEqual({ type: 'pitch', delta: 10 })
    expect(key('ArrowDown', true)).toEqual({ type: 'pitch', delta: -10 })
  })

  it('PageUp/PageDown zoom by one level', () => {
    expect(key('PageUp')).toEqual({ type: 'zoom', delta: 1 })
    expect(key('PageDown')).toEqual({ type: 'zoom', delta: -1 })
  })

  it('+/− zoom, including the unshifted =/_ variants', () => {
    expect(key('+')).toEqual({ type: 'zoom', delta: 1 })
    expect(key('=')).toEqual({ type: 'zoom', delta: 1 })
    expect(key('-')).toEqual({ type: 'zoom', delta: -1 })
    expect(key('_')).toEqual({ type: 'zoom', delta: -1 })
  })

  it('n/u/r map to north, top-down, reset (case-insensitive)', () => {
    expect(key('n')).toEqual({ type: 'north' })
    expect(key('N')).toEqual({ type: 'north' })
    expect(key('u')).toEqual({ type: 'topDown' })
    expect(key('U')).toEqual({ type: 'topDown' })
    expect(key('r')).toEqual({ type: 'reset' })
    expect(key('R')).toEqual({ type: 'reset' })
  })

  it('returns null for keys that are not ours (caller must not preventDefault)', () => {
    for (const k of ['a', 'Escape', 'Enter', ' ', 'Tab', 'Home', 'End', '1', 'F5']) {
      expect(key(k)).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// applyMapKeyAction — camera calls, relative to the current camera state
// ---------------------------------------------------------------------------
describe('applyMapKeyAction', () => {
  const makeCamera = (state = { zoom: 10, bearing: 30, pitch: 20 }): MapCamera => ({
    panBy: vi.fn(),
    easeTo: vi.fn(),
    getZoom: () => state.zoom,
    getBearing: () => state.bearing,
    getPitch: () => state.pitch,
  })

  const apply = (action: MapKeyAction, cam = makeCamera()) => {
    applyMapKeyAction(cam, action)
    return cam
  }

  it('pan calls panBy with the pixel offset', () => {
    const cam = apply({ type: 'pan', dx: 100, dy: 0 })
    expect(cam.panBy).toHaveBeenCalledWith([100, 0], { duration: 100 })
    expect(cam.easeTo).not.toHaveBeenCalled()
  })

  it('zoom eases relative to the current zoom', () => {
    const cam = apply({ type: 'zoom', delta: 1 })
    expect(cam.easeTo).toHaveBeenCalledWith({ zoom: 11, duration: 300 })
  })

  it('rotate eases relative to the current bearing', () => {
    const cam = apply({ type: 'rotate', delta: -15 })
    expect(cam.easeTo).toHaveBeenCalledWith({ bearing: 15, duration: 300 })
  })

  it('pitch eases relative to the current pitch (easeTo clamps out-of-range)', () => {
    const cam = apply({ type: 'pitch', delta: 10 })
    expect(cam.easeTo).toHaveBeenCalledWith({ pitch: 30, duration: 300 })
  })

  it('north/topDown/reset ease to absolute targets', () => {
    expect(apply({ type: 'north' }).easeTo).toHaveBeenCalledWith({ bearing: 0, duration: 400 })
    expect(apply({ type: 'topDown' }).easeTo).toHaveBeenCalledWith({ pitch: 0, duration: 400 })
    expect(apply({ type: 'reset' }).easeTo).toHaveBeenCalledWith({ bearing: 0, pitch: 0, duration: 400 })
  })
})

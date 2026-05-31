import { describe, it, expect } from 'vitest'
import { resolveFanOffset } from '../map/photoLayers/markerOffset'

// Regression guard for the "placed photo drifts off the map on zoom-out" bug:
// the react-mapbox <Marker>/<Popup> wrappers ignore a falsy `offset` prop, so
// an un-fanned marker must be handed an explicit [0,0] — never undefined — or it
// stays stuck at its last fan offset. See markerOffset.ts for the full why.
describe('resolveFanOffset', () => {
  it('returns [0,0] (never undefined) when the marker has no fan offset', () => {
    const result = resolveFanOffset(undefined)
    expect(result).toEqual([0, 0])
    // The exact contract that fixes the bug: the value must be truthy so the
    // wrapper's `if (offset && …)` guard runs `setOffset` and clears a stale one.
    expect(result).not.toBeUndefined()
  })

  it('passes a real fan offset through unchanged', () => {
    expect(resolveFanOffset([16, -8])).toEqual([16, -8])
  })

  it('preserves a zero-valued fan offset as a concrete [0,0]', () => {
    expect(resolveFanOffset([0, 0])).toEqual([0, 0])
  })

  it('returns a fresh tuple, not the caller-supplied reference', () => {
    // Defensive: the marker reads from a Map it does not own; returning a copy
    // keeps the offset immutable from the <Marker>'s perspective.
    const input: [number, number] = [3, 4]
    const out = resolveFanOffset(input)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
  })
})

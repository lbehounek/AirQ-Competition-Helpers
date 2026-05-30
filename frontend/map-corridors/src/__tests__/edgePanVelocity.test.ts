import { describe, it, expect } from 'vitest'
import { edgeVelocity, EDGE_ZONE_PX, MAX_PAN_PX_PER_FRAME } from '../map/useEdgePanDrag'

// Pure screen-space ramp that drives auto-pan when a dragged marker's cursor
// nears a viewport edge. `px` is the cursor offset along one axis; `size` is
// that axis' viewport length. Sign: negative = pan toward the low edge
// (left/top), positive = high edge (right/bottom).

const SIZE = 1000

describe('edgeVelocity', () => {
  it('is zero in the dead zone away from both edges', () => {
    expect(edgeVelocity(SIZE / 2, SIZE)).toBe(0)
    expect(edgeVelocity(EDGE_ZONE_PX, SIZE)).toBe(0) // exactly at the zone boundary
    expect(edgeVelocity(SIZE - EDGE_ZONE_PX, SIZE)).toBe(0)
  })

  it('pans toward the low edge (negative) inside the leading zone', () => {
    expect(edgeVelocity(EDGE_ZONE_PX - 1, SIZE)).toBeLessThan(0)
    expect(edgeVelocity(0, SIZE)).toBe(-MAX_PAN_PX_PER_FRAME) // at the very edge → full speed
  })

  it('pans toward the high edge (positive) inside the trailing zone', () => {
    expect(edgeVelocity(SIZE - EDGE_ZONE_PX + 1, SIZE)).toBeGreaterThan(0)
    expect(edgeVelocity(SIZE, SIZE)).toBe(MAX_PAN_PX_PER_FRAME)
  })

  it('clamps to full speed past the edge (cursor dragged off-screen)', () => {
    expect(edgeVelocity(-200, SIZE)).toBe(-MAX_PAN_PX_PER_FRAME)
    expect(edgeVelocity(SIZE + 200, SIZE)).toBe(MAX_PAN_PX_PER_FRAME)
  })

  it('eases quadratically — slower just inside the zone than near the edge', () => {
    const justInside = Math.abs(edgeVelocity(EDGE_ZONE_PX - 4, SIZE))
    const nearEdge = Math.abs(edgeVelocity(4, SIZE))
    expect(justInside).toBeLessThan(nearEdge)
    // Quadratic ease: halfway into the zone yields a quarter of max speed.
    expect(Math.abs(edgeVelocity(EDGE_ZONE_PX / 2, SIZE))).toBeCloseTo(MAX_PAN_PX_PER_FRAME * 0.25, 5)
  })
})

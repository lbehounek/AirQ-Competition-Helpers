// Regression test for the bug #6 fix (2.26.2): the marker-fan recompute must
// subscribe to the per-frame `zoom` event — not only the `moveend`/`zoomend`
// settle events — so a fanned dot's screen-pixel offset stays valid *during* a
// continuous zoom instead of drifting until the gesture settles. It must also
// unsubscribe every listener it added on unmount (no leak). The pure projection
// boundary (`buildMarkerFan`) is covered separately in `useMarkerFan.test.ts`;
// this file pins the effect's event wiring, which had no coverage.

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RefObject } from 'react'
import type { MapRef } from 'react-map-gl/mapbox'
import { useMarkerFan } from './useMarkerFan'

function fakeMapRef() {
  const on = vi.fn()
  const off = vi.fn()
  const map = { on, off }
  // Only `getMap().on/off` are exercised here: with `markers: undefined` the
  // projection memo returns EMPTY without ever calling project/unproject, so a
  // minimal fake map is enough.
  const ref = { current: { getMap: () => map } } as unknown as RefObject<MapRef | null>
  return { ref, on, off }
}

describe('useMarkerFan — viewport event subscriptions', () => {
  it('subscribes to the per-frame `zoom` event plus the settle events', () => {
    const { ref, on } = fakeMapRef()
    renderHook(() =>
      useMarkerFan({ mapRef: ref, isMapLoaded: true, markers: undefined, draggingMarkerId: null }),
    )
    const events = on.mock.calls.map((c) => c[0])
    expect(events).toContain('zoom') // the bug #6 fix — keeps fanned dots anchored mid-zoom
    expect(events).toContain('moveend')
    expect(events).toContain('zoomend')
  })

  it('unsubscribes every listener it added on unmount (no leak)', () => {
    const { ref, on, off } = fakeMapRef()
    const { unmount } = renderHook(() =>
      useMarkerFan({ mapRef: ref, isMapLoaded: true, markers: undefined, draggingMarkerId: null }),
    )
    unmount()
    // Symmetry: every (event, handler) pair handed to on() is handed to off()
    // with the SAME handler reference, not merely the same event name.
    for (const call of on.mock.calls) {
      expect(off.mock.calls).toContainEqual(call)
    }
    const offEvents = off.mock.calls.map((c) => c[0])
    expect(offEvents).toContain('zoom')
    expect(offEvents).toContain('moveend')
    expect(offEvents).toContain('zoomend')
  })
})

// Regression test for the bug #6 fix (2.26.2): the marker-fan recompute must
// subscribe to the per-frame `zoom` event — not only the `moveend`/`zoomend`
// settle events — so a fanned dot's screen-pixel offset stays valid *during* a
// continuous zoom instead of drifting until the gesture settles. It must also
// unsubscribe every listener it added on unmount (no leak). The pure projection
// boundary (`buildMarkerFan`) is covered separately in `useMarkerFan.test.ts`;
// this file pins the effect's event wiring, which had no coverage.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RefObject } from 'react'
import type { MapRef } from 'react-map-gl/mapbox'
import type { PhotoMarker } from '../../types/markers'
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

// ─────────────────────────────────────────────────────────────────────────
// WP2f — the per-frame `zoom` recompute is now gated on "a fan currently
// exists". These cases pin both halves of that: the bug #6 invariant (fanned
// dots still re-project every frame) and the new skip (no fan → no work).
// ─────────────────────────────────────────────────────────────────────────

/**
 * A fake map whose projection is switchable mid-test. `overlapping` decides
 * whether the two markers land on the same pixel (→ they fan) or 500 px apart
 * (→ no fan, the clusterer's default threshold is 20 px). Returns the fake plus
 * the `on`/`off` spies and a setter so a test can dissolve a fan mid-gesture.
 */
function projectingMapRef(overlapping: boolean) {
  const on = vi.fn()
  const off = vi.fn()
  let overlap = overlapping
  const map = {
    on,
    off,
    project: ([lng]: [number, number]) => (overlap ? { x: 100, y: 100 } : { x: lng * 500, y: 100 }),
    // Any finite inverse is fine — leader endpoints and cluster centroids are
    // not what these cases assert.
    unproject: ([x, y]: [number, number]) => ({ lng: x / 100, lat: y / 100 }),
  }
  const ref = { current: { getMap: () => map } } as unknown as RefObject<MapRef | null>
  return { ref, on, off, setOverlapping: (v: boolean) => { overlap = v } }
}

const FAN_MARKERS: readonly PhotoMarker[] = [
  { id: 'a', lng: 1, lat: 0, name: 'a.jpg', photoId: 'pa' },
  { id: 'b', lng: 2, lat: 0, name: 'b.jpg', photoId: 'pb' },
]

/** The handler the hook registered for `event` (the same reference it hands to `off`). */
function handlerFor(on: ReturnType<typeof vi.fn>, event: string): () => void {
  const call = on.mock.calls.find((c) => c[0] === event)
  if (!call) throw new Error(`no handler registered for '${event}'`)
  return call[1] as () => void
}

/** Render the hook, counting renders — the proxy for "did the fan recompute". */
function renderFan(
  ref: RefObject<MapRef | null>,
  markers: readonly PhotoMarker[],
  draggingMarkerId: string | null = null,
) {
  let renders = 0
  const hook = renderHook(() => {
    renders++
    return useMarkerFan({ mapRef: ref, isMapLoaded: true, markers, draggingMarkerId })
  })
  return { hook, renders: () => renders }
}

describe('useMarkerFan — per-frame zoom recompute is gated on an existing fan', () => {
  it('skips the per-frame recompute when nothing is fanned, but still recomputes on settle', () => {
    const { ref, on } = projectingMapRef(false)
    const { hook, renders } = renderFan(ref, FAN_MARKERS)
    // Mount + the effect's initial bump.
    expect(renders()).toBe(2)
    expect(hook.result.current.offsets.size).toBe(0)

    act(() => { handlerFor(on, 'zoom')() })
    expect(renders()).toBe(2) // gate closed — no work while nothing overlaps

    act(() => { handlerFor(on, 'zoomend')() })
    expect(renders()).toBe(3) // settle events always recompute
  })

  it('keeps re-projecting every frame while a fan exists (bug #6 invariant)', () => {
    const { ref, on } = projectingMapRef(true)
    const { hook, renders } = renderFan(ref, FAN_MARKERS)
    expect(hook.result.current.offsets.size).toBe(2)
    const before = renders()

    act(() => { handlerFor(on, 'zoom')() })
    expect(renders()).toBe(before + 1)
  })

  it('lets a fan dissolve mid-zoom-in, then closes the gate', () => {
    const { ref, on, setOverlapping } = projectingMapRef(true)
    const { hook, renders } = renderFan(ref, FAN_MARKERS)
    expect(hook.result.current.offsets.size).toBe(2)

    setOverlapping(false)
    act(() => { handlerFor(on, 'zoom')() })
    expect(hook.result.current.offsets.size).toBe(0)
    const afterDissolve = renders()

    // Gate now closed: further frames of the same gesture cost nothing…
    act(() => { handlerFor(on, 'zoom')() })
    expect(renders()).toBe(afterDissolve)
    // …but the settle at the end of the gesture still recomputes.
    act(() => { handlerFor(on, 'zoomend')() })
    expect(renders()).toBe(afterDissolve + 1)
  })

  it('still suppresses every recompute while a marker is being dragged', () => {
    const { ref, on } = projectingMapRef(true)
    const { renders } = renderFan(ref, FAN_MARKERS, 'a')
    const before = renders()
    act(() => { handlerFor(on, 'zoomend')() })
    expect(renders()).toBe(before)
  })

  it('batches a moveend+zoomend pair into ONE render (why no rAF coalescing is needed)', () => {
    // mapbox fires these two in a single call stack on gesture end; React 19
    // batches both setState calls, so a requestAnimationFrame wrapper would buy
    // nothing and would cost a frame of lag on the per-frame path.
    const { ref, on } = projectingMapRef(true)
    const { renders } = renderFan(ref, FAN_MARKERS)
    const before = renders()
    act(() => {
      handlerFor(on, 'moveend')()
      handlerFor(on, 'zoomend')()
    })
    expect(renders()).toBe(before + 1)
  })
})

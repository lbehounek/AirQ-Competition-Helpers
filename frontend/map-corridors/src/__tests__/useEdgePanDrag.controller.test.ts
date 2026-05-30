import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import type { MapRef } from 'react-map-gl/mapbox'
import { createEdgePanController, type DragHandleConfig } from '../map/useEdgePanDrag'

// Behavioral tests for the drag state machine inside createEdgePanController —
// the part that decides what coordinates get written to a competition marker
// (commit) vs. treated as a tap (click), and that cancel paths NEVER commit.
// The pure ramp (edgeVelocity) is covered separately in edgePanVelocity.test.ts.
//
// The controller consumes only a structural slice of a mapbox map, so a tiny
// fake drives it deterministically. World/screen model: world = screenPx + pan.
//   project([lng,lat]) → { x: lng - pan.x, y: lat - pan.y }
//   unproject([x,y])   → { lng: x + pan.x, lat: y + pan.y }
//   panBy([dx,dy])     → pan += [dx,dy]
// Canvas is a fixed 1000×1000 at viewport origin (0,0), so screen px == world
// coords while pan is zero.

function makeFakeMap() {
  const pan = { x: 0, y: 0 }
  const calls = { panBy: 0 }
  const map = {
    getCanvas: () => ({
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    }),
    project: ([lng, lat]: [number, number]) => ({ x: lng - pan.x, y: lat - pan.y }),
    unproject: ([x, y]: [number, number]) => ({ lng: x + pan.x, lat: y + pan.y }),
    panBy: ([dx, dy]: [number, number]) => { pan.x += dx; pan.y += dy; calls.panBy++ },
  }
  return { map, pan, calls }
}

// Manual requestAnimationFrame pump: tick() re-schedules itself, so each
// flush() drains the queued callbacks captured so far (the new one a tick
// schedules runs on the next flush).
let rafQueue: Array<FrameRequestCallback>
function flush(n = 1) {
  for (let i = 0; i < n; i++) {
    const batch = rafQueue
    rafQueue = []
    batch.forEach(cb => cb(0))
  }
}

function pointerEvent(over: Record<string, unknown>) {
  return { pointerId: 1, button: 0, isPrimary: true, clientX: 0, clientY: 0, ...over } as unknown as PointerEvent
}

function dispatch(type: string, props: Record<string, unknown> = {}) {
  const e = new Event(type)
  Object.assign(e, props)
  window.dispatchEvent(e)
}

beforeEach(() => {
  rafQueue = []
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafQueue.push(cb); return ++id })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Harness = {
  controller: ReturnType<typeof createEdgePanController>
  active: Array<{ id: string; lng: number; lat: number } | null>
  onCommit: Mock<(lng: number, lat: number) => void>
  onClick: Mock<() => void>
  fake: ReturnType<typeof makeFakeMap>
  startAt: (cx: number, cy: number, anchor?: { lng: number; lat: number }) => void
}

function setup(extraCfg: Partial<DragHandleConfig> = {}): Harness {
  const fake = makeFakeMap()
  const mapRef = { current: { getMap: () => fake.map } } as unknown as React.RefObject<MapRef | null>
  const active: Harness['active'] = []
  const controller = createEdgePanController(mapRef, d => active.push(d))
  // Typed mocks so they satisfy DragHandleConfig's onCommit/onClick under tsc.
  const onCommit = vi.fn<(lng: number, lat: number) => void>()
  const onClick = vi.fn<() => void>()
  const startAt: Harness['startAt'] = (cx, cy, anchor = { lng: cx, lat: cy }) => {
    controller.startDrag(pointerEvent({ clientX: cx, clientY: cy }), {
      id: 'm1', lng: anchor.lng, lat: anchor.lat, onCommit, onClick, ...extraCfg,
    })
  }
  return { controller, active, onCommit, onClick, fake, startAt }
}

const lastActive = (h: Harness) => h.active[h.active.length - 1]

describe('createEdgePanController — commit vs click', () => {
  it('treats a sub-threshold gesture as a click: onClick fires, onCommit does not', () => {
    const h = setup()
    h.startAt(500, 500)
    dispatch('pointermove', { pointerId: 1, clientX: 503, clientY: 502 }) // ~3.6px < 8
    dispatch('pointerup', { pointerId: 1 })
    expect(h.onClick).toHaveBeenCalledTimes(1)
    expect(h.onCommit).not.toHaveBeenCalled()
    expect(lastActive(h)).toBeNull() // override dropped on end
  })

  it('does NOT move the dot during a sub-threshold tap', () => {
    const h = setup()
    h.startAt(500, 500)
    const beforeMove = h.active.length // only the start publish so far
    dispatch('pointermove', { pointerId: 1, clientX: 504, clientY: 500 }) // 4px < 8
    // No new override published while still below the click threshold.
    expect(h.active.length).toBe(beforeMove)
  })

  it('treats a supra-threshold gesture as a drag and commits the cursor-derived coords', () => {
    const h = setup()
    h.startAt(500, 500) // anchor at 500,500; grab offset 0
    dispatch('pointermove', { pointerId: 1, clientX: 600, clientY: 540 }) // 100px > 8
    dispatch('pointerup', { pointerId: 1 })
    expect(h.onClick).not.toHaveBeenCalled()
    expect(h.onCommit).toHaveBeenCalledTimes(1)
    expect(h.onCommit).toHaveBeenCalledWith(600, 540) // pan still zero → screen==world
    expect(lastActive(h)).toBeNull()
  })

  it('respects the grab offset so the grab point stays under the cursor', () => {
    const h = setup()
    // Grab 20px to the right / 10px below the marker's true anchor (485,490).
    h.startAt(505, 500, { lng: 485, lat: 490 })
    dispatch('pointermove', { pointerId: 1, clientX: 605, clientY: 600 })
    dispatch('pointerup', { pointerId: 1 })
    // Cursor moved by (+100,+100); the anchor should move by the same delta:
    // 485+100=585, 490+100=590 — NOT the raw cursor position (605,600).
    expect(h.onCommit).toHaveBeenCalledWith(585, 590)
  })
})

describe('createEdgePanController — cancel paths never commit', () => {
  it('Escape mid-drag cancels: no commit, no click, override dropped', () => {
    const h = setup()
    h.startAt(500, 500)
    dispatch('pointermove', { pointerId: 1, clientX: 600, clientY: 500 }) // real move
    dispatch('keydown', { key: 'Escape' })
    expect(h.onCommit).not.toHaveBeenCalled()
    expect(h.onClick).not.toHaveBeenCalled()
    expect(lastActive(h)).toBeNull()
    // A subsequent pointerup must be a no-op (drag already torn down).
    dispatch('pointerup', { pointerId: 1 })
    expect(h.onCommit).not.toHaveBeenCalled()
  })

  it('ignores non-Escape keys', () => {
    const h = setup()
    h.startAt(500, 500)
    dispatch('pointermove', { pointerId: 1, clientX: 600, clientY: 500 })
    dispatch('keydown', { key: 'a' })
    dispatch('pointerup', { pointerId: 1 })
    expect(h.onCommit).toHaveBeenCalledTimes(1) // drag survived the keypress
  })

  it('window blur cancels without committing', () => {
    const h = setup()
    h.startAt(500, 500)
    dispatch('pointermove', { pointerId: 1, clientX: 600, clientY: 500 })
    dispatch('blur')
    expect(h.onCommit).not.toHaveBeenCalled()
    expect(lastActive(h)).toBeNull()
  })

  it('pointercancel cancels without committing', () => {
    const h = setup()
    h.startAt(500, 500)
    dispatch('pointermove', { pointerId: 1, clientX: 600, clientY: 500 })
    dispatch('pointercancel', { pointerId: 1 })
    expect(h.onCommit).not.toHaveBeenCalled()
    expect(lastActive(h)).toBeNull()
  })
})

describe('createEdgePanController — multi-pointer guard', () => {
  it('ignores moves/ups from a different pointerId', () => {
    const h = setup()
    h.startAt(500, 500)
    dispatch('pointermove', { pointerId: 1, clientX: 600, clientY: 500 }) // real move on primary
    dispatch('pointerup', { pointerId: 2 }) // secondary finger lifts — must be ignored
    expect(h.onCommit).not.toHaveBeenCalled()
    dispatch('pointerup', { pointerId: 1 }) // primary lifts — now commit
    expect(h.onCommit).toHaveBeenCalledTimes(1)
  })
})

describe('createEdgePanController — edge auto-pan', () => {
  it('pans every frame while held in an edge zone and keeps committing past the cursor', () => {
    const h = setup()
    h.startAt(500, 500)
    // Drag the cursor into the left edge zone (x=10 < EDGE_ZONE_PX=64) and hold.
    dispatch('pointermove', { pointerId: 1, clientX: 10, clientY: 500 })
    expect(h.fake.calls.panBy).toBe(0) // pan happens in the RAF loop, not on move
    flush(3) // three animation frames
    expect(h.fake.calls.panBy).toBe(3)
    // Each frame pans toward the low edge (negative vx) and re-derives lng from
    // the stationary cursor, so the committed lng drifts west of the cursor's
    // at-rest unprojection (10).
    dispatch('pointerup', { pointerId: 1 })
    expect(h.onCommit).toHaveBeenCalledTimes(1)
    const [lng] = h.onCommit.mock.calls[0]
    expect(lng).toBeLessThan(10)
    expect(h.onClick).not.toHaveBeenCalled()
  })

  it('does NOT auto-pan on a sub-threshold grab inside the edge zone (still a tap)', () => {
    const h = setup()
    h.startAt(30, 500) // grab already inside the left edge zone (x < 64)
    dispatch('pointermove', { pointerId: 1, clientX: 28, clientY: 500 }) // 2px < 8
    flush(2)
    // Being near the edge is not enough — the gesture must first qualify as a
    // drag (cross the 8px threshold) before the auto-pan loop is armed.
    expect(h.fake.calls.panBy).toBe(0)
    dispatch('pointerup', { pointerId: 1 })
    expect(h.onClick).toHaveBeenCalledTimes(1)
    expect(h.onCommit).not.toHaveBeenCalled()
  })

  it('stops the loop when the cursor leaves the edge zone and restarts on re-entry', () => {
    const h = setup()
    h.startAt(500, 500)
    dispatch('pointermove', { pointerId: 1, clientX: 10, clientY: 500 }) // into edge
    flush(1)
    const afterEntry = h.fake.calls.panBy
    expect(afterEntry).toBeGreaterThan(0)
    dispatch('pointermove', { pointerId: 1, clientX: 500, clientY: 500 }) // back to center → velocity 0
    flush(2) // the in-flight frame idles out; no new frames scheduled
    const afterLeave = h.fake.calls.panBy
    dispatch('pointermove', { pointerId: 1, clientX: 990, clientY: 500 }) // into right edge
    flush(1)
    expect(h.fake.calls.panBy).toBeGreaterThan(afterLeave) // restarted
    dispatch('pointerup', { pointerId: 1 })
  })
})

describe('createEdgePanController — re-entrant startDrag', () => {
  it('a second startDrag cancels the first without committing it', () => {
    const h = setup()
    h.startAt(500, 500)
    dispatch('pointermove', { pointerId: 1, clientX: 600, clientY: 500 }) // first drag moved
    // New grab before the first lifted (e.g. a stray second pointerdown).
    h.controller.startDrag(pointerEvent({ clientX: 200, clientY: 200, pointerId: 9 }), {
      id: 'm2', lng: 200, lat: 200, onCommit: h.onCommit, onClick: h.onClick,
    })
    // First drag must NOT have committed.
    expect(h.onCommit).not.toHaveBeenCalled()
    // The old pointerId no longer controls anything; only the new one does.
    dispatch('pointerup', { pointerId: 1 })
    expect(h.onCommit).not.toHaveBeenCalled() // stale pointer ignored
    dispatch('pointermove', { pointerId: 9, clientX: 300, clientY: 300 })
    dispatch('pointerup', { pointerId: 9 })
    expect(h.onCommit).toHaveBeenCalledTimes(1)
    expect(h.onCommit).toHaveBeenCalledWith(300, 300)
  })
})

/**
 * End-to-end guard for the crash the user actually saw: "when i zoom in map
 * disappears", with
 *
 *   TypeError: undefined is not an object (evaluating 'e.center')
 *
 * thrown from inside maplibre's own event dispatch
 * (resize -> stop -> _stop -> stop -> _fireEvents -> _fireEvent -> fire).
 *
 * This mounts the REAL react-map-gl <Map> and drives a REAL camera event
 * through it. The renderer is injected via the supported `mapLib` prop with a
 * stub shaped exactly like maplibre-gl v6 — discrete getters, a
 * `setTransformCameraUpdate` METHOD, and crucially NO `transform` property,
 * which is what v6 removed and what @vis.gl/react-maplibre 8.1.0 blindly read.
 *
 * Injecting a stub is not a shortcut: real maplibre needs WebGL, which jsdom
 * has not got. The stub reproduces the only thing that mattered — the shape of
 * the map object the wrapper introspects.
 *
 * Against the 8.1.0 wrapper this test throws; against 8.1.3 it passes and
 * `onMove` receives a populated viewState, which is what MapProviderView reads
 * for the compass bearing.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
// Import the MAPLIBRE entry explicitly. The app's source says
// `react-map-gl/mapbox` and vite.config rewrites it to `/maplibre` for the web
// build — but vitest.config SHADOWS vite.config, so that alias does not apply
// under test. Importing the mapbox entry here would silently exercise the
// wrapper the desktop build uses and prove nothing about the bug.
import MapGL from 'react-map-gl/maplibre'

type Listener = (e: unknown) => void

/** Every stub map constructed during a test, newest last. */
const constructed: V6ShapedMap[] = []

/** A maplibre-gl v6 shaped map: getters only, no `transform`. */
class V6ShapedMap {
  private listeners = new Map<string, Listener[]>()
  private center = { lng: 14.42076, lat: 50.08804 }
  private zoom = 6
  cameraUpdate: unknown = null

  constructor(options: Record<string, unknown>) {
    if (Array.isArray(options.center)) {
      this.center = { lng: Number(options.center[0]), lat: Number(options.center[1]) }
    }
    if (typeof options.zoom === 'number') this.zoom = options.zoom
    constructed.push(this)
  }

  // --- the v6 camera-update hook: a METHOD, not a writable property.
  setTransformCameraUpdate(fn: unknown) { this.cameraUpdate = fn }

  // --- discrete getters that replaced `map.transform` in v6
  getCenter() { return this.center }
  getZoom() { return this.zoom }
  getBearing() { return 0 }
  getPitch() { return 0 }
  getPadding() { return { top: 0, bottom: 0, left: 0, right: 0 } }
  getCenterElevation() { return 0 }

  // --- minimal Evented surface
  on(type: string, cb: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]); return this }
  off(type: string, cb: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== cb)); return this
  }
  once(type: string, cb: Listener) { return this.on(type, cb) }
  fire(type: string, e: Record<string, unknown> = {}) {
    for (const cb of this.listeners.get(type) ?? []) cb({ type, target: this, ...e })
    return this
  }

  // --- surface the wrapper touches during setup / teardown
  getCanvas() { return document.createElement('canvas') }
  getContainer() { return document.createElement('div') }
  getStyle() { return { layers: [], sources: {} } }
  isStyleLoaded() { return true }
  getLight() { return undefined }
  getSky() { return undefined }
  getTerrain() { return null }
  getProjection() { return undefined }
  setPadding() { return this }
  resize() { return this }
  remove() { return this }
  addControl() { return this }
  removeControl() { return this }
  triggerRepaint() { return this }
}

beforeEach(() => { constructed.length = 0 })
afterEach(cleanup)

describe('a camera event on a maplibre-v6-shaped renderer', () => {
  it('uses a stub that genuinely lacks `transform`, like maplibre v6', () => {
    const stub = new V6ShapedMap({})
    expect('transform' in stub).toBe(false)
    expect(typeof stub.setTransformCameraUpdate).toBe('function')
  })

  it('does not throw, and delivers a populated viewState to onMove', async () => {
    // Any throw inside the wrapper's event handler would surface here rather
    // than being swallowed, which is exactly how it reached the user's console.
    const onMove = vi.fn()
    const onError = vi.fn()

    render(
      <MapGL
        mapLib={{ Map: V6ShapedMap } as never}
        initialViewState={{ longitude: 14.42076, latitude: 50.08804, zoom: 6 }}
        style={{ width: 400, height: 300 }}
        onMove={onMove}
        onError={onError}
      />,
    )

    // The wrapper attaches its listeners asynchronously (it awaits mapLib),
    // so wait until the map exists and the camera hook has been installed.
    await waitFor(() => {
      expect(constructed.length).toBe(1)
      // 8.1.3 installs the hook through the v6 METHOD. If a future bump
      // regressed to the 8.1.0 expando, this stays null and the crash is back.
      expect(constructed[0].cameraUpdate).not.toBeNull()
    })
    expect(onError).not.toHaveBeenCalled()

    const map = constructed[0]
    // THE ACTUAL REGRESSION: firing a camera event ran the wrapper's
    // _onCameraEvent, which in 8.1.0 dereferenced the removed `map.transform`
    // and threw "undefined is not an object (evaluating 'e.center')".
    expect(() => map.fire('move')).not.toThrow()
    expect(() => map.fire('zoom')).not.toThrow()

    expect(onMove).toHaveBeenCalled()
    const event = onMove.mock.calls.at(-1)?.[0] as { viewState?: Record<string, number> }
    // MapProviderView's onMove reads e.viewState.bearing for the compass, so an
    // event that arrives with no viewState is still a broken map.
    expect(event?.viewState).toBeDefined()
    expect(event?.viewState?.longitude).toBeCloseTo(14.42076)
    expect(event?.viewState?.bearing).toBe(0)
  })
})

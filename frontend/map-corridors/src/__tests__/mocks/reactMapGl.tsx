// Shared test double for `react-map-gl/mapbox`.
//
// WHY a shared module rather than a per-file `vi.mock` factory: two RTL suites
// (photoMarkerPin, mapProviderViewMemo) need the SAME <Marker> shape, and one
// of them uses the marker render counter as its memo probe. Keeping one shape
// means a change to what the map components expose is fixed in one place.
//
// WHY the render counter (and not React's <Profiler onRender>): the Profiler
// marks a commit whenever its OWN props change, which RTL's `rerender()` always
// does — so `onRender` firing proves nothing about a memo hit. Counting the
// mock component's invocations counts actual renders of the subtree under test.
//
// Not collected as a test file: vitest's default `include` is
// `**/*.{test,spec}.?(c|m)[jt]s?(x)` and this file matches neither.

import { vi } from 'vitest'
import type { ReactNode, CSSProperties } from 'react'

/** One call per <Marker> render — the memo probe for PhotoMarkerPin (the pin's
 *  Marker child renders iff the pin itself renders). Reset it per test with
 *  `markerRender.mockClear()`. */
export const markerRender = vi.fn()

type MarkerProps = {
  longitude: number
  latitude: number
  offset?: [number, number]
  style?: CSSProperties
  children?: ReactNode
}

export const reactMapGlMock = {
  __esModule: true,
  // MapGL never fires onLoad here → the view's `isMapLoaded` stays false, so
  // useMarkerFan returns EMPTY and never calls map.on()/project(). That keeps
  // the fake free of a projection surface the render tests don't need.
  default: ({ children }: { children?: ReactNode }) => <div data-testid="map">{children}</div>,
  Marker: (p: MarkerProps) => {
    markerRender(p)
    return (
      <div
        data-testid="marker"
        // Serialized so a test can assert the exact tuple, including the
        // [0,0]-vs-undefined distinction the real <Marker> is sensitive to.
        data-offset={JSON.stringify(p.offset)}
        data-lng={p.longitude}
        data-lat={p.latitude}
        style={p.style}
      >
        {p.children}
      </div>
    )
  },
  Popup: ({ children }: { children?: ReactNode }) => <div data-testid="popup">{children}</div>,
  Source: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Layer: () => null,
}

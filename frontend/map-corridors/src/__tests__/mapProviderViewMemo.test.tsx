// First behavioural coverage of MapProviderView (WP2f). Every case except the
// memo one was written and made green against the PRE-refactor component, so
// they assert behaviour that had to survive the pin extraction; the memo case
// is the only new guarantee.
//
// Render counting goes through the mocked `useI18n` (exactly one call per
// MapProviderView render — with no popup open it is the component's only
// consumer). NOT React's <Profiler onRender>: the Profiler flags a commit
// whenever its OWN props change, which RTL's `rerender()` always does, so it
// cannot distinguish a memo hit from a miss.

import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragHandleConfig } from '../map/useEdgePanDrag'
import type { PhotoMarker } from '../types/markers'

const i18nSpy = vi.hoisted(() => vi.fn(() => ({ t: (k: string) => k })))
// The drag controller is faked because the real one bails out unless
// `mapRef.current.getMap()` yields a live mapbox Map — react-map-gl's MapGL is
// what populates that ref, and the mock below is a plain <div>. Recording the
// DragHandleConfig each pin hands over lets a test fire the pin's own onClick,
// which is the exact path a tap takes through the real controller.
const dragMock = vi.hoisted(() => {
  const cfgs: DragHandleConfig[] = []
  return {
    cfgs,
    controller: { startDrag: (_e: PointerEvent, cfg: DragHandleConfig) => { cfgs.push(cfg) } },
  }
})

vi.mock('react-map-gl/mapbox', async () => (await import('./mocks/reactMapGl')).reactMapGlMock)
vi.mock('../contexts/I18nContext', () => ({ useI18n: i18nSpy }))
vi.mock('../components/usePhotoThumbUrl', () => ({
  usePhotoThumbUrl: () => ({ url: null, state: 'missing' as const }),
}))
vi.mock('../map/useEdgePanDrag', () => ({
  useEdgePanDrag: () => ({ activeDrag: null, controller: dragMock.controller }),
}))

// vitest hoists the vi.mock calls above these imports, so the component below
// is already wired to the doubles.
import { MapProviderView } from '../map/MapProviderView'
import type { MapProviderViewHandle } from '../map/MapProviderView'
import { RAISED_MARKER_STYLE } from '../map/photoLayers/photoMarkerStyle'
import { markerRender } from './mocks/reactMapGl'

type Props = ComponentProps<typeof MapProviderView>

const MARKERS: readonly PhotoMarker[] = [
  { id: 'm1', lng: 14.1, lat: 50.1, name: 'a.jpg', photoId: 'p1', capturedAt: { lng: 14.1, lat: 50.1 }, flag: 'pick-track' },
  { id: 'm2', lng: 14.2, lat: 50.2, name: 'b.jpg', photoId: 'p2', capturedAt: { lng: 14.2, lat: 50.2 } },
  { id: 'm3', lng: 14.3, lat: 50.3, name: 'c.jpg', photoId: 'p3', capturedAt: { lng: 14.3, lat: 50.3 }, flag: 'pick-turning' },
]

const OVERLAYS: Props['geojsonOverlays'] = []

/** Fresh, fully-wired props. All object/array/callback members are created once
 *  per call so a test can rerender with the SAME object to probe the memo. */
function makeProps(): Props {
  return {
    // A plain https style URL (not `mapbox://`) so the token wall never shows.
    mapStyle: 'https://example.com/style.json',
    mapboxAccessToken: 'x',
    geojsonOverlays: OVERLAYS,
    markers: MARKERS,
    activeMarkerId: null,
    activePhotoMarkerId: null,
    onActivePhotoMarkerChange: vi.fn(),
    onMarkerAdd: vi.fn(),
    onMarkerDragEnd: vi.fn(),
    onMarkerClick: vi.fn(),
    onCompareVariants: vi.fn(),
    groundMarkerProps: {
      groundMarkers: [],
      activeGroundMarkerId: null,
      onGroundMarkerAdd: vi.fn(),
      onGroundMarkerDragEnd: vi.fn(),
      onGroundMarkerClick: vi.fn(),
      onGroundMarkerTypeChange: vi.fn(),
      onGroundMarkerDelete: vi.fn(),
    },
  }
}

/** The pin whose <Marker> sits at the given longitude (markers get distinct lngs). */
function pinAt(container: HTMLElement, lng: number): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="marker"][data-lng="${lng}"]`)
  if (!el) throw new Error(`no marker at lng ${lng}`)
  return el
}
/** The visible dot inside a pin: <Marker> → MarkerDragHandle wrapper → dot. */
function dotIn(marker: HTMLElement): HTMLElement {
  const dot = marker.querySelector<HTMLElement>(':scope > div > div')
  if (!dot) throw new Error('dot not found')
  return dot
}

/** Native primary pointerdown — MarkerDragHandle listens natively, not via React props. */
function firePointerDown(el: HTMLElement): void {
  const e = new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0 })
  if (!e.isPrimary) Object.defineProperty(e, 'isPrimary', { value: true })
  el.dispatchEvent(e)
}

beforeEach(() => {
  i18nSpy.mockClear()
  markerRender.mockClear()
  dragMock.cfgs.length = 0
})

describe('MapProviderView — memo boundary', () => {
  it('skips the render when re-rendered with the identical props object', () => {
    const props = makeProps()
    const { rerender } = render(<MapProviderView {...props} />)
    expect(i18nSpy).toHaveBeenCalledTimes(1)

    rerender(<MapProviderView {...props} />)
    expect(i18nSpy).toHaveBeenCalledTimes(1)
  })

  it('re-renders when a prop object changes identity (App must memoize it)', () => {
    // Pairs with appPropStability: this is exactly why groundMarkerProps is a
    // useMemo in App — an equal-content-but-fresh object still costs a render.
    const props = makeProps()
    const { rerender } = render(<MapProviderView {...props} />)
    rerender(<MapProviderView {...props} groundMarkerProps={{ ...props.groundMarkerProps! }} />)
    expect(i18nSpy).toHaveBeenCalledTimes(2)
  })
})

describe('MapProviderView — active photo highlight', () => {
  it('scales and raises only the active pin', () => {
    const props = makeProps()
    const { container, rerender } = render(<MapProviderView {...props} />)
    rerender(<MapProviderView {...props} activePhotoMarkerId="m2" />)
    expect(i18nSpy).toHaveBeenCalledTimes(2)

    expect(dotIn(pinAt(container, 14.2)).style.transform).toBe('scale(1.3)')
    expect(dotIn(pinAt(container, 14.1)).style.transform).toBe('')
    expect(dotIn(pinAt(container, 14.3)).style.transform).toBe('')

    // The raised pin gets the shared constant, by reference.
    const m2Call = markerRender.mock.calls.filter(c => c[0].longitude === 14.2).at(-1)!
    expect(m2Call[0].style).toBe(RAISED_MARKER_STYLE)
    expect(m2Call[0].style).toEqual({ zIndex: 2 })
  })
})

describe('MapProviderView — imperative handle survives memo + forwardRef', () => {
  it('exposes getCenter and flyToPhotoMarker through the ref', () => {
    const ref = createRef<MapProviderViewHandle>()
    render(<MapProviderView ref={ref} {...makeProps()} />)
    expect(ref.current).not.toBeNull()
    // The MapGL mock never populates mapRef, so there is no live map: getCenter
    // must report null rather than throw, and flyTo must no-op.
    expect(ref.current!.getCenter()).toBeNull()
    expect(() => ref.current!.flyToPhotoMarker('m1')).not.toThrow()
  })
})

describe('MapProviderView — pin click routing', () => {
  /** Start a gesture on the pin at `lng` and return the config it registered. */
  function grab(container: HTMLElement, lng: number): DragHandleConfig {
    firePointerDown(dotIn(pinAt(container, lng)))
    const cfg = dragMock.cfgs.at(-1)
    if (!cfg) throw new Error('controller never received a drag config')
    return cfg
  }

  it('opens the popup for a plain click', () => {
    const props = makeProps()
    const { container } = render(<MapProviderView {...props} />)
    const cfg = grab(container, 14.1)
    act(() => { cfg.onClick!({ ctrl: false, meta: false, shift: false }) })
    expect(props.onActivePhotoMarkerChange).toHaveBeenCalledWith('m1')
  })

  it('adds to the compare selection (and does NOT open the popup) on Ctrl-click', () => {
    const props = makeProps()
    const { container } = render(<MapProviderView {...props} />)
    const cfg = grab(container, 14.1)
    act(() => { cfg.onClick!({ ctrl: true, meta: false, shift: false }) })
    expect(props.onActivePhotoMarkerChange).not.toHaveBeenCalled()
    // The floating compare bar appears once ≥1 photo is map-selected.
    expect(container.textContent).toContain('photo.list.compareSelected')
  })

  it('commits a drag through onMarkerDragEnd with the true anchor id', () => {
    const props = makeProps()
    const { container } = render(<MapProviderView {...props} />)
    const cfg = grab(container, 14.3)
    expect(cfg.lng).toBe(14.3)
    act(() => { cfg.onCommit(1, 2) })
    expect(props.onMarkerDragEnd).toHaveBeenCalledWith('m3', 1, 2)
  })
})

// Behavioural contract of the extracted photo pin (WP2f). These assertions
// were written BEFORE MapProviderView's inline marker loop was replaced, so
// they pin the exact semantics the refactor had to preserve:
//
//   • the memo boundary actually holds for equal prop values,
//   • `offset` is never undefined (the "photo drifts off on zoom-out" bug),
//   • MarkerDragHandle gets the TRUE anchor while <Marker> gets the live
//     drag override,
//   • `style` is the shared RAISED_MARKER_STYLE reference, or `undefined`.

import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markerRender, reactMapGlMock } from './mocks/reactMapGl'
import { PhotoMarkerPin, type PhotoMarkerPinProps } from '../map/PhotoMarkerPin'
import { RAISED_MARKER_STYLE } from '../map/photoLayers/photoMarkerStyle'
import type { ClickMods, DragHandleConfig, EdgePanDragController } from '../map/useEdgePanDrag'

vi.mock('react-map-gl/mapbox', async () => (await import('./mocks/reactMapGl')).reactMapGlMock)
// Referenced so the import above is not elided by the bundler in a future edit;
// the mock module is what `vi.mock` resolves to.
void reactMapGlMock

/** The visible dot: <Marker> → MarkerDragHandle's `display:contents` wrapper → dot. */
function dotOf(container: HTMLElement): HTMLElement {
  const dot = container.querySelector<HTMLElement>('[data-testid="marker"] > div > div')
  if (!dot) throw new Error('dot div not found')
  return dot
}

function markerOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="marker"]')
  if (!el) throw new Error('marker not found')
  return el
}

/**
 * Dispatch a native primary-button pointerdown. MarkerDragHandle attaches
 * NATIVE listeners (not React props), so RTL's fireEvent-on-props path would
 * not reach it — the event must be a real dispatched PointerEvent. jsdom 29
 * ships a PointerEvent impl; `isPrimary` is force-defined in case its init dict
 * does not honour the flag, which MarkerDragHandle gates on.
 */
function firePointerDown(el: HTMLElement): void {
  const e = new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0 })
  if (!e.isPrimary) Object.defineProperty(e, 'isPrimary', { value: true })
  el.dispatchEvent(e)
}

/** Records the DragHandleConfig the pin handed the controller at grab time. */
function recordingController(): { controller: EdgePanDragController; cfgs: DragHandleConfig[] } {
  const cfgs: DragHandleConfig[] = []
  return { controller: { startDrag: (_e, cfg) => { cfgs.push(cfg) } }, cfgs }
}

const onClick = vi.fn<(id: string, mods: ClickMods) => void>()
const onDragEnd = vi.fn<(id: string, lng: number, lat: number) => void>()

function baseProps(controller: EdgePanDragController): PhotoMarkerPinProps {
  return {
    id: 'm1',
    lng: 14,
    lat: 50,
    liveLng: 14,
    liveLat: 50,
    moved: false,
    isActive: false,
    isSelected: false,
    isDragging: false,
    fanDx: 0,
    fanDy: 0,
    controller,
    onDragEnd,
    onClick,
  }
}

beforeEach(() => {
  markerRender.mockClear()
  onClick.mockClear()
  onDragEnd.mockClear()
})
afterEach(() => { vi.restoreAllMocks() })

describe('PhotoMarkerPin — memo boundary', () => {
  it('does not re-render when re-rendered with equal prop values', () => {
    const { controller } = recordingController()
    const props = baseProps(controller)
    const { rerender } = render(<PhotoMarkerPin {...props} />)
    expect(markerRender).toHaveBeenCalledTimes(1)

    // A FRESH props object carrying the same values and the same references.
    rerender(<PhotoMarkerPin {...{ ...props }} />)
    expect(markerRender).toHaveBeenCalledTimes(1)
  })

  it('re-renders and re-styles when one of its own values changes', () => {
    const { controller } = recordingController()
    const props = baseProps(controller)
    const { container, rerender } = render(<PhotoMarkerPin {...props} />)
    rerender(<PhotoMarkerPin {...props} isActive />)
    expect(markerRender).toHaveBeenCalledTimes(2)
    expect(dotOf(container).style.transform).toBe('scale(1.3)')
  })
})

describe('PhotoMarkerPin — offset contract', () => {
  it('passes the fan offset as a defined tuple', () => {
    const { controller } = recordingController()
    const { container } = render(<PhotoMarkerPin {...baseProps(controller)} fanDx={12} fanDy={-8} />)
    expect(markerOf(container).getAttribute('data-offset')).toBe('[12,-8]')
  })

  it('suppresses the fan offset to [0,0] while THIS pin is dragged', () => {
    const { controller } = recordingController()
    const { container } = render(
      <PhotoMarkerPin {...baseProps(controller)} fanDx={12} fanDy={-8} isDragging />,
    )
    expect(markerOf(container).getAttribute('data-offset')).toBe('[0,0]')
  })

  it('never passes undefined for an un-fanned pin (stale-offset bug guard)', () => {
    const { controller } = recordingController()
    const { container } = render(<PhotoMarkerPin {...baseProps(controller)} />)
    const raw = markerOf(container).getAttribute('data-offset')
    expect(raw).toBe('[0,0]')
    expect(raw).not.toBe('undefined')
  })
})

describe('PhotoMarkerPin — style contract', () => {
  it('hands <Marker> the shared RAISED_MARKER_STYLE reference when active or selected', () => {
    const { controller } = recordingController()
    const props = baseProps(controller)
    const { rerender } = render(<PhotoMarkerPin {...props} isActive />)
    expect(markerRender.mock.calls.at(-1)![0].style).toBe(RAISED_MARKER_STYLE)

    rerender(<PhotoMarkerPin {...props} isSelected />)
    expect(markerRender.mock.calls.at(-1)![0].style).toBe(RAISED_MARKER_STYLE)
  })

  it('hands <Marker> undefined (not {}) when neither active nor selected', () => {
    // Documents react-map-gl's applyReactStyle early-return: a falsy style is
    // ignored, so a once-raised pin keeps its zIndex until unmount. Passing `{}`
    // instead would be an equally-inert but semantically different contract.
    const { controller } = recordingController()
    render(<PhotoMarkerPin {...baseProps(controller)} />)
    expect(markerRender.mock.calls.at(-1)![0].style).toBeUndefined()
  })
})

describe('PhotoMarkerPin — anchor vs live position', () => {
  it('draws at the live override but grabs from the true anchor', () => {
    const { controller, cfgs } = recordingController()
    const { container } = render(
      <PhotoMarkerPin {...baseProps(controller)} liveLng={14.5} liveLat={50.5} />,
    )
    const marker = markerOf(container)
    expect(marker.getAttribute('data-lng')).toBe('14.5')
    expect(marker.getAttribute('data-lat')).toBe('50.5')

    firePointerDown(dotOf(container))
    expect(cfgs).toHaveLength(1)
    expect(cfgs[0].id).toBe('m1')
    expect(cfgs[0].lng).toBe(14)
    expect(cfgs[0].lat).toBe(50)
  })
})

describe('PhotoMarkerPin — callback routing', () => {
  it('forwards a tap (with its modifier state) to onClick, keyed by id', () => {
    const mods: ClickMods = { ctrl: true, meta: false, shift: false }
    // A controller that resolves the gesture as a click the instant it starts.
    const controller: EdgePanDragController = { startDrag: (_e, cfg) => { cfg.onClick?.(mods) } }
    const { container } = render(<PhotoMarkerPin {...baseProps(controller)} />)
    firePointerDown(dotOf(container))
    expect(onClick).toHaveBeenCalledWith('m1', mods)
  })

  it('forwards a committed drag to onDragEnd, keyed by id', () => {
    const controller: EdgePanDragController = { startDrag: (_e, cfg) => { cfg.onCommit(1, 2) } }
    const { container } = render(<PhotoMarkerPin {...baseProps(controller)} />)
    firePointerDown(dotOf(container))
    expect(onDragEnd).toHaveBeenCalledWith('m1', 1, 2)
  })

  it('tolerates a missing onDragEnd (KML-only call sites)', () => {
    const controller: EdgePanDragController = { startDrag: (_e, cfg) => { cfg.onCommit(1, 2) } }
    const { container } = render(
      <PhotoMarkerPin {...baseProps(controller)} onDragEnd={undefined} />,
    )
    expect(() => firePointerDown(dotOf(container))).not.toThrow()
  })
})

describe('PhotoMarkerPin — label chip', () => {
  it('renders the label only when one is set', () => {
    const { controller } = recordingController()
    const { container, rerender } = render(<PhotoMarkerPin {...baseProps(controller)} />)
    expect(container.textContent).toBe('')

    rerender(<PhotoMarkerPin {...baseProps(controller)} label="A" />)
    expect(container.textContent).toBe('A')
  })
})

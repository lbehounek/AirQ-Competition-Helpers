// First behavioural coverage of PhotoListPanel (WP2f). The interaction cases
// were written and made green against the PRE-refactor panel, so they pin the
// row semantics the closure-free row contract had to preserve; the memo and
// lazy-thumbnail cases are the new guarantees.
//
// Render counting goes through the mocked `usePhotoThumbUrl`: it is called once
// per PhotoListItem render, and its third argument is the row's photoId, so
// filtering the spy's calls by photoId gives that row's render count.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryHandle, StorageInterface } from '@airq/shared-storage'
import type { NoGpsPhoto, PhotoMarker } from '../types/markers'

/** Signature of the mocked hook — declared as a type so the spy's `mock.calls`
 *  stay typed without unused parameter bindings in the implementation. */
type ThumbFn = (
  storage: StorageInterface | null,
  photosDir: DirectoryHandle | null,
  photoId: string,
) => { url: string | null; state: 'missing' }

const thumbSpy = vi.hoisted(() => vi.fn<ThumbFn>(() => ({ url: null, state: 'missing' })))

vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({
    // Echo the key, plus any interpolation params, so a label like the compare
    // button's count is assertable without loading the locale files.
    t: (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(',')}` : k),
  }),
}))
vi.mock('../components/usePhotoThumbUrl', () => ({ usePhotoThumbUrl: thumbSpy }))

import { PhotoListPanel, type PhotoListPanelProps } from '../components/PhotoListPanel'

const RECAT_MIME = 'application/x-airq-photo-recat'
const NO_GPS_MIME = 'application/x-airq-no-gps-photo'

const STORAGE = {} as StorageInterface
const PHOTOS_DIR = {} as DirectoryHandle

// picksTurning is empty; picksTrack = m1,m2; neutral = m3; rejects = m4.
// Visible order (and therefore Shift+click range order) is p1, p2, p3, p4.
const MARKERS: readonly PhotoMarker[] = [
  { id: 'm1', lng: 14, lat: 50, name: 'a.jpg', photoId: 'p1', flag: 'pick-track' },
  { id: 'm2', lng: 14, lat: 50, name: 'b.jpg', photoId: 'p2', flag: 'pick-track' },
  { id: 'm3', lng: 14, lat: 50, name: 'c.jpg', photoId: 'p3' },
  { id: 'm4', lng: 14, lat: 50, name: 'd.jpg', photoId: 'p4', flag: 'reject' },
]
const NO_GPS: readonly NoGpsPhoto[] = [{ photoId: 'p5', filename: 'e.jpg' }]

/** Renders of a given row so far — one usePhotoThumbUrl call per row render. */
function rowRenders(photoId: string): number {
  return thumbSpy.mock.calls.filter(c => c[2] === photoId).length
}

/** The row whose primary text is `name` (rows render their display name). */
function rowByName(name: string): HTMLElement {
  const label = screen.getByText(name)
  const row = label.closest('.MuiListItemButton-root')?.parentElement
  if (!row) throw new Error(`row for ${name} not found`)
  return row as HTMLElement
}
/** The clickable button inside a row. */
function buttonOf(row: HTMLElement): HTMLElement {
  const btn = row.querySelector<HTMLElement>('.MuiListItemButton-root')
  if (!btn) throw new Error('row button not found')
  return btn
}

/** A minimal DataTransfer stand-in: jsdom does not construct real ones. */
function fakeDataTransfer() {
  const data: Record<string, string> = {}
  return {
    types: [] as string[],
    setData: vi.fn((k: string, v: string) => { data[k] = v }),
    getData: vi.fn((k: string) => data[k] ?? ''),
    effectAllowed: '',
    dropEffect: '',
    data,
  }
}

function makeProps(over: Partial<PhotoListPanelProps> = {}): PhotoListPanelProps {
  return {
    markers: MARKERS,
    noGpsPhotos: NO_GPS,
    storage: STORAGE,
    photosDir: PHOTOS_DIR,
    onMarkerClick: vi.fn(),
    onPhotoDelete: vi.fn(),
    onPhotoRename: vi.fn(),
    onCompareVariants: vi.fn(),
    onPreviewPhoto: vi.fn(),
    onPhotoSetFlag: vi.fn(),
    onNoGpsPhotoClick: vi.fn(),
    activePhotoId: null,
    ...over,
  }
}

beforeAll(() => {
  // jsdom 29 does not implement scrollIntoView; the active-row effect calls it.
  Element.prototype.scrollIntoView = vi.fn()
})
beforeEach(() => { thumbSpy.mockClear() })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PhotoListPanel — memo boundary', () => {
  it('renders no row again when re-rendered with the identical props object', () => {
    const props = makeProps()
    const { rerender } = render(<PhotoListPanel {...props} />)
    const before = MARKERS.map(m => rowRenders(m.photoId!))

    rerender(<PhotoListPanel {...props} />)
    expect(MARKERS.map(m => rowRenders(m.photoId!))).toEqual(before)
  })

  it('re-renders only the row whose active highlight changed', () => {
    const props = makeProps()
    const { rerender } = render(<PhotoListPanel {...props} />)
    const before = { p1: rowRenders('p1'), p2: rowRenders('p2'), p3: rowRenders('p3') }

    rerender(<PhotoListPanel {...props} activePhotoId="p2" />)
    expect(rowRenders('p2')).toBe(before.p2 + 1)
    expect(rowRenders('p1')).toBe(before.p1)
    expect(rowRenders('p3')).toBe(before.p3)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('stays stable when routeWaypoints is omitted (shared empty-array constant)', () => {
    // `routeWaypoints ?? []` used to mint a fresh array per render, invalidating
    // the setByPhotoId / breakOptions memos and, through them, every row.
    const props = makeProps({ routeWaypoints: undefined })
    const { rerender } = render(<PhotoListPanel {...props} />)
    const before = MARKERS.map(m => rowRenders(m.photoId!))
    rerender(<PhotoListPanel {...props} />)
    rerender(<PhotoListPanel {...props} />)
    expect(MARKERS.map(m => rowRenders(m.photoId!))).toEqual(before)
  })
})

describe('PhotoListPanel — selection', () => {
  it('extends a Ctrl-click anchor into a Shift+click range in visible order', () => {
    render(<PhotoListPanel {...makeProps()} />)
    fireEvent.click(buttonOf(rowByName('a.jpg')), { ctrlKey: true })
    fireEvent.click(buttonOf(rowByName('c.jpg')), { shiftKey: true })
    // p1..p3 — the intervening p2 is pulled in even though it was never clicked.
    expect(screen.getByText('photo.list.compareSelected:3')).toBeTruthy()
  })

  it('leaves p4/p5 untouched when the range covers p1..p3', () => {
    render(<PhotoListPanel {...makeProps()} />)
    const before = { p4: rowRenders('p4'), p5: rowRenders('p5') }
    fireEvent.click(buttonOf(rowByName('a.jpg')), { ctrlKey: true })
    fireEvent.click(buttonOf(rowByName('c.jpg')), { shiftKey: true })
    expect(rowRenders('p4')).toBe(before.p4)
    expect(rowRenders('p5')).toBe(before.p5)
  })

  it('a plain click flies to the MARKER id and clears the selection', () => {
    const props = makeProps()
    render(<PhotoListPanel {...props} />)
    fireEvent.click(buttonOf(rowByName('a.jpg')), { ctrlKey: true })
    expect(screen.getByText('photo.list.compareSelected:1')).toBeTruthy()

    fireEvent.click(buttonOf(rowByName('b.jpg')))
    // Marker id, not photo id.
    expect(props.onMarkerClick).toHaveBeenCalledWith('m2')
    expect(screen.queryByText(/photo\.list\.compareSelected/)).toBeNull()
  })
})

describe('PhotoListPanel — drag payloads', () => {
  it('drags a GPS row with the recat MIME and the marker id', () => {
    render(<PhotoListPanel {...makeProps()} />)
    const dt = fakeDataTransfer()
    fireEvent.dragStart(rowByName('a.jpg'), { dataTransfer: dt })
    expect(dt.setData).toHaveBeenCalledWith(RECAT_MIME, 'm1')
  })

  it('drags a no-GPS row with the map-drop MIME and the photo id', () => {
    render(<PhotoListPanel {...makeProps()} />)
    const dt = fakeDataTransfer()
    fireEvent.dragStart(rowByName('e.jpg'), { dataTransfer: dt })
    expect(dt.setData).toHaveBeenCalledWith(NO_GPS_MIME, 'p5')
  })

  it('a no-GPS drag never clears the drop-target state a GPS drag armed', () => {
    // Observable proxy for the highlight: a group only accepts a drop while
    // `dragSourceGroup` names a different, valid group.
    const props = makeProps()
    render(<PhotoListPanel {...props} />)

    fireEvent.dragStart(rowByName('a.jpg'), { dataTransfer: fakeDataTransfer() })
    // A drag that starts AND ends on the no-GPS row must not touch that state.
    fireEvent.dragStart(rowByName('e.jpg'), { dataTransfer: fakeDataTransfer() })
    fireEvent.dragEnd(rowByName('e.jpg'))

    const dropDt = fakeDataTransfer()
    dropDt.data[RECAT_MIME] = 'm1'
    const neutralSection = screen.getByText('photo.list.neutral (1)').closest('.MuiListItemButton-root')!.parentElement!
    fireEvent.dragOver(neutralSection, { dataTransfer: dropDt })
    fireEvent.drop(neutralSection, { dataTransfer: dropDt })
    expect(props.onPhotoSetFlag).toHaveBeenCalledWith('m1', null)
  })
})

describe('PhotoListPanel — row actions', () => {
  it('double-click previews GPS and no-GPS rows alike', () => {
    const props = makeProps()
    render(<PhotoListPanel {...props} />)
    fireEvent.doubleClick(buttonOf(rowByName('b.jpg')))
    expect(props.onPreviewPhoto).toHaveBeenCalledWith('p2')
    fireEvent.doubleClick(buttonOf(rowByName('e.jpg')))
    expect(props.onPreviewPhoto).toHaveBeenCalledWith('p5')
  })

  it('suspends the drag while renaming, and restores it on Escape', () => {
    render(<PhotoListPanel {...makeProps()} />)
    // Held by reference: in edit mode the row swaps its label for a TextField,
    // so it can no longer be looked up by its display name.
    const row = rowByName('a.jpg')
    expect(row.getAttribute('draggable')).toBe('true')

    fireEvent.click(row.querySelector('.photo-row-rename')!)
    expect(row.getAttribute('draggable')).toBe('false')

    // The only textbox on screen — the "Set 2 starts at" select is hidden
    // because onSetBreakChange is not wired in these props.
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(row.getAttribute('draggable')).toBe('true')
  })
})

type IOInstance = {
  el: Element
  cb: IntersectionObserverCallback
  options?: IntersectionObserverInit
  disconnect: ReturnType<typeof vi.fn>
}

/** Stub IntersectionObserver and return the array every `observe()` records
 *  into — one entry per observed element, carrying the constructor options so
 *  the root/rootMargin the panel asks for are assertable. */
function makeFakeIO(): IOInstance[] {
  const instances: IOInstance[] = []
  // No parameter properties: tsconfig sets `erasableSyntaxOnly`.
  class FakeIO {
    disconnect = vi.fn()
    cb: IntersectionObserverCallback
    options?: IntersectionObserverInit
    constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.cb = cb
      this.options = options
    }
    observe(el: Element) { instances.push({ el, cb: this.cb, options: this.options, disconnect: this.disconnect }) }
    unobserve() {}
    takeRecords() { return [] }
  }
  vi.stubGlobal('IntersectionObserver', FakeIO)
  return instances
}

/** The nearest ancestor of `el` that actually scrolls — what an observer must
 *  use as its root for `rootMargin` to prefetch anything. */
function nearestScrollAncestor(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

describe('PhotoListPanel — thumbnail I/O gating', () => {
  it('defers the thumbnail fetch until the row intersects the list', () => {
    // Every mounted row used to fetch at mount — including rows inside the
    // default-collapsed rejects group — which on Electron is one IPC round-trip
    // plus a synchronous readFileSync + base64 on the main process per photo.
    const instances = makeFakeIO()

    render(<PhotoListPanel {...makeProps()} />)
    // Nothing has intersected yet → every row is asked for a thumbnail with a
    // null storage, which usePhotoThumbUrl already treats as "missing".
    for (const call of thumbSpy.mock.calls) {
      expect(call[0]).toBeNull()
      expect(call[1]).toBeNull()
    }

    const p1Row = rowByName('a.jpg')
    const inst = instances.find(i => i.el === p1Row)!
    expect(inst).toBeDefined()
    thumbSpy.mockClear()
    // Drive the observer callback directly — inside act(), because it flips
    // the row's own state and React must flush the resulting render.
    act(() => {
      inst.cb([{ isIntersecting: true } as IntersectionObserverEntry], inst as unknown as IntersectionObserver)
    })

    const p1Calls = thumbSpy.mock.calls.filter(c => c[2] === 'p1')
    expect(p1Calls.at(-1)![0]).toBe(STORAGE)
    expect(p1Calls.at(-1)![1]).toBe(PHOTOS_DIR)
    // A row that has not intersected is still gated.
    const p2Calls = thumbSpy.mock.calls.filter(c => c[2] === 'p2')
    for (const c of p2Calls) expect(c[0]).toBeNull()
    expect(inst.disconnect).toHaveBeenCalled()
  })

  it('observes against the list scroll box so the prefetch margin applies', () => {
    // `rootMargin` expands only the ROOT's intersection rectangle; an
    // intermediate scrolling ancestor still clips the target by its plain rect.
    // Observed against the implicit viewport root, the panel's own overflow box
    // clipped every row, so the 200 px prefetch was dead code and a thumbnail
    // only started its IPC/OPFS fetch once the row was already visible.
    const instances = makeFakeIO()
    render(<PhotoListPanel {...makeProps()} />)

    const p1Row = rowByName('a.jpg')
    const scroller = nearestScrollAncestor(p1Row)
    expect(scroller).not.toBeNull()

    const observed = instances.filter(i => i.el === p1Row)
    expect(observed.at(-1)?.options?.root).toBe(scroller)
    expect(observed.at(-1)?.options?.rootMargin).toBe('200px')
    // And exactly one observer: the row waits for the scroll box instead of
    // observing against the viewport first and re-observing a commit later.
    expect(observed).toHaveLength(1)
  })

  it('falls back to eager loading where IntersectionObserver is unavailable', () => {
    // Matches today's behaviour on any viewer without IO — and is why jsdom
    // (which has none) leaves every other test in this file unaffected.
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<PhotoListPanel {...makeProps()} />)
    const first = thumbSpy.mock.calls.find(c => c[2] === 'p1')!
    expect(first[0]).toBe(STORAGE)
    expect(first[1]).toBe(PHOTOS_DIR)
  })
})

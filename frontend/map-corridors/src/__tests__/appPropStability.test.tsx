// App's half of the WP2f memoization contract: after an App re-render caused by
// state that neither the map nor the photo panel reads, every object, array and
// callback prop they receive must be the SAME reference. Without this the memo
// boundaries added to MapProviderView and PhotoListPanel never hit.
//
// The two children are replaced with prop recorders, so this file asserts the
// producer side only — the consumer side (the memo actually skipping) lives in
// mapProviderViewMemo / photoListPanelMemo.
//
// Mock set follows photoImportReentrancy.test.tsx: everything environment-bound
// is stubbed so the render exercises App's own wiring, not WebGL or OPFS.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import type { CorridorsSession } from '../hooks/useCorridorSessionOPFS'

const rec = vi.hoisted(() => ({
  map: [] as Record<string, unknown>[],
  panel: [] as Record<string, unknown>[],
}))

vi.mock('../map/MapProviderView', () => ({
  MapProviderView: (p: Record<string, unknown>) => { rec.map.push(p); return <div data-testid="map-stub" /> },
}))
vi.mock('../components/PhotoListPanel', () => ({
  PhotoListPanel: (p: Record<string, unknown>) => { rec.panel.push(p); return null },
}))
vi.mock('../components/NoGpsTray', () => ({ NoGpsTray: () => null, NO_GPS_PHOTO_DRAG_TYPE: 'x' }))
vi.mock('../components/PhotoCompareModal', () => ({ PhotoCompareModal: () => null }))
vi.mock('../components/PhotoPreviewModal', () => ({ PhotoPreviewModal: () => null }))
// One stable i18n object, mirroring a provider that isn't re-rendering: `t`'s
// identity only changes on a locale switch / the provider's async init, and a
// handler that legitimately depends on `t` (the no-GPS placement snack) must not
// be treated as unstable here for a reason the real app never produces.
const i18n = vi.hoisted(() => ({ t: (k: string) => k, locale: 'en', setLocale: () => {} }))
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => i18n }))
vi.mock('../hooks/useMapStyle', () => ({ useMapStyle: () => ['mapbox-streets', vi.fn(), []] }))
vi.mock('../config/mapProviders', () => ({
  getStyleForId: () => 'mapbox://styles/mapbox/streets-v12',
  setProviderToken: vi.fn(),
  subscribeToProvider: () => () => {},
  getProviderSnapshot: () => 0,
  getMapboxAccessToken: () => '',
}))

/** Swapped per case: a populated session, or none at all. */
let currentSession: unknown = null

// The real hook wraps every setter in a useCallback, so the mock must hand back
// ONE object with ONE set of functions — minting fresh vi.fn()s per render would
// invalidate App's memoized handlers and make this file's assertions untestable
// for reasons that have nothing to do with App.
const sessionApi = vi.hoisted(() => ({
  backendAvailable: true,
  storage: { writeJSON: vi.fn() },
  photosDir: { path: '/photos' },
  // null keeps the map-picks handoff effect from firing during the test.
  competitionDir: null,
  setMapStyleId: vi.fn(),
  setSetBreakWaypointName: vi.fn(),
  setMarkers: vi.fn(),
  setGroundMarkers: vi.fn(),
  setNoGpsPhotos: vi.fn(),
  setNoGpsTrayOpen: vi.fn(),
  getExistingContentHashes: () => new Set<string>(),
  commitImportedPhotos: vi.fn(),
  placeNoGpsPhoto: vi.fn(),
  removePhoto: vi.fn(),
  renamePhoto: vi.fn(),
  setUse1NmAfterSp: vi.fn(),
  setComputedData: vi.fn(),
  saveOriginalKmlText: vi.fn(),
  loadOriginalKmlText: vi.fn(),
}))

vi.mock('../hooks/useCorridorSessionOPFS', () => ({
  useCorridorSessionOPFS: () => ({ ...sessionApi, session: currentSession }),
}))

import App from '../App'
import { DEFAULT_GROUND_MARKER_TYPE } from '../types/markers'

const POPULATED = {
  id: 's', version: 1, createdAt: '', updatedAt: '', mapStyleId: 'mapbox-streets',
  discipline: 'rally', use1NmAfterSp: false,
  // Non-null so `geojsonOverlays` really has an entry, and a valid two-point
  // LineString so the corridor builder has something legal to chew on.
  geojson: {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[14, 50], [14.1, 50.1]] },
    }],
  },
  leftSegments: null, rightSegments: null, gates: null, points: null, exactPoints: null,
  markers: [{ id: 'pm-1', lng: 14, lat: 50, name: 'a.jpg', photoId: 'p1', capturedAt: { lng: 14, lat: 50 } }],
  groundMarkers: [{ id: 'gm-1', lng: 14, lat: 50, type: DEFAULT_GROUND_MARKER_TYPE }],
  noGpsPhotos: [],
  noGpsTrayOpen: true,
} as unknown as CorridorsSession

/**
 * Force an App re-render that neither child consumes: dragging files over the
 * map area flips `isDragOver`, which only paints the drop hint. Asserts the
 * hint appeared, so a silent no-op can't make the stability check vacuous.
 */
function forceUnrelatedRerender(): void {
  const dropArea = screen.getByTestId('map-stub').parentElement!
  fireEvent.dragOver(dropArea, { dataTransfer: { types: ['Files'] } })
  expect(screen.getByText('app.dropHint')).toBeTruthy()
}

/**
 * Assert that EVERY prop kept its identity between the last two recorded
 * renders, and that the prop set itself did not change.
 *
 * Deliberately not a hand-picked key list: the memo boundaries compare all
 * props, so a single inline lambda on any one of the ~35 map / ~17 panel props
 * defeats them. A subset check would stay green for the props it forgot.
 *
 * `allowedToChange` is the escape hatch for a prop that legitimately gets a new
 * identity across an unrelated re-render — there are none today, so any entry
 * added here needs a comment saying why.
 */
function expectAllStable(
  recorded: Record<string, unknown>[],
  allowedToChange: readonly string[] = [],
): void {
  expect(recorded.length).toBeGreaterThanOrEqual(2)
  const prev = recorded[recorded.length - 2]
  const next = recorded[recorded.length - 1]
  // A vanished/added prop is a contract change too, and would otherwise slip
  // through as "nothing to compare".
  expect(Object.keys(next).sort()).toEqual(Object.keys(prev).sort())
  for (const k of Object.keys(prev)) {
    if (allowedToChange.includes(k)) continue
    expect(next[k], `prop "${k}" changed identity`).toBe(prev[k])
  }
}

beforeEach(() => {
  rec.map.length = 0
  rec.panel.length = 0
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList))
})
afterEach(() => cleanup())

describe('App prop stability across an unrelated re-render', () => {
  it('keeps every map prop referentially stable (populated session)', () => {
    currentSession = POPULATED
    render(<App />)
    const rendersBefore = rec.map.length
    forceUnrelatedRerender()
    expect(rec.map.length).toBeGreaterThan(rendersBefore)

    expectAllStable(rec.map)
  })

  it('keeps every panel prop referentially stable (populated session)', () => {
    currentSession = POPULATED
    render(<App />)
    forceUnrelatedRerender()

    expectAllStable(rec.panel)
  })

  it('hands out the SAME empty arrays when the session is null', () => {
    // `?? []` used to mint a fresh array per render even for a session that has
    // nothing in it — the worst case, since it re-rendered both children on
    // every keystroke elsewhere in the app.
    currentSession = null
    render(<App />)
    forceUnrelatedRerender()
    expectAllStable(rec.map)
    expectAllStable(rec.panel)
  })
})

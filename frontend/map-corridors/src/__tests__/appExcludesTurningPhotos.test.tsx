// The App-level half of the turning-point exclusion.
//
// `measurableMarkers.test.ts` proves the predicate and the matcher behave, but
// every one of those tests stays green if `markersToMeasure` is deleted from
// App and the raw `markers` array is passed again — which is precisely the
// regression the exclusion exists to prevent. This file closes that seam: it
// renders App with a real session and asserts on the props the map actually
// receives, so removing the filter fails a test rather than a code review.
//
// Mock set follows appPropStability.test.tsx: everything environment-bound is
// stubbed so the render exercises App's own wiring, not WebGL or OPFS.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { CorridorsSession } from '../hooks/useCorridorSessionOPFS'
import type { PhotoMarker } from '../types/markers'

const rec = vi.hoisted(() => ({ map: [] as Record<string, unknown>[] }))

vi.mock('../map/MapProviderView', () => ({
  MapProviderView: (p: Record<string, unknown>) => { rec.map.push(p); return <div data-testid="map-stub" /> },
}))
vi.mock('../components/PhotoListPanel', () => ({ PhotoListPanel: () => null }))
vi.mock('../components/NoGpsTray', () => ({ NoGpsTray: () => null, NO_GPS_PHOTO_DRAG_TYPE: 'x' }))
vi.mock('../components/PhotoCompareModal', () => ({ PhotoCompareModal: () => null }))
vi.mock('../components/PhotoPreviewModal', () => ({ PhotoPreviewModal: () => null }))
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

let currentSession: unknown = null

const sessionApi = vi.hoisted(() => ({
  backendAvailable: true,
  storage: { writeJSON: vi.fn() },
  photosDir: { path: '/photos' },
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

const TP_ID = 'pm-turning'
const TRACK_ID = 'pm-track'

// Typed as PhotoMarker on purpose: `measurableMarkers` accepts any object with
// an optional `flag`, so an untyped fixture would keep compiling — and the
// predicate would silently become a no-op — if the field were ever renamed.
const marker = (id: string, flag: PhotoMarker['flag']): PhotoMarker => ({
  id, lng: 14, lat: 50, name: id + '.jpg', photoId: id, flag,
  capturedAt: { lng: 14, lat: 50 },
} as unknown as PhotoMarker)

const SESSION = {
  id: 's', version: 1, createdAt: '', updatedAt: '', mapStyleId: 'mapbox-streets',
  discipline: 'rally', use1NmAfterSp: false,
  geojson: {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[14, 50], [14.1, 50.1]] },
    }],
  },
  leftSegments: null, rightSegments: null, gates: null, points: null, exactPoints: null,
  // One of each kind, at the same position, so only the flag distinguishes them.
  markers: [marker(TRACK_ID, 'pick-track'), marker(TP_ID, 'pick-turning')],
  groundMarkers: [],
  noGpsPhotos: [],
  noGpsTrayOpen: false,
} as unknown as CorridorsSession

describe('App excludes turning-point photos from measurement', () => {
  beforeEach(() => { rec.map.length = 0; currentSession = SESSION })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('never hands the map a distance entry for a turning-point photo', () => {
    render(<App />)
    const props = rec.map.at(-1)
    expect(props, 'MapProviderView should have rendered').toBeTruthy()
    const distances = props!.markerDistanceNmById as Record<string, number | null>

    // The en-route photo has an entry — possibly null when no corridor covers
    // it, but PRESENT, which is what proves the marker went through the
    // matcher at all and that this assertion is not vacuous.
    expect(Object.prototype.hasOwnProperty.call(distances, TRACK_ID)).toBe(true)
    // The turning-point photo has none. Not "null" — absent, so nothing
    // downstream can render a cell for it.
    expect(Object.prototype.hasOwnProperty.call(distances, TP_ID)).toBe(false)
  })

  it('keeps the turning-point photo on the map, only out of the measurement', () => {
    // The exclusion must be about measuring, not about hiding: the crew still
    // needs to see and click the photo in order to judge it correct/incorrect.
    render(<App />)
    const props = rec.map.at(-1)!
    const markers = props.markers as ReadonlyArray<{ id: string }>
    expect(markers.map(m => m.id).sort()).toEqual([TRACK_ID, TP_ID].sort())
  })
})

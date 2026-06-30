import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// Regression guard for temporal-dead-zone (TDZ) crashes in the top-level App's
// hook ordering — the same class of bug that white-screened the photo-helper
// editor (see photo-helper AppApiSmoke.test.tsx). tsc doesn't flag TDZ and
// nothing rendered App, so a const used before its declaration would only
// surface as a blank screen at runtime. This mounts the real App; its entire
// hook body executes during render, so a reordered/forward-referenced const
// throws a ReferenceError here and fails the test.

// Heavy / environment-bound dependencies stubbed so the render exercises App's
// OWN body rather than spinning up maplibre/WebGL, OPFS, or token plumbing.
vi.mock('../map/MapProviderView', () => ({
  MapProviderView: () => <div data-testid="map-stub" />,
}))
vi.mock('../components/NoGpsTray', () => ({ NoGpsTray: () => null, NO_GPS_PHOTO_DRAG_TYPE: 'x' }))
vi.mock('../components/PhotoListPanel', () => ({ PhotoListPanel: () => null }))
vi.mock('../components/PhotoCompareModal', () => ({ PhotoCompareModal: () => null }))
vi.mock('../components/PhotoPreviewModal', () => ({ PhotoPreviewModal: () => null }))
vi.mock('../contexts/I18nContext', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: 'en', setLocale: vi.fn() }),
}))
vi.mock('../hooks/useMapStyle', () => ({
  useMapStyle: () => ['mapbox-streets', vi.fn(), []],
}))
vi.mock('../config/mapProviders', () => ({
  getStyleForId: () => 'mapbox://styles/mapbox/streets-v12',
  setProviderToken: vi.fn(),
  subscribeToProvider: () => () => {},
  getProviderSnapshot: () => 0,
  getMapboxAccessToken: () => '',
}))
vi.mock('../hooks/useCorridorSessionOPFS', () => ({
  // session null → App renders with no route/markers, but the full hook body
  // (where a TDZ would throw) still executes top-to-bottom.
  useCorridorSessionOPFS: () => ({
    session: null,
    backendAvailable: false,
    storage: null,
    photosDir: null,
    competitionDir: null,
    setMapStyleId: vi.fn(),
    setSetBreakWaypointName: vi.fn(),
    setMarkers: vi.fn(),
    setGroundMarkers: vi.fn(),
    setNoGpsPhotos: vi.fn(),
    setNoGpsTrayOpen: vi.fn(),
    placeNoGpsPhoto: vi.fn(),
    removePhoto: vi.fn(),
    renamePhoto: vi.fn(),
    setUse1NmAfterSp: vi.fn(),
    setComputedData: vi.fn(),
    saveOriginalKmlText: vi.fn(),
    loadOriginalKmlText: vi.fn(),
  }),
}))

import App from '../App'

describe('map-corridors App render smoke (TDZ guard)', () => {
  beforeEach(() => {
    window.matchMedia = window.matchMedia || ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList))
  })
  afterEach(() => cleanup())

  it('mounts without a temporal-dead-zone ReferenceError (full body executes)', () => {
    // Throws "Cannot access 'X' before initialization" if any const is used
    // before its declaration in the component body.
    expect(() => render(<App />)).not.toThrow()
  })
})

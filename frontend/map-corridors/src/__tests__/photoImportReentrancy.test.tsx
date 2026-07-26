import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

/**
 * Re-entrancy guard for photo import (2026-07-26).
 *
 * The dropzone and the hidden file input both stay live for the whole duration
 * of an import — only a progress bar appears — so organizers re-drop while the
 * first batch is still hashing. Both runs used to execute concurrently, and
 * each built its ADR-020 dedup set from the React render closure that created
 * the callback. The second run therefore saw the PRE-import lists, found no
 * duplicates, and imported every file again under a fresh random `pm-` id.
 *
 * The load-bearing assertion is the second one: the queued batch must be handed
 * the hashes the FIRST batch committed. It fails against the pre-fix code.
 *
 * Mocks follow AppSmoke.test.tsx: everything environment-bound is stubbed so
 * the render exercises App's own import wiring rather than WebGL or OPFS.
 */

vi.mock('../map/MapProviderView', () => ({
  MapProviderView: () => <div data-testid="map-stub" />,
}))
vi.mock('../components/NoGpsTray', () => ({ NoGpsTray: () => null, NO_GPS_PHOTO_DRAG_TYPE: 'x' }))
vi.mock('../components/PhotoListPanel', () => ({ PhotoListPanel: () => null }))
vi.mock('../components/PhotoCompareModal', () => ({ PhotoCompareModal: () => null }))
vi.mock('../components/PhotoPreviewModal', () => ({ PhotoPreviewModal: () => null }))
vi.mock('../contexts/I18nContext', () => ({
  // Echo the key AND its params so the progress banner's numbers are assertable.
  useI18n: () => ({
    t: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k),
    locale: 'en',
    setLocale: vi.fn(),
  }),
}))
vi.mock('../hooks/useMapStyle', () => ({ useMapStyle: () => ['mapbox-streets', vi.fn(), []] }))
vi.mock('../config/mapProviders', () => ({
  getStyleForId: () => 'mapbox://styles/mapbox/streets-v12',
  setProviderToken: vi.fn(),
  subscribeToProvider: () => () => {},
  getProviderSnapshot: () => 0,
  getMapboxAccessToken: () => '',
}))

/** Hashes the session "already owns" — mutated by the fake import on commit. */
const committedHashes = new Set<string>()

vi.mock('../hooks/useCorridorSessionOPFS', () => ({
  useCorridorSessionOPFS: () => ({
    session: {
      id: 's', version: 1, createdAt: '', updatedAt: '', mapStyleId: 'mapbox-streets',
      discipline: 'rally', use1NmAfterSp: false, geojson: null, leftSegments: null,
      rightSegments: null, gates: null, points: null, exactPoints: null,
      markers: [], groundMarkers: [], noGpsPhotos: [], noGpsTrayOpen: true,
    },
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
    // The live read the fix introduced — returns whatever has been committed
    // so far, exactly like the real ref-backed getter.
    getExistingContentHashes: () => new Set(committedHashes),
    commitImportedPhotos: vi.fn(),
    placeNoGpsPhoto: vi.fn(),
    removePhoto: vi.fn(),
    renamePhoto: vi.fn(),
    setUse1NmAfterSp: vi.fn(),
    setComputedData: vi.fn(),
    saveOriginalKmlText: vi.fn(),
    loadOriginalKmlText: vi.fn(),
  }),
}))

/** Resolves when the test says so, so a second drop can land mid-import. */
let releaseImport: (() => void) | null = null
const importSpy = vi.fn()

vi.mock('../photoImport/importPhotosToStorage', () => ({
  importPhotosToStorage: async (
    _storage: unknown,
    _dir: unknown,
    files: File[],
    opts: { existingContentHashes: ReadonlySet<string>; onProgress?: (d: number, t: number) => void },
  ) => {
    importSpy(opts.existingContentHashes)
    await new Promise<void>((resolve) => { releaseImport = resolve })
    // Commit: from here on the session owns these hashes.
    for (const f of files) committedHashes.add(`hash-${f.name}`)
    opts.onProgress?.(files.length, files.length)
    return { ok: [], failed: [], duplicates: [] }
  },
}))

import App from '../App'

const file = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/jpeg' })
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('photo import re-entrancy', () => {
  beforeEach(() => {
    committedHashes.clear()
    importSpy.mockClear()
    releaseImport = null
    window.matchMedia = window.matchMedia || ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList))
  })
  afterEach(() => cleanup())

  /** Drive the hidden file input the way the file picker does. */
  async function selectFiles(container: HTMLElement, files: File[]) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
  }

  it('queues a second selection instead of running it concurrently', async () => {
    const { container } = render(<App />)
    await selectFiles(container, [file('a.jpg')])
    expect(importSpy).toHaveBeenCalledTimes(1)

    // Second selection while the first is still in flight.
    await selectFiles(container, [file('b.jpg')])
    expect(importSpy, 'the second batch must WAIT, not run in parallel').toHaveBeenCalledTimes(1)

    releaseImport?.()
    await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(2))
  })

  it('hands the queued batch the hashes the FIRST batch committed', async () => {
    // THE regression. Pre-fix, both runs read a dedup set built before either
    // committed, so the same file imported twice under two random pm- ids.
    const { container } = render(<App />)
    await selectFiles(container, [file('a.jpg')])
    releaseImport?.()
    await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(1))

    await selectFiles(container, [file('b.jpg')])
    await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(2))

    const secondSet = importSpy.mock.calls[1][0] as ReadonlySet<string>
    expect(secondSet.has('hash-a.jpg'), 'queued batch got a stale dedup set').toBe(true)
  })

  it('shows progress for a batch that is still queued', async () => {
    const { container } = render(<App />)
    await selectFiles(container, [file('a.jpg')])
    await selectFiles(container, [file('b.jpg')])
    // Burst-wide total: the queued file counts immediately, so the bar moves
    // on the second drop instead of sitting there until the first finishes.
    await waitFor(() => {
      expect(container.textContent).toContain('"total":2')
    })
    releaseImport?.()
  })
})

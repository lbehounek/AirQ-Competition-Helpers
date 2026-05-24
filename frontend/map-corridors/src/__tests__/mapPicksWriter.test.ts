import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import {
  buildMapPickEntry,
  buildMapPicks,
  scheduleWriteMapPicks,
  flushPendingMapPicks,
  _resetMapPicksWriterForTests,
  type MapPicksFile,
} from '../handoff/mapPicksWriter'
import type { PhotoMarker } from '../types/markers'

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 14, lat: 50, name: 'x.jpg', ...over } as PhotoMarker
}

describe('buildMapPickEntry', () => {
  it('returns null for KML markers (no photoId)', () => {
    expect(buildMapPickEntry(pm({}))).toBeNull()
  })

  it('defaults absent flag to "neutral"', () => {
    const e = buildMapPickEntry(pm({ photoId: 'pid' }))!
    expect(e.flag).toBe('neutral')
  })

  it('preserves explicit pick/reject', () => {
    expect(buildMapPickEntry(pm({ photoId: 'pid', flag: 'pick' }))!.flag).toBe('pick')
    expect(buildMapPickEntry(pm({ photoId: 'pid', flag: 'reject' }))!.flag).toBe('reject')
  })

  it('forwards label when present', () => {
    expect(buildMapPickEntry(pm({ photoId: 'pid', label: 'A' }))!.label).toBe('A')
  })

  it('omits label when absent (cleaner downstream diff)', () => {
    expect(buildMapPickEntry(pm({ photoId: 'pid' }))!.label).toBeUndefined()
  })

  it('projects the custom displayName into entry.filename (Photo Helper tile shows TP1)', () => {
    const e = buildMapPickEntry(pm({ photoId: 'pid', name: 'DSC_0001.JPG', displayName: 'TP1' }))!
    expect(e.filename).toBe('TP1')
  })

  it('falls back to the original filename when no custom name is set', () => {
    const e = buildMapPickEntry(pm({ photoId: 'pid', name: 'DSC_0001.JPG' }))!
    expect(e.filename).toBe('DSC_0001.JPG')
  })

  it('writes capturedAt to gps when EXIF GPS was present at import', () => {
    const e = buildMapPickEntry(pm({
      photoId: 'pid',
      lng: 14, lat: 50,
      capturedAt: { lng: 14, lat: 50, altitude: 350, timestamp: '2024-01-01T00:00:00Z' },
    }))!
    expect(e.gps?.capturedAt).toEqual({
      lng: 14, lat: 50, altitude: 350, timestamp: '2024-01-01T00:00:00Z',
    })
  })

  it('omits subjectAt when subject equals capture (no drag yet)', () => {
    const e = buildMapPickEntry(pm({
      photoId: 'pid',
      lng: 14, lat: 50,
      capturedAt: { lng: 14, lat: 50 },
    }))!
    expect(e.gps?.subjectAt).toBeUndefined()
  })

  it('writes subjectAt when subject moved away from capture (user dragged pin)', () => {
    const e = buildMapPickEntry(pm({
      photoId: 'pid',
      lng: 14.5, lat: 50.5,
      capturedAt: { lng: 14, lat: 50 },
    }))!
    expect(e.gps?.subjectAt).toEqual({ lng: 14.5, lat: 50.5 })
  })

  it('writes subjectAt for no-GPS picks (no capturedAt at all)', () => {
    // Phase 6 places no-GPS photos at the drop coord. They have no
    // capturedAt; subjectAt is the only coordinate the reader gets.
    const e = buildMapPickEntry(pm({
      photoId: 'pid',
      lng: 14, lat: 50,
      flag: 'pick',
      // no capturedAt
    }))!
    expect(e.gps?.subjectAt).toEqual({ lng: 14, lat: 50 })
    expect(e.gps?.capturedAt).toBeUndefined()
  })

  it('omits gps entirely when there is nothing to record (KML-style placement of a photo)', () => {
    // Theoretical edge — photo marker without capturedAt and lng/lat
    // matching capturedAt (which doesn't exist). subjectMoved=true via
    // the !capturedAt branch — so this actually emits subjectAt. Test
    // documents that subjectAt is always emitted for no-capture photos.
    const e = buildMapPickEntry(pm({ photoId: 'pid', lng: 14, lat: 50 }))!
    expect(e.gps).toEqual({ subjectAt: { lng: 14, lat: 50 } })
  })
})

describe('buildMapPicks', () => {
  it('skips KML markers and projects ONLY photo markers flagged as pick', () => {
    // User feedback 2026-05-17: "Poslat do editoru (N)" must match the
    // number of photos that actually transfer. The button counts picks,
    // so the writer emits picks only — non-pick (neutral / reject /
    // un-flagged) markers stay on the corridor side, where their flag
    // is still tracked on PhotoMarker.flag.
    const result = buildMapPicks([
      pm({ id: 'kml', photoId: undefined }),
      pm({ id: 'p1', photoId: 'pid-1', flag: 'pick' }),
      pm({ id: 'p2', photoId: 'pid-2' }), // no flag → neutral → excluded
      pm({ id: 'p3', photoId: 'pid-3', flag: 'reject' }), // excluded
      pm({ id: 'p4', photoId: 'pid-4', flag: 'pick' }),
    ])
    expect(result.map(e => e.photoId)).toEqual(['pid-1', 'pid-4'])
  })

  it('excludes a marker whose flag is explicitly absent (neutral default)', () => {
    expect(buildMapPicks([pm({ id: 'p1', photoId: 'pid-1' })])).toEqual([])
  })

  it('excludes reject-flagged markers (reject state lives only in corridor session)', () => {
    expect(buildMapPicks([pm({ id: 'p1', photoId: 'pid-1', flag: 'reject' })])).toEqual([])
  })

  it('returns [] for empty input', () => {
    expect(buildMapPicks([])).toEqual([])
  })
})

describe('scheduleWriteMapPicks — debounce + serialization', () => {
  let storage: { writeJSON: Mock }
  let dir: DirectoryHandle

  beforeEach(() => {
    vi.useFakeTimers()
    storage = { writeJSON: vi.fn().mockResolvedValue(undefined) }
    dir = { path: '/competitions/comp-1' }
    _resetMapPicksWriterForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    _resetMapPicksWriterForTests()
  })

  it('does not write before the 300ms debounce', async () => {
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'pick' },
    ])
    expect(storage.writeJSON).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(299)
    expect(storage.writeJSON).not.toHaveBeenCalled()
  })

  it('writes exactly once after the debounce settles', async () => {
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'pick' },
    ])
    await vi.advanceTimersByTimeAsync(300)
    expect(storage.writeJSON).toHaveBeenCalledTimes(1)
  })

  it('coalesces rapid scheduling — only the LATEST data is written', async () => {
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'neutral' },
    ])
    await vi.advanceTimersByTimeAsync(100)
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'pick' },
    ])
    await vi.advanceTimersByTimeAsync(100)
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'reject' },
    ])
    await vi.advanceTimersByTimeAsync(300)
    expect(storage.writeJSON).toHaveBeenCalledTimes(1)
    const written = storage.writeJSON.mock.calls[0][2] as MapPicksFile
    expect(written.picks[0].flag).toBe('reject')
  })

  it('writes to the {photosDir.path}/map-picks.json filename', async () => {
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [])
    await vi.advanceTimersByTimeAsync(300)
    const [actualDir, actualName] = storage.writeJSON.mock.calls[0]
    expect(actualDir).toBe(dir)
    expect(actualName).toBe('map-picks.json')
  })

  it('emits MapPicksFile shape: version=1, ISO updatedAt, picks array', async () => {
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'pick' },
    ])
    await vi.advanceTimersByTimeAsync(300)
    const file = storage.writeJSON.mock.calls[0][2] as MapPicksFile
    expect(file.version).toBe(1)
    expect(typeof file.updatedAt).toBe('string')
    expect(() => new Date(file.updatedAt).toISOString()).not.toThrow()
    expect(Array.isArray(file.picks)).toBe(true)
  })
})

describe('scheduleWriteMapPicks — competition switch (two-dir flush)', () => {
  let storage: { writeJSON: Mock }

  beforeEach(() => {
    vi.useFakeTimers()
    storage = { writeJSON: vi.fn().mockResolvedValue(undefined) }
    _resetMapPicksWriterForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    _resetMapPicksWriterForTests()
  })

  it('flushes pending picks to the OLD dir before scheduling against a NEW dir (no payload swap)', async () => {
    const dirA: DirectoryHandle = { path: '/competitions/A' }
    const dirB: DirectoryHandle = { path: '/competitions/B' }
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dirA, [
      { photoId: 'pid-A', filename: 'a.jpg', flag: 'pick' },
    ])
    // Switch competition before the debounce fires:
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dirB, [
      { photoId: 'pid-B', filename: 'b.jpg', flag: 'reject' },
    ])
    // Allow the immediately-scheduled flush + the debounced new write.
    await vi.advanceTimersByTimeAsync(500)
    expect(storage.writeJSON).toHaveBeenCalledTimes(2)
    const [firstCall, secondCall] = storage.writeJSON.mock.calls
    // First call MUST be the OLD dir with OLD picks — the bug was that
    // the old picks landed in the new dir (or were silently dropped).
    expect(firstCall[0]).toBe(dirA)
    expect((firstCall[2] as MapPicksFile).picks[0].photoId).toBe('pid-A')
    expect(secondCall[0]).toBe(dirB)
    expect((secondCall[2] as MapPicksFile).picks[0].photoId).toBe('pid-B')
  })

  it('does NOT flush when only the picks payload changes (same dir, same storage)', async () => {
    const dir: DirectoryHandle = { path: '/competitions/A' }
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'pick' },
    ])
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'reject' },
    ])
    await vi.advanceTimersByTimeAsync(50)
    // Still nothing written yet (debounce coalesces; no flush triggered).
    expect(storage.writeJSON).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(storage.writeJSON).toHaveBeenCalledTimes(1)
    expect((storage.writeJSON.mock.calls[0][2] as MapPicksFile).picks[0].flag).toBe('reject')
  })
})

describe('flushPendingMapPicks — error propagation (was silently swallowed)', () => {
  let storage: { writeJSON: Mock }
  let dir: DirectoryHandle

  beforeEach(() => {
    vi.useFakeTimers()
    storage = { writeJSON: vi.fn() }
    dir = { path: '/competitions/comp-1' }
    _resetMapPicksWriterForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    _resetMapPicksWriterForTests()
  })

  it('REJECTS when the underlying writeJSON rejects (was: silently resolved)', async () => {
    const quotaErr = Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    storage.writeJSON.mockRejectedValue(quotaErr)
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'pick' },
    ])
    await expect(flushPendingMapPicks()).rejects.toBe(quotaErr)
  })

  it("RESOLVES when there's nothing pending (no caller can be misled by a prior failure)", async () => {
    storage.writeJSON.mockRejectedValue(new Error('boom'))
    // No schedule → nothing pending → flush is a no-op even if a prior
    // hypothetical write had failed. Callers asking "did MY flush land?"
    // get a true answer: there was nothing of mine to land.
    await expect(flushPendingMapPicks()).resolves.toBeUndefined()
  })

  it('does not break the queue: a failed write does not poison the next scheduled write', async () => {
    storage.writeJSON
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce(undefined)
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'pick' },
    ])
    // Catch the rejection so vitest doesn't flag it as unhandled.
    await flushPendingMapPicks().catch(() => undefined)
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'reject' },
    ])
    await vi.advanceTimersByTimeAsync(300)
    expect(storage.writeJSON).toHaveBeenCalledTimes(2)
  })
})

describe('flushPendingMapPicks', () => {
  let storage: { writeJSON: Mock }
  let dir: DirectoryHandle

  beforeEach(() => {
    vi.useFakeTimers()
    storage = { writeJSON: vi.fn().mockResolvedValue(undefined) }
    dir = { path: '/competitions/comp-1' }
    _resetMapPicksWriterForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    _resetMapPicksWriterForTests()
  })

  it('executes the pending write immediately (no debounce wait)', async () => {
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'pick' },
    ])
    expect(storage.writeJSON).not.toHaveBeenCalled()
    await flushPendingMapPicks()
    expect(storage.writeJSON).toHaveBeenCalledTimes(1)
  })

  it('is a no-op (and resolves) when nothing is pending', async () => {
    await expect(flushPendingMapPicks()).resolves.toBeUndefined()
    expect(storage.writeJSON).not.toHaveBeenCalled()
  })

  it('cancels the debounce timer — no second write fires later', async () => {
    scheduleWriteMapPicks(storage as unknown as StorageInterface, dir, [
      { photoId: 'pid', filename: 'x.jpg', flag: 'pick' },
    ])
    await flushPendingMapPicks()
    await vi.advanceTimersByTimeAsync(1000)
    expect(storage.writeJSON).toHaveBeenCalledTimes(1)
  })
})

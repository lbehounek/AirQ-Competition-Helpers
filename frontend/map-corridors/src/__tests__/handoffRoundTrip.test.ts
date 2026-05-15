// Cross-app handoff integration test. Composes mapPicksWriter and
// syncEditorPicksOnce against a shared in-memory storage, simulating
// the photo-helper side by writing photo-helper-picks.json directly
// (the photo-helper writer is unit-tested separately and would pull a
// cross-package dependency into this app's vitest run).
//
// The CRITICAL bugs surfaced in PR #64 review live here:
//  - The map-picks write effect used to fire with empty markers before
//    the session loaded, blanking the file on cold load.
//  - useEditorPicksSync used to capture setMarkers in a stale closure,
//    overwriting the live session on visibilitychange.
//  - mapPicksWriter swallowed write failures, so flushPendingMapPicks
//    resolved even when the bytes never hit disk.
//
// This file exercises the round-trip end-to-end with no React.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import {
  buildMapPicks,
  flushPendingMapPicks,
  scheduleWriteMapPicks,
  _resetMapPicksWriterForTests,
} from '../handoff/mapPicksWriter'
import { syncEditorPicksOnce } from '../hooks/useEditorPicksSync'
import type { PhotoMarker } from '../types/markers'

// In-memory storage. Files are addressed by `${dir.path}::${name}`. Good
// enough for round-trip checks and lightly mirrors the OPFS/Electron
// layout. We only implement the methods the handoff code calls; throw
// loudly for anything else so a future caller addition is caught.
function makeStorage(): StorageInterface & { _files: Map<string, unknown>; _crash: boolean } {
  const files = new Map<string, unknown>()
  let crash = false
  const notImpl = (name: string) => () => { throw new Error(`fakeStorage: ${name} not implemented`) }
  const api = {
    _files: files,
    get _crash() { return crash },
    set _crash(v: boolean) { crash = v },
    async writeJSON(dir: DirectoryHandle, name: string, data: unknown) {
      if (crash) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
      files.set(`${dir.path}::${name}`, data)
    },
    async readJSON<T>(dir: DirectoryHandle, name: string): Promise<T | null> {
      const got = files.get(`${dir.path}::${name}`)
      return (got as T | undefined) ?? null
    },
    init: notImpl('init') as never,
    ensureSessionDirs: notImpl('ensureSessionDirs') as never,
    savePhotoFile: notImpl('savePhotoFile') as never,
    getPhotoBlob: notImpl('getPhotoBlob') as never,
    deletePhotoFile: notImpl('deletePhotoFile') as never,
    savePhotoThumb: notImpl('savePhotoThumb') as never,
    getPhotoThumb: notImpl('getPhotoThumb') as never,
    deletePhotoThumb: notImpl('deletePhotoThumb') as never,
    clearDirectory: notImpl('clearDirectory') as never,
    deleteSessionDir: notImpl('deleteSessionDir') as never,
    getDirectoryHandle: notImpl('getDirectoryHandle') as never,
    isAvailable: notImpl('isAvailable') as never,
    getStorageEstimate: notImpl('getStorageEstimate') as never,
    listDirectory: notImpl('listDirectory') as never,
  }
  return api as unknown as StorageInterface & { _files: Map<string, unknown>; _crash: boolean }
}

const compDir: DirectoryHandle = { path: '/competitions/comp-1' }

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: over.id ?? 'pm-x', lng: 14, lat: 50, name: 'photo.jpg', ...over } as PhotoMarker
}

beforeEach(() => {
  vi.useFakeTimers()
  _resetMapPicksWriterForTests()
})

afterEach(() => {
  vi.useRealTimers()
  _resetMapPicksWriterForTests()
})

describe('cross-app round-trip — map writes, editor reads, editor writes back, map applies', () => {
  it('map writes a pick → editor side can read it from map-picks.json', async () => {
    const storage = makeStorage()
    const markers: PhotoMarker[] = [
      pm({ id: 'pm-1', photoId: 'pm-1', flag: 'pick', capturedAt: { lng: 14, lat: 50 } }),
    ]
    scheduleWriteMapPicks(storage, compDir, buildMapPicks(markers))
    await flushPendingMapPicks()
    const file = storage._files.get('/competitions/comp-1::map-picks.json') as { picks: Array<{ photoId: string; flag: string }> }
    expect(file).toBeTruthy()
    expect(file.picks).toHaveLength(1)
    expect(file.picks[0]).toMatchObject({ photoId: 'pm-1', flag: 'pick' })
  })

  it('editor writes a label → map applies it via syncEditorPicksOnce (newer-wins)', async () => {
    const storage = makeStorage()
    // photo-helper writes its file directly (matches what editorPicksWriter
    // produces). T2 is strictly newer than the local marker's T1.
    await storage.writeJSON(compDir, 'photo-helper-picks.json', {
      version: 1, updatedAt: 'now',
      picks: [{ photoId: 'pm-1', label: 'B', labelUpdatedAt: '2025-02-01T00:00:00Z' }],
    })
    const markers: PhotoMarker[] = [
      pm({ id: 'pm-1', photoId: 'pm-1', flag: 'pick', label: 'A' as never, labelUpdatedAt: '2025-01-01T00:00:00Z' }),
    ]
    let updated: PhotoMarker[] = markers
    const setMarkers = async (updater: (prev: readonly PhotoMarker[]) => readonly PhotoMarker[]) => {
      updated = [...updater(updated)]
    }
    const result = await syncEditorPicksOnce(storage, compDir, setMarkers)
    expect(result.updates).toBe(1)
    expect(updated[0].label).toBe('B')
    expect(updated[0].labelUpdatedAt).toBe('2025-02-01T00:00:00Z')
  })

  it('local edits in flight win on tie-break — editor file with EQUAL timestamp does not overwrite', async () => {
    const storage = makeStorage()
    const t = '2025-01-01T00:00:00Z'
    await storage.writeJSON(compDir, 'photo-helper-picks.json', {
      version: 1, updatedAt: 'now',
      picks: [{ photoId: 'pm-1', label: 'remote', labelUpdatedAt: t }],
    })
    const markers: PhotoMarker[] = [
      pm({ id: 'pm-1', photoId: 'pm-1', flag: 'pick', label: 'local' as never, labelUpdatedAt: t }),
    ]
    let updated: PhotoMarker[] = markers
    const result = await syncEditorPicksOnce(
      storage,
      compDir,
      async (updater) => { updated = [...updater(updated)] },
    )
    expect(result.updates).toBe(0)
    expect(updated[0].label).toBe('local')
  })

  it('editor CLEAR (empty label) propagates to map when remote is newer', async () => {
    const storage = makeStorage()
    await storage.writeJSON(compDir, 'photo-helper-picks.json', {
      version: 1, updatedAt: 'now',
      picks: [{ photoId: 'pm-1', label: '', labelUpdatedAt: '2025-02-01T00:00:00Z' }],
    })
    const markers: PhotoMarker[] = [
      pm({ id: 'pm-1', photoId: 'pm-1', flag: 'pick', label: 'A' as never, labelUpdatedAt: '2025-01-01T00:00:00Z' }),
    ]
    let updated: PhotoMarker[] = markers
    await syncEditorPicksOnce(storage, compDir, async u => { updated = [...u(updated)] })
    expect(updated[0].label).toBeUndefined()
  })

  it('editor file entries WITHOUT the pm- prefix are ignored (map owns the photo identity)', async () => {
    const storage = makeStorage()
    await storage.writeJSON(compDir, 'photo-helper-picks.json', {
      version: 1, updatedAt: 'now',
      picks: [
        { photoId: 'editor-owned', label: 'X', labelUpdatedAt: '2025-02-01T00:00:00Z' },
        { photoId: 'pm-1', label: 'Z', labelUpdatedAt: '2025-02-01T00:00:00Z' },
      ],
    })
    const markers: PhotoMarker[] = [
      pm({ id: 'pm-1', photoId: 'pm-1', flag: 'pick' }),
    ]
    let updated: PhotoMarker[] = markers
    const result = await syncEditorPicksOnce(storage, compDir, async u => { updated = [...u(updated)] })
    expect(result.updates).toBe(1)
    expect(updated[0].label).toBe('Z')
  })
})

describe('cross-app round-trip — failure modes (silent in pre-fix code)', () => {
  it('flushPendingMapPicks REJECTS on quota error (was: silently resolved → caller navigated to stale file)', async () => {
    const storage = makeStorage()
    storage._crash = true
    scheduleWriteMapPicks(storage, compDir, [
      { photoId: 'pm-1', filename: 'a.jpg', flag: 'pick' },
    ])
    await expect(flushPendingMapPicks()).rejects.toMatchObject({ name: 'QuotaExceededError' })
    // …and the file genuinely never landed.
    expect(storage._files.has('/competitions/comp-1::map-picks.json')).toBe(false)
  })

  it('syncEditorPicksOnce returns 0 updates for a missing editor file (absent ≠ empty)', async () => {
    const storage = makeStorage()
    const result = await syncEditorPicksOnce(storage, compDir, async () => undefined)
    expect(result.updates).toBe(0)
  })

  it('competition switch: picks for competition A do not leak into competition B map-picks file', async () => {
    const storage = makeStorage()
    const compDirB: DirectoryHandle = { path: '/competitions/comp-2' }
    scheduleWriteMapPicks(storage, compDir, [
      { photoId: 'pm-A', filename: 'a.jpg', flag: 'pick' },
    ])
    scheduleWriteMapPicks(storage, compDirB, [
      { photoId: 'pm-B', filename: 'b.jpg', flag: 'reject' },
    ])
    await vi.advanceTimersByTimeAsync(500)
    const a = storage._files.get('/competitions/comp-1::map-picks.json') as { picks: Array<{ photoId: string }> }
    const b = storage._files.get('/competitions/comp-2::map-picks.json') as { picks: Array<{ photoId: string }> }
    expect(a.picks[0].photoId).toBe('pm-A')
    expect(b.picks[0].photoId).toBe('pm-B')
  })
})

import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import { syncEditorPicksOnce } from '../hooks/useEditorPicksSync'
import type { PhotoMarker } from '../types/markers'

const competitionDir: DirectoryHandle = { path: '/competitions/c-1' }

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 14, lat: 50, name: 'x.jpg', ...over } as PhotoMarker
}

interface FakeStorage { readJSON: Mock }
function fakeStorage(): FakeStorage {
  return { readJSON: vi.fn() }
}

function recordingSetMarkers() {
  const calls: PhotoMarker[][] = []
  let current: PhotoMarker[] = []
  const setMarkers = vi.fn(async (updater: (prev: readonly PhotoMarker[]) => readonly PhotoMarker[]) => {
    current = [...updater(current)]
    calls.push(current)
  })
  return {
    setMarkers,
    seed(markers: PhotoMarker[]) { current = [...markers] },
    last(): readonly PhotoMarker[] { return current },
    calls,
  }
}

describe('syncEditorPicksOnce — file presence', () => {
  it('no-op when file is absent', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue(null)
    const session = recordingSetMarkers()
    const result = await syncEditorPicksOnce(storage as unknown as StorageInterface, competitionDir, session.setMarkers)
    expect(result.updates).toBe(0)
    expect(session.setMarkers).not.toHaveBeenCalled()
  })

  it('no-op when picks[] is missing/malformed', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({ version: 1, updatedAt: 'x' })
    const session = recordingSetMarkers()
    const result = await syncEditorPicksOnce(storage as unknown as StorageInterface, competitionDir, session.setMarkers)
    expect(result.updates).toBe(0)
  })
})

describe('syncEditorPicksOnce — conflict resolution', () => {
  it('applies remote label when remote is newer than local', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1, updatedAt: 'x',
      picks: [{ photoId: 'pm-1', label: 'A', labelUpdatedAt: '2024-02-01T00:00:00Z' }],
    })
    const session = recordingSetMarkers()
    session.seed([pm({ id: 'pm-1', photoId: 'pm-1', label: 'B', labelUpdatedAt: '2024-01-01T00:00:00Z' })])
    const result = await syncEditorPicksOnce(storage as unknown as StorageInterface, competitionDir, session.setMarkers)
    expect(result.updates).toBe(1)
    const updated = session.last().find(m => m.id === 'pm-1')!
    expect(updated.label).toBe('A')
    expect(updated.labelUpdatedAt).toBe('2024-02-01T00:00:00Z')
  })

  it('keeps local label when local is newer (tie-break in-flight protection)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1, updatedAt: 'x',
      picks: [{ photoId: 'pm-1', label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z' }],
    })
    const session = recordingSetMarkers()
    session.seed([pm({ id: 'pm-1', photoId: 'pm-1', label: 'B', labelUpdatedAt: '2024-02-01T00:00:00Z' })])
    const result = await syncEditorPicksOnce(storage as unknown as StorageInterface, competitionDir, session.setMarkers)
    expect(result.updates).toBe(0)
    expect(session.last()[0].label).toBe('B')
  })

  it('equal timestamps → local wins (deterministic tie-break)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1, updatedAt: 'x',
      picks: [{ photoId: 'pm-1', label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z' }],
    })
    const session = recordingSetMarkers()
    session.seed([pm({ id: 'pm-1', photoId: 'pm-1', label: 'B', labelUpdatedAt: '2024-01-01T00:00:00Z' })])
    const result = await syncEditorPicksOnce(storage as unknown as StorageInterface, competitionDir, session.setMarkers)
    expect(result.updates).toBe(0)
    expect(session.last()[0].label).toBe('B')
  })

  it('applies remote when local has no labelUpdatedAt (legacy data)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1, updatedAt: 'x',
      picks: [{ photoId: 'pm-1', label: 'C', labelUpdatedAt: '2024-01-01T00:00:00Z' }],
    })
    const session = recordingSetMarkers()
    session.seed([pm({ id: 'pm-1', photoId: 'pm-1', label: 'A' })])
    const result = await syncEditorPicksOnce(storage as unknown as StorageInterface, competitionDir, session.setMarkers)
    expect(result.updates).toBe(1)
    expect(session.last()[0].label).toBe('C')
  })

  it('clears local label when remote is empty AND newer', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1, updatedAt: 'x',
      picks: [{ photoId: 'pm-1', label: '', labelUpdatedAt: '2024-02-01T00:00:00Z' }],
    })
    const session = recordingSetMarkers()
    session.seed([pm({ id: 'pm-1', photoId: 'pm-1', label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z' })])
    await syncEditorPicksOnce(storage as unknown as StorageInterface, competitionDir, session.setMarkers)
    const updated = session.last()[0]
    expect(updated.label).toBeUndefined()
    expect(updated.labelUpdatedAt).toBe('2024-02-01T00:00:00Z')
  })
})

describe('syncEditorPicksOnce — never inserts', () => {
  it('ignores remote entry for a photoId not present in local markers', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1, updatedAt: 'x',
      picks: [{ photoId: 'pm-unknown', label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z' }],
    })
    const session = recordingSetMarkers()
    session.seed([pm({ id: 'pm-1', photoId: 'pm-1' })])
    const result = await syncEditorPicksOnce(storage as unknown as StorageInterface, competitionDir, session.setMarkers)
    expect(result.updates).toBe(0)
    expect(session.last().map(m => m.id)).toEqual(['pm-1'])
  })

  it('ignores non-pm- prefixed entries (editor-only photos)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1, updatedAt: 'x',
      picks: [{ photoId: 'photo-helper-own', label: 'Z', labelUpdatedAt: '2024-02-01T00:00:00Z' }],
    })
    const session = recordingSetMarkers()
    session.seed([pm({ id: 'pm-1', photoId: 'pm-1' })])
    const result = await syncEditorPicksOnce(storage as unknown as StorageInterface, competitionDir, session.setMarkers)
    expect(result.updates).toBe(0)
  })
})

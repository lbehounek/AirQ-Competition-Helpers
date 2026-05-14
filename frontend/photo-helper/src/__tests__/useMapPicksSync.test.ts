import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import {
  syncMapPicksOnce,
  type MapPicksSyncSessionApi,
} from '../hooks/useMapPicksSync'
import type { ApiPhoto } from '../types/api'

// jsdom shim for URL.createObjectURL (used by syncMapPicksOnce on insert)
beforeEach(() => {
  if (!('createObjectURL' in URL)) {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:fake'
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

const competitionDir: DirectoryHandle = { path: '/competitions/comp-1' }
const photosDir: DirectoryHandle = { path: '/competitions/comp-1/photos' }

interface FakeStorage extends Pick<StorageInterface, 'readJSON' | 'getPhotoBlob'> {
  readJSON: Mock
  getPhotoBlob: Mock
}

function fakeStorage(): FakeStorage {
  return {
    readJSON: vi.fn(),
    getPhotoBlob: vi.fn(),
  }
}

function fakeSession(initialCandidates: ApiPhoto[] = []): MapPicksSyncSessionApi & {
  addCandidate: Mock
  removeCandidate: Mock
  setCandidateFlag: Mock
} {
  const candidates = [...initialCandidates]
  const api = {
    candidates,
    addCandidate: vi.fn(async (p: ApiPhoto) => { candidates.push(p) }),
    removeCandidate: vi.fn(async (id: string) => {
      const idx = candidates.findIndex(p => p.id === id)
      if (idx >= 0) candidates.splice(idx, 1)
    }),
    setCandidateFlag: vi.fn(async (id: string, flag: ApiPhoto['flag']) => {
      const found = candidates.find(p => p.id === id)
      if (found) found.flag = flag
    }),
  }
  return api as MapPicksSyncSessionApi & { addCandidate: Mock; removeCandidate: Mock; setCandidateFlag: Mock }
}

function pmEntry(id: string, flag: 'pick' | 'neutral' | 'reject' = 'pick') {
  return { photoId: id, filename: `${id}.jpg`, flag }
}

function existing(id: string, flag: ApiPhoto['flag'] = 'neutral'): ApiPhoto {
  return {
    id,
    sessionId: 's',
    url: 'blob:existing',
    filename: `${id}.jpg`,
    canvasState: {
      position: { x: 0, y: 0 },
      scale: 1,
      brightness: 0,
      contrast: 1,
      sharpness: 0,
      whiteBalance: { temperature: 0, tint: 0, auto: false },
      labelPosition: 'bottom-left',
    },
    label: '',
    flag,
  }
}

describe('syncMapPicksOnce — file absence', () => {
  it('returns zero counts when map-picks.json is missing', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue(null)
    const session = fakeSession()
    const result = await syncMapPicksOnce(
      storage as unknown as StorageInterface,
      competitionDir,
      photosDir,
      session,
    )
    expect(result).toEqual({ inserts: 0, updates: 0, deletes: 0 })
    expect(session.addCandidate).not.toHaveBeenCalled()
    expect(session.removeCandidate).not.toHaveBeenCalled()
  })

  it('does NOT delete pool entries when the file is missing (absence ≠ empty)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue(null)
    const session = fakeSession([existing('pm-abc', 'pick')])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.removeCandidate).not.toHaveBeenCalled()
  })

  it('treats malformed payload (missing picks[]) as no-op', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({ version: 1, updatedAt: 'x' })
    const session = fakeSession([existing('pm-abc')])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.deletes).toBe(0)
  })
})

describe('syncMapPicksOnce — insert path', () => {
  it('inserts a new pm- entry not yet in the pool', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-new', 'pick')],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(32)], { type: 'image/jpeg' }))
    const session = fakeSession([])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(1)
    expect(session.addCandidate).toHaveBeenCalledTimes(1)
    const inserted = session.addCandidate.mock.calls[0][0] as ApiPhoto
    expect(inserted.id).toBe('pm-new')
    expect(inserted.filename).toBe('pm-new.jpg')
    expect(inserted.flag).toBe('pick')
    expect(inserted.canvasState.scale).toBe(1) // matches createDefaultCanvasState
  })

  it('skips insert when the photo blob is missing (orphan entry)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-orphan')],
    })
    storage.getPhotoBlob.mockRejectedValue(new Error('NotFoundError'))
    const session = fakeSession([])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(0)
    expect(session.addCandidate).not.toHaveBeenCalled()
  })

  it('ignores entries WITHOUT the pm- prefix (photo-helper-originated)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{ photoId: 'photo-from-helper', filename: 'a.jpg', flag: 'pick' as const }],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([]))
    const session = fakeSession([])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(0)
    expect(session.addCandidate).not.toHaveBeenCalled()
  })
})

describe('syncMapPicksOnce — update path', () => {
  it('updates flag on a pm- entry already in the pool', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-abc', 'pick')],
    })
    const session = fakeSession([existing('pm-abc', 'neutral')])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.updates).toBe(1)
    expect(session.setCandidateFlag).toHaveBeenCalledWith('pm-abc', 'pick')
  })

  it('does NOT call setCandidateFlag when flag is unchanged', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-abc', 'pick')],
    })
    const session = fakeSession([existing('pm-abc', 'pick')])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.updates).toBe(0)
    expect(session.setCandidateFlag).not.toHaveBeenCalled()
  })

  it('preserves photo-helper-owned fields on update (only flag is touched)', async () => {
    // Verified indirectly: we only call setCandidateFlag, never addCandidate
    // or any path that would clobber canvasState / label / url.
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-abc', 'reject')],
    })
    const session = fakeSession([existing('pm-abc', 'pick')])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.addCandidate).not.toHaveBeenCalled()
  })
})

describe('syncMapPicksOnce — delete path (ADR-019 cleanup)', () => {
  it('removes pool entries whose pm- photoId disappeared from the file', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [], // map-corridors has nothing left
    })
    const session = fakeSession([existing('pm-stale')])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.deletes).toBe(1)
    expect(session.removeCandidate).toHaveBeenCalledWith('pm-stale')
  })

  it('NEVER removes photo-helper-originated entries (no pm- prefix)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({ version: 1, updatedAt: 'x', picks: [] })
    const session = fakeSession([existing('photo-helper-owned')])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.removeCandidate).not.toHaveBeenCalled()
  })

  it('mixed: insert one, update one, delete one in a single pass', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [
        pmEntry('pm-new', 'pick'),
        pmEntry('pm-existing', 'reject'), // currently neutral
        // 'pm-going-away' is in the pool but not here
      ],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([]))
    const session = fakeSession([
      existing('pm-existing', 'neutral'),
      existing('pm-going-away'),
      existing('photo-helper-owned'), // must survive
    ])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(1)
    expect(result.updates).toBe(1)
    expect(result.deletes).toBe(1)
    expect(session.removeCandidate).toHaveBeenCalledWith('pm-going-away')
    expect(session.removeCandidate).not.toHaveBeenCalledWith('photo-helper-owned')
  })
})

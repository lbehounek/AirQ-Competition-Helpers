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

function fakeSession(
  initialCandidates: ApiPhoto[] = [],
  placed: string[] = [],
): MapPicksSyncSessionApi & {
  addCandidate: Mock
  importPick: Mock
  removeCandidate: Mock
  setCandidateFlag: Mock
  setCandidateLabel: Mock
  setCandidateFilename: Mock
} {
  const candidates = [...initialCandidates]
  const api = {
    candidates,
    placedIds: new Set(placed),
    addCandidate: vi.fn(async (p: ApiPhoto) => { candidates.push(p) }),
    // Auto-routes category picks into sets — modelled as "leaves the candidate
    // pool" (the real helper clears the flag and moves it into a set bucket).
    importPick: vi.fn(async (_p: ApiPhoto, _mode: 'track' | 'turningpoint') => { /* placed in a set */ }),
    removeCandidate: vi.fn(async (id: string) => {
      const idx = candidates.findIndex(p => p.id === id)
      if (idx >= 0) candidates.splice(idx, 1)
    }),
    setCandidateFlag: vi.fn(async (id: string, flag: ApiPhoto['flag']) => {
      const found = candidates.find(p => p.id === id)
      if (found) found.flag = flag
    }),
    setCandidateLabel: vi.fn(async (id: string, label: string) => {
      const found = candidates.find(p => p.id === id)
      if (found) {
        found.label = label
        found.labelUpdatedAt = new Date().toISOString()
      }
    }),
    setCandidateFilename: vi.fn(async (id: string, filename: string) => {
      const found = candidates.find(p => p.id === id)
      if (found) found.filename = filename
    }),
  }
  return api as MapPicksSyncSessionApi & {
    addCandidate: Mock
    importPick: Mock
    removeCandidate: Mock
    setCandidateFlag: Mock
    setCandidateLabel: Mock
    setCandidateFilename: Mock
  }
}

function pmEntry(
  id: string,
  flag: 'pick-track' | 'pick-turning' | 'neutral' | 'reject' = 'pick-track',
) {
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
    const session = fakeSession([existing('pm-abc', 'pick-track')])
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
  // A category-flagged pick now auto-routes into its discipline's sets via
  // `importPick` (set1→set2→tray spillover) instead of landing in the tray.
  it('auto-routes a new pick-track entry into the track sets (not the tray)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-new', 'pick-track')],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(32)], { type: 'image/jpeg' }))
    const session = fakeSession([])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(1)
    expect(session.addCandidate).not.toHaveBeenCalled()
    expect(session.importPick).toHaveBeenCalledTimes(1)
    const [photo, mode] = session.importPick.mock.calls[0] as [ApiPhoto, string]
    expect(photo.id).toBe('pm-new')
    expect(photo.filename).toBe('pm-new.jpg')
    expect(photo.flag).toBe('pick-track')
    expect(photo.canvasState.scale).toBe(1) // matches createDefaultCanvasState
    expect(mode).toBe('track')
  })

  it('auto-routes a new pick-turning entry into the turning sets', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-tp', 'pick-turning')],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(32)], { type: 'image/jpeg' }))
    const session = fakeSession([])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(1)
    // No break chosen → entry.set is undefined, passed through as the 3rd arg.
    expect(session.importPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'pm-tp' }), 'turningpoint', undefined)
  })

  it('passes entry.set (TP set-break) through to importPick', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{ photoId: 'pm-s', filename: 'pm-s.jpg', flag: 'pick-track', set: 'set2' }],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(8)], { type: 'image/jpeg' }))
    const session = fakeSession([])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.importPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'pm-s' }), 'track', 'set2')
  })

  it('does NOT re-route a photo already placed in a set (placedIds guard prevents tray duplicate)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-placed', 'pick-track')],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(8)], { type: 'image/jpeg' }))
    // pm-placed was auto-routed on a prior sync → it now lives in a set, so it
    // is reported via placedIds (and is NOT in the candidate pool).
    const session = fakeSession([], ['pm-placed'])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(0)
    expect(session.importPick).not.toHaveBeenCalled()
    expect(session.addCandidate).not.toHaveBeenCalled()
    expect(storage.getPhotoBlob).not.toHaveBeenCalled() // skipped before blob fetch
  })

  it('skips insert when the photo blob is missing (orphan entry)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-orphan')],
    })
    const notFound = Object.assign(new Error('thumb gone'), { name: 'NotFoundError' })
    storage.getPhotoBlob.mockRejectedValue(notFound)
    const session = fakeSession([])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(0)
    expect(session.addCandidate).not.toHaveBeenCalled()
  })

  it('skips insert (no throw) when getPhotoBlob throws a NON-NotFoundError — degraded storage must not crash sync', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-deny'), pmEntry('pm-ok')],
    })
    const denied = Object.assign(new Error('permission denied'), { name: 'SecurityError' })
    const okBlob = new Blob([new Uint8Array(8)], { type: 'image/jpeg' })
    storage.getPhotoBlob
      .mockRejectedValueOnce(denied)        // pm-deny
      .mockResolvedValueOnce(okBlob)        // pm-ok still inserts
    const session = fakeSession([])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(1)
    expect(session.importPick).toHaveBeenCalledTimes(1)
    expect(session.importPick.mock.calls[0][0].id).toBe('pm-ok')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('ignores entries WITHOUT the pm- prefix (photo-helper-originated)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{ photoId: 'photo-from-helper', filename: 'a.jpg', flag: 'pick-track' as const }],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([]))
    const session = fakeSession([])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(0)
    expect(session.addCandidate).not.toHaveBeenCalled()
  })
})

describe('syncMapPicksOnce — legacy flag normalization (bare `pick` → `pick-track`)', () => {
  it('normalizes a legacy bare `pick` on INSERT so the candidate carries an explicit category', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      // A pre-split map-picks.json wrote bare `pick`.
      picks: [{ photoId: 'pm-legacy', filename: 'pm-legacy.jpg', flag: 'pick' }],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(8)], { type: 'image/jpeg' }))
    const session = fakeSession([])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    // Normalized to pick-track, so it auto-routes into the track sets.
    const [inserted, mode] = session.importPick.mock.calls[0] as [ApiPhoto, string]
    expect(inserted.flag).toBe('pick-track')
    expect(mode).toBe('track')
  })

  it('normalizes a legacy bare `pick` on UPDATE (reconciles an existing candidate to pick-track)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{ photoId: 'pm-abc', filename: 'pm-abc.jpg', flag: 'pick' }],
    })
    const session = fakeSession([existing('pm-abc', 'neutral')])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.setCandidateFlag).toHaveBeenCalledWith('pm-abc', 'pick-track')
  })
})

describe('syncMapPicksOnce — update path', () => {
  it('updates flag on a pm- entry already in the pool', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-abc', 'pick-track')],
    })
    const session = fakeSession([existing('pm-abc', 'neutral')])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.updates).toBe(1)
    expect(session.setCandidateFlag).toHaveBeenCalledWith('pm-abc', 'pick-track')
  })

  it('does NOT call setCandidateFlag when flag is unchanged', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-abc', 'pick-track')],
    })
    const session = fakeSession([existing('pm-abc', 'pick-track')])
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
    const session = fakeSession([existing('pm-abc', 'pick-track')])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.addCandidate).not.toHaveBeenCalled()
  })
})

describe('syncMapPicksOnce — label sync (bidirectional)', () => {
  it('propagates label on insert', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{
        photoId: 'pm-new', filename: 'a.jpg', flag: 'pick-track',
        label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z',
      }],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(8)], { type: 'image/jpeg' }))
    const session = fakeSession([])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    // pick-track auto-routes into a set; the label rides along on the photo.
    expect(session.importPick).toHaveBeenCalledTimes(1)
    const inserted = session.importPick.mock.calls[0][0] as ApiPhoto
    expect(inserted.label).toBe('A')
    expect(inserted.labelUpdatedAt).toBe('2024-01-01T00:00:00Z')
  })

  it('updates label when remote labelUpdatedAt is newer than local', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{
        photoId: 'pm-abc', filename: 'a.jpg', flag: 'pick-track',
        label: 'B', labelUpdatedAt: '2024-02-01T00:00:00Z',
      }],
    })
    const local: ApiPhoto = { ...existing('pm-abc', 'pick-track'), label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z' }
    const session = fakeSession([local])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.setCandidateLabel).toHaveBeenCalledWith('pm-abc', 'B')
  })

  it('keeps local label when local labelUpdatedAt is newer (local-wins on edits-in-flight)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{
        photoId: 'pm-abc', filename: 'a.jpg', flag: 'pick-track',
        label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z',
      }],
    })
    const local: ApiPhoto = { ...existing('pm-abc', 'pick-track'), label: 'B', labelUpdatedAt: '2024-02-01T00:00:00Z' }
    const session = fakeSession([local])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.setCandidateLabel).not.toHaveBeenCalled()
  })

  it('tie-break: equal timestamps → local wins (no update)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{
        photoId: 'pm-abc', filename: 'a.jpg', flag: 'pick-track',
        label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z',
      }],
    })
    const local: ApiPhoto = { ...existing('pm-abc', 'pick-track'), label: 'B', labelUpdatedAt: '2024-01-01T00:00:00Z' }
    const session = fakeSession([local])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.setCandidateLabel).not.toHaveBeenCalled()
  })

  it('applies remote label when local has no labelUpdatedAt (legacy data)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{
        photoId: 'pm-abc', filename: 'a.jpg', flag: 'pick-track',
        label: 'C', labelUpdatedAt: '2024-01-01T00:00:00Z',
      }],
    })
    const local: ApiPhoto = { ...existing('pm-abc', 'pick-track'), label: 'A' }
    const session = fakeSession([local])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.setCandidateLabel).toHaveBeenCalledWith('pm-abc', 'C')
  })

  it('propagates a label CLEAR (empty string) when remote is newer', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{
        photoId: 'pm-abc', filename: 'a.jpg', flag: 'pick-track',
        label: '', labelUpdatedAt: '2024-02-01T00:00:00Z',
      }],
    })
    const local: ApiPhoto = { ...existing('pm-abc', 'pick-track'), label: 'A', labelUpdatedAt: '2024-01-01T00:00:00Z' }
    const session = fakeSession([local])
    await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(session.setCandidateLabel).toHaveBeenCalledWith('pm-abc', '')
  })
})

// Regression: rename in map-corridors after the first Send must
// propagate to an ALREADY-existing candidate in the editor pool.
// User feedback 2026-05-17 (Martin Hrivna): renaming `DSC_0123.JPG`
// → `TP1` in map-corridors after Send had no effect — the insert
// branch picked up `entry.filename` correctly on first sync, but
// subsequent renames hit the update branch which used to diff only
// `flag` and `label`. The fix adds a filename diff + setCandidateFilename.
describe('syncMapPicksOnce — filename one-way sync (rename of existing pm- candidate)', () => {
  it('calls setCandidateFilename when remote filename differs from local', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{ photoId: 'pm-abc', filename: 'TP1', flag: 'pick-track' }],
    })
    const local: ApiPhoto = { ...existing('pm-abc', 'pick-track') } // filename = 'pm-abc.jpg' from existing()
    const session = fakeSession([local])
    const result = await syncMapPicksOnce(
      storage as unknown as StorageInterface, competitionDir, photosDir, session,
    )
    expect(session.setCandidateFilename).toHaveBeenCalledWith('pm-abc', 'TP1')
    expect(result.updates).toBe(1)
  })

  it('does NOT call setCandidateFilename when filename matches', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{ photoId: 'pm-abc', filename: 'pm-abc.jpg', flag: 'pick-track' }],
    })
    const session = fakeSession([existing('pm-abc', 'pick-track')])
    await syncMapPicksOnce(
      storage as unknown as StorageInterface, competitionDir, photosDir, session,
    )
    expect(session.setCandidateFilename).not.toHaveBeenCalled()
  })

  it('updates filename AND flag together if both diverge (touched once)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [{ photoId: 'pm-abc', filename: 'TP2', flag: 'pick-track' }],
    })
    const session = fakeSession([existing('pm-abc', 'neutral')])
    const result = await syncMapPicksOnce(
      storage as unknown as StorageInterface, competitionDir, photosDir, session,
    )
    expect(session.setCandidateFlag).toHaveBeenCalledWith('pm-abc', 'pick-track')
    expect(session.setCandidateFilename).toHaveBeenCalledWith('pm-abc', 'TP2')
    // Both writes count toward a single "touched" tally (one update event).
    expect(result.updates).toBe(1)
  })
})

describe('syncMapPicksOnce — concurrency & blob URL leak guards (CRITICAL bugs fixed)', () => {
  it('does NOT double-insert when the same pm-id appears twice in the file (one createObjectURL call only)', async () => {
    // Defensive: a torn writer could repeat an entry. The local index must
    // be updated as we insert so the second occurrence sees the existing
    // photo and skips the createObjectURL path.
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-dup', 'pick-track'), pmEntry('pm-dup', 'pick-track')],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(8)], { type: 'image/jpeg' }))
    let createUrlCount = 0
    ;(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => {
      createUrlCount++
      return `blob:n${createUrlCount}`
    }
    const session = fakeSession([])
    const result = await syncMapPicksOnce(storage as unknown as StorageInterface, competitionDir, photosDir, session)
    expect(result.inserts).toBe(1)
    // Routed once (pick-track → set); the same-run placedThisRun guard skips the
    // duplicate row before it allocates a second blob URL.
    expect(session.importPick).toHaveBeenCalledTimes(1)
    expect(createUrlCount).toBe(1)
  })

  it('does NOT delete a freshly-inserted entry in the same pass (cleanup iterates LIVE index, not the stale snapshot)', async () => {
    // The cleanup pass used to iterate `session.candidates` — a snapshot
    // captured at hook-call time. A pm- entry inserted earlier in the
    // pass but absent from the snapshot would then be immediately deleted.
    // Reproducible with a session whose `candidates` array does not
    // reflect addCandidate calls synchronously.
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [pmEntry('pm-new', 'pick-track')],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(8)], { type: 'image/jpeg' }))
    // session.candidates frozen at [] — addCandidate does NOT append to it.
    // This models the photo-helper React snapshot semantics where the live
    // `candidates` array passed in is unchanged mid-pass.
    const session = {
      candidates: [] as readonly ApiPhoto[],
      placedIds: new Set<string>(),
      addCandidate: vi.fn(async () => undefined),
      importPick: vi.fn(async () => undefined),
      removeCandidate: vi.fn(async () => undefined),
      setCandidateFlag: vi.fn(async () => undefined),
      setCandidateLabel: vi.fn(async () => undefined),
      setCandidateFilename: vi.fn(async () => undefined),
    }
    const result = await syncMapPicksOnce(
      storage as unknown as StorageInterface,
      competitionDir, photosDir,
      session as unknown as MapPicksSyncSessionApi,
    )
    expect(result.inserts).toBe(1)
    expect(result.deletes).toBe(0)
    expect(session.removeCandidate).not.toHaveBeenCalled()
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

  // ADR-019 cleanup pass interaction with the new guard layer: a pm-
  // entry that FAILS isMapPickEntry is treated as absent — the photo
  // is NOT added to remoteIds. If a local copy of that id exists, the
  // cleanup pass should delete it (the row "disappeared" from the
  // writer's perspective). Pinning this so a future loosening of the
  // guard doesn't silently turn malformed rows into "preserve local".
  it('malformed pm- entry causes existing local copy to be deleted (treated as absent for cleanup)', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [
        { photoId: 'pm-bad', filename: 42, flag: 'pick-track' }, // filename wrong type → drop
        pmEntry('pm-good', 'pick-track'),
      ],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(8)], { type: 'image/jpeg' }))
    const session = fakeSession([
      existing('pm-bad', 'pick-track'),  // pre-existing local copy of the now-dropped id
      existing('pm-good', 'neutral'),
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await syncMapPicksOnce(
      storage as unknown as StorageInterface,
      competitionDir, photosDir, session,
    )
    expect(result.deletes).toBe(1)
    expect(session.removeCandidate).toHaveBeenCalledWith('pm-bad')
    expect(session.setCandidateFlag).toHaveBeenCalledWith('pm-good', 'pick-track')
    expect(warn).toHaveBeenCalled() // dropped row was logged
    warn.mockRestore()
  })

  it('drops malformed entries individually; valid neighbors still apply', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [
        pmEntry('pm-1', 'pick-track'),
        { photoId: 'pm-2', filename: 'b.jpg', flag: 'archived' }, // bad flag → drop
        pmEntry('pm-3', 'pick-track'),
        { photoId: 'pm-4', flag: 'pick-track' },                         // missing filename → drop
      ],
    })
    storage.getPhotoBlob.mockResolvedValue(new Blob([new Uint8Array(8)], { type: 'image/jpeg' }))
    const session = fakeSession([])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await syncMapPicksOnce(
      storage as unknown as StorageInterface,
      competitionDir, photosDir, session,
    )
    expect(result.inserts).toBe(2)
    expect(session.importPick).toHaveBeenCalledTimes(2)
    const ids = session.importPick.mock.calls.map(c => (c[0] as ApiPhoto).id).sort()
    expect(ids).toEqual(['pm-1', 'pm-3'])
    expect(warn).toHaveBeenCalledTimes(2) // one warn per dropped row
    warn.mockRestore()
  })

  it('mixed: insert one, update one, delete one in a single pass', async () => {
    const storage = fakeStorage()
    storage.readJSON.mockResolvedValue({
      version: 1,
      updatedAt: 'x',
      picks: [
        pmEntry('pm-new', 'pick-track'),
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

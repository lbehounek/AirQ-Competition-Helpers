import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CompetitionsIndex } from '@airq/competitions'
import type {
  DirectoryHandle,
  StorageHandles,
  StorageInterface,
} from '@airq/shared-storage'

type MockDir = DirectoryHandle & { children: Map<string, MockDir>; files: Map<string, unknown> }

function makeMockDir(path: string): MockDir {
  return {
    path,
    children: new Map(),
    files: new Map(),
  } as MockDir
}

function createMockStorage(): {
  storage: StorageInterface
  handles: StorageHandles
  root: MockDir
} {
  const root = makeMockDir('root')
  const sessions = makeMockDir('root/sessions')

  const handles: StorageHandles = { root, sessions }

  const storage: StorageInterface = {
    async init() {
      return handles
    },
    async ensureSessionDirs(sessionId: string) {
      const dir = makeMockDir(`root/sessions/${sessionId}`)
      const photos = makeMockDir(`root/sessions/${sessionId}/photos`)
      return { dir, photos }
    },
    async writeJSON(dir: DirectoryHandle, name: string, data: unknown) {
      ;(dir as MockDir).files.set(name, data)
    },
    async readJSON<T>(dir: DirectoryHandle, name: string): Promise<T | null> {
      const v = (dir as MockDir).files.get(name)
      return v === undefined ? null : (v as T)
    },
    async savePhotoFile() {},
    async getPhotoBlob() {
      return new Blob()
    },
    async deletePhotoFile() {},
    // Thumbnail trio, added to StorageInterface after this branch was written
    // (shared-storage/src/photoThumbs.ts). The landing flows never touch
    // thumbs, so these only need to satisfy the interface — getPhotoThumb
    // returns null, which is the documented "regenerate from the original"
    // miss path rather than a lie about having one.
    async savePhotoThumb() {},
    async getPhotoThumb() {
      return null
    },
    async deletePhotoThumb() {},
    async clearDirectory(dir: DirectoryHandle) {
      ;(dir as MockDir).files.clear()
      ;(dir as MockDir).children.clear()
    },
    async deleteSessionDir() {},
    async getDirectoryHandle(parent: DirectoryHandle, name: string, options?: { create?: boolean }) {
      const p = parent as MockDir
      const existing = p.children.get(name)
      if (existing) return existing
      if (!options?.create) {
        throw new Error(`Directory not found: ${name}`)
      }
      const child = makeMockDir(`${p.path}/${name}`)
      p.children.set(name, child)
      return child
    },
    async isAvailable() {
      return true
    },
    async getStorageEstimate() {
      return { usage: 1024, quota: 10_240 }
    },
    async listDirectory(dir: DirectoryHandle) {
      const p = dir as MockDir
      return Array.from(p.children.keys()).map((name) => ({ name, isDirectory: true }))
    },
  }

  return { storage, handles, root }
}

vi.mock('@airq/shared-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airq/shared-storage')>()
  return {
    ...actual,
    initStorage: vi.fn(),
  }
})

describe('LandingStorage', () => {
  let mock: ReturnType<typeof createMockStorage>

  beforeEach(async () => {
    vi.resetModules()
    mock = createMockStorage()
    const shared = await import('@airq/shared-storage')
    vi.mocked(shared.initStorage).mockResolvedValue(mock.storage)
  })

  it('returns empty index on fresh init and persists it', async () => {
    const { LandingStorage } = await import('../services/landingStorage')
    const ls = new LandingStorage()
    const idx = await ls.getIndex()
    expect(idx.competitions).toEqual([])
    expect(idx.activeCompetitionId).toBeNull()
    expect(idx.version).toBe(1)
    expect(mock.root.files.get('competitions-index.json')).toBeDefined()
  })

  it('createCompetition adds entry with discipline=rally and writes an empty session', async () => {
    const { LandingStorage } = await import('../services/landingStorage')
    const ls = new LandingStorage()
    const md = await ls.createCompetition('Test Comp')
    expect(md.name).toBe('Test Comp')
    expect(md.discipline).toBe('rally')
    expect(md.isActive).toBe(true)

    const idx = (await ls.getIndex()) as CompetitionsIndex
    expect(idx.competitions).toHaveLength(1)
    expect(idx.activeCompetitionId).toBe(md.id)

    const competitionsDir = mock.root.children.get('competitions')!
    const compDir = competitionsDir.children.get(md.id)!
    const session = compDir.files.get('session.json') as Record<string, unknown>
    expect(session.version).toBe(1)
    expect(session.mode).toBe('track')
    expect(session.competition_name).toBe('Test Comp')
    expect((session.sets as any).set1.title).toBe('SP - TPX')
    expect((session.sets as any).set2.title).toBe('TPX - FP')
    expect(session.setsTrack).toBeDefined()
    expect(session.setsTurning).toBeDefined()
  })

  it('deleteCompetition removes entry and reassigns active', async () => {
    const { LandingStorage } = await import('../services/landingStorage')
    const ls = new LandingStorage()
    const a = await ls.createCompetition('A')
    const b = await ls.createCompetition('B')
    const result = await ls.deleteCompetition(b.id)
    expect(result.activeCompetitionId).toBe(a.id)
    const idx = await ls.getIndex()
    expect(idx.competitions.map((c) => c.id)).toEqual([a.id])
    expect(idx.competitions[0].isActive).toBe(true)
  })

  it('setDiscipline updates the metadata', async () => {
    const { LandingStorage } = await import('../services/landingStorage')
    const ls = new LandingStorage()
    const c = await ls.createCompetition('X')
    await ls.setDiscipline(c.id, 'precision')
    const idx = await ls.getIndex()
    expect(idx.competitions[0].discipline).toBe('precision')
  })

  it('setActive switches the active competition', async () => {
    const { LandingStorage } = await import('../services/landingStorage')
    const ls = new LandingStorage()
    const a = await ls.createCompetition('A')
    const b = await ls.createCompetition('B')
    expect((await ls.getIndex()).activeCompetitionId).toBe(b.id)
    await ls.setActive(a.id)
    const idx = await ls.getIndex()
    expect(idx.activeCompetitionId).toBe(a.id)
    expect(idx.competitions.find((c) => c.id === a.id)?.isActive).toBe(true)
    expect(idx.competitions.find((c) => c.id === b.id)?.isActive).toBe(false)
  })

  it('getStorageStats derives percentUsed and isLow flags', async () => {
    const { LandingStorage } = await import('../services/landingStorage')
    const ls = new LandingStorage()
    const stats = await ls.getStorageStats()
    expect(stats.usedBytes).toBe(1024)
    expect(stats.quotaBytes).toBe(10_240)
    expect(stats.percentUsed).toBe(10)
    expect(stats.isLow).toBe(false)
    expect(stats.isCritical).toBe(false)
  })
})

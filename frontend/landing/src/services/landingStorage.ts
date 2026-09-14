import {
  COMPETITIONS_INDEX_FILE,
  addCompetition,
  createMetadata,
  emptyIndex,
  removeCompetition,
  setActive,
  setDiscipline,
  validateIndex,
} from '@airq/competitions'
import type {
  CompetitionMetadata,
  CompetitionsIndex,
  Discipline,
  StorageStats,
} from '@airq/competitions'
import {
  initStorage,
  type DirectoryHandle,
  type StorageHandles,
  type StorageInterface,
} from '@airq/shared-storage'

type EmptySession = {
  id: string
  version: 1
  createdAt: string
  updatedAt: string
  mode: 'track'
  competition_name: string
  sets: Record<'set1' | 'set2', { title: string; photos: never[] }>
  setsTrack: Record<'set1' | 'set2', { title: string; photos: never[] }>
  setsTurning: Record<'set1' | 'set2', { title: string; photos: never[] }>
}

function makeEmptySession(name: string, now: string): EmptySession {
  const randomId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id: randomId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    mode: 'track',
    competition_name: name,
    sets: {
      set1: { title: 'SP - TPX', photos: [] },
      set2: { title: 'TPX - FP', photos: [] },
    },
    setsTrack: {
      set1: { title: 'SP - TPX', photos: [] },
      set2: { title: 'TPX - FP', photos: [] },
    },
    setsTurning: {
      set1: { title: '', photos: [] },
      set2: { title: '', photos: [] },
    },
  }
}

export class LandingStorage {
  private storage: StorageInterface | null = null
  private handles: StorageHandles | null = null
  private competitionsDir: DirectoryHandle | null = null

  async initialize(): Promise<void> {
    if (this.storage && this.handles && this.competitionsDir) return
    this.storage = await initStorage()
    this.handles = await this.storage.init()
    this.competitionsDir = await this.storage.getDirectoryHandle(
      this.handles.root,
      'competitions',
      { create: true },
    )
  }

  async getIndex(): Promise<CompetitionsIndex> {
    await this.initialize()
    const raw = await this.storage!.readJSON<unknown>(
      this.handles!.root,
      COMPETITIONS_INDEX_FILE,
    )
    if (raw === null) {
      const fresh = emptyIndex()
      await this.writeIndex(fresh)
      return fresh
    }
    return validateIndex(raw)
  }

  async writeIndex(index: CompetitionsIndex): Promise<void> {
    await this.initialize()
    await this.storage!.writeJSON(this.handles!.root, COMPETITIONS_INDEX_FILE, index)
  }

  async createCompetition(name: string): Promise<CompetitionMetadata> {
    await this.initialize()

    const metadata = createMetadata({ name })
    const compDir = await this.storage!.getDirectoryHandle(
      this.competitionsDir!,
      metadata.id,
      { create: true },
    )
    await this.storage!.getDirectoryHandle(compDir, 'photos', { create: true })

    const emptySession = makeEmptySession(name, metadata.createdAt)
    await this.storage!.writeJSON(compDir, 'session.json', emptySession)

    const current = await this.getIndex()
    const next = addCompetition(current, metadata)
    await this.writeIndex(next)

    return next.competitions.find((c) => c.id === metadata.id)!
  }

  async deleteCompetition(id: string): Promise<{ activeCompetitionId: string | null }> {
    await this.initialize()

    const current = await this.getIndex()
    if (!current.competitions.some((c) => c.id === id)) {
      throw new Error(`Competition not found: ${id}`)
    }

    try {
      const compDir = await this.storage!.getDirectoryHandle(this.competitionsDir!, id, {
        create: false,
      })
      await this.storage!.clearDirectory(compDir)
    } catch (e) {
      // "Already gone" is the expected, benign case: the index update below
      // still removes the entry so the UI stays consistent. Anything else
      // (quota, a locked handle, a partial clear) means photo bytes remain on
      // disk with nothing pointing at them once the index is rewritten — log
      // that rather than report a clean delete, so an orphan is traceable.
      const alreadyGone = e instanceof DOMException && e.name === 'NotFoundError'
      if (!alreadyGone) {
        console.error(`deleteCompetition(${id}): directory not cleared, data may be orphaned`, e)
      }
    }

    const { index: next } = removeCompetition(current, id)
    await this.writeIndex(next)
    return { activeCompetitionId: next.activeCompetitionId }
  }

  async setActive(id: string): Promise<void> {
    const current = await this.getIndex()
    const next = setActive(current, id)
    await this.writeIndex(next)
  }

  async setDiscipline(id: string, discipline: Discipline): Promise<void> {
    const current = await this.getIndex()
    const next = setDiscipline(current, id, discipline)
    await this.writeIndex(next)
  }

  async getStorageStats(): Promise<StorageStats> {
    await this.initialize()
    try {
      const estimate = await this.storage!.getStorageEstimate()
      const usedBytes = estimate?.usage ?? null
      const quotaBytes = estimate?.quota ?? null
      let percentUsed: number | null = null
      let isLow = false
      let isCritical = false
      if (usedBytes !== null && quotaBytes !== null && quotaBytes > 0) {
        percentUsed = Math.round((usedBytes / quotaBytes) * 100)
        isLow = percentUsed >= 80
        isCritical = percentUsed >= 95
      }
      return { usedBytes, quotaBytes, percentUsed, isLow, isCritical }
    } catch {
      return {
        usedBytes: null,
        quotaBytes: null,
        percentUsed: null,
        isLow: false,
        isCritical: false,
      }
    }
  }
}

export const landingStorage = new LandingStorage()

/**
 * Reproduction harness for the client report of 2026-07-23:
 *
 *   "PRECISION competition, every photo had GPS. After generating the PDF of
 *    turning-point and track photos, back in Umístění fotek the LAST photo showed
 *    up as 'bez souřadnic' — the original was still there PLUS an extra no-GPS one."
 *
 * i.e. the end state is one photo appearing TWICE: once correctly (marker, on the
 * map) and once as a phantom row in the "Bez GPS" tray.
 *
 * This file drives the REAL `useCorridorSessionOPFS` hook against an in-memory
 * storage backend and asserts, after every persisted write, the invariant that
 * makes the ghost impossible:
 *
 *   INVARIANT: no photoId may appear in both `session.markers` and
 *              `session.noGpsPhotos`.
 *
 * Each test also checks the weaker "no photo is silently lost" property, because
 * the session writer is a read-modify-write over a ref that is only refreshed by a
 * passive effect — a lost update is the failure mode the same race produces when
 * it lands the other way round.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { StrictMode, useEffect, useImperativeHandle, type Ref } from 'react'
import type { DirectoryHandle } from '@airq/shared-storage'

// ---------------------------------------------------------------------------
// In-memory storage double
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory stand-in for OPFS/Electron storage.
 *
 * `writeJSON` resolves on the MICROTASK queue by default, which is the whole
 * point: React's passive effects are flushed from a scheduler task (macrotask),
 * so an `await storage.writeJSON(...)` that settles as a microtask returns to the
 * caller BEFORE `useEffect(() => { sessionRef.current = session })` has run. That
 * is the exact window `handlePhotoFiles` steps through between its
 * `persistMarkers` and `persistNoGpsPhotos` awaits. Real OPFS is usually slower
 * than that, which is why the bug is intermittent in the field rather than
 * constant.
 *
 * `writeDelayMs > 0` switches writes to a macrotask so a test can model the
 * "slow disk, React got to render" ordering instead.
 */
class FakeStorage {
  files = new Map<string, unknown>()
  /** Every session.json snapshot ever written, in order. */
  sessionWrites: any[] = []
  writeDelayMs = 0

  private key(dir: DirectoryHandle, name: string) {
    return `${dir.path}/${name}`
  }

  async init() {
    return { root: { path: '/root' }, sessions: { path: '/root/sessions' } }
  }

  async getDirectoryHandle(parent: DirectoryHandle, name: string) {
    return { path: `${parent.path}/${name}` }
  }

  async writeJSON(dir: DirectoryHandle, name: string, data: unknown) {
    // Deep clone on write — mirrors serialization, so a later in-memory mutation
    // of the object we were handed cannot retroactively change "what is on disk".
    const snapshot = JSON.parse(JSON.stringify(data))
    if (this.writeDelayMs > 0) {
      await new Promise(r => setTimeout(r, this.writeDelayMs))
    }
    this.files.set(this.key(dir, name), snapshot)
    if (name === 'session.json') this.sessionWrites.push(snapshot)
  }

  async readJSON<T>(dir: DirectoryHandle, name: string): Promise<T | null> {
    const v = this.files.get(this.key(dir, name))
    return (v === undefined ? null : (JSON.parse(JSON.stringify(v)) as T))
  }

  async savePhotoFile() {}
  async savePhotoThumb() {}
  async deletePhotoFile() {}
  async getPhotoBlob() { return new Blob() }
  async getPhotoThumb() { return null }
  async deletePhotoThumb() {}
  async ensureSessionDirs() { return { dir: { path: '/x' }, photos: { path: '/x/photos' } } }

  /** Latest persisted corridors session.json, or null if never written. */
  disk(competitionId: string) {
    return this.files.get(`/root/competitions/${competitionId}/corridors/session.json`) as any ?? null
  }
}

let storage: FakeStorage

vi.mock('@airq/shared-storage', () => ({
  isStorageAvailable: async () => true,
  initStorage: async () => storage,
  loadOrCreateSessionId: () => 'legacy-session',
  deletePhotoThumb: async () => {},
}))

// Imported after the mock is registered so the hook binds to the double.
const { useCorridorSessionOPFS } = await import('../hooks/useCorridorSessionOPFS')
type SessionApi = ReturnType<typeof useCorridorSessionOPFS>

// ---------------------------------------------------------------------------
// Harness component
// ---------------------------------------------------------------------------

/**
 * Renders the real hook and republishes its API through an imperative handle so
 * a test can call the setters from outside React, exactly the way App.tsx's
 * async `handlePhotoFiles` does (i.e. NOT from inside a React event handler, so
 * the updates are not batched into the caller's tick).
 *
 * `onSession` fires on every committed render so a test can watch the in-memory
 * session as well as the on-disk one.
 */
function Harness(props: {
  competitionId: string
  apiRef: Ref<SessionApi>
  onSession?: (s: SessionApi['session']) => void
}) {
  const api = useCorridorSessionOPFS(props.competitionId)
  useImperativeHandle(props.apiRef, () => api)
  const onSession = props.onSession
  useEffect(() => { onSession?.(api.session) }, [api.session, onSession])
  return null
}

/** Mount the hook and wait until the initial session load has settled. */
async function mountSession(competitionId = 'comp-1', strict = false) {
  const apiRef = { current: null as SessionApi | null }
  const tree = (
    <Harness competitionId={competitionId} apiRef={apiRef as Ref<SessionApi>} />
  )
  await act(async () => {
    render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  })
  // Init is a chain of awaits; give it a couple of macrotask turns to settle.
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  return apiRef as { current: SessionApi }
}

/**
 * Run `fn` the way the production app runs `handlePhotoFiles`: as a bare async
 * function, NOT inside `act()`.
 *
 * This matters and is not pedantry. `act()` holds React's passive effects in its
 * own queue and flushes them when the act scope exits, so anything driven inside
 * act() sees `sessionRef.current` frozen for the whole callback — which would
 * manufacture the very staleness we are trying to detect. Dropping the act
 * environment lets React's real scheduler (a MessageChannel macrotask) interleave
 * with the awaits exactly as it does in the browser, so a lost update observed
 * here is a property of the hook and not of the test.
 */
async function outsideAct(fn: () => Promise<void>) {
  const prev = (globalThis as any).IS_REACT_ACT_ENVIRONMENT
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
  try {
    await fn()
    // Let React commit + flush passive effects before we read the result.
    await new Promise(r => setTimeout(r, 20))
  } finally {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = prev
  }
}

// ---------------------------------------------------------------------------
// Invariant helpers
// ---------------------------------------------------------------------------

/** photoIds present in BOTH lists of a persisted session snapshot. */
function ghosts(session: any): string[] {
  if (!session) return []
  const placed = new Set<string>(
    (session.markers ?? []).map((m: any) => m.photoId).filter(Boolean),
  )
  return (session.noGpsPhotos ?? [])
    .map((p: any) => p.photoId)
    .filter((id: string) => placed.has(id))
}

/** Assert the ghost invariant over EVERY snapshot ever written, not just the last. */
function expectNoGhostEver() {
  const offenders = storage.sessionWrites
    .map((s, i) => ({ i, ghosts: ghosts(s) }))
    .filter(x => x.ghosts.length > 0)
  expect(offenders).toEqual([])
}

const marker = (n: number, over: Record<string, unknown> = {}) => ({
  id: `pm-${n}`,
  photoId: `pm-${n}`,
  lng: 14.0446 + n / 10000,
  lat: 50.1232 + n / 10000,
  name: `RIMG0${160 + n}.JPG`,
  contentHash: `hash-${n}`,
  capturedAt: { lng: 14.0446 + n / 10000, lat: 50.1232 + n / 10000 },
  ...over,
})

const trayEntry = (n: number) => ({
  photoId: `pm-${n}`,
  filename: `RIMG0${160 + n}.JPG`,
  contentHash: `hash-${n}`,
})

beforeEach(() => {
  storage = new FakeStorage()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. The handlePhotoFiles shape: persistMarkers THEN persistNoGpsPhotos
// ---------------------------------------------------------------------------

describe('import: markers write followed by no-GPS write (App.tsx handlePhotoFiles)', () => {
  it('REPRO: fast (microtask) storage — the marker batch is silently discarded', async () => {
    const api = await mountSession()

    // Exactly App.tsx:615-650 — one batch, 9 with GPS + 1 without, two awaits
    // back to back inside a single async function, no render in between.
    await outsideAct(async () => {
      await api.current.setMarkers(prev => [...prev, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => marker(n))] as any)
      await api.current.setNoGpsPhotos(prev => [...prev, trayEntry(10)] as any)
    })

    const disk = storage.disk('comp-1')
    expectNoGhostEver()
    // The weaker property: nothing may be silently dropped by the read-modify-write.
    expect(disk.markers.map((m: any) => m.photoId)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `pm-${n}`),
    )
    expect(disk.noGpsPhotos.map((p: any) => p.photoId)).toEqual(['pm-10'])
  })

  it('REPRO: 1 ms-latency storage — still discarded (the window is ~5 ms wide)', async () => {
    const api = await mountSession()
    storage.writeDelayMs = 1

    await outsideAct(async () => {
      await api.current.setMarkers(prev => [...prev, marker(1), marker(2)] as any)
      await api.current.setNoGpsPhotos(prev => [...prev, trayEntry(3)] as any)
    })

    const disk = storage.disk('comp-1')
    expectNoGhostEver()
    expect(disk.markers).toHaveLength(2)
    expect(disk.noGpsPhotos).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 2. Two overlapping imports (double drop / drop + file-input both firing)
// ---------------------------------------------------------------------------

describe('two overlapping handlePhotoFiles runs', () => {
  it('interleaved marker+tray writes never produce a photoId in both lists', async () => {
    const api = await mountSession()

    await outsideAct(async () => {
      const runA = (async () => {
        await api.current.setMarkers(prev => [...prev, marker(1)] as any)
        await api.current.setNoGpsPhotos(prev => [...prev, trayEntry(2)] as any)
      })()
      const runB = (async () => {
        await api.current.setMarkers(prev => [...prev, marker(3)] as any)
        await api.current.setNoGpsPhotos(prev => [...prev, trayEntry(4)] as any)
      })()
      await Promise.all([runA, runB])
    })

    expectNoGhostEver()
  })
})

// ---------------------------------------------------------------------------
// 3. Placement racing the editor-picks sync (the return-from-photo-helper path)
// ---------------------------------------------------------------------------

describe('placeNoGpsPhoto racing a whole-session write', () => {
  it('a tray photo placed on the map is never resurrected into the tray', async () => {
    const api = await mountSession()

    await outsideAct(async () => {
      await api.current.setNoGpsPhotos(() => [trayEntry(7)] as any)
    })

    // The user drags the tray photo onto the map; concurrently the visibility
    // change fired by returning from photo-helper runs useEditorPicksSync, whose
    // setMarkers call re-persists the WHOLE session from `sessionRef.current`.
    await outsideAct(async () => {
      const place = api.current.placeNoGpsPhoto('pm-7', 14.05, 50.12, 'pick-track')
      const sync = api.current.setMarkers(prev =>
        prev.map(m => ({ ...m, label: 'A', labelUpdatedAt: '2026-07-23T10:00:00Z' })),
      )
      await Promise.all([place, sync])
    })

    expectNoGhostEver()
    const disk = storage.disk('comp-1')
    // Either ordering is acceptable for the LABEL, but the photo must exist
    // exactly once across the two lists.
    const total =
      disk.markers.filter((m: any) => m.photoId === 'pm-7').length +
      disk.noGpsPhotos.filter((p: any) => p.photoId === 'pm-7').length
    expect(total).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 4. StrictMode double-mount / competition switch replaying a stale snapshot
// ---------------------------------------------------------------------------

describe('session (re)load cannot resurrect a stale tray entry', () => {
  it('StrictMode double-invoked init does not duplicate or ghost', async () => {
    // Seed disk with a legitimate mixed session first.
    storage.files.set('/root/competitions/comp-1/corridors/session.json', {
      id: 'corridors-comp-1',
      version: 3,
      createdAt: '2026-07-23T09:00:00Z',
      updatedAt: '2026-07-23T09:00:00Z',
      mapStyleId: 'mapbox-streets',
      discipline: 'precision',
      use1NmAfterSp: false,
      geojson: null, leftSegments: null, rightSegments: null,
      gates: null, points: null, exactPoints: null,
      markers: [marker(1), marker(2)],
      groundMarkers: [],
      noGpsPhotos: [trayEntry(3)],
      noGpsTrayOpen: true,
      setBreakWaypointName: null,
    })

    const api = await mountSession('comp-1', true)

    await outsideAct(async () => {
      await api.current.placeNoGpsPhoto('pm-3', 14.06, 50.13, 'pick-turning')
    })
    // A visibility-change style whole-session rewrite after the placement.
    await outsideAct(async () => {
      await api.current.setMarkers(prev => prev.map(m => ({ ...m })))
    })

    expectNoGhostEver()
    const disk = storage.disk('comp-1')
    expect(disk.markers.map((m: any) => m.photoId).sort()).toEqual(['pm-1', 'pm-2', 'pm-3'])
    expect(disk.noGpsPhotos).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. Precision discipline specifically
// ---------------------------------------------------------------------------

describe('precision discipline import', () => {
  it('10 GPS photos + a precision session never produce a tray entry', async () => {
    const api = await mountSession()
    await outsideAct(async () => { await api.current.setDiscipline('precision') })

    await outsideAct(async () => {
      await api.current.setMarkers(
        prev => [...prev, ...Array.from({ length: 10 }, (_, i) => marker(i + 1))] as any,
      )
    })

    const disk = storage.disk('comp-1')
    expect(disk.discipline).toBe('precision')
    expect(disk.markers).toHaveLength(10)
    expect(disk.noGpsPhotos).toEqual([])
    expectNoGhostEver()
  })
})

// ---------------------------------------------------------------------------
// 6. Interleaving fuzz — the systematic version of the negative result
// ---------------------------------------------------------------------------

/**
 * The three tests above probe hand-picked orderings. This one brute-forces the
 * session mutations that touch either photo list, at every await-boundary
 * interleaving a pseudo-random schedule can reach, and asserts the ghost
 * invariant on EVERY snapshot written.
 *
 * The point is to make "we could not reproduce the ghost" a measured statement
 * rather than an anecdote: `persistSession` always writes `markers` and
 * `noGpsPhotos` from the SAME `sessionRef.current` object
 * (`useCorridorSessionOPFS.ts:362-374`), so a stale read can roll the whole
 * session backwards but can never combine a new `markers` with an old
 * `noGpsPhotos`. If that ever stops being true — someone adds a setter that
 * mixes bases — this catches it.
 */
describe('interleaving fuzz over every noGpsPhotos/markers mutation', () => {
  it('no schedule produces a photoId in both lists', async () => {
    // Deterministic PRNG so a failure is replayable from the seed alone.
    let seed = 0x5eed
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

    for (let round = 0; round < 40; round++) {
      storage = new FakeStorage()
      const api = await mountSession()

      // Seed a mixed session: two placed photos, two waiting in the tray.
      await outsideAct(async () => {
        await api.current.setMarkers(() => [marker(1), marker(2)] as any)
      })
      await outsideAct(async () => {
        await api.current.setNoGpsPhotos(() => [trayEntry(3), trayEntry(4)] as any)
      })

      const ops: (() => Promise<unknown>)[] = [
        () => api.current.placeNoGpsPhoto('pm-3', 14.05, 50.12, 'pick-track'),
        () => api.current.placeNoGpsPhoto('pm-4', 14.06, 50.13, 'pick-turning'),
        // The editor-picks sync: a whole-session rewrite driven by markers only.
        () => api.current.setMarkers(prev =>
          prev.map(m => ({ ...m, label: 'A', labelUpdatedAt: '2026-07-23T10:00:00Z' })),
        ),
        // A fresh import arriving mid-flight.
        () => api.current.setMarkers(prev => [...prev, marker(5)] as any),
        () => api.current.setNoGpsPhotos(prev => [...prev, trayEntry(6)] as any),
        () => api.current.removePhoto('pm-2'),
        () => api.current.renamePhoto('pm-3', 'TP1'),
        () => api.current.setDiscipline(rnd() > 0.5 ? 'precision' : 'rally'),
      ]

      // Shuffle, then fire in overlapping pairs so each pair shares one stale
      // `sessionRef` read — the widest window the hook actually exposes.
      const order = [...ops].sort(() => rnd() - 0.5)
      await outsideAct(async () => {
        for (let i = 0; i < order.length; i += 2) {
          await Promise.all([order[i]?.(), order[i + 1]?.()].filter(Boolean))
        }
      })

      expectNoGhostEver()
    }
  }, 60_000)
})

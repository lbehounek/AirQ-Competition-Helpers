import { describe, it, expect, vi } from 'vitest'
import { createImportQueue, type ImportProgress } from '../photoImport/importQueue'

// Ordering itself is pinned by serialQueue.test.ts — this file covers what is
// SPECIFIC to imports: aggregating progress across batches so a drop landing
// mid-import moves the bar immediately instead of sitting there invisibly.

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const args = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.map((c) => c[0] as ImportProgress | null)

describe('createImportQueue', () => {
  it('aggregates across queued batches so a queued drop shows feedback immediately', async () => {
    const onProgress = vi.fn()
    const queue = createImportQueue(onProgress)
    const gate = deferred()
    let reportA!: (n: number) => void

    queue.enqueue(24, async (report) => { reportA = report; await gate.promise })
    expect(args(onProgress).at(-1)).toEqual({ done: 0, total: 24 })

    // The second batch must widen the total SYNCHRONOUSLY, before its task runs.
    queue.enqueue(24, async () => {})
    expect(args(onProgress).at(-1)).toEqual({ done: 0, total: 48 })

    // Tasks start on a microtask, so wait for A to actually be running before
    // driving its progress sink.
    await flush()
    reportA(12)
    expect(args(onProgress).at(-1)).toEqual({ done: 12, total: 48 })

    gate.resolve()
    await flush()
  })

  it('reconciles a batch that throws before reporting every file', async () => {
    const onProgress = vi.fn()
    const queue = createImportQueue(onProgress)

    const pA = queue.enqueue(24, async (report) => { report(5); throw new Error('quota') })
    pA.catch(() => {}) // observed below; keeps the runner quiet
    await expect(pA).rejects.toThrow('quota')

    await queue.enqueue(10, async (report) => { report(10) })

    // The failed batch still consumed its whole slot, so the bar cannot stick
    // below 100% for the rest of the burst.
    const seen = args(onProgress).filter((p): p is ImportProgress => p !== null)
    expect(Math.max(...seen.map((p) => p.done))).toBeGreaterThanOrEqual(24)
  })

  it('emits null and resets counters once the queue drains', async () => {
    const onProgress = vi.fn()
    const queue = createImportQueue(onProgress)

    await queue.enqueue(24, async (report) => { report(24) })
    expect(args(onProgress).at(-1)).toBeNull()

    // The next burst starts at 0/N, not inheriting the previous totals.
    queue.enqueue(3, async () => {})
    expect(args(onProgress).at(-1)).toEqual({ done: 0, total: 3 })
    await flush()
  })

  it('clamps out-of-order and over-count reports', async () => {
    const onProgress = vi.fn()
    const queue = createImportQueue(onProgress)
    const gate = deferred()
    let report!: (n: number) => void

    queue.enqueue(3, async (r) => { report = r; await gate.promise })
    await flush() // the task starts on a microtask; `report` exists after it
    report(2)
    expect(args(onProgress).at(-1)).toEqual({ done: 2, total: 3 })
    report(1) // regression — must not move the bar backwards
    expect(args(onProgress).at(-1)).toEqual({ done: 2, total: 3 })
    report(99) // over-report — must not render "99 of 3"
    expect(args(onProgress).at(-1)).toEqual({ done: 3, total: 3 })

    gate.resolve()
    await flush()
  })

  it('counts queued plus running batches in `pending`', async () => {
    const queue = createImportQueue(vi.fn())
    const gate = deferred()

    const pA = queue.enqueue(1, async () => { await gate.promise })
    expect(queue.pending).toBe(1)
    const pB = queue.enqueue(1, async () => {})
    expect(queue.pending).toBe(2)

    gate.resolve()
    await Promise.all([pA, pB])
    expect(queue.pending).toBe(0)
  })

  it('still runs a batch queued behind one that rejected', async () => {
    const onProgress = vi.fn()
    const queue = createImportQueue(onProgress)
    const second = vi.fn(async () => {})

    const pA = queue.enqueue(1, async () => { throw new Error('boom') })
    pA.catch(() => {})
    const pB = queue.enqueue(1, second)

    await expect(pA).rejects.toThrow('boom')
    await pB
    expect(second).toHaveBeenCalledTimes(1)
    expect(args(onProgress).at(-1)).toBeNull()
    expect(queue.pending).toBe(0)
  })
})

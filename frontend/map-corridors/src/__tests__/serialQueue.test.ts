import { describe, it, expect, vi } from 'vitest'
import { createSerialQueue } from '../utils/serialQueue'

// The ordering primitive behind both the session writer and the photo-import
// queue. Everything here is deliberately deterministic (hand-rolled deferreds,
// no fake timers) except the one latency test, which needs real time to prove
// that completion order follows ENQUEUE order rather than duration.

/** Minimal externally-resolvable promise. */
function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('createSerialQueue', () => {
  it('runs tasks in enqueue order even when an earlier task is slower', async () => {
    const order: string[] = []
    const enqueue = createSerialQueue()
    const slow = (id: string, ms: number) => enqueue(async () => {
      await new Promise((r) => setTimeout(r, ms))
      order.push(id)
    })
    // Unserialized, these settle c, b, a — the durations are the whole point.
    await Promise.all([slow('a', 30), slow('b', 15), slow('c', 0)])
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('never overlaps two tasks', async () => {
    const enqueue = createSerialQueue()
    const gate = deferred()
    let running = false
    let bStarted = false
    let bSawRunning: boolean | null = null

    const pA = enqueue(async () => { running = true; await gate.promise; running = false })
    const pB = enqueue(async () => { bStarted = true; bSawRunning = running })

    await flush()
    expect(bStarted, 'B must not start while A is in flight').toBe(false)

    gate.resolve()
    await Promise.all([pA, pB])
    expect(bStarted).toBe(true)
    expect(bSawRunning, 'B observed A still running — they overlapped').toBe(false)
  })

  it('a rejected task does not wedge the queue', async () => {
    const enqueue = createSerialQueue()
    const after = vi.fn(async () => 'ok')
    const pA = enqueue(async () => { throw new Error('boom') })
    const pB = enqueue(after)

    await expect(pA).rejects.toThrow('boom')
    await expect(pB).resolves.toBe('ok')
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('hands each caller only its own outcome', async () => {
    const enqueue = createSerialQueue()
    const e1 = new Error('first')
    const e2 = new Error('second')
    const pA = enqueue(async () => { throw e1 })
    const pB = enqueue(async () => 'b')
    const pC = enqueue(async () => { throw e2 })

    // Identity-compared: one caller's failure must never be reported to another.
    await expect(pA).rejects.toBe(e1)
    await expect(pB).resolves.toBe('b')
    await expect(pC).rejects.toBe(e2)
  })

  it('a handled rejection with no follow-up task raises no unhandledrejection', async () => {
    // Regression guard for the `.catch` placement: attaching it to the NEXT
    // link instead of the stored tail leaves the tail rejected and unobserved
    // whenever nothing else is ever enqueued.
    const onUnhandled = vi.fn()
    window.addEventListener('unhandledrejection', onUnhandled)
    try {
      const enqueue = createSerialQueue()
      const p = enqueue(async () => { throw new Error('lonely') })
      await expect(p).rejects.toThrow('lonely')
      await flush()
      await flush()
      expect(onUnhandled).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  })

  it('two queues are independent', async () => {
    const q1 = createSerialQueue()
    const q2 = createSerialQueue()
    const gate = deferred()
    let q2Done = false

    q1(async () => { await gate.promise })
    await q2(async () => { q2Done = true })

    expect(q2Done, 'a task on queue 2 must not wait on queue 1').toBe(true)
    gate.resolve()
  })
})

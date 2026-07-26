import { describe, it, expect, vi, afterEach } from 'vitest'
import { detectOrientation, withTimeout, resolveLabelCollisions } from '../utils/mapCapture'
import type { PrintLabelBox } from '../utils/mapCapture'

// ---------------------------------------------------------------------------
// detectOrientation
// ---------------------------------------------------------------------------
describe('detectOrientation', () => {
  const LANDSCAPE_W = 3508
  const PORTRAIT_W = 2480

  it('wide track near equator → landscape', () => {
    // 2° lng × 1° lat at equator — lng dominates
    const bbox: [[number, number], [number, number]] = [[10, -0.5], [12, 0.5]]
    expect(detectOrientation(bbox).width).toBe(LANDSCAPE_W)
  })

  it('tall track near equator → portrait', () => {
    // 0.5° lng × 2° lat at equator — lat dominates
    const bbox: [[number, number], [number, number]] = [[10, -1], [10.5, 1]]
    expect(detectOrientation(bbox).width).toBe(PORTRAIT_W)
  })

  it('square track near equator → landscape (>= favors landscape)', () => {
    // 1° × 1° at equator: cos(0) = 1, so lngSpan == latSpan → >=
    const bbox: [[number, number], [number, number]] = [[0, -0.5], [1, 0.5]]
    expect(detectOrientation(bbox).width).toBe(LANDSCAPE_W)
  })

  it('square track at 60° latitude → portrait (Mercator compresses lng)', () => {
    // 1° × 1° at lat 60: cos(60°) = 0.5, so lngSpan = 0.5 < latSpan = 1
    const bbox: [[number, number], [number, number]] = [[14, 59.5], [15, 60.5]]
    expect(detectOrientation(bbox).width).toBe(PORTRAIT_W)
  })

  it('wide track at high latitude can still be landscape', () => {
    // 6° lng × 1° lat at lat 50: cos(50°) ≈ 0.643, lngSpan ≈ 3.86 > 1
    const bbox: [[number, number], [number, number]] = [[14, 49.5], [20, 50.5]]
    expect(detectOrientation(bbox).width).toBe(LANDSCAPE_W)
  })

  it('Czech Republic typical track (lat ~49.5°)', () => {
    // Narrow rally track: ~0.05° lng × 0.15° lat
    // cos(49.5°) ≈ 0.649, lngSpan ≈ 0.032 < 0.15
    const bbox: [[number, number], [number, number]] = [[16.6, 49.1], [16.65, 49.25]]
    expect(detectOrientation(bbox).width).toBe(PORTRAIT_W)
  })

  it('degenerate single-point bbox → landscape (0 >= 0)', () => {
    const bbox: [[number, number], [number, number]] = [[15, 50], [15, 50]]
    expect(detectOrientation(bbox).width).toBe(LANDSCAPE_W)
  })
})

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------
describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves when inner promise resolves before timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000, 'timeout')
    expect(result).toBe(42)
  })

  it('rejects with original error when inner promise rejects before timeout', async () => {
    const err = new Error('inner failure')
    await expect(withTimeout(Promise.reject(err), 1000, 'timeout')).rejects.toThrow('inner failure')
  })

  it('rejects with timeout message when inner promise does not settle', async () => {
    vi.useFakeTimers()
    const never = new Promise<void>(() => {})
    const p = withTimeout(never, 5000, 'Map timed out')
    vi.advanceTimersByTime(5000)
    await expect(p).rejects.toThrow('Map timed out')
  })

  it('inner resolve after timeout is harmless (no double settle)', async () => {
    vi.useFakeTimers()
    let resolve!: (v: string) => void
    const inner = new Promise<string>(r => { resolve = r })
    const p = withTimeout(inner, 100, 'timeout')
    vi.advanceTimersByTime(100)
    await expect(p).rejects.toThrow('timeout')
    // Late resolve — should not throw or cause issues
    resolve('late')
  })
})

// ---------------------------------------------------------------------------
// resolveLabelCollisions — pill packing for the printed A4.
// The print projects raw coordinates with no marker fan, so photos taken at the
// same turning point land on one pixel; without this their names would render
// as an unreadable pile (client feedback 2026-07-23).
// ---------------------------------------------------------------------------
describe('resolveLabelCollisions', () => {
  const box = (x: number, y: number, w = 100, h = 40): PrintLabelBox => ({ x, y, w, h })

  it('leaves well-separated pills exactly where they were', () => {
    expect(resolveLabelCollisions([box(0, 100), box(0, 500), box(0, 900)]))
      .toEqual([100, 500, 900])
  })

  it('pushes an exactly co-located pill below the first', () => {
    // Same point: second drops one pill height + gap (40 + 4).
    expect(resolveLabelCollisions([box(0, 100), box(0, 100)], 4)).toEqual([100, 144])
  })

  it('stacks a whole cluster without any pair overlapping', () => {
    const ys = resolveLabelCollisions(Array.from({ length: 5 }, () => box(0, 200)), 4)
    expect(ys).toEqual([200, 244, 288, 332, 376])
    // Pairwise check rather than trusting the literal above.
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(40)
  })

  it('does not move pills that merely share a row but not a column', () => {
    // Far apart horizontally — no overlap, so no nudge.
    expect(resolveLabelCollisions([box(0, 100), box(500, 100)])).toEqual([100, 100])
  })

  it('nudges on partial overlap, not just exact coincidence', () => {
    // 50px apart with 100px-wide pills → they overlap horizontally, and share y.
    expect(resolveLabelCollisions([box(0, 100), box(50, 110)], 4)).toEqual([100, 154])
  })

  it('preserves input order and keeps earlier markers in their natural spot', () => {
    // Stability matters: two prints of the same map must lay out identically.
    const boxes = [box(0, 300), box(0, 300), box(0, 300)]
    expect(resolveLabelCollisions(boxes)[0]).toBe(300)
    expect(resolveLabelCollisions(boxes)).toEqual(resolveLabelCollisions(boxes))
  })

  it('only ever moves pills down, never up or sideways', () => {
    const ys = resolveLabelCollisions([box(0, 100), box(0, 100), box(0, 100)])
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(100)
  })

  it('terminates on a large degenerate cluster (every pill on one pixel)', () => {
    const ys = resolveLabelCollisions(Array.from({ length: 60 }, () => box(0, 0)))
    expect(ys).toHaveLength(60)
    expect(new Set(ys).size).toBe(60) // all distinct — nothing left stacked
  })

  it('handles an empty list', () => {
    expect(resolveLabelCollisions([])).toEqual([])
  })
})

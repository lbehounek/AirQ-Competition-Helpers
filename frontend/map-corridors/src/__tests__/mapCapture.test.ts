import { describe, it, expect, vi, afterEach } from 'vitest'
import { detectOrientation, withTimeout } from '../utils/mapCapture'

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

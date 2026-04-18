import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  rasterizeGroundMarker,
  rasterizeGroundMarkerSet,
} from '../utils/groundMarkerPng'
import type { GroundMarkerType } from '../types/markers'

// JSDOM doesn't fire `img.onload` / `img.onerror` for data-URI sources,
// which would hang the Promise inside `rasterizeGroundMarker` forever.
// We stub `Image` with per-test behavior: `succeed` → fires onload and
// lets the canvas path run (canvas ctx is still null in JSDOM so the
// function returns null, but for a different reason); `fail` → fires
// onerror and the catch returns null early.
type ImgBehavior = 'succeed' | 'fail'
function installImageStub(behavior: ImgBehavior) {
  class StubImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    private _src = ''
    set src(value: string) {
      this._src = value
      queueMicrotask(() => {
        if (behavior === 'succeed') this.onload?.()
        else this.onerror?.()
      })
    }
    get src() {
      return this._src
    }
  }
  vi.stubGlobal('Image', StubImage as any)
}

// ---------------------------------------------------------------------------
// rasterizeGroundMarker — contract: "null for unknown type, null on canvas
// failure, PNG data URI on success". The function must NEVER throw and must
// refuse unknown types synchronously before touching the canvas or Image.
// ---------------------------------------------------------------------------
describe('rasterizeGroundMarker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null for unknown type without touching canvas', async () => {
    // No Image stub needed — unknown type returns null before any async work.
    const result = await rasterizeGroundMarker('NOT_A_TYPE' as GroundMarkerType, 64)
    expect(result).toBeNull()
  })

  it('does not throw on any input (contract: always returns null-or-dataUri)', async () => {
    const bogus = await rasterizeGroundMarker('' as GroundMarkerType, 64)
    expect(bogus).toBeNull()
  })

  it('rejects prototype keys (hasOwnProperty guard)', async () => {
    const proto = await rasterizeGroundMarker('toString' as GroundMarkerType, 64)
    expect(proto).toBeNull()
    const ctor = await rasterizeGroundMarker('constructor' as GroundMarkerType, 64)
    expect(ctor).toBeNull()
  })

  it('returns null when image load fails', async () => {
    installImageStub('fail')
    const result = await rasterizeGroundMarker('LETTER_A', 64)
    expect(result).toBeNull()
  })

  it('returns null when canvas 2D context is unavailable (JSDOM default)', async () => {
    installImageStub('succeed')
    // JSDOM returns null from getContext('2d') → function returns null.
    const result = await rasterizeGroundMarker('LETTER_A', 64)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// rasterizeGroundMarkerSet — contract: "returns { icons, failed } so the
// caller can surface partial failure to the user". A regression that drops
// the `failed` field (e.g. reverts to the old `Record<string, string>` shape)
// silently downgrades the KML export to yellow-dot placemarks — the exact
// regression feedback 2026-04-18 was meant to prevent.
// ---------------------------------------------------------------------------
describe('rasterizeGroundMarkerSet', () => {
  beforeEach(() => {
    // Default: make Image load fail so real types also route through the
    // `failed` branch (useful for the contract tests below).
    installImageStub('fail')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns { icons: {}, failed: [] } for empty input', async () => {
    const result = await rasterizeGroundMarkerSet([])
    expect(result.icons).toEqual({})
    expect(result.failed).toEqual([])
  })

  it('puts unknown types in `failed`, not `icons`', async () => {
    const result = await rasterizeGroundMarkerSet([
      'UNKNOWN_1' as GroundMarkerType,
      'UNKNOWN_2' as GroundMarkerType,
    ])
    expect(result.icons).toEqual({})
    expect(result.failed).toHaveLength(2)
    expect(result.failed).toContain('UNKNOWN_1')
    expect(result.failed).toContain('UNKNOWN_2')
  })

  it('accounts for every input type — either in icons or in failed', async () => {
    const result = await rasterizeGroundMarkerSet([
      'LETTER_A',
      'UNKNOWN' as GroundMarkerType,
      'HOOK',
    ])
    for (const t of ['LETTER_A', 'UNKNOWN', 'HOOK'] as GroundMarkerType[]) {
      const inIcons = typeof result.icons[t] === 'string'
      const inFailed = result.failed.includes(t)
      expect(inIcons || inFailed).toBe(true)
    }
  })

  it('never rejects for a mixed-validity input (failed channel, not throw)', async () => {
    // Regression pin: the old contract returned `{}` on any failure, so a
    // caller that passes a mix of valid + invalid types must not receive a
    // rejected Promise. `failed` is the ONLY channel for partial failure.
    await expect(
      rasterizeGroundMarkerSet([
        'LETTER_A',
        'UNKNOWN' as GroundMarkerType,
        'HOOK',
      ]),
    ).resolves.toBeDefined()
  })
})

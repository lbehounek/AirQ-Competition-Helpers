import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateThumb, fitWithin } from '../photoImport/generateThumb'

// jsdom has neither `createImageBitmap` nor `OffscreenCanvas` (both are
// browser-Worker APIs). We stub them globally to verify the function's
// orchestration: arg shape passed to createImageBitmap (imageOrientation
// 'from-image' per ADR-015), size math, blob output shape, lifecycle
// (bitmap.close() always called). Real-pixel assertions — actual JPEG
// bytes, EXIF Orientation=6 rotation — require @vitest/browser and are
// gated off the default `pnpm test` run per Phase 0 plan.

describe('fitWithin (pure math)', () => {
  it('returns the source size unchanged when it already fits', () => {
    expect(fitWithin(100, 75, 200, 150)).toEqual({ width: 100, height: 75 })
    expect(fitWithin(200, 150, 200, 150)).toEqual({ width: 200, height: 150 })
  })

  it('caps wide images by width (landscape)', () => {
    // 1000x500 (2:1) inside 200x150 → cap by width → 200x100.
    expect(fitWithin(1000, 500, 200, 150)).toEqual({ width: 200, height: 100 })
  })

  it('caps tall images by height (portrait)', () => {
    // 500x1000 (1:2) inside 200x150 → cap by height → 75x150.
    expect(fitWithin(500, 1000, 200, 150)).toEqual({ width: 75, height: 150 })
  })

  it('caps square images by the smaller bound', () => {
    expect(fitWithin(1000, 1000, 200, 150)).toEqual({ width: 150, height: 150 })
  })

  it('never produces zero dimensions', () => {
    expect(fitWithin(1, 100000, 200, 150).width).toBeGreaterThanOrEqual(1)
    expect(fitWithin(100000, 1, 200, 150).height).toBeGreaterThanOrEqual(1)
  })

  it('floors instead of rounds so we never exceed the bounds', () => {
    // 333x200 inside 200x150 → width-capped at 200, height = 200*200/333 = 120.12 → 120
    const r = fitWithin(333, 200, 200, 150)
    expect(r.width).toBeLessThanOrEqual(200)
    expect(r.height).toBeLessThanOrEqual(150)
    expect(r).toEqual({ width: 200, height: 120 })
  })
})

interface FakeBitmap {
  width: number
  height: number
  close: ReturnType<typeof vi.fn>
}

function fakeBitmap(width: number, height: number): FakeBitmap {
  return { width, height, close: vi.fn() }
}

interface CanvasCall {
  width: number
  height: number
  drawImage: ReturnType<typeof vi.fn>
  convertToBlob: ReturnType<typeof vi.fn>
}

describe('generateThumb (orchestration)', () => {
  let createImageBitmapMock: ReturnType<typeof vi.fn>
  let canvasInstances: CanvasCall[]
  let mockBlob: Blob

  beforeEach(() => {
    canvasInstances = []
    mockBlob = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' })

    createImageBitmapMock = vi.fn(async () => fakeBitmap(1000, 750))

    // OffscreenCanvas constructor — capture each instance for assertion.
    const OffscreenCanvasMock = vi.fn(function (this: CanvasCall, w: number, h: number) {
      this.width = w
      this.height = h
      this.drawImage = vi.fn()
      this.convertToBlob = vi.fn(async () => mockBlob)
      const ctx = { drawImage: this.drawImage }
      ;(this as unknown as { getContext: (id: string) => unknown }).getContext = vi.fn(() => ctx)
      canvasInstances.push(this)
    }) as unknown as typeof OffscreenCanvas

    vi.stubGlobal('createImageBitmap', createImageBitmapMock)
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function dummyFile(): File {
    return new File([new Uint8Array(8)], 'photo.jpg', { type: 'image/jpeg' })
  }

  it('passes imageOrientation:"from-image" to createImageBitmap (ADR-015)', async () => {
    const file = dummyFile()
    await generateThumb(file)
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1)
    expect(createImageBitmapMock).toHaveBeenCalledWith(
      file,
      { imageOrientation: 'from-image' },
    )
  })

  it('applies default 200x150 bounds with contain-fit', async () => {
    // 1000x750 (4:3) inside 200x150 → 200x150 exactly.
    await generateThumb(dummyFile())
    expect(canvasInstances).toHaveLength(1)
    expect(canvasInstances[0].width).toBe(200)
    expect(canvasInstances[0].height).toBe(150)
  })

  it('honors custom maxWidth/maxHeight', async () => {
    await generateThumb(dummyFile(), { maxWidth: 400, maxHeight: 300 })
    expect(canvasInstances[0].width).toBe(400)
    expect(canvasInstances[0].height).toBe(300)
  })

  it('forwards quality option to convertToBlob', async () => {
    await generateThumb(dummyFile(), { quality: 0.9 })
    expect(canvasInstances[0].convertToBlob).toHaveBeenCalledWith({
      type: 'image/jpeg',
      quality: 0.9,
    })
  })

  it('defaults quality to 0.7 when not specified', async () => {
    await generateThumb(dummyFile())
    expect(canvasInstances[0].convertToBlob).toHaveBeenCalledWith({
      type: 'image/jpeg',
      quality: 0.7,
    })
  })

  it('produces a JPEG Blob result', async () => {
    const result = await generateThumb(dummyFile())
    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('image/jpeg')
    expect(result.size).toBeGreaterThan(0)
  })

  it('calls bitmap.close() after successful encode (release GC pressure)', async () => {
    const bm = fakeBitmap(1000, 750)
    createImageBitmapMock.mockResolvedValueOnce(bm)
    await generateThumb(dummyFile())
    expect(bm.close).toHaveBeenCalledTimes(1)
  })

  it('calls bitmap.close() even when encode fails', async () => {
    const bm = fakeBitmap(1000, 750)
    createImageBitmapMock.mockResolvedValueOnce(bm)
    // Make convertToBlob throw on first canvas instance — set up after
    // mock fires by patching the OffscreenCanvas mock to throw.
    const OffscreenCanvasMock = vi.fn(function (this: { getContext: () => unknown; convertToBlob: () => Promise<Blob> }) {
      this.getContext = () => ({ drawImage: () => {} })
      this.convertToBlob = () => Promise.reject(new Error('encode boom'))
    }) as unknown as typeof OffscreenCanvas
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock)

    await expect(generateThumb(dummyFile())).rejects.toThrow('encode boom')
    expect(bm.close).toHaveBeenCalledTimes(1)
  })

  it('throws when createImageBitmap rejects (corrupt input)', async () => {
    createImageBitmapMock.mockRejectedValueOnce(new Error('decode failed'))
    await expect(generateThumb(dummyFile())).rejects.toThrow('decode failed')
    expect(canvasInstances).toHaveLength(0)
  })

  it('throws when decoded bitmap has zero dimensions', async () => {
    createImageBitmapMock.mockResolvedValueOnce(fakeBitmap(0, 100))
    await expect(generateThumb(dummyFile())).rejects.toThrow(/zero dimension/)
  })

  it('throws when 2D context is unavailable', async () => {
    const OffscreenCanvasMock = vi.fn(function (this: { getContext: () => null }) {
      this.getContext = () => null
    }) as unknown as typeof OffscreenCanvas
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock)

    await expect(generateThumb(dummyFile())).rejects.toThrow(/2D context unavailable/)
  })

  it('rejects invalid bounds', async () => {
    await expect(generateThumb(dummyFile(), { maxWidth: 0 })).rejects.toThrow(/invalid bounds/)
    await expect(generateThumb(dummyFile(), { maxHeight: -1 })).rejects.toThrow(/invalid bounds/)
    expect(createImageBitmapMock).not.toHaveBeenCalled()
  })

  // Real-pixel + EXIF Orientation tests are deferred to a browser-mode
  // run (@vitest/browser + Playwright). Tracked in Phase 1b TODO.
  it.todo('EXIF Orientation=6 produces an upright thumbnail (real-canvas only)')
  it.todo('Output JPEG is ≤ 30 KB for 4 MP input (real-canvas only)')
})

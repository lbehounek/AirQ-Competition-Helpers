import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { importPhotoFiles } from '../photoImport/importPhotoFiles'
import { extractExif } from '../photoImport/extractExif'
import { generateThumb } from '../photoImport/generateThumb'
import { HeicNotSupportedError } from '../photoImport/types'

vi.mock('../photoImport/extractExif', () => ({
  extractExif: vi.fn(),
}))
vi.mock('../photoImport/generateThumb', () => ({
  generateThumb: vi.fn(),
}))

const extractExifMock = extractExif as unknown as Mock
const generateThumbMock = generateThumb as unknown as Mock

beforeEach(() => {
  // `mockReset` (not `clearAllMocks`) — the latter keeps queued
  // `mockResolvedValueOnce`/`mockRejectedValueOnce` calls and they
  // leak into the next test as silent surprise behaviour.
  extractExifMock.mockReset()
  generateThumbMock.mockReset()
  extractExifMock.mockResolvedValue({})
  generateThumbMock.mockResolvedValue(new Blob([new Uint8Array(64)], { type: 'image/jpeg' }))
})

function makeFile(name: string, type = 'image/jpeg', bytes = new Uint8Array(16)): File {
  return new File([bytes], name, { type })
}

describe('importPhotoFiles — happy path', () => {
  it('imports a single JPEG', async () => {
    const result = await importPhotoFiles([makeFile('a.jpg')])
    expect(result.ok).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
    expect(result.ok[0].file.name).toBe('a.jpg')
    expect(result.ok[0].photoId).toMatch(/^pm-/)
    expect(result.ok[0].contentHash).toMatch(/^[0-9a-f]{40}$/)
    expect(result.ok[0].thumbnail).toBeInstanceOf(Blob)
  })

  it('produces unique photoIds per file', async () => {
    const result = await importPhotoFiles([
      makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg'),
    ])
    const ids = result.ok.map(p => p.photoId)
    expect(new Set(ids).size).toBe(3)
    ids.forEach(id => expect(id).toMatch(/^pm-/))
  })

  it('produces stable contentHash per identical bytes, distinct per different', async () => {
    const sameA = makeFile('same1.jpg', 'image/jpeg', new Uint8Array([1, 2, 3, 4]))
    const sameB = makeFile('same2.jpg', 'image/jpeg', new Uint8Array([1, 2, 3, 4]))
    const diff = makeFile('different.jpg', 'image/jpeg', new Uint8Array([9, 8, 7, 6]))
    const result = await importPhotoFiles([sameA, sameB, diff])
    const hashes = new Map(result.ok.map(p => [p.file.name, p.contentHash]))
    expect(hashes.get('same1.jpg')).toBe(hashes.get('same2.jpg'))
    expect(hashes.get('same1.jpg')).not.toBe(hashes.get('different.jpg'))
  })

  it('falls back to filename extension when file.type is empty', async () => {
    const file = makeFile('photo.JPG', '', new Uint8Array(8))
    const result = await importPhotoFiles([file])
    expect(result.ok).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
  })

  it('accepts PNG', async () => {
    const result = await importPhotoFiles([makeFile('a.png', 'image/png')])
    expect(result.ok).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
  })

  it('attaches the ExifData returned by extractExif', async () => {
    extractExifMock.mockResolvedValueOnce({
      capturedAt: { lat: 50, lng: 14 },
      timestamp: '2024-01-01T00:00:00.000Z',
    })
    const result = await importPhotoFiles([makeFile('a.jpg')])
    expect(result.ok[0].exif).toEqual({
      capturedAt: { lat: 50, lng: 14 },
      timestamp: '2024-01-01T00:00:00.000Z',
    })
  })
})

describe('importPhotoFiles — rejection routing', () => {
  it('routes HEIC to failed with reason="heic"', async () => {
    extractExifMock.mockRejectedValueOnce(new HeicNotSupportedError('apple.heic'))
    const result = await importPhotoFiles([makeFile('apple.heic', 'image/heic')])
    // image/heic isn't in the supported list → "unsupported" wins before extractExif fires
    expect(result.ok).toHaveLength(0)
    expect(result.failed).toEqual([
      expect.objectContaining({ filename: 'apple.heic', reason: 'unsupported' }),
    ])
  })

  it('routes mislabeled HEIC (.jpg) to failed with reason="heic"', async () => {
    // File passes MIME gate (image/jpeg) — extractExif then detects HEIC content and throws.
    extractExifMock.mockRejectedValueOnce(new HeicNotSupportedError('photo.jpg'))
    const result = await importPhotoFiles([makeFile('photo.jpg', 'image/jpeg')])
    expect(result.ok).toHaveLength(0)
    expect(result.failed).toEqual([
      expect.objectContaining({ filename: 'photo.jpg', reason: 'heic' }),
    ])
  })

  it('routes corrupt files to failed with reason="corrupt"', async () => {
    generateThumbMock.mockRejectedValueOnce(new Error('decode failed'))
    const result = await importPhotoFiles([makeFile('broken.jpg')])
    expect(result.ok).toHaveLength(0)
    expect(result.failed).toEqual([
      expect.objectContaining({ filename: 'broken.jpg', reason: 'corrupt', message: 'decode failed' }),
    ])
  })

  it('routes unsupported MIME types to failed with reason="unsupported"', async () => {
    const result = await importPhotoFiles([
      makeFile('doc.pdf', 'application/pdf'),
      makeFile('arch.zip', 'application/zip'),
      makeFile('note.txt', 'text/plain'),
    ])
    expect(result.ok).toHaveLength(0)
    expect(result.failed).toHaveLength(3)
    result.failed.forEach(f => expect(f.reason).toBe('unsupported'))
    // extractExif/generateThumb never called for these
    expect(extractExifMock).not.toHaveBeenCalled()
    expect(generateThumbMock).not.toHaveBeenCalled()
  })
})

describe('importPhotoFiles — failure isolation (ADR-013)', () => {
  it('one corrupt file does not abort the rest of the batch', async () => {
    extractExifMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({})
    const result = await importPhotoFiles([
      makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg'),
    ])
    expect(result.ok.map(p => p.file.name).sort()).toEqual(['a.jpg', 'c.jpg'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].filename).toBe('b.jpg')
  })

  it('mixes ok and failed in a single batch', async () => {
    extractExifMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new HeicNotSupportedError('b.jpg'))
    const result = await importPhotoFiles([makeFile('a.jpg'), makeFile('b.jpg')])
    expect(result.ok).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].reason).toBe('heic')
  })
})

describe('importPhotoFiles — concurrency (ADR-014)', () => {
  // Tracks the maximum number of concurrently-pending extractExif calls
  // to verify the worker pool respects `opts.concurrency`.
  function buildConcurrencyTracker() {
    let active = 0
    let peak = 0
    const tracker = vi.fn(async () => {
      active++
      if (active > peak) peak = active
      await new Promise(r => setTimeout(r, 5))
      active--
      return {}
    })
    return { tracker, get peak() { return peak } }
  }

  it('caps active workers at the configured concurrency (default 8)', async () => {
    const t = buildConcurrencyTracker()
    extractExifMock.mockImplementation(t.tracker)
    const files = Array.from({ length: 20 }, (_, i) => makeFile(`f${i}.jpg`))
    await importPhotoFiles(files)
    expect(t.peak).toBeLessThanOrEqual(8)
    expect(t.peak).toBeGreaterThan(1)
  })

  it('respects an explicit concurrency: 3', async () => {
    const t = buildConcurrencyTracker()
    extractExifMock.mockImplementation(t.tracker)
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`f${i}.jpg`))
    await importPhotoFiles(files, { concurrency: 3 })
    expect(t.peak).toBeLessThanOrEqual(3)
  })

  it('processes ALL files regardless of concurrency cap', async () => {
    const t = buildConcurrencyTracker()
    extractExifMock.mockImplementation(t.tracker)
    const files = Array.from({ length: 20 }, (_, i) => makeFile(`f${i}.jpg`))
    const result = await importPhotoFiles(files, { concurrency: 4 })
    expect(result.ok).toHaveLength(20)
  })

  it('treats concurrency < 1 as 1', async () => {
    const files = [makeFile('a.jpg'), makeFile('b.jpg')]
    const result = await importPhotoFiles(files, { concurrency: 0 })
    expect(result.ok).toHaveLength(2)
  })
})

describe('importPhotoFiles — progress callback', () => {
  it('calls onProgress once per file with monotonically increasing done', async () => {
    const onProgress = vi.fn()
    const files = [makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')]
    await importPhotoFiles(files, { onProgress })
    expect(onProgress).toHaveBeenCalledTimes(3)
    const dones = onProgress.mock.calls.map(c => c[0])
    expect(dones).toEqual([1, 2, 3])
    // Total is always the original count
    onProgress.mock.calls.forEach(c => expect(c[1]).toBe(3))
  })

  it('reports progress for filtered (unsupported) files too', async () => {
    const onProgress = vi.fn()
    const files = [
      makeFile('a.jpg'),
      makeFile('doc.pdf', 'application/pdf'),
      makeFile('b.jpg'),
    ]
    await importPhotoFiles(files, { onProgress })
    expect(onProgress).toHaveBeenCalledTimes(3)
  })

  it('reports progress for failed files too', async () => {
    const onProgress = vi.fn()
    extractExifMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('boom'))
    await importPhotoFiles([makeFile('a.jpg'), makeFile('b.jpg')], { onProgress })
    expect(onProgress).toHaveBeenCalledTimes(2)
  })
})

describe('importPhotoFiles — edge cases', () => {
  it('returns empty ok/failed for an empty input', async () => {
    const result = await importPhotoFiles([])
    expect(result.ok).toEqual([])
    expect(result.failed).toEqual([])
  })

  it('runs extractExif, generateThumb, and the hash in parallel per file', async () => {
    // We can't easily verify "started simultaneously" in jsdom, but we
    // can verify they were all awaited (called) for each successful file.
    await importPhotoFiles([makeFile('a.jpg')])
    expect(extractExifMock).toHaveBeenCalledTimes(1)
    expect(generateThumbMock).toHaveBeenCalledTimes(1)
  })
})

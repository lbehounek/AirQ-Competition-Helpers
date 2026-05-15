import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import exifr from 'exifr'
import { extractExif } from '../photoImport/extractExif'
import { HeicNotSupportedError } from '../photoImport/types'

// Mock exifr — we test the LOGIC in extractExif, not exifr itself. Phase
// 1b's generateThumb tests exercise the actual Canvas/createImageBitmap
// path with real JPEG bytes; here we want fast, deterministic, jsdom-only.
vi.mock('exifr', () => ({
  default: {
    gps: vi.fn(),
    parse: vi.fn(),
  },
}))

const gpsMock = exifr.gps as unknown as Mock
const parseMock = exifr.parse as unknown as Mock

beforeEach(() => {
  vi.clearAllMocks()
})

function makeFile(bytes: Uint8Array, name = 'photo.jpg', type = 'image/jpeg'): File {
  // Cast: `Uint8Array<ArrayBufferLike>` confuses the strict TS lib about
  // BlobPart assignability when the buffer could be a SharedArrayBuffer.
  // Runtime is fine — we always allocate fresh ArrayBuffer-backed views.
  return new File([bytes as BlobPart], name, { type })
}

// Minimal JPEG: SOI + EOI. extractExif only sniffs first 12 bytes for HEIC,
// so for non-HEIC tests this is enough to bypass that gate.
function jpegBytes(size = 64): Uint8Array {
  const out = new Uint8Array(size)
  out[0] = 0xff; out[1] = 0xd8 // SOI
  out[out.length - 2] = 0xff; out[out.length - 1] = 0xd9 // EOI
  return out
}

// ISO base-media file: bytes 4..7 = "ftyp", 8..11 = brand.
function ftypBytes(brand: string, size = 32): Uint8Array {
  const out = new Uint8Array(size)
  // box size
  out[0] = 0; out[1] = 0; out[2] = 0; out[3] = size
  // "ftyp"
  out[4] = 0x66; out[5] = 0x74; out[6] = 0x79; out[7] = 0x70
  // brand (4 ASCII chars)
  for (let i = 0; i < 4; i++) out[8 + i] = brand.charCodeAt(i)
  return out
}

describe('extractExif — HEIC content rejection', () => {
  it.each(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'])('rejects HEIC brand %s by content', async (brand) => {
    // Mislabeled — .jpg extension, image/jpeg MIME, but HEIC bytes inside.
    const file = makeFile(ftypBytes(brand), 'photo.jpg', 'image/jpeg')
    await expect(extractExif(file)).rejects.toBeInstanceOf(HeicNotSupportedError)
    expect(gpsMock).not.toHaveBeenCalled()
    expect(parseMock).not.toHaveBeenCalled()
  })

  it('includes the original filename in the error message', async () => {
    const file = makeFile(ftypBytes('heic'), 'IMG_0001.jpg')
    await expect(extractExif(file)).rejects.toThrow(/IMG_0001\.jpg/)
  })

  it.each(['mif1', 'msf1'])('does NOT reject generic MIAF brand %s (exifr can parse these)', async (brand) => {
    // mif1/msf1 are the generic ISO-BMFF MIAF brands used by many non-HEIC
    // HEIF profiles. Treating them as HEIC produced false rejections.
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue(null)
    const file = makeFile(ftypBytes(brand), `photo-${brand}.heif`)
    await expect(extractExif(file)).resolves.toEqual({})
    expect(gpsMock).toHaveBeenCalled()
  })

  it('does NOT reject non-HEIC `ftyp` brands (e.g. mp4)', async () => {
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue(null)
    // mp42 is an ftyp brand but not HEIC — should fall through to exifr.
    const file = makeFile(ftypBytes('mp42'), 'video.jpg')
    await expect(extractExif(file)).resolves.toEqual({})
  })

  it('does NOT reject short JPEGs (< 12 bytes) on the HEIC sniff', async () => {
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue(null)
    const file = makeFile(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'tiny.jpg')
    await expect(extractExif(file)).resolves.toEqual({})
  })
})

describe('extractExif — GPS extraction', () => {
  it('extracts valid lat/lng + altitude', async () => {
    gpsMock.mockResolvedValue({ latitude: 50.1, longitude: 14.2 })
    parseMock.mockResolvedValue({ GPSAltitude: 350 })
    const file = makeFile(jpegBytes())
    expect(await extractExif(file)).toEqual({
      capturedAt: { lat: 50.1, lng: 14.2, altitude: 350 },
    })
  })

  it('returns lat/lng without altitude when altitude is missing', async () => {
    gpsMock.mockResolvedValue({ latitude: 50.1, longitude: 14.2 })
    parseMock.mockResolvedValue({})
    const file = makeFile(jpegBytes())
    expect(await extractExif(file)).toEqual({
      capturedAt: { lat: 50.1, lng: 14.2 },
    })
  })

  it('omits capturedAt when GPS is absent', async () => {
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue({})
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).capturedAt).toBeUndefined()
  })

  it('treats exact (0, 0) as no GPS (camera-lock-failed sentinel)', async () => {
    gpsMock.mockResolvedValue({ latitude: 0, longitude: 0 })
    parseMock.mockResolvedValue({})
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).capturedAt).toBeUndefined()
  })

  it('keeps non-zero coordinate even when one axis is 0', async () => {
    gpsMock.mockResolvedValue({ latitude: 0, longitude: 14.2 })
    parseMock.mockResolvedValue({})
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).capturedAt).toEqual({ lat: 0, lng: 14.2 })
  })

  it.each([
    ['NaN lat', { latitude: NaN, longitude: 14.2 }],
    ['Infinity lng', { latitude: 50.1, longitude: Infinity }],
    ['out-of-range lat', { latitude: 91, longitude: 14.2 }],
    ['out-of-range lng', { latitude: 50.1, longitude: 181 }],
    ['non-number lat', { latitude: 'fifty', longitude: 14.2 }],
  ])('rejects %s', async (_label, value) => {
    gpsMock.mockResolvedValue(value as { latitude: number; longitude: number })
    parseMock.mockResolvedValue({})
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).capturedAt).toBeUndefined()
  })

  it('omits invalid altitude but keeps valid GPS', async () => {
    gpsMock.mockResolvedValue({ latitude: 50.1, longitude: 14.2 })
    parseMock.mockResolvedValue({ GPSAltitude: NaN })
    const file = makeFile(jpegBytes())
    expect(await extractExif(file)).toEqual({
      capturedAt: { lat: 50.1, lng: 14.2 },
    })
  })
})

describe('extractExif — timestamp', () => {
  it('formats DateTimeOriginal as ISO 8601 UTC', async () => {
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue({ DateTimeOriginal: new Date('2024-03-15T10:30:00Z') })
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).timestamp).toBe('2024-03-15T10:30:00.000Z')
  })

  it('omits timestamp when DateTimeOriginal is absent', async () => {
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue({})
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).timestamp).toBeUndefined()
  })

  it('omits timestamp when DateTimeOriginal is an Invalid Date', async () => {
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue({ DateTimeOriginal: new Date('bogus') })
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).timestamp).toBeUndefined()
  })

  it('omits timestamp when DateTimeOriginal is a string (not parsed by exifr)', async () => {
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue({ DateTimeOriginal: '2024:03:15 10:30:00' })
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).timestamp).toBeUndefined()
  })
})

describe('extractExif — orientation', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('returns numeric orientation %i', async (o) => {
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue({ Orientation: o })
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).orientation).toBe(o)
  })

  it.each([
    ['0 (out of range)', 0],
    ['9 (out of range)', 9],
    ['-1 (out of range)', -1],
    ['3.5 (non-integer)', 3.5],
  ])('omits orientation for %s', async (_label, value) => {
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue({ Orientation: value })
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).orientation).toBeUndefined()
  })

  it('omits orientation when exifr returns a translated string', async () => {
    // If `translateValues` accidentally gets re-enabled by a future refactor,
    // exifr returns 'Horizontal (normal)' instead of 1. Guard against it.
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue({ Orientation: 'Horizontal (normal)' })
    const file = makeFile(jpegBytes())
    expect((await extractExif(file)).orientation).toBeUndefined()
  })
})

describe('extractExif — error resilience', () => {
  it('returns {} when both exifr.gps and exifr.parse throw', async () => {
    gpsMock.mockRejectedValue(new Error('corrupt'))
    parseMock.mockRejectedValue(new Error('corrupt'))
    const file = makeFile(jpegBytes())
    expect(await extractExif(file)).toEqual({})
  })

  it('returns partial result when only one of gps/parse throws', async () => {
    gpsMock.mockResolvedValue({ latitude: 50.1, longitude: 14.2 })
    parseMock.mockRejectedValue(new Error('parse failed'))
    const file = makeFile(jpegBytes())
    expect(await extractExif(file)).toEqual({
      capturedAt: { lat: 50.1, lng: 14.2 },
    })
  })

  it('exifr.parse is called with translateValues:false to keep numeric Orientation', async () => {
    gpsMock.mockResolvedValue(null)
    parseMock.mockResolvedValue({})
    const file = makeFile(jpegBytes())
    await extractExif(file)
    expect(parseMock).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ translateValues: false }),
    )
  })
})

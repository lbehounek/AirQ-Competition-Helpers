/**
 * The classification half of the client report of 2026-07-23 — "a photo that
 * HAS GPS shows up under Bez GPS".
 *
 * A failed READ and "this photo carries no coordinates" are the same thing to
 * an EXIF parser, so the two have to be told apart deliberately or a perfectly
 * good photo lands in the no-GPS tray. The first attempt at that guard keyed on
 * `err instanceof DOMException` and was dead code, because exifr does not read
 * with `Blob.arrayBuffer()` — it reads through FileReader:
 *
 *   exifr/src/reader.mjs:63-68
 *     export const readBlobAsArrayBuffer = blob => new Promise((resolve, reject) => {
 *       let reader = new FileReader()
 *       reader.onloadend = () => resolve(reader.result || new ArrayBuffer)
 *       reader.onerror = reject
 *       reader.readAsArrayBuffer(blob)
 *     })
 *
 * `onerror` hands over the ProgressEvent; the DOMException stays on
 * `reader.error` and is discarded. So the value reaching extractExif was a
 * plain event object that no DOMException check could match.
 *
 * Two changes closed it, and both are pinned below: extractExif reads the bytes
 * itself and hands exifr a buffer (so FileReader is out of the picture), and
 * the discriminator recognises the ProgressEvent shape as well.
 *
 * The fixture is a committed, generated JPEG with a genuine GPS IFD, so a
 * pass/fail here is about the error plumbing and not the sample data.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractExif } from '../photoImport/extractExif'
import { isUnreadableFileError } from '../photoImport/types'

// A committed 523-byte JPEG carrying a real EXIF GPS IFD. Generated rather
// than photographed so it stays in git (the repo's real sample photos are
// gitignored 2 MB originals, so tests that depended on them could never run in
// CI) and so the coordinates under test are visible right here.
const GPS_FIXTURE = resolve(__dirname, 'fixtures/gps-tagged.jpg')
const FIXTURE_LAT = 50.123288333333335
const FIXTURE_LNG = 14.044641666666667

function realFile(name = GPS_FIXTURE): File {
  const bytes = readFileSync(name)
  return new File([new Uint8Array(bytes)], 'DSC_0001.JPG', { type: 'image/jpeg' })
}

/**
 * FileReader stand-in that reproduces a browser read failure faithfully:
 * `onerror` receives the ProgressEvent, `reader.error` carries the DOMException,
 * and `onloadend` fires afterwards (as the spec requires) with a null `result`.
 */
class FailingFileReader {
  onloadend: null | (() => void) = null
  onerror: null | ((ev: unknown) => void) = null
  onload: null | (() => void) = null
  result: ArrayBuffer | null = null
  error = new DOMException('The requested file could not be read', 'NotReadableError')
  readAsArrayBuffer(): void {
    setTimeout(() => {
      this.onerror?.({ type: 'error', target: this })
      this.onloadend?.()
    }, 0)
  }
}

function withFailingFileReader<T>(fn: () => Promise<T>): Promise<T> {
  const real = globalThis.FileReader
  ;(globalThis as unknown as { FileReader: unknown }).FileReader = FailingFileReader
  return fn().finally(() => {
    ;(globalThis as unknown as { FileReader: unknown }).FileReader = real
  })
}

describe('extractExif — happy path against a GPS-tagged fixture', () => {
  it('reads the GPS coordinates and the capture timestamp', async () => {
    const exif = await extractExif(realFile())
    expect(exif.capturedAt).toEqual({ lat: FIXTURE_LAT, lng: FIXTURE_LNG })
    // Only asserted as "present": exifr resolves EXIF DateTimeOriginal in LOCAL
    // time (EXIF carries no zone), so pinning an exact instant would pass here
    // and fail in CI.
    expect(exif.timestamp).toBeTruthy()
  })
})

describe('isUnreadableFileError recognises BOTH shapes a read failure arrives in', () => {
  it('recognises the ProgressEvent that FileReader.onerror passes', () => {
    // This is the exact value exifr rejects with. Matching only DOMException
    // missed it entirely, which made the whole guard dead code for the EXIF path.
    const reader = new FailingFileReader()
    expect(isUnreadableFileError({ type: 'error', target: reader })).toBe(true)
    // …and the DOMException hanging off `reader.error`, which is what
    // `Blob.arrayBuffer()` rejects with directly.
    expect(isUnreadableFileError(reader.error)).toBe(true)
  })

  it('does NOT treat a parse failure as a read failure', () => {
    // Corrupt JPEG / no EXIF segment must still degrade to "no coordinates",
    // otherwise every EXIF-less photo becomes a failed import.
    expect(isUnreadableFileError(new Error('Invalid JPEG structure'))).toBe(false)
    expect(isUnreadableFileError(null)).toBe(false)
    expect(isUnreadableFileError('nope')).toBe(false)
    expect(isUnreadableFileError({ type: 'load', target: {} })).toBe(false)
  })
})

describe('an unreadable photo is reported, never filed as "no coordinates"', () => {
  /** A File whose bytes cannot be read — the SD card was pulled mid-import. */
  function unreadableFile(): File {
    const file = realFile()
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(
        new DOMException('The requested file could not be read', 'NotReadableError'),
      ),
    })
    return file
  }

  it('propagates the read failure instead of returning empty EXIF', async () => {
    // The whole point: resolving with `{}` would send a GPS-tagged photo down
    // the `withoutGps` branch and into the no-GPS tray, with no way back —
    // the content hash comes from a separate, working read, so re-importing
    // the file would be rejected as a duplicate forever.
    await expect(extractExif(unreadableFile())).rejects.toThrow(/could not be read/)
  })

  it('classifies that failure as "read", so the import reports it', async () => {
    const err = await extractExif(unreadableFile()).catch((e) => e)
    expect(isUnreadableFileError(err)).toBe(true)
  })
})

describe('the EXIF read no longer goes through FileReader at all', () => {
  it('reads GPS fine even when FileReader is completely broken', async () => {
    // Regression guard for the root cause: exifr reads via FileReader and
    // rejects with a ProgressEvent whose DOMException is discarded, which is
    // indistinguishable from "no EXIF here". extractExif now reads the bytes
    // itself with `arrayBuffer()` and hands exifr a buffer, so a broken
    // FileReader cannot affect classification.
    const exif = await withFailingFileReader(() => extractExif(realFile()))
    expect(exif.capturedAt).toMatchObject({ lat: FIXTURE_LAT, lng: FIXTURE_LNG })
  })
})

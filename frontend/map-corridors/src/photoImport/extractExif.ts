import exifr from 'exifr'
import type { ExifData } from './types'
import { HeicNotSupportedError, isUnreadableFileError } from './types'

// ISO base-media-file-format brands that exifr/photo-helper cannot decode.
// Apple HEIC and its HEVC-derived codec brands all share the `ftyp` box
// layout. We deliberately do NOT include the generic `mif1`/`msf1` MIAF
// brands here — many JPEG-encoded HEIF files use those brands and exifr
// CAN parse them. Treating mif1 as HEIC produced false "HEIC not
// supported" rejections on otherwise-valid images.
const HEIC_FTYP_BRANDS: ReadonlySet<string> = new Set([
  'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx',
])

// HEIC/HEIF detection by content (ADR-006). Filename extension is not
// trusted — Apple Photos export sometimes writes `.jpg` over HEIC bytes.
// Layout: bytes 0..3 = box size, 4..7 = "ftyp", 8..11 = brand.
// Takes already-read bytes so the file is read exactly once per import.
function isHeicContent(b: Uint8Array): boolean {
  if (b.length < 12) return false
  if (b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) return false
  const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase()
  return HEIC_FTYP_BRANDS.has(brand)
}

// Reject the (0, 0) GPS sentinel — some cameras write zeros when GPS lock
// fails. ADR-005 / Phase 1 test plan.
function isValidGps(g: { latitude?: unknown; longitude?: unknown } | null | undefined):
  g is { latitude: number; longitude: number } {
  if (!g) return false
  const { latitude, longitude } = g
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return false
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) return false
  if (latitude === 0 && longitude === 0) return false
  if (latitude < -90 || latitude > 90) return false
  if (longitude < -180 || longitude > 180) return false
  return true
}

/**
 * Extract a normalized subset of EXIF data: GPS subject coordinates,
 * capture timestamp, and orientation. Pure function — no storage, no
 * mutation, no UI.
 *
 * @throws HeicNotSupportedError if the file's content is HEIC/HEIF.
 * @throws DOMException if the file's bytes cannot be read at all. Propagated
 *   rather than swallowed so the file is reported as an import failure;
 *   treating it as "no EXIF" would file a GPS-tagged photo under "Bez GPS"
 *   with no explanation, and — because the content hash comes from a separate,
 *   working read — the photo could never be re-imported to fix it: dedup
 *   would report it as an already-imported duplicate forever.
 *   Genuine parse failures (corrupt JPEG, missing EXIF segment) still resolve
 *   to an empty result so importPhotoFiles keeps going on the rest of the batch.
 */
export async function extractExif(file: File, preRead?: Uint8Array): Promise<ExifData> {
  // Parse from BYTES, never from the File. Handing exifr a File makes it read
  // via FileReader, whose `onerror` rejects with a ProgressEvent that discards
  // the underlying DOMException — arriving here as something a catch-all reads
  // as "no EXIF found". That is exactly how a photo with perfectly good GPS
  // lands in the no-GPS tray.
  //
  // `importPhotoFiles` passes bytes it already read for the content hash, so
  // one read serves EXIF, hashing and the HEIC sniff. The self-read fallback
  // keeps this callable standalone (and is what the unit tests exercise).
  const bytes = preRead ?? new Uint8Array(await file.arrayBuffer())

  if (isHeicContent(bytes)) {
    throw new HeicNotSupportedError(file.name)
  }

  const result: ExifData = {}

  // Parsing from bytes can no longer fail for I/O reasons, so anything thrown
  // here is a genuine parse failure — except that the guard stays in place as
  // defense in depth if this ever goes back to passing a File/Blob.
  const swallowParseErrors = (err: unknown) => {
    if (isUnreadableFileError(err)) throw err
    return null
  }

  const gps = await exifr.gps(bytes).catch(swallowParseErrors)
  // `translateValues: false` keeps Orientation as a 1..8 integer instead
  // of exifr's human-readable string ("Horizontal (normal)" etc.).
  const meta = await exifr.parse(bytes, {
    pick: ['DateTimeOriginal', 'GPSAltitude', 'Orientation'],
    translateValues: false,
  }).catch(swallowParseErrors) as Record<string, unknown> | null

  if (isValidGps(gps)) {
    const altitude = meta?.GPSAltitude
    const hasAltitude = typeof altitude === 'number' && Number.isFinite(altitude)
    result.capturedAt = {
      lat: gps.latitude,
      lng: gps.longitude,
      ...(hasAltitude ? { altitude: altitude as number } : {}),
    }
  }

  const dto = meta?.DateTimeOriginal
  if (dto instanceof Date && !Number.isNaN(dto.getTime())) {
    result.timestamp = dto.toISOString()
  }

  const orientation = meta?.Orientation
  if (
    typeof orientation === 'number' &&
    Number.isInteger(orientation) &&
    orientation >= 1 && orientation <= 8
  ) {
    result.orientation = orientation
  }

  return result
}

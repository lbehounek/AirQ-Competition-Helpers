import exifr from 'exifr'
import type { ExifData } from './types'
import { HeicNotSupportedError } from './types'

// ISO base-media-file-format brands that exifr/photo-helper cannot decode.
// Apple HEIC, HEIF, and a handful of related codecs all share the `ftyp` box
// layout. The list is kept conservative: only brands known to be HEIC-family.
const HEIC_FTYP_BRANDS: ReadonlySet<string> = new Set([
  'heic', 'heix', 'mif1', 'msf1', 'heim', 'heis', 'hevc', 'hevx',
])

// HEIC/HEIF detection by content (ADR-006). Filename extension is not
// trusted — Apple Photos export sometimes writes `.jpg` over HEIC bytes.
// Layout: bytes 0..3 = box size, 4..7 = "ftyp", 8..11 = brand.
async function isHeicContent(file: File | Blob): Promise<boolean> {
  if (file.size < 12) return false
  const head = await file.slice(0, 12).arrayBuffer()
  const b = new Uint8Array(head)
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
 *   Any other parse failure (corrupt JPEG, missing EXIF) resolves to an
 *   empty result so importPhotoFiles can keep going on the rest of the batch.
 */
export async function extractExif(file: File): Promise<ExifData> {
  if (await isHeicContent(file)) {
    throw new HeicNotSupportedError(file.name)
  }

  const result: ExifData = {}

  const gps = await exifr.gps(file).catch(() => null)
  // `translateValues: false` keeps Orientation as a 1..8 integer instead
  // of exifr's human-readable string ("Horizontal (normal)" etc.).
  const meta = await exifr.parse(file, {
    pick: ['DateTimeOriginal', 'GPSAltitude', 'Orientation'],
    translateValues: false,
  }).catch(() => null) as Record<string, unknown> | null

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

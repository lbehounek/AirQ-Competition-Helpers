// One-off EXIF verification for the 3 sample JPGs at repo root.
// Run: cd frontend/map-corridors && pnpm exec node scripts/verify-exif.mjs
//
// Confirms that `exifr` (the library Phase 0 of photo-map-culling pins) can
// extract GPS + timestamp + orientation from real Ricoh-camera photos
// before we wire it into the import pipeline (Phase 1).

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import exifr from 'exifr'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const files = ['RIMG0169.JPG', 'RIMG0170.JPG', 'RIMG0172.JPG']

function fmtCoord(n, axis) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '(none)'
  const dir = axis === 'lat' ? (n >= 0 ? 'N' : 'S') : (n >= 0 ? 'E' : 'W')
  return `${Math.abs(n).toFixed(6)}° ${dir}`
}

for (const name of files) {
  const path = resolve(REPO_ROOT, name)
  const buf = await readFile(path)

  // Mirror the doc's Phase 1 plan: subset parse, GPS-only + a few tags.
  const gps = await exifr.gps(buf)
  const meta = await exifr.parse(buf, {
    pick: ['DateTimeOriginal', 'GPSAltitude', 'Orientation', 'Make', 'Model'],
  })

  console.log(`\n=== ${name} (${(buf.byteLength / 1024).toFixed(0)} KB) ===`)
  if (gps) {
    console.log(`  GPS:        ${fmtCoord(gps.latitude, 'lat')}, ${fmtCoord(gps.longitude, 'lon')}`)
    console.log(`  altitude:   ${meta?.GPSAltitude ?? '(none)'} m`)
  } else {
    console.log('  GPS:        (none)')
  }
  console.log(`  taken:      ${meta?.DateTimeOriginal?.toISOString?.() ?? meta?.DateTimeOriginal ?? '(none)'}`)
  console.log(`  orientation:${meta?.Orientation ?? '(none)'}`)
  console.log(`  camera:     ${[meta?.Make, meta?.Model].filter(Boolean).join(' ') || '(none)'}`)
  if (gps) {
    const url = `https://www.google.com/maps/?q=${gps.latitude},${gps.longitude}`
    console.log(`  map:        ${url}`)
  }
}

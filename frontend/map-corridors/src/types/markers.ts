// Shared marker type definitions — used by App.tsx, MapProviderView, useCorridorSessionOPFS, mapCapture

// Photo label sets + the discipline → label-set rule live in
// `@airq/shared-discipline` so map-corridors and photo-helper cannot drift.
// Re-exported here under the legacy names so existing imports
// (`from '../types/markers'`) continue to resolve.
import { ALL_PHOTO_LABELS, type PhotoLabel } from '@airq/shared-discipline'

export {
  PHOTO_LABELS_LETTERS,
  PHOTO_LABELS_NUMBERS,
  ALL_PHOTO_LABELS,
  getLabelsForDiscipline,
} from '@airq/shared-discipline'
export type { PhotoLabel } from '@airq/shared-discipline'

// `lng/lat` is the subject (answer-sheet) location; `capturedAt` is the optional EXIF source. See docs/photo-map-culling/implementation-plan.md Phase 0.
// `flag` is a Phase-5 intermediate — until Phase 8 (map-picks.json), the
// flag persists on the marker. Phase 8 makes map-picks.json the source
// of truth and the marker.flag becomes a render-time projection.
export type PhotoFlag = 'pick' | 'reject'
export type PhotoMarker = Readonly<{
  id: string
  lng: number
  lat: number
  /**
   * Original camera filename (e.g. `DSC_0123.JPG`), assigned at import and
   * NEVER overwritten. It is the stable sort key (list/tray order by filename)
   * and the secondary part of the exported KML name. Renaming writes
   * `displayName`, not this. See `computeRenamedPhoto`.
   */
  name: string
  /**
   * Optional user-supplied workflow label (e.g. `TP1`). When set it is shown
   * as the primary name everywhere (list row, marker popup, KML `<name>`,
   * Photo Helper tile) while `name` is preserved underneath for ordering and
   * identification. `undefined` = no custom name, fall back to `name`.
   * User feedback 2026-05-17 (Martin Hrivna).
   */
  displayName?: string
  label?: PhotoLabel
  capturedAt?: Readonly<{
    lng: number
    lat: number
    altitude?: number
    timestamp?: string
  }>
  photoId?: string
  flag?: PhotoFlag
  // Phase D of photo-map-culling — when the label was last set, ISO 8601.
  // Drives the "newer wins" conflict resolution in `useEditorPicksSync`
  // and `useMapPicksSync` (label may be set in either app now).
  labelUpdatedAt?: string
}>

// Ground marker types — FAI precision flying canvas shapes (12 letters + 14 symbols).
// Single source of truth: the union is derived from the array so the two can't drift.
export const GROUND_MARKER_TYPES = [
  // Letters (FAI canvas uses a restricted set — J, M, N, Q, T are intentionally omitted)
  'LETTER_A', 'LETTER_C', 'LETTER_E', 'LETTER_F', 'LETTER_G', 'LETTER_I',
  'LETTER_K', 'LETTER_L', 'LETTER_O', 'LETTER_P', 'LETTER_R', 'LETTER_S',
  // Symbols
  'PARALLELOGRAM', 'PI', 'CROSSED_LEGS', 'TRIANGLE', 'SQUARE_DIAGONAL',
  'SPLIT_RECT', 'FIGURE_8', 'SMALL_TRIANGLE', 'THREE_BARS',
  'TRIANGLE_ON_LINE', 'PERPENDICULAR', 'WANG', 'SLANTED_CROSS', 'HOOK',
] as const
export type GroundMarkerType = (typeof GROUND_MARKER_TYPES)[number]

export const DEFAULT_GROUND_MARKER_TYPE: GroundMarkerType = 'LETTER_A'

// GroundMarker has no `name` field (unlike PhotoMarker) — ground markers are
// identified by their FAI shape (`type`) which serves as the visible label.
export type GroundMarker = Readonly<{
  id: string
  lng: number
  lat: number
  type: GroundMarkerType
}>

export type GroundMarkerCallbacks = {
  groundMarkers: readonly GroundMarker[]
  activeGroundMarkerId: string | null
  onGroundMarkerAdd: (lng: number, lat: number) => void
  onGroundMarkerDragEnd: (id: string, lng: number, lat: number) => void
  onGroundMarkerClick: (id: string | null) => void
  onGroundMarkerTypeChange: (id: string, type: GroundMarkerType) => void
  onGroundMarkerDelete: (id: string) => void
}

// Runtime guards for deserialization / untrusted input (OPFS session files, KML imports).
// Keep these narrow: validate only what downstream code assumes.

const GROUND_MARKER_TYPE_SET: ReadonlySet<string> = new Set<string>(GROUND_MARKER_TYPES)
const PHOTO_LABEL_SET: ReadonlySet<string> = new Set<string>(ALL_PHOTO_LABELS)

function isValidLngLat(lng: unknown, lat: unknown): boolean {
  return (
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180 &&
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
  )
}

export function isGroundMarker(value: unknown): value is GroundMarker {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    isValidLngLat(v.lng, v.lat) &&
    typeof v.type === 'string' && GROUND_MARKER_TYPE_SET.has(v.type)
  )
}

function isValidCapturedAt(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  if (!isValidLngLat(c.lng, c.lat)) return false
  if (c.altitude !== undefined && !(typeof c.altitude === 'number' && Number.isFinite(c.altitude))) return false
  if (c.timestamp !== undefined && typeof c.timestamp !== 'string') return false
  return true
}

const PHOTO_FLAG_SET: ReadonlySet<string> = new Set<string>(['pick', 'reject'])

export function isPhotoMarker(value: unknown): value is PhotoMarker {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    isValidLngLat(v.lng, v.lat) &&
    typeof v.name === 'string' &&
    (v.displayName === undefined || typeof v.displayName === 'string') &&
    (v.label === undefined || (typeof v.label === 'string' && PHOTO_LABEL_SET.has(v.label))) &&
    isValidCapturedAt(v.capturedAt) &&
    (v.photoId === undefined || (typeof v.photoId === 'string' && v.photoId.length > 0)) &&
    (v.flag === undefined || (typeof v.flag === 'string' && PHOTO_FLAG_SET.has(v.flag))) &&
    (v.labelUpdatedAt === undefined || typeof v.labelUpdatedAt === 'string')
  )
}

export function sanitizeGroundMarkers(input: unknown): GroundMarker[] {
  if (!Array.isArray(input)) return []
  return input.filter(isGroundMarker)
}

export function sanitizePhotoMarkers(input: unknown): PhotoMarker[] {
  if (!Array.isArray(input)) return []
  return input.filter(isPhotoMarker)
}

// Phase 6 of photo-map-culling — no-GPS photo tray entries.
// These photos live in this list (not in `markers`) until the user drags
// one onto the map, at which point a `PhotoMarker` is created at the drop
// coords and the entry leaves this list. ADR-012 — they never receive
// synthetic coordinates while in the tray.
export type NoGpsPhoto = Readonly<{
  photoId: string
  /**
   * Original camera filename — the immutable sort key for the tray and the
   * right-side list's no-GPS group. Renaming writes `displayName`, not this.
   */
  filename: string
  /**
   * Optional user-supplied workflow label (e.g. `TP1`). Mirrors
   * `PhotoMarker.displayName`: shown as the primary name, `filename` preserved
   * underneath. Carried onto the created `PhotoMarker.displayName` when the
   * photo is dragged onto the map (`placeNoGpsPhoto`).
   */
  displayName?: string
  /** ISO 8601 EXIF DateTimeOriginal; used for tray sort order. Optional — some cameras don't set it. */
  timestamp?: string
}>

export function isNoGpsPhoto(value: unknown): value is NoGpsPhoto {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.photoId === 'string' && v.photoId.length > 0 &&
    typeof v.filename === 'string' && v.filename.length > 0 &&
    (v.displayName === undefined || typeof v.displayName === 'string') &&
    (v.timestamp === undefined || typeof v.timestamp === 'string')
  )
}

/**
 * Effective display name for a photo marker: the user's custom `displayName`
 * if set, otherwise the original camera filename. Single source of truth so
 * the list row, marker popup, KML export, and map-picks all agree.
 */
export function photoMarkerDisplayName(m: Pick<PhotoMarker, 'name' | 'displayName'>): string {
  return m.displayName ?? m.name
}

/** Effective display name for a no-GPS tray entry. See {@link photoMarkerDisplayName}. */
export function noGpsPhotoDisplayName(p: Pick<NoGpsPhoto, 'filename' | 'displayName'>): string {
  return p.displayName ?? p.filename
}

/**
 * Numeric-aware filename comparator for list/tray ordering. `numeric: true`
 * makes `DSC_0009 < DSC_0010 < DSC_0100` (a plain lexical sort would put
 * `DSC_0010` before `DSC_0009`). `sensitivity: 'base'` keeps the order stable
 * regardless of case. Sorts by the ORIGINAL filename, so a rename
 * (which only touches `displayName`) never reorders the list.
 */
export function compareFilenames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Sort comparator for no-GPS tray entries. Ordered by ORIGINAL camera filename
 * (numeric-aware via {@link compareFilenames}, so `IMG_9` < `IMG_10`), with EXIF
 * timestamp as the tie-break for identical filenames. Sorting by the immutable
 * filename — not the user's `displayName` — keeps a renamed photo from jumping
 * position (user feedback 2026-05-17).
 *
 * Single source of truth: both the off-map tray ({@link NoGpsPhoto} thumbnails)
 * and the right-side list's no-GPS group order through this, so the two surfaces
 * can never disagree on tie-break order. A typo flipping it would otherwise ship
 * silently — see `componentLogic.test.ts`.
 */
export function compareNoGpsPhotos(a: NoGpsPhoto, b: NoGpsPhoto): number {
  const byName = compareFilenames(a.filename, b.filename)
  if (byName !== 0) return byName
  const ta = a.timestamp ?? '￿'
  const tb = b.timestamp ?? '￿'
  return ta < tb ? -1 : ta > tb ? 1 : 0
}

export function sanitizeNoGpsPhotos(input: unknown): NoGpsPhoto[] {
  if (!Array.isArray(input)) return []
  return input.filter(isNoGpsPhoto)
}

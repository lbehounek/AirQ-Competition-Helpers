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
  name: string
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
  filename: string
  /** ISO 8601 EXIF DateTimeOriginal; used for tray sort order. Optional — some cameras don't set it. */
  timestamp?: string
}>

export function isNoGpsPhoto(value: unknown): value is NoGpsPhoto {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.photoId === 'string' && v.photoId.length > 0 &&
    typeof v.filename === 'string' && v.filename.length > 0 &&
    (v.timestamp === undefined || typeof v.timestamp === 'string')
  )
}

export function sanitizeNoGpsPhotos(input: unknown): NoGpsPhoto[] {
  if (!Array.isArray(input)) return []
  return input.filter(isNoGpsPhoto)
}

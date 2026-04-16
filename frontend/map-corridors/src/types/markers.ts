// Shared marker type definitions — used by App.tsx, MapProviderView, useCorridorSessionOPFS, mapCapture

export const ALL_PHOTO_LABELS = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T',
] as const
export type PhotoLabel = (typeof ALL_PHOTO_LABELS)[number]

export type PhotoMarker = Readonly<{
  id: string
  lng: number
  lat: number
  name: string
  label?: PhotoLabel
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

export function isPhotoMarker(value: unknown): value is PhotoMarker {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    isValidLngLat(v.lng, v.lat) &&
    typeof v.name === 'string' &&
    (v.label === undefined || (typeof v.label === 'string' && PHOTO_LABEL_SET.has(v.label)))
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

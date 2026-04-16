// Shared marker type definitions — used by App.tsx, MapProviderView, useCorridorSessionOPFS, mapCapture

export type PhotoLabel = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T'

export const ALL_PHOTO_LABELS: PhotoLabel[] = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T']

export type PhotoMarker = {
  id: string
  lng: number
  lat: number
  name: string
  label?: PhotoLabel
}

// Ground marker types — FAI precision flying canvas shapes (12 letters + 14 symbols)
export type GroundMarkerType =
  // Letters
  | 'LETTER_A' | 'LETTER_C' | 'LETTER_E' | 'LETTER_F' | 'LETTER_G' | 'LETTER_I'
  | 'LETTER_K' | 'LETTER_L' | 'LETTER_O' | 'LETTER_P' | 'LETTER_R' | 'LETTER_S'
  // Symbols
  | 'PARALLELOGRAM' | 'PI' | 'CROSSED_LEGS' | 'TRIANGLE' | 'SQUARE_DIAGONAL'
  | 'SPLIT_RECT' | 'FIGURE_8' | 'SMALL_TRIANGLE' | 'THREE_BARS'
  | 'TRIANGLE_ON_LINE' | 'PERPENDICULAR' | 'WANG' | 'SLANTED_CROSS' | 'HOOK'

export const GROUND_MARKER_TYPES: GroundMarkerType[] = [
  // Letters
  'LETTER_A', 'LETTER_C', 'LETTER_E', 'LETTER_F', 'LETTER_G', 'LETTER_I',
  'LETTER_K', 'LETTER_L', 'LETTER_O', 'LETTER_P', 'LETTER_R', 'LETTER_S',
  // Symbols
  'PARALLELOGRAM', 'PI', 'CROSSED_LEGS', 'TRIANGLE', 'SQUARE_DIAGONAL',
  'SPLIT_RECT', 'FIGURE_8', 'SMALL_TRIANGLE', 'THREE_BARS',
  'TRIANGLE_ON_LINE', 'PERPENDICULAR', 'WANG', 'SLANTED_CROSS', 'HOOK',
]

export type GroundMarker = {
  id: string
  lng: number
  lat: number
  type: GroundMarkerType
}

export type GroundMarkerCallbacks = {
  groundMarkers: GroundMarker[]
  activeGroundMarkerId: string | null
  onGroundMarkerAdd: (lng: number, lat: number) => void
  onGroundMarkerDragEnd: (id: string, lng: number, lat: number) => void
  onGroundMarkerClick: (id: string | null) => void
  onGroundMarkerTypeChange: (id: string, type: GroundMarkerType) => void
  onGroundMarkerDelete: (id: string) => void
}

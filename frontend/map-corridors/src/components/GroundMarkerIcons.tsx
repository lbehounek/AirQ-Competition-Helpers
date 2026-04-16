import React from 'react'
import type { GroundMarkerType } from '../types/markers'

// FAI precision flying canvas shapes — inline SVG components from official rules
// Each SVG uses viewBox="0 0 100 100", black strokes, no fill

const SVG_CONTENT: Record<GroundMarkerType, string> = {
  // Letters
  LETTER_A: '<path d="M 25 85 L 50 15 L 75 85"/><path d="M 33 62 L 67 62"/>',
  LETTER_C: '<path d="M 75 20 L 25 20 L 25 80 L 75 80"/>',
  LETTER_E: '<path d="M 75 15 L 25 15 L 25 85 L 75 85"/><path d="M 25 50 L 65 50"/>',
  LETTER_F: '<path d="M 25 85 L 25 15 L 75 15"/><path d="M 25 50 L 65 50"/>',
  LETTER_G: '<path d="M 75 20 L 25 20 L 25 80 L 75 80 L 75 50 L 55 50"/>',
  LETTER_I: '<path d="M 30 15 L 70 15"/><path d="M 50 15 L 50 85"/><path d="M 30 85 L 70 85"/>',
  LETTER_K: '<path d="M 25 15 L 25 85"/><path d="M 25 50 L 75 15"/><path d="M 25 50 L 75 85"/>',
  LETTER_L: '<path d="M 25 15 L 25 85 L 75 85"/>',
  LETTER_O: '<rect x="25" y="15" width="50" height="70"/>',
  LETTER_P: '<path d="M 25 85 L 25 15 L 70 15 L 70 50 L 25 50"/>',
  LETTER_R: '<path d="M 25 85 L 25 15 L 70 15 L 70 50 L 25 50"/><path d="M 45 50 L 75 85"/>',
  LETTER_S: '<path d="M 75 20 L 25 20 L 25 50 L 75 50 L 75 80 L 25 80"/>',
  // Symbols
  PARALLELOGRAM: '<path d="M 30 80 L 45 20 L 85 20 L 70 80 Z"/>',
  PI: '<path d="M 20 25 L 80 25"/><path d="M 32 25 L 32 80"/><path d="M 68 25 L 68 80"/>',
  CROSSED_LEGS: '<path d="M 20 30 L 80 30"/><path d="M 50 30 L 25 85"/><path d="M 50 30 L 75 85"/>',
  TRIANGLE: '<path d="M 20 25 L 80 25"/><path d="M 50 25 L 20 85 L 80 85 Z"/>',
  SQUARE_DIAGONAL: '<rect x="20" y="20" width="60" height="60"/><path d="M 20 20 L 80 80"/>',
  SPLIT_RECT: '<rect x="15" y="25" width="70" height="50"/><path d="M 50 25 L 50 75"/>',
  FIGURE_8: '<path d="M 25 15 L 75 15 L 50 50 L 25 15 Z"/><path d="M 25 85 L 75 85 L 50 50 L 25 85 Z"/>',
  SMALL_TRIANGLE: '<path d="M 50 20 L 20 85 L 80 85 Z"/>',
  THREE_BARS: '<path d="M 30 20 L 30 80"/><path d="M 50 20 L 50 80"/><path d="M 70 20 L 70 80"/>',
  TRIANGLE_ON_LINE: '<path d="M 50 35 L 20 70 L 80 70 Z"/><path d="M 20 85 L 80 85"/>',
  PERPENDICULAR: '<path d="M 50 20 L 50 65"/><path d="M 20 65 L 80 65"/><path d="M 20 85 L 80 85"/>',
  WANG: '<path d="M 20 25 L 80 25"/><path d="M 20 50 L 80 50"/><path d="M 20 75 L 80 75"/><path d="M 50 25 L 50 75"/>',
  SLANTED_CROSS: '<path d="M 20 35 L 80 35"/><path d="M 20 65 L 80 65"/><path d="M 20 20 L 80 80"/>',
  HOOK: '<path d="M 25 25 L 60 25 L 60 80 L 95 80"/>',
}

const SVG_ATTRS_PRINT = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" stroke="black" stroke-width="10" fill="none" stroke-linecap="square" stroke-linejoin="miter"'

function lookupSvgContent(type: GroundMarkerType): string {
  // Guard against prototype keys (`toString`, `constructor`, ...) leaking through.
  // Only own keys of the literal SVG_CONTENT record are valid content.
  return Object.prototype.hasOwnProperty.call(SVG_CONTENT, type) ? SVG_CONTENT[type] : ''
}

function GroundMarkerSvg({ type, size = 24 }: { type: GroundMarkerType; size?: number }) {
  const content = lookupSvgContent(type)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      stroke="black"
      strokeWidth="5"
      fill="none"
      strokeLinecap="square"
      strokeLinejoin="miter"
      dangerouslySetInnerHTML={{ __html: content }}
    />
  )
}

// Lookup: type → React component
export const GROUND_MARKER_ICON: Record<GroundMarkerType, React.FC<{ size?: number }>> =
  Object.fromEntries(
    Object.keys(SVG_CONTENT).map(type => [
      type,
      ({ size = 24 }: { size?: number }) => <GroundMarkerSvg type={type as GroundMarkerType} size={size} />,
    ])
  ) as Record<GroundMarkerType, React.FC<{ size?: number }>>

// Raw SVG string for canvas print rendering (mapCapture.ts) — double stroke width for print.
// Returns '' for unknown types so callers can detect the miss and surface a warning
// (see mapCapture.ts). The guard uses hasOwnProperty to reject prototype keys.
export function groundMarkerSvgString(type: GroundMarkerType, size: number): string {
  const content = lookupSvgContent(type)
  if (!content) return ''
  return `<svg ${SVG_ATTRS_PRINT} width="${size}" height="${size}">${content}</svg>`
}

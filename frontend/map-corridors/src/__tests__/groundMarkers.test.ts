import { describe, it, expect } from 'vitest'
import { GROUND_MARKER_TYPES } from '../types/markers'
import type { GroundMarkerType } from '../types/markers'
import { GROUND_MARKER_ICON, groundMarkerSvgString } from '../components/GroundMarkerIcons'

// ---------------------------------------------------------------------------
// Ground marker type constants
// ---------------------------------------------------------------------------
describe('GROUND_MARKER_TYPES', () => {
  it('has 26 entries (12 letters + 14 symbols)', () => {
    expect(GROUND_MARKER_TYPES).toHaveLength(26)
  })

  it('contains all expected letters', () => {
    const letters = GROUND_MARKER_TYPES.filter(t => t.startsWith('LETTER_'))
    expect(letters).toHaveLength(12)
    expect(letters).toContain('LETTER_A')
    expect(letters).toContain('LETTER_S')
  })

  it('contains all expected symbols', () => {
    const symbols = GROUND_MARKER_TYPES.filter(t => !t.startsWith('LETTER_'))
    expect(symbols).toHaveLength(14)
    expect(symbols).toContain('PARALLELOGRAM')
    expect(symbols).toContain('HOOK')
  })

  it('has no duplicates', () => {
    const unique = new Set(GROUND_MARKER_TYPES)
    expect(unique.size).toBe(GROUND_MARKER_TYPES.length)
  })
})

// ---------------------------------------------------------------------------
// groundMarkerSvgString (used for print rendering)
// ---------------------------------------------------------------------------
describe('groundMarkerSvgString', () => {
  it('returns valid SVG for every type', () => {
    for (const type of GROUND_MARKER_TYPES) {
      const svg = groundMarkerSvgString(type, 48)
      expect(svg).toContain('<svg')
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
      expect(svg).toContain('width="48"')
      expect(svg).toContain('height="48"')
      expect(svg).toContain('</svg>')
    }
  })

  it('uses doubled stroke-width (10) for print legibility', () => {
    const svg = groundMarkerSvgString('LETTER_A', 24)
    expect(svg).toContain('stroke-width="10"')
  })

  it('returns empty string for unknown type', () => {
    expect(groundMarkerSvgString('UNKNOWN' as GroundMarkerType, 24)).toBe('')
  })

  it('scales to requested size', () => {
    const svg72 = groundMarkerSvgString('TRIANGLE', 72)
    expect(svg72).toContain('width="72"')
    expect(svg72).toContain('height="72"')
  })

  // --- `stroke` parameter: used by groundMarkerPng.ts for KML icons on
  // satellite imagery ('white') vs. printed A4 on white paper ('black', default).
  // The value is interpolated *unescaped* into the SVG attribute — pin both
  // the default AND the explicit override so a regression doesn't silently
  // render all-black icons on dark satellite tiles.
  it('defaults stroke to black (print-on-white)', () => {
    const svg = groundMarkerSvgString('LETTER_A', 48)
    expect(svg).toContain('stroke="black"')
    expect(svg).not.toContain('stroke="white"')
  })

  it('applies stroke="white" when explicitly requested (KML icons on satellite)', () => {
    const svg = groundMarkerSvgString('LETTER_A', 48, 'white')
    expect(svg).toContain('stroke="white"')
    expect(svg).not.toContain('stroke="black"')
  })

  it('propagates stroke across every ground-marker type', () => {
    for (const type of GROUND_MARKER_TYPES) {
      const svg = groundMarkerSvgString(type, 48, 'white')
      expect(svg).toContain('stroke="white"')
    }
  })
})

// ---------------------------------------------------------------------------
// GROUND_MARKER_ICON lookup
// ---------------------------------------------------------------------------
describe('GROUND_MARKER_ICON', () => {
  it('has a component for every type', () => {
    for (const type of GROUND_MARKER_TYPES) {
      expect(GROUND_MARKER_ICON[type]).toBeDefined()
      expect(typeof GROUND_MARKER_ICON[type]).toBe('function')
    }
  })
})

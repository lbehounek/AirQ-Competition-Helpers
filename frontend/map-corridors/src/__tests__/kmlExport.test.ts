import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { appendFeaturesToKML } from '../utils/kmlMerge'
import type { FeatureCollection } from 'geojson'

function loadFixtureText(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8')
}

describe('appendFeaturesToKML', () => {
  it('uses bright yellow ABGR for labelPoint style', () => {
    const kml = loadFixtureText('RED.kml')
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
    const result = appendFeaturesToKML(kml, empty, 'test_export')
    // ff00ffff = bright yellow in KML ABGR (RGB #FFFF00 → ABGR ff00ffff)
    expect(result).toContain('ff00ffff')
  })

  it('photo markers appear under track_photos folder using label-only name', () => {
    const kml = loadFixtureText('RED.kml')
    const markers: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        // Callers now pass `label` as the display name and drop the " - photo"
        // fallback suffix (feedback 2026-04-18).
        type: 'Feature',
        properties: { name: 'A', role: 'track_photos', label: 'A' },
        geometry: { type: 'Point', coordinates: [14.0, 50.0] }
      }]
    }
    const result = appendFeaturesToKML(kml, markers, 'test_export')
    expect(result).toContain('track_photos')
    expect(result).toContain('<name>A</name>')
    expect(result).not.toContain('- photo')
  })

  it('does NOT include corridor features when only markers are passed', () => {
    const kml = loadFixtureText('RED.kml')
    const markers: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'A', role: 'track_photos' },
        geometry: { type: 'Point', coordinates: [14.0, 50.0] }
      }]
    }
    const result = appendFeaturesToKML(kml, markers, 'test_export')
    // Should not contain corridor-specific content
    expect(result).not.toContain('role">corridor')
    expect(result).not.toContain('role">gate')
    expect(result).not.toContain('role">exact')
  })

  it('preserves original KML content including SC gates', () => {
    const kml = loadFixtureText('RED_SC.kml')
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
    const result = appendFeaturesToKML(kml, empty, 'test_export')
    // Original KML should be preserved — check SC-related coordinates are still there
    // SC 01 point is at coordinates in the original
    expect(result).toContain('SC 01')
    expect(result).toContain('SC 14')
    // Original LineStrings should be preserved
    expect(result).toContain('15.096075,50.015613')
  })

  it('works with empty features array (no markers)', () => {
    const kml = loadFixtureText('RED.kml')
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
    const result = appendFeaturesToKML(kml, empty, 'test_export')
    // Should still produce valid KML with original content
    expect(result).toContain('<kml')
    expect(result).toContain('FP')
    expect(result).toContain('TP 1')
  })

  it('ground markers render without visible label text but preserve role + markerType', () => {
    // Feedback 2026-04-18: ground-marker <name> text cluttered Google Earth.
    // Callers now pass an empty name; we emit <name></name> and keep the
    // semantic type in ExtendedData (markerType) for round-tripping.
    const kml = loadFixtureText('RED.kml')
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: '', role: 'ground_markers', markerType: 'LETTER_A' },
          geometry: { type: 'Point', coordinates: [14.1, 50.1] }
        },
        {
          type: 'Feature',
          properties: { name: '', role: 'ground_markers', markerType: 'HOOK' },
          geometry: { type: 'Point', coordinates: [14.2, 50.2] }
        }
      ]
    }
    const result = appendFeaturesToKML(kml, fc, 'test_export')
    // Role still flows through via ExtendedData
    expect(result).toContain('ground_markers')
    // Empty <name> element is emitted (self-closing `<name/>` is also valid XML)
    // rather than falling through to the role fallback.
    expect(result).toMatch(/<name(?:\s*\/>|><\/name>)/)
    // And we don't leak the enum label into visible KML text
    expect(result).not.toContain('<name>LETTER_A</name>')
    expect(result).not.toContain('<name>HOOK</name>')
  })

  it('embeds a per-type IconStyle when groundMarkerIcons is passed', () => {
    // Feedback 2026-04-18: KML viewers should render the same shapes as screen
    // and print. appendFeaturesToKML takes an optional type → PNG-data-URI map
    // and creates one `<Style id="groundMarker_<TYPE>">` per type.
    const kml = loadFixtureText('RED.kml')
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: '', role: 'ground_markers', markerType: 'LETTER_A' },
          geometry: { type: 'Point', coordinates: [14.1, 50.1] }
        }
      ]
    }
    const pngUri = 'data:image/png;base64,AAAA'
    const result = appendFeaturesToKML(kml, fc, 'test_export', {
      groundMarkerIcons: { LETTER_A: pngUri }
    })
    // A style block for the type exists and points at the provided data URI.
    expect(result).toContain('groundMarker_LETTER_A')
    expect(result).toContain(pngUri)
    // LabelStyle scale=0 suppresses visible names even for viewers that
    // ignore empty <name> elements.
    expect(result).toMatch(/LabelStyle>[\s\S]*?<scale>0/)
    // The placemark uses the per-type style, not the default labelPoint.
    expect(result).toMatch(/styleUrl>#groundMarker_LETTER_A/)
    // markerType is preserved in ExtendedData for round-tripping.
    expect(result).toContain('markerType')
  })

  it('XML-escapes attacker-controlled characters in ground marker names', () => {
    // Even though sanitizeGroundMarkers filters unknown types at the session boundary,
    // the KML layer must defense-in-depth escape any string that ends up in <name>.
    const kml = loadFixtureText('RED.kml')
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: '<script>x</script>&"', role: 'ground_markers' },
        geometry: { type: 'Point', coordinates: [14, 50] }
      }]
    }
    const result = appendFeaturesToKML(kml, fc, 'test_export')
    expect(result).not.toContain('<script>x</script>')
  })
})

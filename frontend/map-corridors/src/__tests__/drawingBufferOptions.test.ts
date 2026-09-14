/**
 * Guards the context-attribute options every map in this app is built with.
 *
 * WHY THIS FILE EXISTS: the previous coverage asserted against **maplibre's own
 * `.d.ts`** — that `canvasContextAttributes` exists and top-level
 * `preserveDrawingBuffer` does not. That proves something about maplibre and
 * nothing about us: both call sites could drop the key and the suite would stay
 * green. These assertions are on OUR module instead.
 *
 * The defect being guarded: maplibre-gl v6 silently ignores the top-level
 * `preserveDrawingBuffer` that mapbox-gl still honours, so the web build was
 * constructing its canvas without the one option the PNG/PDF export depends on.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRESERVE_DRAWING_BUFFER_OPTIONS } from '../config/drawingBuffer'

describe('PRESERVE_DRAWING_BUFFER_OPTIONS', () => {
  it('carries the flag in BOTH renderer shapes', () => {
    // Drop either key and a renderer loses its readable backing store.
    expect(PRESERVE_DRAWING_BUFFER_OPTIONS).toMatchObject({
      preserveDrawingBuffer: true,                              // mapbox-gl (desktop)
      canvasContextAttributes: { preserveDrawingBuffer: true }, // maplibre-gl v6 (web)
    })
  })

  it('is used by both map construction sites, not just one', () => {
    // The two call sites drifting apart is the realistic regression: someone
    // edits the <Map> props and forgets the off-screen capture map, or vice
    // versa. Reading the sources keeps that honest without mounting either.
    const view = readFileSync(join(__dirname, '..', 'map', 'MapProviderView.tsx'), 'utf8')
    const capture = readFileSync(join(__dirname, '..', 'utils', 'mapCapture.ts'), 'utf8')
    for (const [name, src] of [['MapProviderView', view], ['mapCapture', capture]] as const) {
      expect(src, `${name} must use the shared options`).toContain('PRESERVE_DRAWING_BUFFER_OPTIONS')
      // A local re-declaration would silently diverge from the shared module.
      expect(src, `${name} must not redeclare the flag inline`).not.toMatch(/preserveDrawingBuffer:\s*true/)
    }
  })
})

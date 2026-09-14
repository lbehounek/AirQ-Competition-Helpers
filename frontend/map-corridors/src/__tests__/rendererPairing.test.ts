/**
 * Guards the react-map-gl <-> maplibre-gl version PAIRING for the web build.
 *
 * THE BUG THIS EXISTS FOR: the deployed map vanished the moment the user
 * zoomed, with `TypeError: undefined is not an object (evaluating 'e.center')`.
 *
 * maplibre-gl v6 stopped having `Map extends Camera` and REMOVED the public
 * `map.transform` property in favour of discrete getters (upstream's own words,
 * in @vis.gl/react-maplibre/dist/utils/transform.js). @vis.gl/react-maplibre
 * 8.1.0 still read `this._map.transform` on every camera event and passed the
 * result to `transformToViewState(tr)`, which dereferences `tr.center.lng` —
 * so the first zoom, pan, rotate or resize threw from inside maplibre's own
 * event dispatch, aborting `resize()`/`stop()` half-way.
 *
 * Nothing caught it: `@vis.gl/react-maplibre@8.1.0` declares its peer as
 * `maplibre-gl >=4.0.0`, a range written before v6 existed, so pnpm installed
 * the pairing without a murmur and the whole suite stayed green. The fix is
 * react-map-gl 8.1.3, whose `getTransformLike()` rebuilds the snapshot from
 * public getters.
 *
 * These assertions are deliberately about the INSTALLED PACKAGES rather than
 * our own code, because our code was never at fault and a future bump of
 * either package is exactly what would reintroduce this.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Map as RendererMap } from 'maplibre-gl'

const require_ = createRequire(import.meta.url)

/**
 * Resolve a file inside the installed @vis.gl/react-maplibre dist tree.
 *
 * Resolved via the package's main entry rather than its package.json: the
 * package publishes an `exports` map containing only ".", so `./package.json`
 * is not resolvable. The main entry already lands inside `dist/`.
 */
function wrapperDist(relative: string): string {
  return join(dirname(require_.resolve('@vis.gl/react-maplibre')), relative)
}

describe('maplibre-gl v6 API surface the wrapper depends on', () => {
  it('confirms Map no longer exposes `transform` (the removal that broke us)', () => {
    // Walk the whole prototype chain: v5 inherited `transform` from Camera.
    let proto: object | null = RendererMap.prototype
    let found = false
    while (proto && proto !== Object.prototype) {
      if (Object.getOwnPropertyDescriptor(proto, 'transform')) found = true
      proto = Object.getPrototypeOf(proto)
    }
    // If this ever becomes true again, maplibre restored the property and the
    // note above needs revisiting — it does not mean the pairing is broken.
    expect(found).toBe(false)
  })

  it('exposes the camera-update hook as a method, not a writable property', () => {
    // 8.1.0 assigned `map.transformCameraUpdate = fn` as a plain expando, which
    // v6 never reads — so the `||` fallback that would have avoided the crash
    // was dead too. 8.1.3 branches on this method existing.
    expect(typeof RendererMap.prototype.setTransformCameraUpdate).toBe('function')
  })

  it('accepts context attributes only under `canvasContextAttributes`', () => {
    // Why mapCapture and MapProviderView pass BOTH keys: v6 silently drops the
    // top-level `preserveDrawingBuffer` that mapbox-gl still honours.
    // maplibre-gl DOES publish its package.json (unlike the wrapper), and its
    // main entry is import-only, so resolve through package.json here.
    const dts = readFileSync(
      join(dirname(require_.resolve('maplibre-gl/package.json')), 'dist', 'maplibre-gl.d.ts'),
      'utf8',
    )
    expect(dts).toContain('canvasContextAttributes?: WebGLContextAttributesWithType;')
    // The top-level MapOption is gone — it survives only inside the attributes type.
    expect(dts).not.toContain('\n  preserveDrawingBuffer?: boolean;')
  })
})

describe('@vis.gl/react-maplibre is v6-aware', () => {
  it('rebuilds the transform from public getters instead of reading map.transform', () => {
    const src = readFileSync(wrapperDist('utils/transform.js'), 'utf8')
    expect(src).toContain('export function getTransformLike')
    // The shim must use the getters that v6 actually has.
    for (const getter of ['getCenter()', 'getZoom()', 'getBearing()', 'getPitch()', 'getPadding()']) {
      expect(src).toContain(getter)
    }
  })

  it('never dereferences the removed `_map.transform` on the camera path', () => {
    const src = readFileSync(wrapperDist('maplibre/maplibre.js'), 'utf8')
    // This exact expression is what threw on every camera event in 8.1.0.
    expect(src).not.toContain('transformToViewState(this._map.transform)')
    expect(src).toContain('setTransformCameraUpdate')
  })

  it('rebuilds the snapshot from getters a v6 map actually has', () => {
    // Deliberately NOT a hand-built transform asserted against itself — that
    // was tautological and passed under either wrapper version. The real
    // end-to-end proof lives in cameraEventNoCrash.test.tsx, which mounts the
    // wrapper and fires camera events. What is worth pinning HERE is that the
    // shim reads the getters rather than the removed `transform` property.
    // NOTE: a `not.toContain('map.transform')` here would be wrong — upstream's
    // own comment names the removed property while explaining the shim. Assert
    // on the getters it actually calls instead.
    const src = readFileSync(wrapperDist('utils/transform.js'), 'utf8')
    expect(src).toContain('center: map.getCenter()')
    expect(src).toContain('zoom: map.getZoom()')
  })
})

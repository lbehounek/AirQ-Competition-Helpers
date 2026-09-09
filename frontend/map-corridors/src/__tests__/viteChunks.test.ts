/**
 * Unit tests for the shared bundle-splitting helpers in
 * `frontend/vite.chunks.ts`, which both apps' `vite.config.ts` import.
 *
 * They live in map-corridors because its `tsconfig.app.json` is NOT composite,
 * so reaching outside the package root type-checks; photo-helper's IS composite
 * and the same import would raise TS6307.
 *
 * The value here is the GUARD: `assertLazyOnly` is the only thing standing
 * between us and a silent re-eagerization of the 1.6 MB PDF tree, and a build
 * that fails for the right reason is hard to observe from a build log alone.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Rollup } from 'vite'
import { packageOf, vendorChunks, assertLazyOnly } from '../../../vite.chunks'

describe('packageOf', () => {
  it('reads a plain package name out of a posix module id', () => {
    expect(packageOf('/x/node_modules/react-dom/client.js')).toBe('react-dom')
  })

  it('keeps both segments of a scoped package', () => {
    expect(packageOf('/x/node_modules/@mui/material/Button/index.js')).toBe('@mui/material')
  })

  it('attributes a nested install to the INNERMOST node_modules', () => {
    expect(packageOf('/x/node_modules/a/node_modules/@emotion/react/dist/x.mjs')).toBe('@emotion/react')
  })

  it('normalises Windows separators (both CI workflows run on windows-latest)', () => {
    expect(packageOf('C:\\ci\\frontend\\node_modules\\pica\\dist\\pica.js')).toBe('pica')
  })

  it('returns null for a Rollup virtual module', () => {
    expect(packageOf('\0commonjsHelpers.js')).toBeNull()
  })

  it('returns null for application code', () => {
    expect(packageOf('/x/frontend/photo-helper/src/App.tsx')).toBeNull()
  })

  it('ignores a ?query suffix and keeps the owning package', () => {
    expect(packageOf('/x/node_modules/react/index.js?commonjs-exports')).toBe('react')
  })
})

describe('vendorChunks', () => {
  const assign = vendorChunks([
    ['vendor-react', /^(react|react-dom|scheduler)$/],
    ['vendor-mui', /^@mui\//],
  ])

  it('routes a matching package to its chunk', () => {
    expect(assign('/x/node_modules/react-dom/client.js')).toBe('vendor-react')
    expect(assign('/x/node_modules/@mui/material/Button.js')).toBe('vendor-mui')
  })

  it('leaves stylesheets alone even when their package matches a rule', () => {
    // CSS must stay in the single index-*.css so the cascade order cannot shift.
    expect(assign('/x/node_modules/@mui/material/x.css')).toBeUndefined()
    expect(assign('/x/node_modules/mapbox-gl/dist/mapbox-gl.css')).toBeUndefined()
  })

  it('leaves unmatched packages and app code to Rollup', () => {
    expect(assign('/x/node_modules/@react-pdf/renderer/lib/x.js')).toBeUndefined()
    expect(assign('/x/frontend/map-corridors/src/App.tsx')).toBeUndefined()
  })

  it('gives the FIRST matching rule the module (rule order is load-bearing)', () => {
    const ordered = vendorChunks([
      ['first', /^react$/],
      ['second', /^react$/],
    ])
    expect(ordered('/x/node_modules/react/index.js')).toBe('first')
  })
})

describe('assertLazyOnly', () => {
  /** Minimal `OutputChunk` shape — only the fields the guard reads. */
  type FakeChunk = {
    type: 'chunk'
    isEntry: boolean
    name: string
    fileName: string
    imports: string[]
    dynamicImports: string[]
    moduleIds: string[]
  }

  const chunk = (over: Partial<FakeChunk> & Pick<FakeChunk, 'fileName' | 'name'>): FakeChunk => ({
    type: 'chunk',
    isEntry: false,
    imports: [],
    dynamicImports: [],
    moduleIds: [],
    ...over,
  })

  /** A healthy graph: driver.js is reachable only through a dynamic import. */
  const healthyBundle = (): Record<string, FakeChunk> => ({
    'index.js': chunk({
      fileName: 'index.js',
      name: 'index',
      isEntry: true,
      imports: ['vendor-x.js'],
      dynamicImports: ['driver.js-1.js'],
      moduleIds: ['/x/src/main.tsx'],
    }),
    'vendor-x.js': chunk({
      fileName: 'vendor-x.js',
      name: 'vendor-x',
      moduleIds: ['/x/node_modules/react/index.js'],
    }),
    'driver.js-1.js': chunk({
      fileName: 'driver.js-1.js',
      name: 'driver.js',
      imports: ['index.js'],
      moduleIds: ['/x/node_modules/driver.js/dist/driver.js.mjs'],
    }),
  })

  /**
   * Invoke the plugin's `generateBundle` with a `this.error` that throws, which
   * is what Rollup does — so a violation surfaces here as a thrown Error.
   */
  const run = (lazyOnly: RegExp[], bundle: Record<string, FakeChunk>): void => {
    const plugin = assertLazyOnly(lazyOnly)
    const hook = plugin.generateBundle as unknown as (
      this: { error: (m: string) => never },
      options: unknown,
      bundle: unknown,
    ) => void
    hook.call(
      {
        error: (m: string) => {
          throw new Error(m)
        },
      },
      {},
      bundle as unknown as Rollup.OutputBundle,
    )
  }

  it('passes when the lazy-only package is reached only via a dynamic import', () => {
    expect(() => run([/^driver\.js$/], healthyBundle())).not.toThrow()
  })

  it('fails when the lazy-only package lands in a statically imported chunk', () => {
    const bundle = healthyBundle()
    // Exactly the manualChunks trap: the package is absorbed into a vendor
    // chunk the entry statically imports.
    bundle['vendor-x.js'].moduleIds.push('/x/node_modules/driver.js/dist/driver.js.mjs')
    expect(() => run([/^driver\.js$/], bundle)).toThrow(/lazy-only package "driver\.js"/)
  })

  it('fails when the lazy-only package lands in the entry chunk itself', () => {
    const bundle = healthyBundle()
    bundle['index.js'].moduleIds.push('/x/node_modules/driver.js/dist/driver.js.mjs')
    expect(() => run([/^driver\.js$/], bundle)).toThrow(/statically reachable from entry "index\.js"/)
  })

  it('fails when the lazy-only package is reached TRANSITIVELY (entry → vendor → vendor)', () => {
    // The reachability walk is breadth-first for a reason: the real graph is
    // two hops (entry → vendor-mui → vendor-react is in the built bundle). Every
    // other fixture here is one static hop deep, so flattening the walk to
    // `for (const dep of entry.imports)` would keep them all green.
    const bundle = healthyBundle()
    bundle['vendor-x.js'].imports = ['vendor-deep.js']
    bundle['vendor-deep.js'] = chunk({
      fileName: 'vendor-deep.js',
      name: 'vendor-deep',
      moduleIds: ['/x/node_modules/driver.js/dist/driver.js.mjs'],
    })
    expect(() => run([/^driver\.js$/], bundle)).toThrow(/via chunk "vendor-deep\.js"/)
  })

  it('allows a lazy-only package behind a dynamic import even at depth', () => {
    // A second hop behind import() is still lazy and must not fail the build:
    // the walk follows `imports`, never `dynamicImports`.
    const bundle = healthyBundle()
    bundle['index.js'].imports = ['vendor-x.js']
    bundle['vendor-x.js'].dynamicImports = ['driver.js-1.js']
    expect(() => run([/^driver\.js$/], bundle)).not.toThrow()
  })

  it('tolerates an eagerly imported STYLESHEET from a lazy-only package', () => {
    // Both tours import `driver.js/dist/driver.css` eagerly on purpose.
    const bundle = healthyBundle()
    bundle['index.js'].moduleIds.push('/x/node_modules/driver.js/dist/driver.css')
    expect(() => run([/^driver\.js$/], bundle)).not.toThrow()
  })

  it('fails when a vendor chunk statically imports the entry (circular graph)', () => {
    const bundle = healthyBundle()
    bundle['vendor-y.js'] = chunk({ fileName: 'vendor-y.js', name: 'vendor-y', imports: ['index.js'] })
    expect(() => run([/^driver\.js$/], bundle)).toThrow(/circular chunk graph/)
  })

  it('does NOT flag an async chunk that imports the entry', () => {
    // `driver.js-1.js` already imports the entry in the healthy fixture; only
    // `vendor-*` chunks are supposed to trip the cycle check.
    expect(() => run([/^nothing-here$/], healthyBundle())).not.toThrow()
  })

  it('ignores non-chunk assets in the bundle', () => {
    const bundle = healthyBundle() as Record<string, unknown>
    bundle['index.css'] = { type: 'asset', fileName: 'index.css', source: '' }
    expect(() => run([/^driver\.js$/], bundle as Record<string, FakeChunk>)).not.toThrow()
  })

  it('only runs during builds', () => {
    expect(assertLazyOnly([]).apply).toBe('build')
  })

  it('does not consult dynamicImports when walking static reachability', () => {
    // Guard against someone "fixing" the walk by following dynamicImports too:
    // that would make every lazy chunk look eager.
    const bundle = healthyBundle()
    const spy = vi.spyOn(bundle['index.js'], 'dynamicImports', 'get')
    run([/^driver\.js$/], bundle)
    expect(spy).not.toHaveBeenCalled()
  })
})

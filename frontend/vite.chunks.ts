// Shared bundle-splitting helpers for both Vite apps (photo-helper,
// map-corridors). Imported from each `vite.config.ts`; Vite bundles config
// imports with esbuild, and `tsc -b` sees this file through the
// `"../vite.chunks.ts"` entry in each app's `tsconfig.node.json` `include`
// (without it, a composite project fails with TS6307).
//
// ---------------------------------------------------------------------------
// WHY a manualChunks rule for a LAZY library re-eagerizes it (the trap)
// ---------------------------------------------------------------------------
// Rollup 4's `addStaticDependenciesToManualChunk` makes each manual chunk
// ABSORB every static dependency of its modules that no earlier manual chunk
// has claimed — the commonjs interop helper, `buffer`, `react-is`, and so on.
// If an absorbed module is ALSO needed by the entry, the entry gains a STATIC
// import of that vendor chunk and Vite emits a `<link rel="modulepreload">`
// for it. That is how an innocent-looking rule such as
// `['vendor-pdf', /^@react-pdf\//]` silently pulled the 1.6 MB PDF tree back
// into first paint while the source `import()` and the build both stayed green
// (measured twice). Only FIRST-PAINT libraries belong in the rule tables;
// anything reached through `import()` lands in its own async chunk by itself.
//
// The same absorption is why the chunk graph stays acyclic — shared helpers
// end up inside a vendor chunk, never in the entry — and why rule ORDER
// matters: react is listed first, so the commonjs helper lands in
// `vendor-react` and `vendor-mui`/`vendor-pica` import `vendor-react` rather
// than the entry.
//
// `assertLazyOnly` turns that silent regression into a failed build.

import type { Plugin, Rollup } from 'vite'

/**
 * True for a stylesheet module id (a `?query` suffix is stripped first).
 * Stylesheets are excluded from BOTH helpers below: they never carry the
 * JS parse/compile cost the splitting is about, and a package can be
 * deliberately half-eager — `driver.js/dist/driver.css` is imported eagerly
 * (3 kB, keeps the popover styles in `index-*.css`) while `driver.js` itself
 * is lazy.
 */
const isStylesheet = (id: string): boolean => id.split('?')[0].endsWith('.css')

/** A manualChunks rule: the emitted chunk name and the package pattern it claims. */
export type VendorRule = readonly [chunkName: string, packagePattern: RegExp]

/**
 * Resolve the npm package name (`@scope/name` aware) that owns a module id.
 * Returns `null` for application/workspace code and for Rollup's virtual
 * modules.
 *
 * The package is taken from after the LAST `/node_modules/` so a nested
 * install (`a/node_modules/@emotion/react`) is attributed to the inner
 * package. Backslashes are normalised because both CI workflows build on
 * `windows-latest`; a `?query` suffix (`react/index.js?commonjs-exports`) is
 * harmless since only the leading path segments are read.
 */
export function packageOf(id: string): string | null {
  const norm = id.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/node_modules/')
  if (i < 0) return null
  const rest = norm.slice(i + '/node_modules/'.length).split('/')
  return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
}

/**
 * Build the `output.manualChunks` function from a rule table. Returns the
 * chunk name for the first matching rule, or `undefined` to let Rollup decide.
 *
 * `undefined` is returned for app code, for `@airq/shared-*` workspace
 * packages (real paths — the hoisted linker gives them no `node_modules`
 * segment) and for EVERY stylesheet. CSS is excluded on purpose: it keeps the
 * emitted `index-*.css` byte-identical to the single-chunk build, so
 * `mapbox-gl.css` and `driver.css` stay in one stylesheet and the cascade
 * order cannot shift.
 */
export function vendorChunks(rules: ReadonlyArray<VendorRule>): (id: string) => string | undefined {
  return (id) => {
    if (isStylesheet(id)) return undefined
    const pkg = packageOf(id)
    if (!pkg) return undefined
    return rules.find(([, re]) => re.test(pkg))?.[0]
  }
}

/**
 * Build guard: fail `vite build` when a package that must stay behind
 * `import()` becomes statically reachable from an entry chunk, or when a
 * `vendor-*` chunk statically imports the entry. Returns a Vite `Plugin` that
 * only runs during builds.
 *
 * Static reachability is walked over `chunk.imports` (never `dynamicImports`),
 * which is exactly the set Vite turns into `<link rel="modulepreload">` — so a
 * hit here means the library really is being downloaded and compiled at first
 * paint. Stylesheet ids are skipped (see `isStylesheet`), so eagerly importing
 * a lazy package's CSS — which both tours do — is not a violation.
 *
 * The second check catches a `vendor-* → entry` edge, which produces a runtime
 * TDZ ("Cannot access before initialization") rather than a size regression.
 *
 * Edge case: if a future Rollup stops naming manual chunks after their alias,
 * the `vendor-` name check degrades to a no-op — it can never fail falsely.
 */
export function assertLazyOnly(lazyOnly: ReadonlyArray<RegExp>): Plugin {
  return {
    name: 'airq:assert-lazy-only',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((o): o is Rollup.OutputChunk => o.type === 'chunk')
      const byFile = new Map(chunks.map((c) => [c.fileName, c]))

      for (const entry of chunks.filter((c) => c.isEntry)) {
        // Breadth-first over STATIC imports only; `reachable` is appended to
        // while it is iterated, which is how the walk continues transitively.
        const reachable = [entry]
        const seen = new Set([entry.fileName])
        for (const chunk of reachable) {
          for (const dep of chunk.imports) {
            const c = byFile.get(dep)
            if (c && !seen.has(dep)) {
              seen.add(dep)
              reachable.push(c)
            }
          }
        }

        for (const chunk of reachable) {
          for (const id of chunk.moduleIds) {
            if (isStylesheet(id)) continue
            const pkg = packageOf(id)
            if (pkg && lazyOnly.some((re) => re.test(pkg))) {
              this.error(
                `lazy-only package "${pkg}" is statically reachable from entry "${entry.fileName}" via chunk "${chunk.fileName}". ` +
                  'It must be reached only through import(); remove it (or a dependency it shares with the entry) from manualChunks.',
              )
            }
          }
        }

        for (const c of chunks) {
          if (!c.isEntry && c.name.startsWith('vendor-') && c.imports.includes(entry.fileName)) {
            this.error(`vendor chunk "${c.fileName}" statically imports the entry chunk — circular chunk graph.`)
          }
        }
      }
    },
  }
}

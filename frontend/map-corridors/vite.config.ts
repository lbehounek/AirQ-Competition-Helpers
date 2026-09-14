import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { assertLazyOnly, vendorChunks, type VendorRule } from '../vite.chunks'

// Monorepo-wide env file sits at the repo root so Mapbox/Mapy tokens don't
// have to be duplicated per sub-app. `envDir` points Vite there for both
// `loadEnv()` (build-time reads) and `import.meta.env` injection.
const ENV_DIR = path.resolve(__dirname, '../..')

// Bundle splitting. FIRST-PAINT libraries ONLY — see ../vite.chunks.ts for why
// a rule for a lazily-reached library (driver.js here) re-eagerizes it.
// Deliberately NO rule for @turf/* (≈17 kB — a separate chunk would be one more
// fetch + compile unit for nothing) or exifr (≈74 kB, same, and a rule would
// spring the trap if it is ever made lazy).
const VENDOR_RULES: ReadonlyArray<VendorRule> = [
  ['vendor-react', /^(react|react-dom|scheduler)$/],
  ['vendor-mui', /^(@mui\/.*|@emotion\/.*|stylis|@babel\/runtime|clsx|prop-types|react-is|react-transition-group|@popperjs\/core|hoist-non-react-statics|dom-helpers)$/],
  // mapbox-gl (≈1.70 MB) is required by the FIRST screen (App renders
  // MapProviderView unconditionally), so it is eager on purpose; this chunk
  // will keep triggering Vite's 500 kB warning — expected, do not raise
  // chunkSizeWarningLimit to hide it.
  ['vendor-map', /^(mapbox-gl|maplibre-gl|react-map-gl|@vis\.gl\/.*|@mapbox\/.*|@maplibre\/.*)$/],
]

// Packages that must stay behind import(): the build FAILS if they ever become
// statically reachable from the entry chunk (see assertLazyOnly).
const LAZY_ONLY = [/^driver\.js$/]

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ENV_DIR, '')
  const isDesktop = env.VITE_DESKTOP_BUILD === 'true'
  // Renderer choice, decided at BUILD time rather than in the components.
  //
  // Mapbox GL JS v2+ authenticates on every render — `_render` calls
  // `_authenticate` -> `getSessionAPI`, which throws "A valid Mapbox access
  // token is required" with no token present. That is a billing handshake, not
  // a style concern, so it fires even for the OSM/CARTO and ESRI raster styles
  // that need no token at all. The effect is that a tokenless web build shows
  // NO map and the style switcher cannot rescue it: the renderer dies before
  // any style is applied.
  //
  // MapLibre GL is the fork without that handshake and renders the same raster
  // style specs unchanged. react-map-gl ships both wrappers with an identical
  // component API, so aliasing swaps the implementation with zero source
  // changes — the three files importing <Map>/<Layer>/<Source>/<Marker> keep
  // their `react-map-gl/mapbox` imports and stay on ONE renderer's React
  // context, which mixing the two entry points would break.
  //
  // Desktop keeps Mapbox GL: it has a token (settings dialog) and the
  // `mapbox://` styles need Mapbox's own resolver.
  const webRendererAliases: Record<string, string> = isDesktop ? {} : {
    'react-map-gl/mapbox': 'react-map-gl/maplibre',
    'mapbox-gl/dist/mapbox-gl.css': 'maplibre-gl/dist/maplibre-gl.css',
    'mapbox-gl': 'maplibre-gl',
  }
  // MapLibre v6 locates its worker at runtime via `new URL('./maplibre-gl-worker.mjs',
  // import.meta.url)` — a constructed string Rollup cannot follow, so the chunk is
  // never emitted and the deployed map silently requests nothing. The web module
  // re-declares that dependency with `?worker&url`; the desktop stub keeps
  // maplibre out of an Electron build that uses real Mapbox GL. See
  // src/config/initMapWorker.ts for the full failure mode.
  const workerUrlModule = path.resolve(
    __dirname,
    isDesktop ? 'src/config/maplibreWorkerUrl.desktop.ts' : 'src/config/maplibreWorkerUrl.web.ts',
  )
  return {
    envDir: ENV_DIR,
    resolve: { alias: { ...webRendererAliases, 'virtual:maplibre-worker-url': workerUrlModule } },
    // For desktop (Electron) builds, use relative paths
    base: env.VITE_DESKTOP_BUILD === 'true' ? './' : '/map-corridors/',
    // MapLibre calls `new Worker(url, {type: 'module'})` and only falls back to a
    // classic worker if that throws. Emitting ES-format workers matches the path
    // it actually takes instead of relying on the fallback.
    worker: { format: 'es' as const },
    build: {
      rollupOptions: {
        output: { manualChunks: vendorChunks(VENDOR_RULES) },
      },
    },
    plugins: [react(), assertLazyOnly(LAZY_ONLY)],
    server: {
      // Security: Only bind to localhost to prevent network exposure
      host: 'localhost',
      fs: {
        // Security: Explicitly deny access to sensitive files/directories
        deny: [
          '.env*',
          '../../**', // Prevent access outside project root
          '../**',
          '**/.git/**',
          '**/.ssh/**',
          '**/.*'
        ]
      },
      // Security: Restrict CORS to prevent malicious cross-origin requests
      cors: {
        origin: [
          'http://localhost:5173',
          'http://localhost:3000',
          'http://127.0.0.1:5173',
          'http://[::1]:5173',     // IPv6 localhost
          'http://[::1]:3000'      // IPv6 localhost alt port
        ],
        credentials: false
      }
    },
    preview: {
      // Security: Only bind to localhost to prevent network exposure
      host: 'localhost'
    }
  }
})

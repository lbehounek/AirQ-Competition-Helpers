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
  ['vendor-map', /^(mapbox-gl|react-map-gl|@vis\.gl\/.*|@mapbox\/.*)$/],
]

// Packages that must stay behind import(): the build FAILS if they ever become
// statically reachable from the entry chunk (see assertLazyOnly).
const LAZY_ONLY = [/^driver\.js$/]

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ENV_DIR, '')
  return {
    envDir: ENV_DIR,
    // For desktop (Electron) builds, use relative paths
    base: env.VITE_DESKTOP_BUILD === 'true' ? './' : '/map-corridors/',
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

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { assertLazyOnly, vendorChunks, type VendorRule } from '../vite.chunks'

// Shared `.env` at the monorepo root (same pattern as map-corridors) — keeps
// Mapbox/Mapy tokens and other VITE_* vars in one place.
const ENV_DIR = path.resolve(__dirname, '../..')

// Bundle splitting. FIRST-PAINT libraries ONLY — see ../vite.chunks.ts for why
// @react-pdf/*, buffer and driver.js must never be listed here (a rule for a
// lazily-reached library makes Rollup absorb its shared dependencies and
// re-eagerizes the whole tree). `scheduler` travels with react so vendor-react
// never has to import the entry; MUI's small transitive deps are grouped with
// MUI so vendor-mui depends only on vendor-react.
const VENDOR_RULES: ReadonlyArray<VendorRule> = [
  ['vendor-react', /^(react|react-dom|scheduler)$/],
  ['vendor-mui', /^(@mui\/.*|@emotion\/.*|stylis|@babel\/runtime|clsx|prop-types|react-is|react-transition-group|@popperjs\/core|hoist-non-react-statics|dom-helpers)$/],
  ['vendor-pica', /^pica$/],
]

// Packages that must stay behind import(): the build FAILS if they ever become
// statically reachable from the entry chunk (see assertLazyOnly).
const LAZY_ONLY = [/^@react-pdf\//, /^driver\.js$/]

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ENV_DIR, '')
  return {
    envDir: ENV_DIR,
    // Ensure assets load correctly when hosted under /photo-helper/
    // For desktop (Electron) builds, use relative paths
    base: env.VITE_DESKTOP_BUILD === 'true' ? './' : (mode === 'production' ? '/photo-helper/' : '/'),
    plugins: [react(), tailwindcss(), assertLazyOnly(LAZY_ONLY)],
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
    },
    build: {
      rollupOptions: {
        output: { manualChunks: vendorChunks(VENDOR_RULES) },
      },
    },
    define: {
      global: 'globalThis',
    },
    resolve: {
      alias: {
        buffer: 'buffer', // Required by @react-pdf/renderer internal usage
      },
    },
    optimizeDeps: {
      include: ['buffer'],
    },
  }
})

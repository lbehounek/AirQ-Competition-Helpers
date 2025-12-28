import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // Ensure assets load correctly when hosted under /photo-helper/
    // For desktop (Electron) builds, use relative paths
    base: env.VITE_DESKTOP_BUILD === 'true' ? './' : (mode === 'production' ? '/photo-helper/' : '/'),
    plugins: [react(), tailwindcss()],
    server: {
      // Security: Only bind to localhost to prevent network exposure
      host: 'localhost',
      proxy: {
        // Proxy API calls to the backend
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
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

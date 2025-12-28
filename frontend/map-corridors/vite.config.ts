import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // For desktop (Electron) builds, use relative paths
    base: env.VITE_DESKTOP_BUILD === 'true' ? './' : '/map-corridors/',
    plugins: [react()],
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

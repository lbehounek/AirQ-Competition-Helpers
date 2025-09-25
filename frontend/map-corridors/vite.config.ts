import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/map-corridors/',
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
        '**/node_modules/**',
        '**/.ssh/**',
        '**/.*'
      ]
    },
    // Security: Restrict CORS to prevent malicious cross-origin requests
    cors: {
      origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
      credentials: false
    }
  },
  preview: {
    // Security: Only bind to localhost to prevent network exposure
    host: 'localhost'
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Ensure assets load correctly when hosted under /photo-helper/
  base: mode === 'production' ? '/photo-helper/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Proxy API calls to the backend
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
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
}))

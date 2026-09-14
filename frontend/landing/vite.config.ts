import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const ENV_DIR = path.resolve(__dirname, '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ENV_DIR, '')
  return {
    envDir: ENV_DIR,
    base: env.VITE_DESKTOP_BUILD === 'true' ? './' : '/',
    plugins: [react()],
    server: {
      host: 'localhost',
      fs: {
        deny: ['.env*', '../../**', '../**', '**/.git/**', '**/.ssh/**', '**/.*'],
      },
      cors: {
        origin: [
          'http://localhost:5173',
          'http://localhost:3000',
          'http://127.0.0.1:5173',
          'http://[::1]:5173',
          'http://[::1]:3000',
        ],
        credentials: false,
      },
    },
    preview: {
      host: 'localhost',
    },
  }
})

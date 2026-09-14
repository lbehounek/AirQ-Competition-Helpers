import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  // This file SHADOWS vite.config.ts rather than merging with it, so none of
  // the build-time aliases there apply under test — including the one that
  // resolves the MapLibre worker-url module. Point it at the desktop stub: it
  // is plain TypeScript exporting '', where the web module uses `?worker&url`
  // and would drag a worker build into every test run. Tests needing a real
  // URL substitute one with vi.doMock.
  resolve: {
    alias: {
      'virtual:maplibre-worker-url': path.resolve(__dirname, 'src/config/maplibreWorkerUrl.desktop.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})

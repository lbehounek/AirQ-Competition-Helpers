// Minimal vitest config for the desktop package's path-validation
// helpers. The Electron main-process bundle (`main.js`) is NOT under
// test — only the pure CommonJS helpers in `lib/` are. They share no
// runtime dependency on Electron, so vitest in `node` env runs them
// directly.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.{js,ts}'],
  },
});

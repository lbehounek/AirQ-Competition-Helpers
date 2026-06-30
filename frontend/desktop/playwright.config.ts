import { defineConfig } from '@playwright/test';

// E2E tests drive the REAL Electron app (main.js) via Playwright's _electron
// launcher — the only way to exercise the app:// protocol, the shared native
// competition storage, and the map-corridors → photo-helper handoff together.
//
// Prerequisite: the sub-apps must be BUILT first (the renderer is served from
// each app's dist/ via the app:// protocol, even in dev mode). Use the
// `test:e2e:build` script (or the CI workflow) which runs `build:apps` first;
// plain `test:e2e` assumes an up-to-date build.
//
// Electron is single-instance, so e2e runs serially (workers: 1).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
});

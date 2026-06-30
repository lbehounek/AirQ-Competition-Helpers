import { test, expect } from '@playwright/test';
import { launchApp, navigateToApp, closeApp, type LaunchedApp } from './electronApp';

// Smoke: the real packaged renderer must MOUNT each surface without an uncaught
// error. This is the end-to-end guard for the "white screen on send to editor"
// class (a temporal-dead-zone ReferenceError) — the unit-level render smoke
// tests catch it per component, this catches it in the actual Electron build,
// including the app:// protocol + bundling that minified `t` into `dt`.

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('launcher home loads without a renderer error', async () => {
  const { page, pageErrors } = launched;
  // Locale-agnostic: assert a stable launcher element rather than localized tile
  // text (the launcher defaults to Czech).
  await expect(page.locator('#competition-select')).toBeVisible();
  expect(pageErrors, `renderer threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

test('Photo Helper mounts without a temporal-dead-zone / uncaught error', async () => {
  const { page, pageErrors } = launched;
  await navigateToApp(page, 'photo-helper');
  // A mounted React app renders SOMETHING into #root; a TDZ crash leaves it blank.
  await expect(page.locator('#root')).not.toBeEmpty();
  // Zero uncaught renderer errors — this is the white-screen guard.
  expect(pageErrors, `Photo Helper threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

test('Map Corridors mounts without a temporal-dead-zone / uncaught error', async () => {
  const { page, pageErrors } = launched;
  await navigateToApp(page, 'map-corridors');
  await expect(page.locator('#root')).not.toBeEmpty();
  expect(pageErrors, `Map Corridors threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

test('round-trip home → editor → map → home stays error-free', async () => {
  const { page, pageErrors } = launched;
  await navigateToApp(page, 'photo-helper');
  await expect(page.locator('#root')).not.toBeEmpty();
  await navigateToApp(page, 'map-corridors');
  await expect(page.locator('#root')).not.toBeEmpty();
  await navigateToApp(page, 'home');
  await expect(page.locator('#competition-select')).toBeVisible();
  expect(pageErrors, `navigation threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

import { test, expect } from '@playwright/test';
import { launchApp, navigateToApp, closeApp, type LaunchedApp } from './electronApp';

// Verifies the onboarding tour actually RENDERS in the real Electron build for
// both surfaces (vendored driver.js in the vanilla launcher; bundled driver.js
// in the React Map Corridors app). The fixture suppresses the AUTO first-run
// tour for determinism, but the "?" Help button always starts it — that's the
// path we drive here. `.driver-popover` is driver.js's popover element.

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('launcher Help button starts the guided tour', async () => {
  const { page, pageErrors } = launched;
  await page.locator('#help-tour-btn').click();
  await expect(page.locator('.driver-popover')).toBeVisible();
  expect(pageErrors, `launcher tour threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

test('Map Corridors Help button starts the guided tour', async () => {
  const { page, pageErrors } = launched;
  await navigateToApp(page, 'map-corridors', 'e2e-tour');
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.locator('[data-tour="help"]').click();
  await expect(page.locator('.driver-popover')).toBeVisible();
  expect(pageErrors, `Map Corridors tour threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

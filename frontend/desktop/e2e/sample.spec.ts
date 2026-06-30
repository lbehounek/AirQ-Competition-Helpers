import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from './electronApp';

// Verifies the bundled sample competition is PRELOADED on launch (main.js
// ensureSampleCompetition) and shows up in the launcher's competition list as a
// normal, clearly-marked competition. Runs only when a sample is bundled (the
// dev/e2e build reads frontend/desktop/sample-data, which is present locally);
// CI has no sample, so this is skipped there.

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});
test.afterEach(async () => {
  await closeApp(launched);
});

test('preloaded sample competition appears in the launcher (when a sample is bundled)', async () => {
  const { page } = launched;
  const sampleAvailable = await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI?: { sample?: { manifest?: () => Promise<{ available?: boolean }> } } }).electronAPI;
    return !!(await api?.sample?.manifest?.())?.available;
  });
  test.skip(!sampleAvailable, 'no sample bundled in this build');

  // The launcher lists competitions in #competition-select; the preloaded sample
  // is marked VZOR / SAMPLE.
  await expect(page.locator('#competition-select')).toBeVisible();
  await expect.poll(async () =>
    page.locator('#competition-select option').filter({ hasText: /VZOR|SAMPLE/ }).count(),
  ).toBeGreaterThan(0);
});

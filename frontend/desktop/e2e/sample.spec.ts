import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, closeApp, navigateToApp, type LaunchedApp } from './electronApp';

function sessionPhotoCount(file: string): number {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const seen = new Set<string>();
    for (const b of [s.sets, s.setsTrack, s.setsTurning]) {
      for (const key of ['set1', 'set2']) {
        for (const p of b?.[key]?.photos || []) if (p && !p.isPlaceholder && p.id) seen.add(p.id);
      }
    }
    return seen.size;
  } catch {
    return 0;
  }
}

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

  // When a finalized competition is bundled, it's preloaded with photos already
  // in the editor sets — so opening the Photo Editor DIRECTLY shows them (no need
  // to open Map Corridors first). The skip below covers the empty+pending fallback.
  const sessionFile = path.join(launched.userDataDir, 'photo-sessions', 'competitions', 'sample-plasy-blue', 'session.json');
  const prebuiltPhotos = sessionPhotoCount(sessionFile);
  test.skip(prebuiltPhotos === 0, 'no finalized (pre-built) sample bundled — only the empty+pending fallback');
  expect(prebuiltPhotos).toBeGreaterThanOrEqual(8);

  await navigateToApp(page, 'photo-helper', 'sample-plasy-blue');
  // The editor renders one <canvas> per placed photo; assert several appear.
  await expect.poll(async () => page.locator('canvas').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  expect(launched.pageErrors, launched.pageErrors.map(e => e.message).join('\n')).toHaveLength(0);
});

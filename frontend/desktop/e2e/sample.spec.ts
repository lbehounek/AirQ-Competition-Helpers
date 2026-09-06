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

/**
 * Ask the main process for the competition index through the very IPC channel
 * the gate wraps (`competition-list`) and return the ids it reports.
 *
 * Returns `[]` when the preload bridge is missing, which fails the callers'
 * `toContain` assertion loudly rather than throwing an opaque evaluate error.
 */
async function listCompetitionIds(page: LaunchedApp['page']): Promise<string[]> {
  return page.evaluate(async () => {
    const api = (window as unknown as {
      electronAPI?: { competitions?: { list?: () => Promise<{ competitions?: { id: string }[] }> } };
    }).electronAPI;
    const index = await api?.competitions?.list?.();
    return (index?.competitions || []).map(c => c.id);
  });
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

  // --- The `afterSample` gate contract (main.js) -------------------------
  // The sample is copied in the BACKGROUND after the window opens, so the
  // handful of IPC channels that OBSERVE the competitions index await that
  // copy. The property under test is NOT "the sample eventually shows up"
  // (a poll would pass with the gate removed whenever the copy happens to win
  // the race) but "no list call can observe an index without the sample".
  //
  // So: one call, no poll, no retry. With the gate this holds however slow the
  // disk is; without it the call races the multi-megabyte copy.
  expect(await listCompetitionIds(page)).toContain('sample-plasy-blue');

  // `storage-init` is the first call every sub-app makes, and it is gated for
  // the same reason (photo-helper's CompetitionService rewrites an index that
  // only LOOKS empty, which would persist the sample away).
  //
  // Honest scope: this pair of lines does NOT prove that gate. `storage-init`
  // only creates directories and returns paths — it never reads the index — so
  // the re-list below goes back through the still-gated `competition-list` and
  // would pass even with `afterSample` stripped from init. The init wiring is
  // pinned by `__tests__/sampleGate.test.js`; what this adds here is only that
  // an init between two lists does not disturb the sample.
  await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI?: { storage?: { init?: () => Promise<unknown> } } }).electronAPI;
    await api?.storage?.init?.();
  });
  expect(await listCompetitionIds(page)).toContain('sample-plasy-blue');

  // The launcher lists competitions in #competition-select; the preloaded sample
  // is marked VZOR / SAMPLE. This only waits for the renderer to paint the
  // option — the copy itself is already done (the gated call above awaited it).
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

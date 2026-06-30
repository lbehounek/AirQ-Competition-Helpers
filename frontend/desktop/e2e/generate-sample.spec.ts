import { test, expect } from '@playwright/test';
import { launchApp, navigateToApp } from './electronApp';
import fs from 'node:fs';
import path from 'node:path';

// One-off generator (NOT part of the normal e2e run — guarded by GENERATE_SAMPLE=1).
// It produces the bundled, finalized sample competition by driving the real app:
//   GENERATE_SAMPLE=1 npx playwright test generate-sample
// It opens the preloaded "VZOR – Plasy Blue" in Map Corridors (which auto-imports
// the route + photos and writes the handoff), then in the Photo Editor (which
// imports the picks into the sets and saves), and copies the resulting competition
// directory into sample-data/competition/. ensureSampleCompetition then copies that
// finalized dir on every launch, so the sample shows photos from ANY entry point.

const SHOULD = process.env.GENERATE_SAMPLE === '1';
const SAMPLE_ID = 'sample-plasy-blue';
const OUT_DIR = path.resolve(__dirname, '..', 'sample-data', 'competition');

function readPickCount(file: string): number {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j?.picks) ? j.picks.length : 0;
  } catch {
    return 0;
  }
}

function readSessionPhotoCount(file: string): number {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const buckets = [s?.sets, s?.setsTrack, s?.setsTurning];
    let n = 0;
    for (const b of buckets) {
      for (const key of ['set1', 'set2']) {
        const photos = b?.[key]?.photos;
        if (Array.isArray(photos)) n += photos.filter((p: { isPlaceholder?: boolean }) => !p?.isPlaceholder).length;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

// Wait until `fn()` reaches >= atLeast AND stops increasing for `stableMs`
// (the import count isn't known up-front — one photo may lack usable GPS and
// land in the No-GPS tray rather than as a pick).
async function pollStable(label: string, fn: () => number, atLeast: number, timeoutMs: number, stableMs = 4000): Promise<number> {
  const start = Date.now();
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cur = fn();
    if (cur !== last) { last = cur; stableSince = Date.now(); }
    if (last >= atLeast && Date.now() - stableSince >= stableMs) return last;
    await new Promise(r => setTimeout(r, 500));
  }
  if (last >= atLeast) return last;
  throw new Error(`[generate] timeout waiting for ${label}: got ${last}, wanted >= ${atLeast}`);
}

test.describe('generate sample fixture', () => {
  test.skip(!SHOULD, 'set GENERATE_SAMPLE=1 to (re)generate the bundled sample competition');

  test('build the finalized sample competition', async () => {
    test.setTimeout(240_000);
    const launched = await launchApp();
    const { app, page, userDataDir } = launched;
    const compDir = path.join(userDataDir, 'photo-sessions', 'competitions', SAMPLE_ID);
    const picksFile = path.join(compDir, 'map-picks.json');
    const sessionFile = path.join(compDir, 'session.json');

    // 1) Map Corridors — auto-import runs on open; wait for the handoff picks to settle.
    await navigateToApp(page, 'map-corridors', SAMPLE_ID);
    const picks = await pollStable('corridors handoff picks', () => readPickCount(picksFile), 1, 150_000);
    console.log(`[generate] corridors wrote ${picks} picks`);

    // 2) Photo Editor — imports the picks into the sets and autosaves the session.
    await navigateToApp(page, 'photo-helper', SAMPLE_ID);
    const photos = await pollStable('editor session photos', () => readSessionPhotoCount(sessionFile), picks, 150_000);
    console.log(`[generate] editor session holds ${photos} photos`);
    await page.waitForTimeout(3000); // let the debounced session save settle

    // 3) Copy the finalized competition into the bundle.
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.cpSync(compDir, OUT_DIR, { recursive: true });
    const bytes = fs.readdirSync(OUT_DIR, { recursive: true } as { recursive: true })
      .map(f => { try { return fs.statSync(path.join(OUT_DIR, f as string)).size; } catch { return 0; } })
      .reduce((a, b) => a + b, 0);
    console.log(`[generate] wrote ${OUT_DIR} (${(bytes / 1e6).toFixed(1)} MB)`);
    expect(readSessionPhotoCount(path.join(OUT_DIR, 'session.json'))).toBeGreaterThanOrEqual(picks);
    expect(readPickCount(path.join(OUT_DIR, 'map-picks.json'))).toBeGreaterThanOrEqual(picks);

    await app.close();
  });
});

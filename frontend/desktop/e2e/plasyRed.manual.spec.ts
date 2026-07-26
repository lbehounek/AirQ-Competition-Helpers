import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { launchApp, navigateToApp, closeApp, type LaunchedApp } from './electronApp';

// MANUAL / REAL-DATA spec — the "Plasy Red" competition (18 June 2026).
//
// Everything else in this suite runs on synthesized fixtures: deterministic,
// committable, and ~500 bytes each. That is the right default, but it cannot
// catch what only shows up at real scale — 17 photos at 6–8 MB (~120 MB total)
// with real camera EXIF, imported at concurrency 8, plus one genuine no-GPS
// file ("1 bezfoto.jpg", the organizer's no-photo placeholder).
//
// That mix is exactly the case that used to lose data: markers and tray entries
// were written in two sequential whole-session writes, and a batch containing
// even one photo without GPS could discard EVERY marker in the import.
// Synthetic tests reproduce it, but only real files prove it at real timing.
//
// SKIPPED AUTOMATICALLY when the photo folder is absent. The photos are
// gitignored (119 MB), so CI and any fresh clone skip this file rather than
// fail. To run it, put the folder at the repo root and:
//     npx playwright test e2e/plasyRed.manual.spec.ts
//
// Screenshots land in `test-results/plasy-red/` for eyeballing the map render,
// the label pills, and the editor grid.

const PHOTO_ROOT = path.resolve(__dirname, '../../../Plasy Red');
const TRACK_DIR = path.join(PHOTO_ROOT, 'red trat');
const ROUTE_KML = path.join(PHOTO_ROOT, 'RED.kml');
const SHOTS = path.resolve(__dirname, '../test-results/plasy-red');

const hasPhotos = fs.existsSync(PHOTO_ROOT) && fs.existsSync(ROUTE_KML);

/** Turning-point photos (SP, TP1–TP7, FP) — all GPS-tagged. */
const TURNING = ['red sp.JPG', 'red tp1.JPG', 'red tp2.JPG', 'red tp4.JPG',
  'red tp5.JPG', 'red tp6.JPG', 'red tp7.JPG', 'red fp.JPG']
  .map((f) => path.join(PHOTO_ROOT, f));

/** En-route track photos — all GPS-tagged. */
const TRACK = Array.from({ length: 9 }, (_, i) => path.join(TRACK_DIR, `red ${i + 1}.JPG`));

/** The organizer's "no photo" placeholder — genuinely carries no EXIF GPS. */
const NO_GPS = path.join(PHOTO_ROOT, '1 bezfoto.jpg');

const ALL_PHOTOS = [...TURNING, ...TRACK, NO_GPS];
const GPS_COUNT = TURNING.length + TRACK.length; // 17

type CorridorsSession = {
  markers?: { photoId?: string; name?: string; lng?: number; lat?: number }[];
  noGpsPhotos?: { photoId: string; filename: string }[];
};

function readSession(userDataDir: string, competitionId: string): CorridorsSession | null {
  const file = path.join(
    userDataDir, 'photo-sessions', 'competitions', competitionId, 'corridors', 'session.json',
  );
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as CorridorsSession;
}

test.describe('Plasy Red — real competition photos', () => {
  test.skip(!hasPhotos, 'Plasy Red photo folder not present (gitignored) — manual run only');

  let launched: LaunchedApp;

  test.beforeAll(() => { fs.mkdirSync(SHOTS, { recursive: true }); });

  test.beforeEach(async () => {
    launched = await launchApp();
    await launched.page.evaluate(() => {
      const api = (window as unknown as { electronAPI?: { setConfig?: (k: string, v: string) => void } }).electronAPI;
      api?.setConfig?.('locale', 'en');
    });
  });

  test.afterEach(async () => { await closeApp(launched); });

  test('imports the full competition: 17 GPS photos on the map, 1 placeholder in the tray', async () => {
    // ~120 MB through the real import pipeline at concurrency 8 — the memory
    // path that used to read every file twice (EXIF + content hash).
    test.setTimeout(300_000);

    const { page, pageErrors } = launched;
    const compId = 'plasy-red';
    await navigateToApp(page, 'map-corridors', compId);
    await expect(page.locator('#root')).not.toBeEmpty();

    const started = Date.now();
    await page.locator('input[type="file"]').setInputFiles([ROUTE_KML, ...ALL_PHOTOS]);
    await expect(page.getByText(/Imported \d+ photos/i)).toBeVisible({ timeout: 240_000 });
    const elapsedMs = Date.now() - started;

    const session = readSession(launched.userDataDir, compId);
    expect(session, 'session.json must exist').not.toBeNull();

    // THE regression this exists to catch: a mixed batch must keep BOTH lists.
    // Before the fix, the tray write rebuilt the session from a pre-import
    // snapshot and all 17 markers vanished.
    expect(session!.markers, 'all GPS photos must survive a mixed import').toHaveLength(GPS_COUNT);
    expect(session!.noGpsPhotos, 'the placeholder belongs in the tray').toHaveLength(1);
    expect(session!.noGpsPhotos![0].filename).toBe('1 bezfoto.jpg');

    // No photo may be in both lists.
    const placed = new Set(session!.markers!.map((m) => m.photoId).filter(Boolean));
    const ghosts = session!.noGpsPhotos!.map((p) => p.photoId).filter((id) => placed.has(id));
    expect(ghosts, `photo(s) in BOTH map and tray: ${ghosts.join(', ')}`).toEqual([]);

    // Every marker must carry real coordinates — a silently-failed EXIF read
    // would show up here as a photo that never made it to the map at all.
    for (const m of session!.markers!) {
      expect(Number.isFinite(m.lng) && Number.isFinite(m.lat), `${m.name} has no coordinates`).toBe(true);
    }

    await page.screenshot({ path: path.join(SHOTS, '01-map-after-import.png'), fullPage: false });
    // eslint-disable-next-line no-console
    console.log(`[plasy-red] imported ${GPS_COUNT} GPS + 1 no-GPS photo (~120 MB) in ${(elapsedMs / 1000).toFixed(1)}s`);

    expect(pageErrors, `renderer threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
  });

  test('re-importing the same folder is fully deduped by content hash', async () => {
    test.setTimeout(300_000);
    const { page, pageErrors } = launched;
    const compId = 'plasy-red-dup';
    await navigateToApp(page, 'map-corridors', compId);

    const input = page.locator('input[type="file"]');
    await input.setInputFiles([ROUTE_KML, ...ALL_PHOTOS]);
    await expect(page.getByText(/Imported \d+ photos/i)).toBeVisible({ timeout: 240_000 });

    await input.setInputFiles(ALL_PHOTOS);
    await expect(page.getByText(/already imported/i)).toBeVisible({ timeout: 240_000 });

    const session = readSession(launched.userDataDir, compId);
    expect(session!.markers).toHaveLength(GPS_COUNT);
    expect(session!.noGpsPhotos).toHaveLength(1);

    expect(pageErrors, `renderer threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
  });

  test('Print Map exports an A4 PNG carrying the real photo names', async () => {
    // The client's original complaint: "in the map export the photo names are
    // not shown". This drives the whole path with their own photos — import,
    // rename, print — and inspects the PNG that actually reaches disk.
    //
    // `dialog.showSaveDialog` is a native OS dialog Playwright cannot click, so
    // it is stubbed in the MAIN process to answer with a fixed path. Everything
    // downstream of it (the A4/300DPI capture, the label composition, the pill
    // packer, the byte transport over IPC and the file write) is the real code.
    test.setTimeout(300_000);

    const { page, app, pageErrors } = launched;
    const compId = 'plasy-red-print';
    const outPng = path.join(SHOTS, 'plasy-red-print.png');
    if (fs.existsSync(outPng)) fs.unlinkSync(outPng);

    await app.evaluate(async ({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, outPng);

    await navigateToApp(page, 'map-corridors', compId);
    await page.locator('input[type="file"]').setInputFiles([ROUTE_KML, ...TURNING, ...TRACK]);
    await expect(page.getByText(/Imported \d+ photos/i)).toBeVisible({ timeout: 240_000 });

    await page.getByRole('button', { name: /Print Map/i }).click();

    // The capture renders an offscreen map and waits for tiles, so allow time.
    await expect.poll(() => fs.existsSync(outPng), { timeout: 180_000, intervals: [1000] }).toBe(true);

    // PNG IHDR: width and height are big-endian uint32 at byte offsets 16 and 20.
    const buf = fs.readFileSync(outPng);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    // A4 at 300 DPI, either orientation — the v2.29.0 fix normalizes this
    // regardless of the machine's display scaling.
    const isA4at300 = (width === 3508 && height === 2480) || (width === 2480 && height === 3508);
    expect(isA4at300, `expected A4@300DPI, got ${width}x${height}`).toBe(true);
    expect(buf.byteLength, 'a real map render should not be a near-empty PNG').toBeGreaterThan(100_000);

    // eslint-disable-next-line no-console
    console.log(`[plasy-red] printed ${width}x${height} PNG, ${(buf.byteLength / 1048576).toFixed(1)} MB → ${outPng}`);

    expect(pageErrors, `renderer threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
  });
});

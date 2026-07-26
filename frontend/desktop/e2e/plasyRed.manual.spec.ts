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

  test('precision end to end: categorize → send to editor → numeric labels → PDF', async () => {
    // The full organizer workflow for a PRECISION competition, on real photos:
    // create the competition, import route + track photos, mark each photo as a
    // track pick, hand them to the editor, and export the printable PDF.
    //
    // Precision is the discipline the client reported problems with, and it
    // differs from rally in ways only this path exercises: numeric answer-sheet
    // labels (1..N) instead of letters, a single set (no "Set 2 starts at"), and
    // a 9-slot landscape sheet. FAI precision rules allow 8-10 photos.
    test.setTimeout(600_000);

    const { page, app, pageErrors } = launched;
    const outPdf = path.join(SHOTS, 'plasy-red-precision.pdf');
    if (fs.existsSync(outPdf)) fs.unlinkSync(outPdf);
    await app.evaluate(async ({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, outPdf);

    // Discipline lives in the competitions index, not the URL — `navigate-to-app`
    // reads it from there and appends `?discipline=`. Creating through the real
    // IPC is what the launcher's New-competition flow does.
    const compId: string = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI: any }).electronAPI;
      const comp = await api.competitions.create('Plasy Red Precision');
      await api.competitions.setDiscipline(comp.id, 'precision');
      return comp.id as string;
    });

    await navigateToApp(page, 'map-corridors', compId);
    expect(page.url(), 'the sub-app must be told it is precision').toContain('discipline=precision');

    await page.locator('input[type="file"]').setInputFiles([ROUTE_KML, ...TRACK]);
    await expect(page.getByText(/Imported \d+ photos/i)).toBeVisible({ timeout: 240_000 });

    // Precision is single-set, so the rally-only split selector must be absent.
    await expect(page.getByRole('combobox', { name: /Set 2 starts at/i })).toHaveCount(0);

    // Categorize every photo as a track pick. Clicking a list row flies the map
    // to that marker and centres it, so a click at the canvas centre lands on
    // the marker and opens its popup — no coordinate projection needed.
    const canvas = page.locator('canvas').first();
    const panel = page.locator('[data-tour="send"]').locator('xpath=ancestor::*[3]');
    for (let i = 0; i < TRACK.length; i++) {
      const label = `red ${i + 1}.JPG`;
      await panel.getByText(label, { exact: true }).first().click();
      await page.waitForTimeout(900); // flyTo duration is 700ms
      const box = await canvas.boundingBox();
      if (!box) throw new Error('map canvas has no bounding box');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByRole('button', { name: /^Track photo$/i }).click({ timeout: 15_000 });
      await page.keyboard.press('Escape');
    }

    await page.screenshot({ path: path.join(SHOTS, '02-precision-categorized.png') });

    // All nine picked → the send button carries the count.
    const send = page.locator('[data-tour="send"]');
    await expect(send).toContainText(`(${TRACK.length})`);
    await send.click();

    // Land in the editor with the sets pre-filled.
    await page.waitForURL((u) => u.toString().includes('/photo-helper/'), { timeout: 60_000 });
    await expect(page.locator('#root')).not.toBeEmpty();

    // Poll the editor's own session on disk until the handoff import settles.
    // A fixed sleep would silently accept a partial transfer — the count is the
    // thing under test, so wait on the count itself.
    const editorSession = () => {
      const f = path.join(
        launched.userDataDir, 'photo-sessions', 'competitions', compId, 'session.json',
      );
      if (!fs.existsSync(f)) return null;
      return JSON.parse(fs.readFileSync(f, 'utf-8'));
    };
    const setCounts = () => {
      const s = editorSession();
      if (!s) return null;
      return {
        set1: s.sets?.set1?.photos?.length ?? 0,
        set2: s.sets?.set2?.photos?.length ?? 0,
        candidates: s.candidates?.length ?? s.candidatePool?.length ?? 0,
      };
    };
    await expect
      .poll(() => setCounts()?.set1 ?? -1, { timeout: 60_000, intervals: [500] })
      .toBe(TRACK.length);
    // eslint-disable-next-line no-console
    console.log('[plasy-red] editor sets after handoff:', JSON.stringify(setCounts()));

    // ...and wait until they are actually RENDERED, not just persisted. The
    // session file leads the canvas by a beat, so asserting only on disk would
    // screenshot (and export) a half-drawn sheet.
    await expect(page.getByText(/^red \d+\.JPG$/)).toHaveCount(TRACK.length, { timeout: 60_000 });
    // Single-set precision sheet. The answer-sheet labels themselves (1..N for
    // precision, A.. for rally) are drawn ONTO each photo's canvas rather than
    // into the DOM, so they are verified by the committed screenshot and by
    // labelsForDiscipline's unit tests — not assertable here. What IS in the
    // DOM is the set title: precision runs SP - FP as one sheet, where rally
    // would show the SP - TPX / TPX - FP pair.
    await expect(page.getByText('SP - FP')).toBeVisible();
    await expect(page.getByText('TPX - FP')).toHaveCount(0);

    await page.screenshot({ path: path.join(SHOTS, '03-precision-editor.png'), fullPage: true });

    await page.getByRole('button', { name: /Generate PDF/i }).click();
    await expect.poll(() => fs.existsSync(outPdf), { timeout: 240_000, intervals: [1000] }).toBe(true);

    const pdf = fs.readFileSync(outPdf);
    expect(pdf.subarray(0, 5).toString('latin1'), 'must be a real PDF').toBe('%PDF-');
    expect(pdf.byteLength, 'a sheet of 9 photos should not be a stub PDF').toBeGreaterThan(100_000);
    // Precision is a SINGLE answer sheet — a second page would mean the rally
    // set-2 path leaked in (the web build's discipline downgrade does exactly that).
    const raw = pdf.toString('latin1');
    const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pageCount, 'precision must export exactly one sheet').toBe(1);
    // Every photo must be embedded. A silent truncation (the class of bug this
    // whole branch is about) would show up here as a missing image XObject.
    const imageCount = (raw.match(/\/Subtype\s*\/Image/g) || []).length;
    expect(imageCount, `expected ${TRACK.length} photos embedded, found ${imageCount}`)
      .toBeGreaterThanOrEqual(TRACK.length);

    // eslint-disable-next-line no-console
    console.log(`[plasy-red] precision PDF: ${(pdf.byteLength / 1048576).toFixed(1)} MB, ${pageCount} page`);

    expect(pageErrors, `renderer threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
  });
});

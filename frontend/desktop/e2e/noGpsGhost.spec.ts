import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { launchApp, navigateToApp, closeApp, type LaunchedApp } from './electronApp';
import { writeGpsJpeg } from './gpsPhoto';

// Regression E2E for the client report of 2026-07-23: in a PRECISION
// competition where every photo had GPS, one photo appeared a SECOND time in
// "Umístění fotek" as a no-GPS entry — the original stayed on the map and a
// ghost duplicate showed up in the Bez GPS list.
//
// The import pipeline is the only writer of `noGpsPhotos`, so these specs drive
// the real Electron build through the import paths that could plausibly produce
// the state — a plain import, a re-import of the same files, and a round trip
// through the editor — and assert the invariant the client's session violated:
// a GPS-tagged photo is on the map and NOWHERE in the no-GPS list.
//
// Photos are synthesized with real EXIF GPS at test time (see gpsPhoto.ts); the
// committed fixtures/photo.jpg has none, which is why the flows below could not
// be covered before.

// Points on/near the fixture route (see fixtures/route.kml).
const P1 = { lat: 50.140517, lng: 14.034499 };
const P2 = { lat: 50.219208, lng: 13.879178 };
// Deliberately identical to P2 — two shots of one turning point is the normal
// competition case and the one most likely to expose identity/dedup bugs.
const P3 = { lat: 50.219208, lng: 13.879178 };

const ROUTE_KML = path.resolve(__dirname, 'fixtures/route.kml');

let launched: LaunchedApp;
let photoDir: string;
let photos: string[];

/** The panel's warning banner — the visible symptom of anything in the tray. */
const NO_GPS_WARNING = /aren't on the map yet/i;

test.beforeEach(async () => {
  photoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airq-gps-fx-'));
  photos = [
    writeGpsJpeg(path.join(photoDir, 'DSC_0001.JPG'), { ...P1, dateTimeOriginal: '2026:07:20 10:00:00' }),
    writeGpsJpeg(path.join(photoDir, 'DSC_0002.JPG'), { ...P2, dateTimeOriginal: '2026:07:20 10:05:00' }),
    writeGpsJpeg(path.join(photoDir, 'DSC_0003.JPG'), { ...P3, dateTimeOriginal: '2026:07:20 10:05:30' }),
  ];
  launched = await launchApp();
  await launched.page.evaluate(() => {
    const api = (window as unknown as { electronAPI?: { setConfig?: (k: string, v: string) => void } }).electronAPI;
    api?.setConfig?.('locale', 'en');
  });
});

test.afterEach(async () => {
  await closeApp(launched);
  fs.rmSync(photoDir, { recursive: true, force: true });
});

type CorridorsSession = {
  markers?: { photoId?: string }[];
  noGpsPhotos?: { photoId: string; filename: string }[];
};

/**
 * Read the persisted corridors session off disk. In the desktop build the
 * competition lives in the native store (`<userData>/photo-sessions/…`), not in
 * the renderer's OPFS.
 *
 * The UI proves what the organizer sees; this proves what was actually written,
 * which is where the reported ghost lived — the same photo present in BOTH
 * `markers` and `noGpsPhotos`.
 */
function readSession(userDataDir: string, competitionId: string): CorridorsSession | null {
  const file = path.join(
    userDataDir, 'photo-sessions', 'competitions', competitionId, 'corridors', 'session.json',
  );
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as CorridorsSession;
}

/** photoIds that are on the map AND in the tray — the reported bug, as a set. */
function ghostPhotoIds(session: CorridorsSession): string[] {
  const placed = new Set((session.markers ?? []).map((m) => m.photoId).filter(Boolean));
  return (session.noGpsPhotos ?? []).map((p) => p.photoId).filter((id) => placed.has(id));
}

test('precision: photos that all carry GPS land on the map, none in the No GPS list', async () => {
  const { page, pageErrors } = launched;
  const compId = 'e2e-ghost-1';
  await navigateToApp(page, 'map-corridors', compId);
  await expect(page.locator('#root')).not.toBeEmpty();

  await page.locator('input[type="file"]').setInputFiles([ROUTE_KML, ...photos]);
  await expect(page.getByText(/Imported 3 photos/i)).toBeVisible();

  // The client's precondition: nothing should be in the tray at all.
  await expect(page.getByText(NO_GPS_WARNING)).toHaveCount(0);

  const session = readSession(launched.userDataDir, compId);
  expect(session, 'session.json should exist after import').not.toBeNull();
  expect(session!.markers).toHaveLength(3);
  expect(session!.noGpsPhotos ?? []).toEqual([]);

  expect(pageErrors, `renderer threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

test('re-importing the same photos adds no duplicate and no ghost tray entry', async () => {
  const { page, pageErrors } = launched;
  const compId = 'e2e-ghost-2';
  await navigateToApp(page, 'map-corridors', compId);
  await page.locator('input[type="file"]').setInputFiles([ROUTE_KML, ...photos]);
  await expect(page.getByText(/Imported 3 photos/i)).toBeVisible();

  // Import the very same files again — content-hash dedup should skip them all.
  await page.locator('input[type="file"]').setInputFiles(photos);
  await expect(page.getByText(/already imported/i)).toBeVisible();

  const session = readSession(launched.userDataDir, compId);
  expect(session!.markers, 'a re-import must not mint new markers').toHaveLength(3);
  expect(session!.noGpsPhotos ?? []).toEqual([]);
  await expect(page.getByText(NO_GPS_WARNING)).toHaveCount(0);

  expect(pageErrors, `renderer threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

test('no photo is ever in both the map and the No GPS list, across an editor round trip', async () => {
  const { page, pageErrors } = launched;
  const compId = 'e2e-ghost-3';
  await navigateToApp(page, 'map-corridors', compId);
  await page.locator('input[type="file"]').setInputFiles([ROUTE_KML, ...photos]);
  await expect(page.getByText(/Imported 3 photos/i)).toBeVisible();

  // Leave for the editor and come back — the reported ghost appeared after a
  // trip through Photo Helper, so the session must survive the round trip with
  // the two lists still disjoint.
  await navigateToApp(page, 'photo-helper', compId);
  await expect(page.locator('#root')).not.toBeEmpty();
  await navigateToApp(page, 'map-corridors', compId);
  await expect(page.locator('#root')).not.toBeEmpty();

  const session = readSession(launched.userDataDir, compId);
  const both = ghostPhotoIds(session!);

  expect(both, `photo(s) present in BOTH the map and the No GPS list: ${both.join(', ')}`).toEqual([]);
  expect(session!.markers).toHaveLength(3);
  await expect(page.getByText(NO_GPS_WARNING)).toHaveCount(0);

  expect(pageErrors, `renderer threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// Overlapping imports. `handlePhotoFiles` has no in-flight guard and builds its
// content-hash dedup set from a render closure captured BEFORE the import runs,
// so a second drop landing while the first is still working sees a stale set.
// Two `setInputFiles` calls back-to-back resolve as soon as the change event is
// dispatched, so the app's two async import runs genuinely overlap.
//
// This is the suspected mechanism behind the client's report: if dedup is
// bypassed, the same file is imported twice under two different photo ids —
// and because the pipeline reads each File three times concurrently (EXIF,
// thumbnail, hash) at concurrency 8, one of those reads failing is what would
// put the second copy in the no-GPS tray beside the good one.
// ---------------------------------------------------------------------------

test('overlapping imports of the SAME files do not bypass dedup', async () => {
  const { page, pageErrors } = launched;
  const compId = 'e2e-ghost-4';
  await navigateToApp(page, 'map-corridors', compId);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([ROUTE_KML]);

  // A batch big enough that the first run is demonstrably still working when
  // the second starts — with three files the import finishes in milliseconds
  // and the two runs would never actually overlap, so the test would pass
  // without exercising anything. A real competition is this size anyway.
  const BATCH = 24;
  const many = Array.from({ length: BATCH }, (_, i) =>
    writeGpsJpeg(path.join(photoDir, `BULK_${String(i).padStart(3, '0')}.JPG`), {
      lat: 50.14 + i * 0.001,
      lng: 14.03 + i * 0.001,
      dateTimeOriginal: `2026:07:20 11:${String(i % 60).padStart(2, '0')}:00`,
    }),
  );

  // Fire the second import without waiting for the first to finish: setInputFiles
  // resolves once the change event is dispatched, not when the import settles.
  await input.setInputFiles(many);
  await input.setInputFiles(many);
  await expect(page.getByText(/Importing|Imported|already imported/i).first()).toBeVisible();
  await page.waitForTimeout(8000); // let both runs settle

  const session = readSession(launched.userDataDir, compId);
  const ids = (session!.markers ?? []).map((m) => m.photoId);
  expect(ghostPhotoIds(session!), 'a photo ended up on the map AND in the tray').toEqual([]);
  expect(session!.noGpsPhotos ?? [], 'GPS-tagged photos must never reach the tray').toEqual([]);
  expect(ids, 'the same files were imported twice — dedup should keep one marker each').toHaveLength(BATCH);
  expect(new Set(ids).size, 'duplicate photoIds among markers').toBe(ids.length);

  expect(pageErrors, `renderer threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

test('overlapping imports of DIFFERENT files keep every photo exactly once', async () => {
  const { page, pageErrors } = launched;
  const compId = 'e2e-ghost-5';
  await navigateToApp(page, 'map-corridors', compId);

  const second = [
    writeGpsJpeg(path.join(photoDir, 'DSC_0004.JPG'), { lat: 50.120652, lng: 13.439564 }),
    writeGpsJpeg(path.join(photoDir, 'DSC_0005.JPG'), { lat: 49.952986, lng: 13.463876 }),
  ];

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([ROUTE_KML]);
  await input.setInputFiles(photos);
  await input.setInputFiles(second); // overlaps the first batch
  await page.waitForTimeout(3000);

  const session = readSession(launched.userDataDir, compId);
  expect(ghostPhotoIds(session!)).toEqual([]);
  expect(session!.noGpsPhotos ?? []).toEqual([]);
  // The real risk here is a lost update: two whole-session writes racing, with
  // one batch silently overwriting the other.
  expect(session!.markers, 'both overlapping batches must survive').toHaveLength(5);

  expect(pageErrors, `renderer threw: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
});

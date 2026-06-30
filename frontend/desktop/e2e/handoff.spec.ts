import { test, expect } from '@playwright/test';
import path from 'node:path';
import { launchApp, navigateToApp, closeApp, type LaunchedApp } from './electronApp';

// Cross-app / set-split feature E2E in the real Electron build.
//
// Robust subset (runs): load a real route + a photo in Map Corridors and assert
// the "Set 2 starts at" route-TP selector surfaces with the route's turning
// points — the exact discoverability the feature is about, exercised end to end
// (KML parse → corridor compute → route waypoints → panel selector) with zero
// renderer errors.
//
// Full crown-jewel flow (pick GPS photos → set a split → Send → editor fills
// set1/set2) is documented as a test.fixme below: it needs GPS-tagged photo
// fixtures and map-marker interaction that should be stabilized against the CI
// Electron runner. The map→editor handoff's data layer (buildMapPicks set
// stamping + useMapPicksSync routing/reflow) is already covered by unit tests.

const ROUTE_KML = path.resolve(__dirname, 'fixtures/route.kml');
const PHOTO_JPG = path.resolve(__dirname, 'fixtures/photo.jpg');

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
  // Pin English so locale-dependent labels are stable, then open Map Corridors
  // as a fresh rally competition.
  await launched.page.evaluate(() => {
    const api = (window as unknown as { electronAPI?: { setConfig?: (k: string, v: string) => void } }).electronAPI;
    api?.setConfig?.('locale', 'en');
  });
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('loading a route surfaces the "Set 2 starts at" selector with the route turning points', async () => {
  const { page, pageErrors } = launched;
  await navigateToApp(page, 'map-corridors', 'e2e-comp-1');
  await expect(page.locator('#root')).not.toBeEmpty();

  // Import the route + a photo through the app's hidden file input. The route
  // gives the TP options; the photo makes the right-side panel (which hosts the
  // selector) render.
  await page.locator('input[type="file"]').setInputFiles([ROUTE_KML, PHOTO_JPG]);

  // The selector (MUI select) renders as a combobox named "Set 2 starts at".
  const selector = page.getByRole('combobox', { name: 'Set 2 starts at' });
  await expect(selector).toBeVisible();

  // Opening it lists the route's turning points (TP 1 … TP 5 from the KML) —
  // proves route → waypoints → options end to end. Choosing one must not error.
  await selector.click();
  const tpOption = page.getByRole('option', { name: /TP/ }).first();
  await expect(tpOption).toBeVisible();
  await tpOption.click();

  expect(
    pageErrors,
    `renderer threw during the set-split flow: ${pageErrors.map((e) => e.message).join('; ')}`,
  ).toEqual([]);
});

// Full map-corridors → photo-helper handoff. Needs GPS-tagged photo fixtures so
// picks land on the map, plus marker-popup interaction to categorize + pick, set
// a split, then Send. Tracked here so the intended coverage is explicit; enable
// and stabilize against the CI Electron runner.
test.fixme('full handoff: pick photos → set split → send → editor fills set1/set2', async () => {
  // 1. Map Corridors: import route + GPS-tagged photos.
  // 2. Click two photo markers → "Turning-point photo" / "Track photo".
  // 3. "Set 2 starts at" → choose a TP.
  // 4. "Send to editor" → wait for navigation to photo-helper.
  // 5. Assert set1 and set2 each contain the expected photos (by the split),
  //    and pageErrors is empty.
});

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DESKTOP_DIR = path.resolve(__dirname, '..');

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  /** Renderer errors collected across the whole session (TDZ / uncaught throws). */
  pageErrors: Error[];
  /** Per-run userData dir so OPFS/native storage starts clean and is isolated. */
  userDataDir: string;
}

/**
 * Launch the real Electron app (main.js) in a throwaway userData dir, return the
 * main window page, and start collecting renderer `pageerror`s. A non-empty
 * `pageErrors` after a navigation means the renderer threw uncaught — exactly
 * the "white screen on mount" class (e.g. a temporal-dead-zone ReferenceError)
 * that unit tests can't see in the packaged app.
 *
 * Requires the sub-apps to be built (served via the app:// protocol). Pass extra
 * CLI/env if a test needs to seed a competition before the window opens.
 */
export async function launchApp(): Promise<LaunchedApp> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airq-e2e-'));
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: DESKTOP_DIR,
    env: { ...process.env, AIRQ_E2E: '1' },
  });
  const page = await app.firstWindow();
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  // Suppress the first-run onboarding tours so they can't cover the UI and flake
  // the deterministic tests. Runs in every page (incl. each sub-app origin)
  // before app code, so the auto-start gate sees the flags already set.
  //
  // Every version of each key is set, not just the current one: the tour keys
  // are deliberately bumped (`…onboarding.v2`) whenever the tour changes
  // materially so returning users see it once, and a bump that forgot to update
  // this list would silently un-suppress the tour and flake every spec here.
  await page.addInitScript(() => {
    const keys = [
      'airq.mapCorridors.onboarding.v1',
      'airq.mapCorridors.onboarding.v2',
      'airq.photoHelper.onboarding.v1',
      'airq.launcher.onboarding.v1',
    ];
    try {
      for (const key of keys) window.localStorage.setItem(key, 'e2e');
    } catch {
      /* storage unavailable — nothing to suppress */
    }
  });
  // The init script applies to future loads; reload home so it also takes effect
  // on the already-loaded launcher (suppresses its first-run tour deterministically).
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, pageErrors, userDataDir };
}

/** Navigate the main window to a sub-app via the same IPC the launcher uses. */
export async function navigateToApp(
  page: Page,
  appName: 'photo-helper' | 'map-corridors' | 'home',
  competitionId?: string,
): Promise<void> {
  // The main process does `loadURL('app://<appName>/index.html')` on the SAME
  // BrowserWindow, so we must wait for the URL to actually change — a bare
  // `waitForLoadState` resolves immediately on the already-loaded current page.
  const navigated = page.waitForURL((url) => url.toString().includes(`/${appName}/`), { timeout: 30_000 });
  await page.evaluate(
    ([name, id]) => {
      const api = (window as unknown as {
        electronAPI?: { navigateToApp?: (a: string, c?: string) => void };
      }).electronAPI;
      api?.navigateToApp?.(name as string, id as string | undefined);
    },
    [appName, competitionId] as const,
  );
  await navigated;
  await page.waitForLoadState('domcontentloaded');
}

export async function closeApp(launched: LaunchedApp): Promise<void> {
  await launched.app.close();
  try {
    fs.rmSync(launched.userDataDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
}

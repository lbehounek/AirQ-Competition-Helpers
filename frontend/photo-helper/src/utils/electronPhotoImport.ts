/**
 * Photo import via Electron's native open dialog. Used by all three
 * dropzone surfaces in the photo-helper (DropZone, GridSizedDropZone,
 * PhotoGridSlotEmpty) to bypass the HTML `<input type=file>` whose
 * starting directory cannot be programmatically seeded.
 *
 * The dialog defaults to the active competition's working folder, which
 * is also where KML / PNG / PDF exports default to. After the user picks
 * files, the dirname of the first selection becomes the new working
 * folder — so the user steers the persistent default by simply navigating
 * in any open or save dialog (feedback 2026-04-25).
 *
 * Failure mode contract: callers get back `{ files, failures }`. A
 * cancelled dialog is `{ files: [], failures: [] }`. Per-file read
 * errors land in `failures` instead of being silently swallowed — the
 * `useElectronPhotoImport` hook surfaces them via an Alert so the user
 * isn't left wondering why 5 of 9 photos vanished.
 */

import { dirnameOf } from '@airq/shared-storage';

declare global {
  interface Window {
    electronAPI?: {
      openPhotos?: (defaultDir?: string, maxFiles?: number) => Promise<string[]>;
      readPhotoFile?: (filePath: string) => Promise<{ name: string; mimeType: string; base64: string } | null>;
      competitions?: {
        getWorkingDir?: (id: string) => Promise<string | null>;
        setWorkingDir?: (id: string, dir: string) => Promise<unknown>;
      };
    };
  }
}

export interface PhotoImportFailure {
  path: string;
  error: unknown;
}

export interface PhotoImportResult {
  files: File[];
  failures: PhotoImportFailure[];
  /** True only when the user explicitly cancelled the dialog. */
  cancelled: boolean;
  /** True if `setWorkingDir` rejected — the persistence side of the feature regressed but the import itself worked. */
  workingDirPersistFailed: boolean;
}

export function getCompetitionIdFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('competitionId') || null;
  } catch {
    return null;
  }
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function isElectronPhotoImportAvailable(): boolean {
  const api = window.electronAPI;
  return !!(api && typeof api.openPhotos === 'function' && typeof api.readPhotoFile === 'function');
}

const EMPTY: PhotoImportResult = Object.freeze({
  files: [],
  failures: [],
  cancelled: true,
  workingDirPersistFailed: false,
}) as PhotoImportResult;

/**
 * Open the Electron native photo dialog and return reconstructed File
 * objects. Failures are reported alongside successes — never silently
 * swallowed. Web-build callers get `{ files: [], failures: [], cancelled: true }`
 * (effectively a no-op) so they can fall through to their HTML
 * `<input type=file>` flow.
 */
export async function openPhotosViaElectron(maxFiles?: number): Promise<PhotoImportResult> {
  const api = window.electronAPI;
  if (!api?.openPhotos || !api?.readPhotoFile) return EMPTY;

  // Read the competition's working dir (if any) to seed the dialog's
  // starting directory. Best-effort — failures are non-fatal; the
  // dialog will fall back to ~/Pictures.
  const competitionId = getCompetitionIdFromUrl();
  let workingDir: string | undefined;
  if (competitionId && api.competitions?.getWorkingDir) {
    try {
      const dir = await api.competitions.getWorkingDir(competitionId);
      if (dir) workingDir = dir;
    } catch (err) {
      // Keep this debug-level so a real IPC regression is at least
      // diagnosable in devtools, without polluting the user-visible
      // error channel for a best-effort lookup.
      console.debug('[photo import] getWorkingDir failed (using default):', err);
    }
  }

  const paths = await api.openPhotos(workingDir, maxFiles);
  if (!paths || !paths.length) return EMPTY;

  // Parallelize the per-file reads. Each round-trip is fs.readFileSync
  // + Buffer.toString('base64') (~40 MB string for a 30 MB image) +
  // IPC + renderer atob, all CPU-bound on different stages — running
  // them concurrently overlaps the renderer-side decode with main-side
  // reads and shaves seconds off a 9-photo import. Failures are
  // captured per-path so a partial batch still surfaces what worked.
  const settled = await Promise.all(
    paths.map(async (p): Promise<{ ok: true; file: File } | { ok: false; path: string; error: unknown }> => {
      try {
        const data = await api.readPhotoFile!(p);
        if (!data || !data.base64) {
          return { ok: false, path: p, error: new Error('Empty response from readPhotoFile') };
        }
        const bytes = base64ToUint8Array(data.base64);
        return { ok: true, file: new File([bytes], data.name, { type: data.mimeType }) };
      } catch (err) {
        return { ok: false, path: p, error: err };
      }
    }),
  );

  const files: File[] = [];
  const failures: PhotoImportFailure[] = [];
  for (const r of settled) {
    if (r.ok) files.push(r.file);
    else failures.push({ path: r.path, error: r.error });
  }

  // Promote the chosen folder to the working dir so subsequent dialogs
  // (saves, future imports) default there. Only seed from a path we
  // actually managed to read — promoting a directory we couldn't import
  // from would mislead the next dialog into a folder the user is already
  // having trouble with.
  let workingDirPersistFailed = false;
  if (competitionId && api.competitions?.setWorkingDir) {
    const firstOkIdx = settled.findIndex(r => r.ok);
    const seedPath = firstOkIdx >= 0 ? paths[firstOkIdx] : null;
    const dir = seedPath ? dirnameOf(seedPath) : null;
    if (dir) {
      try {
        await api.competitions.setWorkingDir(competitionId, dir);
      } catch (err) {
        workingDirPersistFailed = true;
        console.warn('[workingDir] persist failed:', err);
      }
    }
  }

  return { files, failures, cancelled: false, workingDirPersistFailed };
}

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
 * Returns `[]` and lets the caller fall through to the native
 * `<input>` flow on the web build, when the dialog is cancelled, or
 * when no files come back.
 */

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

function getCompetitionIdFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('competitionId') || null;
  } catch {
    return null;
  }
}

function dirnameOf(fullPath: string): string | null {
  const sepIdx = Math.max(fullPath.lastIndexOf('\\'), fullPath.lastIndexOf('/'));
  if (sepIdx <= 0) return null;
  const dir = fullPath.slice(0, sepIdx);
  return dir || null;
}

function base64ToUint8Array(base64: string): Uint8Array {
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

export async function openPhotosViaElectron(maxFiles?: number): Promise<File[]> {
  const api = window.electronAPI;
  if (!api?.openPhotos || !api?.readPhotoFile) return [];

  // Read the competition's working dir (if any) to seed the dialog's
  // starting directory. Competition id is on the URL when launched from
  // the desktop launcher (`?competitionId=…`). Best-effort — failures
  // are non-fatal; the dialog will fall back to ~/Pictures.
  const competitionId = getCompetitionIdFromUrl();
  let workingDir: string | undefined;
  if (competitionId && api.competitions?.getWorkingDir) {
    try {
      const dir = await api.competitions.getWorkingDir(competitionId);
      if (dir) workingDir = dir;
    } catch { /* non-fatal */ }
  }

  const paths = await api.openPhotos(workingDir, maxFiles);
  if (!paths || !paths.length) return [];

  // Reconstruct File objects from each path. Reading happens in main
  // (Node fs) and the bytes come over IPC as base64; we decode and wrap
  // in a Blob/File so the existing onFilesDropped pipeline (which
  // expects File[]) doesn't need changes.
  const files: File[] = [];
  for (const p of paths) {
    try {
      const data = await api.readPhotoFile(p);
      if (!data || !data.base64) continue;
      const bytes = base64ToUint8Array(data.base64);
      files.push(new File([bytes], data.name, { type: data.mimeType }));
    } catch (err) {
      console.error('[photo import] Failed to read', p, err);
    }
  }

  // Promote the chosen folder to the working dir so subsequent dialogs
  // (saves, future imports) default there.
  if (competitionId && api.competitions?.setWorkingDir && paths[0]) {
    const dir = dirnameOf(paths[0]);
    if (dir) {
      api.competitions.setWorkingDir(competitionId, dir).catch((err: unknown) => {
        console.warn('[workingDir] persist failed:', err);
      });
    }
  }

  return files;
}

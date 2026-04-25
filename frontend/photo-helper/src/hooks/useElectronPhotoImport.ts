import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  isElectronPhotoImportAvailable,
  openPhotosViaElectron,
  type PhotoImportFailure,
} from '../utils/electronPhotoImport';
import { isValidImageFile } from '../utils/imageProcessing';
import { useI18n } from '../contexts/I18nContext';

/**
 * Single owner of the click → Electron-dialog → File[] flow shared by
 * DropZone, GridSizedDropZone, and PhotoGridSlotEmpty. Three identical
 * copies of try/catch-then-console.error were swallowing every failure
 * path, leaving users with a click that produced no UI feedback. The
 * hook exposes `importError` so each dropzone can render an Alert.
 *
 * Failure modes surfaced here:
 * - Dialog fails to open (mainWindow null, IPC channel closed) → `importError`
 * - User picks 9 photos, 4 fail to read (allowlist miss, EACCES, 30 MB
 *   cap, corrupted file) → partial-import message, valid files still
 *   delivered to the consumer
 * - `setWorkingDir` rejects (disk full, EACCES) → toast-style notice
 *   that the persistence side regressed; the import itself succeeded
 */

// `isImporting` MUST be shared across every component that mounts this
// hook. PhotoGridSlotEmpty renders one hook instance per empty slot, so
// per-component state would let slot A's still-pending readPhotoFile
// reads race slot B's open-photos — main would clear `photoOpenAllowlist`
// and slot A's reads would silently land in `failures`. A module-level
// boolean exposed via useSyncExternalStore disables every dropzone the
// moment any one of them starts importing, restoring the documented
// "previous batch's reads always finish first" invariant.
let globalIsImporting = false;
const importingSubscribers = new Set<() => void>();

function setGlobalIsImporting(v: boolean): void {
  if (globalIsImporting === v) return;
  globalIsImporting = v;
  importingSubscribers.forEach(s => s());
}

function subscribeImporting(cb: () => void): () => void {
  importingSubscribers.add(cb);
  return () => { importingSubscribers.delete(cb); };
}

function getImportingSnapshot(): boolean {
  return globalIsImporting;
}

export function useElectronPhotoImport() {
  const { t } = useI18n();
  const [importError, setImportError] = useState<string | null>(null);
  // Subscribe to the module-level singleton so every dropzone re-renders
  // (and disables itself) when another instance starts importing.
  const isImporting = useSyncExternalStore(
    subscribeImporting,
    getImportingSnapshot,
    getImportingSnapshot,
  );

  const isAvailable = isElectronPhotoImportAvailable();

  const clearImportError = useCallback(() => setImportError(null), []);

  const pickPhotos = useCallback(
    async (maxFiles: number, onFiles: (files: File[]) => void) => {
      // Read the live singleton, not the rendered snapshot — between
      // render and click the value can change without us re-rendering.
      if (!isAvailable || globalIsImporting) return;
      setImportError(null);
      setGlobalIsImporting(true);
      try {
        const result = await openPhotosViaElectron(maxFiles);
        if (result.failures.length) {
          setImportError(formatFailureMessage(t, result.files.length, result.failures));
        } else if (result.workingDirPersistFailed) {
          setImportError(t('upload.workingDirPersistFailed'));
        }
        const validFiles = result.files.filter(isValidImageFile);
        if (validFiles.length > 0) onFiles(validFiles);
      } catch (err) {
        // Reaches here only if openPhotosViaElectron itself rejects
        // (the IPC threw before returning a structured result — e.g.
        // `untrusted sender`, channel closed, mainWindow=null).
        console.error('[photo import] dialog failed:', err);
        setImportError(t('upload.electronDialogFailed'));
      } finally {
        setGlobalIsImporting(false);
      }
    },
    [isAvailable, t],
  );

  return { isAvailable, isImporting, importError, clearImportError, pickPhotos };
}

function formatFailureMessage(
  t: ReturnType<typeof useI18n>['t'],
  successCount: number,
  failures: PhotoImportFailure[],
): string {
  if (successCount === 0) {
    return t('upload.allFilesFailed', { count: failures.length });
  }
  return t('upload.partialImport', {
    success: successCount,
    failed: failures.length,
    total: successCount + failures.length,
  });
}

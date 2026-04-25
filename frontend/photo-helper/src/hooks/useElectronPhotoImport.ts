import { useCallback, useState } from 'react';
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
export function useElectronPhotoImport() {
  const { t } = useI18n();
  const [importError, setImportError] = useState<string | null>(null);
  // True while the dialog is open and files are being read. Lets
  // dropzones disable themselves so a second click doesn't fire a
  // parallel batch (which would race the allowlist replacement in main).
  const [isImporting, setIsImporting] = useState(false);

  const isAvailable = isElectronPhotoImportAvailable();

  const clearImportError = useCallback(() => setImportError(null), []);

  const pickPhotos = useCallback(
    async (maxFiles: number, onFiles: (files: File[]) => void) => {
      if (!isAvailable || isImporting) return;
      setImportError(null);
      setIsImporting(true);
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
        setIsImporting(false);
      }
    },
    [isAvailable, isImporting, t],
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

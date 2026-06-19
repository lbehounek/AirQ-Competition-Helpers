import React from 'react';
import { Box, Typography, CircularProgress, Snackbar } from '@mui/material';
import { CloudUpload } from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import { isValidImageFile } from '../utils/imageProcessing';
import { useI18n } from '../contexts/I18nContext';
import { useElectronPhotoImport } from '../hooks/useElectronPhotoImport';

/**
 * Always-visible inline photo-import control. Mirrors the
 * `map-corridors` "Select KML" button — a compact click-or-drop affordance
 * that lives in the toolbar regardless of grid state, so the user always
 * has an entry point even when the hero DropZone is no longer rendered
 * (slots have photos but aren't full → no GridSizedDropZone; slots full
 * → CandidateTray's "Add more" is the only path otherwise) (feedback
 * M., 2026-05-15: "would be nice to have a photo dropzone like the KML
 * one").
 *
 * Routing: files go to the caller's `onFilesPicked` — AppApi wires this
 * to `addPhotosToCandidates`, same destination as paste + overflow drops.
 * Keeps the mental model consistent: "anything I add without picking a
 * slot lands in the tray; drag from the tray when ready".
 */
export interface ImportPhotosControlProps {
  onFilesPicked: (files: File[]) => void;
  /** Disabled when no competition is loaded. */
  disabled?: boolean;
}

export const ImportPhotosControl: React.FC<ImportPhotosControlProps> = ({
  onFilesPicked,
  disabled = false,
}) => {
  const { t } = useI18n();
  const electronImport = useElectronPhotoImport();
  const useElectronDialog = electronImport.isAvailable;
  const busy = electronImport.isImporting;
  const isDisabled = disabled || busy;

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject,
  } = useDropzone({
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxSize: 20 * 1024 * 1024,
    disabled: isDisabled,
    // In Electron, the hidden <input type=file> can't be seeded with the
    // competition's working folder — route clicks through the native
    // dialog instead. Browser fallback uses the hidden input.
    noClick: useElectronDialog,
    onDrop: (accepted) => {
      const valid = accepted.filter(isValidImageFile);
      if (valid.length > 0) onFilesPicked(valid);
    },
  });

  const handleClick = async () => {
    if (isDisabled) return;
    if (useElectronDialog) {
      // No slot-capacity cap here — the candidate tray is bounded only by
      // storage. The IPC layer enforces PHOTO_OPEN_HARD_CAP=200.
      await electronImport.pickPhotos(200, (files) => {
        const valid = files.filter(isValidImageFile);
        if (valid.length > 0) onFilesPicked(valid);
      });
    }
  };

  const label = busy
    ? t('upload.processing')
    : isDragReject
    ? t('upload.invalidFileType')
    : isDragActive
    ? t('upload.dropImages')
    : t('importControl.label');

  const borderColor = isDragReject
    ? 'error.main'
    : isDragAccept
    ? 'success.main'
    : isDragActive
    ? 'primary.main'
    // Idle: primary-tinted (was grey) so the always-visible add-photos entry
    // point reads as an action and is easy to find, including on an empty
    // competition where it sits beside the hero drop zone (feedback 2026-06-19).
    : 'primary.main';

  const bgColor = isDragReject
    ? 'error.light'
    : isDragAccept
    ? 'success.light'
    : isDragActive
    ? 'primary.light'
    : 'transparent';

  return (
    <>
      <Box
        {...getRootProps({ onClick: useElectronDialog ? handleClick : undefined })}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          border: '2px dashed',
          borderColor,
          borderRadius: 1.5,
          bgcolor: bgColor,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.55 : 1,
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
          '&:hover': isDisabled
            ? undefined
            : { borderColor: 'primary.main', bgcolor: 'primary.light' },
          userSelect: 'none',
        }}
        title={t('importControl.tooltip')}
      >
        <input {...getInputProps()} />
        {busy ? (
          <CircularProgress size={18} />
        ) : (
          <CloudUpload sx={{ fontSize: 20, color: 'primary.main' }} />
        )}
        <Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'primary.main', whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
      </Box>
      {/* `useElectronPhotoImport.pickPhotos` already traps its own throws
          and calls `setImportError`; the chip just renders that surface.
          Without this Snackbar, a failed native dialog opens nothing,
          shows nothing, and the user keeps clicking. Matches the Alert
          pattern used by the hero DropZone and GridSizedDropZone, but
          rendered as a transient toast so the chip stays compact. */}
      <Snackbar
        open={Boolean(electronImport.importError)}
        autoHideDuration={8000}
        onClose={electronImport.clearImportError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={electronImport.importError ?? ''}
      />
    </>
  );
};

import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert
} from '@mui/material';
import {
  CloudUpload,
  CheckCircle,
  Error as ErrorIcon
} from '@mui/icons-material';
import { isValidImageFile } from '../utils/imageProcessing';
import { useI18n } from '../contexts/I18nContext';
import { useAspectRatio } from '../contexts/AspectRatioContext';
import { useElectronPhotoImport } from '../hooks/useElectronPhotoImport';
import { parseDragPayload, DRAG_PAYLOAD_MIME } from '../utils/dragPayload';
import { dispatchSlotDrop } from '../utils/slotDropDispatch';

interface GridSizedDropZoneProps {
  onFilesDropped: (files: File[]) => void;
  setName: string;
  maxPhotos: number;
  loading?: boolean;
  error?: string | null;
  /**
   * Which set this empty drop zone fills. Required to recognise a cross-set
   * slot drag (a slot photo from the *other* set) so we can route it to the
   * rejection hint instead of silently swallowing it. Defaults to 'set1'.
   */
  setKey?: 'set1' | 'set2';
  /**
   * Candidate-tray → set promotion. The set is empty here, so the dropped
   * candidate always lands in slot 0. Mirrors `PhotoGridApi`'s prop of the
   * same name so an empty set accepts tray drops just like a populated grid.
   */
  onCandidateDropped?: (candidateId: string) => void;
  /** A slot photo from the other set was dropped here (v1 doesn't support cross-set). */
  onCrossSetDropRejected?: () => void;
}

export const GridSizedDropZone: React.FC<GridSizedDropZoneProps> = ({
  onFilesDropped,
  setName,
  maxPhotos,
  loading = false,
  error = null,
  setKey = 'set1',
  onCandidateDropped,
  onCrossSetDropRejected
}) => {
  const { t } = useI18n();
  const { currentRatio } = useAspectRatio();

  const electronImport = useElectronPhotoImport();
  const useElectronDialog = electronImport.isAvailable;
  const isBusy = loading || electronImport.isImporting;

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject
  } = useDropzone({
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png']
    },
    maxFiles: maxPhotos,
    maxSize: 20 * 1024 * 1024, // 20MB
    disabled: isBusy,
    noClick: useElectronDialog,
    onDrop: (acceptedFiles, rejectedFiles) => {
      // Filter valid files
      const validFiles = acceptedFiles.filter(isValidImageFile);

      if (validFiles.length > 0) {
        onFilesDropped(validFiles);
      }

      // Log rejected files for debugging
      if (rejectedFiles.length > 0) {
        rejectedFiles.forEach(({ file, errors }) => {
          console.warn(`Rejected file ${file.name}:`, errors);
        });
      }
    }
  });

  const handleElectronClick = async () => {
    if (isBusy) return;
    await electronImport.pickPhotos(maxPhotos, onFilesDropped);
  };

  // Internal candidate-tray drag channel. react-dropzone above owns the native
  // file-drop path (`dataTransfer.files`); here we layer the app's
  // `application/x-airq-photo` protocol on top so dropping a tray thumb onto an
  // EMPTY set works just like dropping onto a populated `PhotoGridApi` grid.
  // Same compose-through-getRootProps pattern as `CandidateTray` — our handlers
  // only act when the internal MIME is present, leaving file drops to dropzone.
  const [dropActive, setDropActive] = useState(false);

  const handleInternalDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_PAYLOAD_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropActive(true);
  };

  const handleInternalDragLeave = () => setDropActive(false);

  const handleInternalDrop = (e: React.DragEvent) => {
    setDropActive(false);
    // No internal payload → native file drop; let react-dropzone's composed
    // onDrop handle it (don't preventDefault here, or we'd suppress it).
    if (!e.dataTransfer.types.includes(DRAG_PAYLOAD_MIME)) return;
    e.preventDefault();

    // Reuse the same unit-tested dispatch the grid uses. The set is empty, so
    // the only meaningful outcomes are `promote` (tray photo → slot 0) and
    // `cross-set-rejected` (a slot photo dragged from the other set).
    const action = dispatchSlotDrop({
      payload: parseDragPayload(e.dataTransfer.getData(DRAG_PAYLOAD_MIME)),
      textPlain: e.dataTransfer.getData('text/plain'),
      files: [],
      dropIndex: 0,
      setKey,
      isValidImageFile,
    });

    if (action.kind === 'promote') {
      if (onCandidateDropped) onCandidateDropped(action.photoId);
    } else if (action.kind === 'cross-set-rejected') {
      if (onCrossSetDropRejected) onCrossSetDropRejected();
    }
  };

  // Determine styling based on state
  const getDropZoneStyles = () => {
    if (loading) {
      return {
        borderColor: 'grey.300',
        backgroundColor: 'grey.50',
        cursor: 'not-allowed',
        opacity: 0.7
      };
    }
    
    if (isDragReject) {
      return {
        borderColor: 'error.main',
        backgroundColor: 'error.light',
        color: 'error.dark'
      };
    }
    
    if (isDragAccept) {
      return {
        borderColor: 'success.main',
        backgroundColor: 'success.light',
        color: 'success.dark'
      };
    }
    
    // `dropActive` = a candidate-tray thumb is being dragged over (internal
    // payload, which react-dropzone's `isDragActive` doesn't pick up). Show the
    // same active glow so the empty set reads as a valid drop target.
    if (isDragActive || dropActive) {
      return {
        borderColor: 'primary.main',
        backgroundColor: 'primary.light',
        color: 'primary.dark'
      };
    }

    return {
      borderColor: 'grey.400',
      backgroundColor: 'grey.50',
      cursor: 'pointer',
      '&:hover': {
        borderColor: 'primary.main',
        backgroundColor: 'primary.light'
      }
    };
  };

  const getStatusText = () => {
    if (loading) {
      return t('upload.processing');
    }
    
    if (isDragReject) {
      return t('upload.invalidFileType');
    }
    
    if (isDragAccept) {
      const photoText = maxPhotos > 1 ? t('upload.photos') : t('upload.photo');
      return t('upload.dropPhotosHere', { count: maxPhotos, photoText });
    }
    
    if (isDragActive || dropActive) {
      return t('upload.dropImages');
    }

    return t('upload.clickOrDrop');
  };

  const getSubText = () => {
    if (loading || isDragActive || dropActive) {
      return null;
    }
    
    const slotText = maxPhotos !== 1 ? t('upload.slots') : t('upload.slot');
    const slotsAvailable = t('upload.slotsAvailable', { count: maxPhotos, slotText });
    return t('upload.supported', { maxSize: 20 }) + ` • ${slotsAvailable}`;
  };

  // Calculate grid cell aspect ratio based on current ratio
  const aspectRatio = currentRatio.ratio;

  return (
    <Box sx={{ p: 2 }}>
      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Electron-import error: dialog failed, partial read failure, or
          working-folder persistence failure. */}
      {electronImport.importError && (
        <Alert
          severity="warning"
          sx={{ mb: 2, cursor: 'pointer' }}
          onClose={electronImport.clearImportError}
        >
          {electronImport.importError}
        </Alert>
      )}

      {/* Grid-Sized Drop Zone */}
      <Paper
        {...getRootProps({
          onClick: useElectronDialog ? handleElectronClick : undefined,
          // Chain our internal tray-drop handlers through react-dropzone so the
          // native file-drop path stays intact (composeEventHandlers runs both).
          onDragOver: handleInternalDragOver,
          onDragLeave: handleInternalDragLeave,
          onDrop: handleInternalDrop,
        })}
        elevation={isDragActive ? 4 : 1}
        sx={{
          width: '100%',
          border: 2,
          borderStyle: 'dashed',
          borderRadius: 2,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 2,
          aspectRatio: `${3 * aspectRatio} / 3`, // 3 columns by 3 rows with current aspect ratio
          textAlign: 'center',
          justifyContent: 'center',
          alignItems: 'center',
          transition: 'all 0.2s ease-in-out',
          position: 'relative',
          ...getDropZoneStyles()
        }}
      >
        <input {...getInputProps()} />
        
        {/* Content spans all grid cells */}
        <Box sx={{ 
          gridColumn: '1 / -1',
          gridRow: '1 / -1',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          p: 2
        }}>
          {/* Upload Icon */}
          <Box sx={{ mb: 2 }}>
            {loading ? (
              <CircularProgress size={48} color="primary" />
            ) : (
              <>
                {isDragReject ? (
                  <ErrorIcon sx={{ fontSize: 48, color: 'error.main' }} />
                ) : isDragAccept ? (
                  <CheckCircle sx={{ fontSize: 48, color: 'success.main' }} />
                ) : (
                  <CloudUpload sx={{ fontSize: 48, color: 'text.secondary' }} />
                )}
              </>
            )}
          </Box>

          {/* Status Text */}
          <Typography 
            variant="h6" 
            component="p" 
            sx={{ 
              mb: 1,
              fontWeight: 500,
              color: isDragReject ? 'error.main' : isDragAccept ? 'success.main' : 'text.primary'
            }}
          >
            {getStatusText()}
          </Typography>

          {/* Subtext */}
          {getSubText() && (
            <Typography variant="body2" color="text.secondary">
              {getSubText()}
            </Typography>
          )}
        </Box>
      </Paper>
    </Box>
  );
};

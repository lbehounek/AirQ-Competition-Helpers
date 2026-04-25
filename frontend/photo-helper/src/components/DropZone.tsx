import React from 'react';
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
import { isElectronPhotoImportAvailable, openPhotosViaElectron } from '../utils/electronPhotoImport';

interface DropZoneProps {
  onFilesDropped: (files: File[]) => void;
  setName: string;
  currentPhotoCount: number;
  maxPhotos: number;
  loading?: boolean;
  error?: string | null;
}

export const DropZone: React.FC<DropZoneProps> = ({
  onFilesDropped,
  setName,
  currentPhotoCount,
  maxPhotos,
  loading = false,
  error = null
}) => {
  const availableSlots = Math.max(0, maxPhotos - currentPhotoCount);
  const isDisabled = loading || availableSlots === 0;
  const { t } = useI18n();
  // In the desktop bundle we route the click to Electron's `dialog.
  // showOpenDialog` so the file picker opens in the competition's
  // working folder. Drag-and-drop still uses react-dropzone's native
  // handlers — only the click path differs (feedback 2026-04-25).
  const useElectronDialog = isElectronPhotoImportAvailable();

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
    maxFiles: availableSlots,
    maxSize: 20 * 1024 * 1024, // 20MB
    disabled: isDisabled,
    // `noClick` disables react-dropzone's auto-trigger of the hidden
    // `<input type=file>` on click — we provide our own click handler
    // below that calls Electron's native dialog instead.
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
    if (isDisabled) return;
    try {
      const files = await openPhotosViaElectron(availableSlots);
      const validFiles = files.filter(isValidImageFile);
      if (validFiles.length > 0) onFilesDropped(validFiles);
    } catch (err) {
      console.error('[photo import] Electron dialog failed:', err);
    }
  };

  // Determine styling based on state
  const getDropZoneStyles = () => {
    if (isDisabled) {
      return {
        borderColor: 'grey.300',
        backgroundColor: 'grey.50',
        cursor: 'not-allowed',
        opacity: 0.5
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
    
    if (isDragActive) {
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
    
    if (availableSlots === 0) {
      return t('upload.setFull', { setName, current: currentPhotoCount, max: maxPhotos });
    }
    
    if (isDragReject) {
      return t('upload.invalidFileType');
    }
    
    if (isDragAccept) {
      const photoText = availableSlots > 1 ? t('upload.photos') : t('upload.photo');
      return t('upload.dropPhotosHere', { count: availableSlots, photoText });
    }
    
    if (isDragActive) {
      return t('upload.dropImages');
    }
    
    return t('upload.clickOrDrop');
  };

  const getSubText = () => {
    if (loading || availableSlots === 0 || isDragActive) {
      return null;
    }
    
    const slotText = availableSlots !== 1 ? t('upload.slots') : t('upload.slot');
    const slotsAvailable = t('upload.slotsAvailable', { count: availableSlots, slotText });
    return t('upload.supported', { maxSize: 20 }) + ` • ${slotsAvailable}`;
  };

  return (
    <Box sx={{ width: '100%' }}>
      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Drop Zone */}
      <Paper
        {...getRootProps({ onClick: useElectronDialog ? handleElectronClick : undefined })}
        elevation={isDragActive ? 4 : 1}
        sx={{
          border: 2,
          borderStyle: 'dashed',
          borderRadius: 2,
          p: 4,
          textAlign: 'center',
          minHeight: 200,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          transition: 'all 0.2s ease-in-out',
          ...getDropZoneStyles()
        }}
      >
        <input {...getInputProps()} />
        
        {/* Upload Icon */}
        <Box sx={{ mb: 3 }}>
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
      </Paper>


    </Box>
  );
};

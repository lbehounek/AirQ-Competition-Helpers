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
import { useAspectRatio } from '../contexts/AspectRatioContext';

interface GridSizedDropZoneProps {
  onFilesDropped: (files: File[]) => void;
  setName: string;
  maxPhotos: number;
  loading?: boolean;
  error?: string | null;
}

export const GridSizedDropZone: React.FC<GridSizedDropZoneProps> = ({
  onFilesDropped,
  setName,
  maxPhotos,
  loading = false,
  error = null
}) => {
  const { t } = useI18n();
  const { currentRatio } = useAspectRatio();

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
    disabled: loading,
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
    
    if (isDragReject) {
      return t('upload.invalidFileType');
    }
    
    if (isDragAccept) {
      const photoText = maxPhotos > 1 ? t('upload.photos') : t('upload.photo');
      return t('upload.dropPhotosHere', { count: maxPhotos, photoText });
    }
    
    if (isDragActive) {
      return t('upload.dropImages');
    }
    
    return t('upload.clickOrDrop');
  };

  const getSubText = () => {
    if (loading || isDragActive) {
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

      {/* Grid-Sized Drop Zone */}
      <Paper
        {...getRootProps()}
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

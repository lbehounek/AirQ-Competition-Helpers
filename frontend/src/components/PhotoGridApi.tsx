import React from 'react';
import { Box, Typography, Paper, CircularProgress } from '@mui/material';
import { Image as ImageIcon, CloudUpload } from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import { PhotoEditorApi } from './PhotoEditorApi';
import { isValidImageFile } from '../utils/imageProcessing';
import { useAspectRatio } from '../contexts/AspectRatioContext';

interface ApiPhoto {
  id: string;
  url: string;
  filename: string;
  canvasState: {
    position: { x: number; y: number };
    scale: number;
    brightness: number;
    contrast: number;
    sharpness: number;
    whiteBalance: {
      temperature: number;
      tint: number;
      auto: boolean;
    };
    labelPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  label: string;
}

interface ApiPhotoSet {
  title: string;
  photos: ApiPhoto[];
}

interface PhotoGridApiProps {
  photoSet: ApiPhotoSet;
  setKey: 'set1' | 'set2';
  onPhotoUpdate: (photoId: string, canvasState: any) => void;
  onPhotoRemove: (photoId: string) => void;
  onPhotoClick?: (photo: ApiPhoto) => void;
  onFilesDropped?: (files: File[]) => void; // For uploading files to empty slots
  labelOffset?: number; // Offset for label sequence (e.g., set2 continues from where set1 left off)
}

interface GridSlot {
  id: string;
  index: number;
  label: string;
  photo: ApiPhoto | null;
}

interface PhotoGridSlotEmptyProps {
  label: string;
  position: number;
  onFilesDropped?: (files: File[]) => void;
}

export const PhotoGridApi: React.FC<PhotoGridApiProps> = ({
  photoSet,
  setKey,
  onPhotoUpdate,
  onPhotoRemove,
  onPhotoClick,
  onFilesDropped,
  labelOffset = 0
}) => {
  const { currentRatio, isTransitioning } = useAspectRatio();
  // Create 9 grid slots (3x3)
  const gridSlots: GridSlot[] = Array.from({ length: 9 }, (_, index) => {
    const label = String.fromCharCode(65 + labelOffset + index); // A, B, C, ... or continue from previous set
    const photo = photoSet.photos[index] || null;
    
    return {
      id: `${setKey}-slot-${index}`,
      index,
      label,
      photo
    };
  });

  return (
    <Box sx={{ width: '100%', position: 'relative' }}>
      {isTransitioning ? (
        /* Loading State During Aspect Ratio Transition */
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
          bgcolor: 'background.paper',
          borderRadius: 2,
          border: '2px solid',
          borderColor: 'primary.light',
          boxShadow: 1,
          p: 4
        }}>
          <CircularProgress size={48} color="primary" sx={{ mb: 2 }} />
          <Typography variant="body1" color="text.secondary">
            Updating aspect ratio...
          </Typography>
        </Box>
      ) : (
        /* 3x3 Photo Grid */
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 2,
          p: 2,
          bgcolor: 'background.paper',
          borderRadius: 2,
          border: '2px solid',
          borderColor: 'primary.light',
          boxShadow: 1
        }}>
        {gridSlots.map((slot) => (
          <Paper
            key={slot.id}
            elevation={slot.photo ? 2 : 0}
            sx={{
              aspectRatio: currentRatio.cssRatio,
              bgcolor: slot.photo ? 'background.paper' : 'grey.50',
              border: '1px solid',
              borderColor: slot.photo ? 'primary.main' : 'grey.300',
              borderRadius: 0, // Rectangular to match PDF output
              overflow: 'hidden',
              position: 'relative',
              transition: 'all 0.2s ease-in-out',
              cursor: slot.photo ? 'pointer' : 'default',
              '&:hover': slot.photo ? {
                borderColor: 'primary.main',
                boxShadow: '0 0 12px rgba(33, 150, 243, 0.4)', // Blue glow effect
                // Remove transform to prevent movement
              } : {}
            }}
          >
            {slot.photo ? (
              <Box
                onClick={() => onPhotoClick && onPhotoClick(slot.photo!)}
                sx={{ 
                  cursor: 'pointer', 
                  width: '100%', 
                  height: '100%',
                  position: 'relative',
                  '&:hover .hover-overlay': {
                    opacity: 1
                  }
                }}
              >
                <PhotoEditorApi
                  photo={slot.photo}
                  label={slot.label}
                  onUpdate={(canvasState) => onPhotoUpdate(slot.photo!.id, canvasState)}
                  onRemove={() => onPhotoRemove(slot.photo!.id)}
                  size="grid" // Small size for grid view
                  setKey={setKey} // Pass setKey for PDF generation
                  setName={photoSet.title}
                  isFirstInSet={slot.index === 0} // First photo gets set name
                />
                {/* Hover overlay */}
                <Box
                  className="hover-overlay"
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    bgcolor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0,
                    transition: 'opacity 0.2s ease-in-out',
                    pointerEvents: 'none'
                  }}
                >
                  <Typography 
                    variant="body1" 
                    sx={{ 
                      color: 'white', 
                      fontWeight: 600,
                      textShadow: '0 2px 4px rgba(0,0,0,0.8)'
                    }}
                  >
                    Click to Edit
                  </Typography>
                </Box>
              </Box>
            ) : (
              <PhotoGridSlotEmpty
                label={slot.label}
                position={slot.index + 1}
                onFilesDropped={onFilesDropped}
              />
            )}
          </Paper>
        ))}
        </Box>
      )}
    </Box>
  );
};

const PhotoGridSlotEmpty: React.FC<PhotoGridSlotEmptyProps> = ({
  label,
  position,
  onFilesDropped
}) => {
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
    maxFiles: 9, // Allow multiple files for easier bulk upload
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0 && onFilesDropped) {
        const validFiles = acceptedFiles.filter(file => isValidImageFile(file));
        if (validFiles.length > 0) {
          onFilesDropped(validFiles);
        }
      }
    },
    noClick: false,
    noKeyboard: false
  });

  const getBorderColor = () => {
    if (isDragAccept) return 'success.main';
    if (isDragReject) return 'error.main';
    if (isDragActive) return 'primary.main';
    return 'grey.300';
  };

  const getBackgroundColor = () => {
    if (isDragAccept) return 'success.light';
    if (isDragReject) return 'error.light';
    if (isDragActive) return 'primary.light';
    return 'grey.100';
  };

  return (
    <Box 
      {...getRootProps()}
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: getBackgroundColor(),
        color: 'grey.500',
        border: `2px dashed`,
        borderColor: getBorderColor(),
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          bgcolor: isDragActive ? getBackgroundColor() : 'grey.200',
          borderColor: isDragActive ? getBorderColor() : 'primary.main',
          color: 'grey.600'
        }
      }}
    >
      <input {...getInputProps()} />
      
      {/* Position indicator */}
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5, color: 'grey.400' }}>
        {label}
      </Typography>

      {isDragActive ? (
        <>
          <CloudUpload sx={{ fontSize: 32, color: isDragAccept ? 'success.main' : 'primary.main', mb: 1 }} />
          <Typography variant="body2" sx={{ textAlign: 'center', px: 1, fontWeight: 500 }}>
            {isDragAccept ? 'Drop photos here' : 'Invalid file type'}
          </Typography>
        </>
      ) : (
        <>
          {/* Position text */}
          <Typography variant="caption" sx={{ textAlign: 'center', px: 1, color: 'grey.500', mb: 0.5 }}>
            Position {position}
          </Typography>

          {/* Placeholder icon */}
          <ImageIcon sx={{ fontSize: 24, color: 'grey.400', opacity: 0.7, mb: 0.5 }} />
          
          {/* Upload hint */}
          <Typography variant="caption" sx={{ textAlign: 'center', px: 1, color: 'grey.500' }}>
            Click or drag photos
          </Typography>
        </>
      )}
    </Box>
  );
};

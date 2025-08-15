import React, { useState } from 'react';
import { Box, Typography, Paper, CircularProgress, IconButton } from '@mui/material';
import { Image as ImageIcon, CloudUpload, Close } from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import { PhotoEditorApi } from './PhotoEditorApi';
import { isValidImageFile } from '../utils/imageProcessing';
import { useAspectRatio } from '../contexts/AspectRatioContext';
import { useLabeling } from '../contexts/LabelingContext';

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
  onPhotoMove?: (fromIndex: number, toIndex: number) => void; // For drag-and-drop reordering
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
  onPhotoMove,
  labelOffset = 0
}) => {
  const { currentRatio, isTransitioning } = useAspectRatio();
  const { generateLabel } = useLabeling();
  
  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  // Create 9 grid slots (3x3)
  const gridSlots: GridSlot[] = Array.from({ length: 9 }, (_, index) => {
    const label = generateLabel(index, labelOffset); // Use dynamic labeling (letters or numbers) with dot
    const photo = photoSet.photos[index] || null;
    
    return {
      id: `${setKey}-slot-${index}`,
      index,
      label,
      photo
    };
  });

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    
    // Create custom drag image (optional - use default for now)
    (e.currentTarget as HTMLElement).style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedIndex(null);
    setDragOverIndex(null);
    (e.currentTarget as HTMLElement).style.opacity = '1';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
    
    if (dragIndex !== dropIndex && onPhotoMove) {
      onPhotoMove(dragIndex, dropIndex);
    }
    
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

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
        {gridSlots.map((slot) => {
          const isDragOver = dragOverIndex === slot.index;
          const isDragging = draggedIndex === slot.index;
          
          return <Paper
              key={slot.id}
              elevation={slot.photo ? 2 : 0}
              draggable={slot.photo ? true : false}
              onDragStart={slot.photo ? (e) => handleDragStart(e, slot.index) : undefined}
              onDragEnd={slot.photo ? handleDragEnd : undefined}
              onDragOver={(e) => handleDragOver(e, slot.index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, slot.index)}
              sx={{
                aspectRatio: currentRatio.cssRatio,
                bgcolor: slot.photo ? 'background.paper' : 'grey.50',
                border: '2px solid',
                borderColor: isDragOver 
                  ? 'success.main' // Green border when drag over
                  : slot.photo 
                    ? 'primary.main' 
                    : 'grey.300',
                borderRadius: 0, // Rectangular to match PDF output
                overflow: 'hidden',
                position: 'relative',
                transition: 'all 0.2s ease-in-out',
                cursor: slot.photo ? 'grab' : 'default',
                opacity: isDragging ? 0.5 : 1,
                transform: isDragOver ? 'scale(1.02)' : 'scale(1)',
                boxShadow: isDragOver 
                  ? '0 0 20px rgba(76, 175, 80, 0.6)' // Green glow when drag over
                  : slot.photo 
                    ? '0 0 12px rgba(33, 150, 243, 0.4)' // Blue glow for photos
                    : 'none',
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
                  {/* Delete button - top right corner, visible only on hover */}
                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent triggering photo click
                      onPhotoRemove(slot.photo!.id);
                    }}
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 36,
                      height: 36,
                      bgcolor: 'rgba(128, 128, 128, 0.9)', // Grayscale background
                      color: 'white',
                      borderRadius: '6px', // Square with slight rounding
                      pointerEvents: 'auto', // Enable clicking
                      transition: 'all 0.2s ease-in-out',
                      '&:hover': {
                        bgcolor: 'rgba(128, 128, 128, 1)',
                        boxShadow: '0 0 12px rgba(255, 255, 255, 0.8)', // White glow effect
                        transform: 'scale(1.1)'
                      }
                    }}
                    size="medium"
                  >
                    <Close sx={{ fontSize: 22 }} />
                  </IconButton>
                  
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
          </Paper>;
        })}
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
    onDrop: (acceptedFiles, rejectedFiles) => {
      console.log('Drop event - Accepted:', acceptedFiles, 'Rejected:', rejectedFiles);
      
      if (acceptedFiles.length > 0 && onFilesDropped) {
        // Filter out valid files
        const validFiles = acceptedFiles.filter(file => isValidImageFile(file));
        if (validFiles.length > 0) {
          onFilesDropped(validFiles);
        }
      }
    }
  });

  // Determine border color based on drag state
  const borderColor = isDragActive 
    ? (isDragAccept ? 'success.main' : (isDragReject ? 'error.main' : 'primary.main'))
    : 'grey.300';
  
  const bgColor = isDragActive 
    ? (isDragAccept ? 'success.50' : (isDragReject ? 'error.50' : 'primary.50'))
    : 'grey.50';

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
        bgcolor: bgColor,
        color: isDragActive ? (isDragAccept ? 'success.main' : (isDragReject ? 'error.main' : 'primary.main')) : 'grey.500',
        border: '2px dashed',
        borderColor,
        borderRadius: 1,
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          bgcolor: 'primary.50',
          borderColor: 'primary.main',
          color: 'primary.main'
        }
      }}
    >
      <input {...getInputProps()} />
      
      {isDragActive ? (
        <>
          <CloudUpload sx={{ fontSize: 32, mb: 1, opacity: 0.7 }} />
          <Typography variant="body2" sx={{ fontWeight: 500, textAlign: 'center', px: 1 }}>
            {isDragAccept ? 'Drop images here' : 'Invalid file type'}
          </Typography>
        </>
      ) : (
        <>
          <ImageIcon sx={{ fontSize: 28, mb: 1, opacity: 0.5 }} />
          <Typography 
            variant="h6" 
            sx={{ 
              fontWeight: 700, 
              fontSize: '1.1rem',
              color: 'text.secondary',
              mb: 0.5
            }}
          >
            {label}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.7, textAlign: 'center', px: 1 }}>
            Click or drop images
          </Typography>
        </>
      )}
    </Box>
  );
};

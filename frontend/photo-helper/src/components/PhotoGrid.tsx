import React, { useState } from 'react';
import { Box, Typography, Paper, CircularProgress, IconButton } from '@mui/material';
import { Image as ImageIcon, Close } from '@mui/icons-material';
import type { PhotoSet } from '../types';
import { PhotoEditor } from './PhotoEditor';
import { useAspectRatio } from '../contexts/AspectRatioContext';
import { useLabeling } from '../contexts/LabelingContext';
import { useLayoutMode } from '../contexts/LayoutModeContext';

interface PhotoGridProps {
  photoSet: PhotoSet;
  setKey: 'set1' | 'set2';
  onPhotoUpdate: (photoId: string, canvasState: any) => void;
  onPhotoRemove: (photoId: string) => void;
  onPhotoClick?: (photo: any) => void;
  onPhotoMove?: (fromIndex: number, toIndex: number) => void; // For drag-and-drop reordering
}

export const PhotoGrid: React.FC<PhotoGridProps> = ({
  photoSet,
  setKey,
  onPhotoUpdate,
  onPhotoRemove,
  onPhotoClick,
  onPhotoMove
}) => {
  const { currentRatio, isTransitioning } = useAspectRatio();
  const { generateLabel } = useLabeling();
  
  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  // Import layout mode
  const { layoutConfig } = useLayoutMode();
  
  // Create array of slots based on layout mode (9 for landscape, 10 for portrait)
  const gridSlots = Array.from({ length: layoutConfig.slots }, (_, index) => {
    const photo = photoSet.photos[index] || null;
    const label = generateLabel(index); // Use dynamic labeling (letters or numbers) with dot
    
    return {
      index,
      photo,
      label,
      id: `${setKey}-slot-${index}`
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
        /* Dynamic Photo Grid (3x3 or 2x5 based on layout) */
        <Box sx={{ 
          display: 'grid', 
          gridTemplateColumns: `repeat(${layoutConfig.columns}, 1fr)`,
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
          
          return (
            <Paper
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
                borderRadius: 1.5,
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
                  borderColor: 'primary.dark',
                  boxShadow: 3,
                  transform: 'translateY(-2px)'
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
                  '&:hover .hover-overlay': { opacity: 1 }
                }}
              >
                <PhotoEditor
                  photo={slot.photo}
                  label={slot.label}
                  onUpdate={(canvasState) => onPhotoUpdate(slot.photo!.id, canvasState)}
                  onRemove={() => onPhotoRemove(slot.photo!.id)}
                  size="grid" // Small size for grid view
                />
                
                {/* Hover overlay with delete button */}
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
              />
            )}
          </Paper>
          );
        })}
        </Box>
      )}
    </Box>
  );
};

/**
 * Empty slot component for the grid
 */
interface PhotoGridSlotEmptyProps {
  label: string;
  position: number;
}

const PhotoGridSlotEmpty: React.FC<PhotoGridSlotEmptyProps> = ({ 
  label, 
  position 
}) => {
  return (
    <Box sx={{ 
      width: '100%', 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      bgcolor: 'grey.100',
      color: 'grey.500'
    }}>
      {/* Position indicator */}
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5, color: 'grey.400' }}>
        {label}
      </Typography>
      
      {/* Position text */}
      <Typography variant="caption" sx={{ textAlign: 'center', px: 1, color: 'grey.500' }}>
        Position {position}
      </Typography>
      
      {/* Placeholder icon */}
      <ImageIcon sx={{ mt: 1, fontSize: 24, color: 'grey.400', opacity: 0.7 }} />
    </Box>
  );
};

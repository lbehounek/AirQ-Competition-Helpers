import React from 'react';
import { Box, Typography, Grid, Paper, Chip, CircularProgress, IconButton } from '@mui/material';
import { Image as ImageIcon, PhotoCamera, Close } from '@mui/icons-material';
import type { PhotoSet } from '../types';
import { PhotoEditor } from './PhotoEditor';
import { useAspectRatio } from '../contexts/AspectRatioContext';
import { useLabeling } from '../contexts/LabelingContext';

interface PhotoGridProps {
  photoSet: PhotoSet;
  setKey: 'set1' | 'set2';
  onPhotoUpdate: (photoId: string, canvasState: any) => void;
  onPhotoRemove: (photoId: string) => void;
  onPhotoClick?: (photo: any) => void;
}

export const PhotoGrid: React.FC<PhotoGridProps> = ({
  photoSet,
  setKey,
  onPhotoUpdate,
  onPhotoRemove,
  onPhotoClick
}) => {
  const { currentRatio, isTransitioning } = useAspectRatio();
  const { generateLabel } = useLabeling();
  
  // Create array of 9 slots (3x3 grid)
  const gridSlots = Array.from({ length: 9 }, (_, index) => {
    const photo = photoSet.photos[index] || null;
    const label = generateLabel(index); // Use dynamic labeling (letters or numbers) with dot
    
    return {
      index,
      photo,
      label,
      id: `${setKey}-slot-${index}`
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
              borderRadius: 1.5,
              overflow: 'hidden',
              position: 'relative',
              transition: 'all 0.2s ease-in-out',
              cursor: slot.photo ? 'pointer' : 'default',
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
                sx={{ cursor: 'pointer', width: '100%', height: '100%', position: 'relative' }}
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
                    pointerEvents: 'none',
                    '&:hover': {
                      opacity: 1
                    }
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
                      width: 28,
                      height: 28,
                      bgcolor: 'rgba(128, 128, 128, 0.9)', // Grayscale background
                      color: 'white',
                      borderRadius: '4px', // Square with slight rounding
                      pointerEvents: 'auto', // Enable clicking
                      transition: 'all 0.2s ease-in-out',
                      '&:hover': {
                        bgcolor: 'rgba(128, 128, 128, 1)',
                        boxShadow: '0 0 12px rgba(255, 255, 255, 0.8)', // White glow effect
                        transform: 'scale(1.1)'
                      }
                    }}
                    size="small"
                  >
                    <Close sx={{ fontSize: 18 }} />
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
        ))}
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

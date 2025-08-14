import React from 'react';
import { Box, Typography, Grid, Paper, Chip } from '@mui/material';
import { Image as ImageIcon, PhotoCamera } from '@mui/icons-material';
import type { PhotoSet } from '../types';
import { PhotoEditor } from './PhotoEditor';
import { useAspectRatio } from '../contexts/AspectRatioContext';

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
  const { currentRatio } = useAspectRatio();
  // Create array of 9 slots (3x3 grid)
  const gridSlots = Array.from({ length: 9 }, (_, index) => {
    const photo = photoSet.photos[index] || null;
    const label = String.fromCharCode(65 + index); // A, B, C, etc.
    
    return {
      index,
      photo,
      label,
      id: `${setKey}-slot-${index}`
    };
  });

  return (
    <Box sx={{ width: '100%' }}>
      {/* 3x3 Photo Grid */}
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
                sx={{ cursor: 'pointer', width: '100%', height: '100%' }}
              >
                <PhotoEditor
                  photo={slot.photo}
                  label={slot.label}
                  onUpdate={(canvasState) => onPhotoUpdate(slot.photo!.id, canvasState)}
                  onRemove={() => onPhotoRemove(slot.photo!.id)}
                  size="grid" // Small size for grid view
                />
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

import React from 'react';
import { Box, Typography, Paper, Chip } from '@mui/material';
import { Image as ImageIcon, PhotoCamera } from '@mui/icons-material';
import { PhotoEditorApi } from './PhotoEditorApi';

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
}

export const PhotoGridApi: React.FC<PhotoGridApiProps> = ({
  photoSet,
  setKey,
  onPhotoUpdate,
  onPhotoRemove,
  onPhotoClick
}) => {
  // Create 9 grid slots (3x3)
  const gridSlots: GridSlot[] = Array.from({ length: 9 }, (_, index) => {
    const label = String.fromCharCode(65 + index); // A, B, C, ..., I
    const photo = photoSet.photos[index] || null;
    
    return {
      id: `${setKey}-slot-${index}`,
      index,
      label,
      photo
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
              aspectRatio: '4/3',
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
              />
            )}
          </Paper>
        ))}
      </Box>
      
      {/* Grid Stats */}
      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center', gap: 2 }}>
        <Chip
          icon={<PhotoCamera />}
          label={`Photos: ${photoSet.photos.length}/9`}
          color="primary"
          variant="outlined"
          size="small"
        />
        <Chip
          icon={<ImageIcon />}
          label={`Available: ${9 - photoSet.photos.length}`}
          color="default"
          variant="outlined"
          size="small"
        />
      </Box>
    </Box>
  );
};

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

import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip
} from '@mui/material';
import { AspectRatio, CameraAlt, PhotoCamera, Tv } from '@mui/icons-material';
import { useAspectRatio, ASPECT_RATIO_OPTIONS } from '../contexts/AspectRatioContext';

const getFormatIcon = (id: string) => {
  switch (id) {
    case '4:3':
      return <CameraAlt />;
    case '3:2':
      return <PhotoCamera />;
    case '16:9':
      return <Tv />;
    default:
      return <AspectRatio />;
  }
};

export const AspectRatioSelector: React.FC = () => {
  const { currentRatio, setAspectRatio } = useAspectRatio();

  const handleCardClick = (option: typeof ASPECT_RATIO_OPTIONS[0]) => {
    setAspectRatio(option);
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
      {ASPECT_RATIO_OPTIONS.map((option) => {
        const isSelected = currentRatio.id === option.id;
        
        return (
          <Card
            key={option.id}
            onClick={() => handleCardClick(option)}
            sx={{
              minWidth: 140,
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              border: 2,
              borderColor: isSelected ? 'primary.main' : 'grey.300',
              backgroundColor: isSelected ? 'primary.50' : 'background.paper',
              transform: isSelected ? 'scale(1.02)' : 'scale(1)',
              boxShadow: isSelected ? 4 : 1,
              '&:hover': {
                borderColor: isSelected ? 'primary.main' : 'primary.light',
                backgroundColor: isSelected ? 'primary.50' : 'primary.25',
                transform: 'scale(1.02)',
                boxShadow: 3
              }
            }}
          >
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                mb: 1,
                color: isSelected ? 'primary.main' : 'text.secondary'
              }}>
                {getFormatIcon(option.id)}
              </Box>
              
              <Typography 
                variant="h6" 
                component="div" 
                sx={{ 
                  fontWeight: 600,
                  color: isSelected ? 'primary.main' : 'text.primary',
                  mb: 0.5
                }}
              >
                {option.name}
              </Typography>
              
              <Typography 
                variant="body2" 
                color="text.secondary"
                sx={{ mb: 1, fontSize: '0.75rem' }}
              >
                {option.description}
              </Typography>
              
              {isSelected && (
                <Chip 
                  label="Selected" 
                  size="small" 
                  color="primary"
                  sx={{ fontSize: '0.7rem', height: 20 }}
                />
              )}
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
};

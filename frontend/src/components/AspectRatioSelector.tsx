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
import { useI18n } from '../contexts/I18nContext';

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
  const { t } = useI18n();

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
              minWidth: 120,
              maxWidth: 140,
              height: 70, // Even shorter cards
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
            <CardContent sx={{ textAlign: 'center', py: 1, px: 1 }}>
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                mb: 0.25,
                color: isSelected ? 'primary.main' : 'text.secondary'
              }}>
                {getFormatIcon(option.id)}
              </Box>
              
              <Typography 
                variant="subtitle2" 
                component="div" 
                sx={{ 
                  fontWeight: 600,
                  color: isSelected ? 'primary.main' : 'text.primary',
                  mb: 0.1,
                  fontSize: '0.875rem'
                }}
              >
                {t(`photoFormat.aspectRatios.${option.id}.name`)}
              </Typography>
              
              <Typography 
                variant="caption" 
                color="text.secondary"
                sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}
              >
                {t(`photoFormat.aspectRatios.${option.id}.description`)}
              </Typography>
              
              {isSelected && (
                <Chip 
                  label={t('common.selected')} 
                  size="small" 
                  color="primary"
                  sx={{ fontSize: '0.65rem', height: 16, mt: 0.25 }}
                />
              )}
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
};

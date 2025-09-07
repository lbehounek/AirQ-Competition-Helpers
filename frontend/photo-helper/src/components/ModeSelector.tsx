import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  ButtonGroup,
  Button
} from '@mui/material';
import { Route, TurnRight } from '@mui/icons-material';
import { useI18n } from '../contexts/I18nContext';

interface ModeSelectorProps {
  currentMode: 'track' | 'turningpoint';
  onModeChange: (mode: 'track' | 'turningpoint') => void;
  compact?: boolean;
}

const MODE_OPTIONS = [
  {
    id: 'track' as const,
    icon: <Route />,
    nameKey: 'mode.track.name',
    descriptionKey: 'mode.track.description'
  },
  {
    id: 'turningpoint' as const,
    icon: <TurnRight />,
    nameKey: 'mode.turningpoint.name',
    descriptionKey: 'mode.turningpoint.description'
  }
];

export const ModeSelector: React.FC<ModeSelectorProps> = ({ currentMode, onModeChange, compact = false }) => {
  const { t } = useI18n();

  const handleCardClick = (option: typeof MODE_OPTIONS[0]) => {
    onModeChange(option.id);
  };

  if (compact) {
    return (
      <ButtonGroup size="small" variant="outlined" sx={{ flexWrap: 'nowrap' }}>
        {MODE_OPTIONS.map((option) => (
          <Button
            key={option.id}
            onClick={() => handleCardClick(option)}
            variant={currentMode === option.id ? 'contained' : 'outlined'}
            startIcon={option.icon}
            sx={{ 
              fontSize: '0.72rem',
              px: 1.25,
              py: 0.4,
              minWidth: 'auto',
              whiteSpace: 'nowrap'
            }}
          >
            {t(option.nameKey)}
          </Button>
        ))}
      </ButtonGroup>
    );
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 2, color: 'text.primary', fontWeight: 600 }}>
        {t('mode.title')}
      </Typography>
      
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {MODE_OPTIONS.map((option) => (
          <Card
            key={option.id}
            onClick={() => handleCardClick(option)}
            sx={{
              minWidth: 200,
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              border: currentMode === option.id ? '2px solid' : '1px solid',
              borderColor: currentMode === option.id ? 'primary.main' : 'divider',
              bgcolor: currentMode === option.id ? 'primary.50' : 'background.paper',
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: 3,
                borderColor: 'primary.main'
              }
            }}
          >
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                <Box sx={{ color: currentMode === option.id ? 'primary.main' : 'text.secondary' }}>
                  {option.icon}
                </Box>
                <Typography 
                  variant="subtitle1" 
                  sx={{ 
                    fontWeight: 600,
                    color: currentMode === option.id ? 'primary.main' : 'text.primary'
                  }}
                >
                  {t(option.nameKey)}
                </Typography>
                {currentMode === option.id && (
                  <Chip 
                    label={t('common.selected')} 
                    size="small" 
                    color="primary" 
                    variant="filled"
                    sx={{ ml: 'auto' }}
                  />
                )}
              </Box>
              
              <Typography 
                variant="body2" 
                color="text.secondary"
                sx={{ lineHeight: 1.4 }}
              >
                {t(option.descriptionKey)}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
};

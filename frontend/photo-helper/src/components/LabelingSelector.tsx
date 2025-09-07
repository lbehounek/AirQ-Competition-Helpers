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
import { Pin, Looks3, FormatListNumbered } from '@mui/icons-material';
import { useLabeling, LABELING_OPTIONS } from '../contexts/LabelingContext';
import { useI18n } from '../contexts/I18nContext';

interface LabelingSelectorProps {
  compact?: boolean;
}

const getLabelingIcon = (id: string) => {
  switch (id) {
    case 'letters':
      return <Pin />;
    case 'numbers':
      return <FormatListNumbered />;
    default:
      return <Looks3 />;
  }
};

export const LabelingSelector: React.FC<LabelingSelectorProps> = ({ compact = false }) => {
  const { currentLabeling, setLabeling } = useLabeling();
  const { t } = useI18n();

  const handleCardClick = (option: typeof LABELING_OPTIONS[0]) => {
    setLabeling(option);
  };

  if (compact) {
    return (
      <ButtonGroup size="small" variant="outlined" sx={{ flexWrap: 'nowrap' }}>
        {LABELING_OPTIONS.map((option) => (
          <Button
            key={option.id}
            onClick={() => handleCardClick(option)}
            variant={currentLabeling.id === option.id ? 'contained' : 'outlined'}
            startIcon={getLabelingIcon(option.id)}
            sx={{ 
              fontSize: '0.72rem',
              px: 1.25,
              py: 0.4,
              minWidth: 'auto',
              whiteSpace: 'nowrap'
            }}
          >
            {t(`photoLabels.types.${option.id}.name`)}
          </Button>
        ))}
      </ButtonGroup>
    );
  }

  return (
    <Box role="radiogroup" sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
      {LABELING_OPTIONS.map((option) => {
        const isSelected = currentLabeling.id === option.id;
        
        return (
          <Card
            key={option.id}
            onClick={() => handleCardClick(option)}
            role="radio"
            aria-checked={isSelected}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (e.key === ' ') e.preventDefault();
                handleCardClick(option);
              }
            }}
            sx={{
              minWidth: 120,
              maxWidth: 140,
              height: 70, // Same height as aspect ratio cards
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              border: 2,
              borderColor: isSelected ? 'primary.main' : 'grey.300',
              backgroundColor: isSelected ? 'action.selected' : 'background.paper',
              transform: isSelected ? 'scale(1.02)' : 'scale(1)',
              boxShadow: isSelected ? 4 : 1,
              '&:hover': {
                borderColor: isSelected ? 'primary.main' : 'primary.light',
                backgroundColor: isSelected ? 'action.selected' : 'action.hover',
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
                {getLabelingIcon(option.id)}
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
                {t(`photoLabels.types.${option.id}.name`)}
              </Typography>
              
              <Typography 
                variant="caption" 
                color="text.secondary"
                sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}
              >
                {t(`photoLabels.types.${option.id}.description`)}
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

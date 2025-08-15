import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip
} from '@mui/material';
import { Pin, Looks3, FormatListNumbered } from '@mui/icons-material';
import { useLabeling, LABELING_OPTIONS } from '../contexts/LabelingContext';

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

export const LabelingSelector: React.FC = () => {
  const { currentLabeling, setLabeling } = useLabeling();

  const handleCardClick = (option: typeof LABELING_OPTIONS[0]) => {
    setLabeling(option);
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
      {LABELING_OPTIONS.map((option) => {
        const isSelected = currentLabeling.id === option.id;
        
        return (
          <Card
            key={option.id}
            onClick={() => handleCardClick(option)}
            sx={{
              minWidth: 120,
              maxWidth: 140,
              height: 70, // Same height as aspect ratio cards
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
                {option.name}
              </Typography>
              
              <Typography 
                variant="caption" 
                color="text.secondary"
                sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}
              >
                {option.description}
              </Typography>
              
              {isSelected && (
                <Chip 
                  label="Selected" 
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

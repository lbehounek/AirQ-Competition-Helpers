import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  ButtonGroup,
  Button,
  IconButton,
  Tooltip
} from '@mui/material';
import { Close } from '@mui/icons-material';

import { useI18n } from '../contexts/I18nContext';
import { SUPPORTED_LOCALES } from '../locales';

interface LanguageSwitcherProps {
  compact?: boolean;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ compact = false }) => {
  const { locale, setLocale, t } = useI18n();

  const handleLanguageClick = (newLocale: typeof locale) => {
    setLocale(newLocale);
  };


  if (compact) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ButtonGroup size="small" variant="outlined">
          {SUPPORTED_LOCALES.map((lang) => (
            <Button
              key={lang.code}
              onClick={() => handleLanguageClick(lang.code)}
              variant={locale === lang.code ? 'contained' : 'outlined'}
              sx={{ 
                fontSize: '0.75rem',
                px: 1.5,
                py: 0.5,
                minWidth: 'auto'
              }}
            >
              {lang.flag} {lang.code.toUpperCase()}
            </Button>
          ))}
        </ButtonGroup>
        <Tooltip title={t('app.backToMenu')} arrow>
          <IconButton
            component="a"
            href="../"
            aria-label={t('app.backToMenu')}
            size="small"
            sx={{
              color: 'white',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.1)'
              }
            }}
          >
            <Close fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Box role="radiogroup" sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
      {SUPPORTED_LOCALES.map((lang) => {
        const isSelected = locale === lang.code;
        
        return (
          <Card
            key={lang.code}
            onClick={() => handleLanguageClick(lang.code)}
            role="radio"
            aria-checked={isSelected}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (e.key === ' ') e.preventDefault();
                handleLanguageClick(lang.code);
              }
            }}
            sx={{
              minWidth: 120,
              maxWidth: 140,
              height: 70,
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
                color: isSelected ? 'primary.main' : 'text.secondary',
                fontSize: '1.5rem'
              }}>
                {lang.flag}
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
                {lang.name}
              </Typography>
              
              <Typography 
                variant="caption" 
                color="text.secondary"
                sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}
              >
                {lang.code.toUpperCase()}
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

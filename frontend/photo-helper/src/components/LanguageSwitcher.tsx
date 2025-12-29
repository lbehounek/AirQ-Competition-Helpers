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

// SVG Flag components (Windows doesn't render emoji flags)
const CzechFlag = ({ size = 20 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600" width={size} height={size * 0.67}>
    <rect width="900" height="600" fill="#d7141a"/>
    <rect width="900" height="300" fill="#fff"/>
    <path d="M 0,0 L 450,300 L 0,600 Z" fill="#11457e"/>
  </svg>
);

const USFlag = ({ size = 20 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7410 3900" width={size} height={size * 0.53}>
    <rect width="7410" height="3900" fill="#b22234"/>
    <path d="M0,450H7410m0,600H0m0,600H7410m0,600H0m0,600H7410m0,600H0" stroke="#fff" strokeWidth="300"/>
    <rect width="2964" height="2100" fill="#3c3b6e"/>
    <g fill="#fff">
      <g id="s18"><g id="s9"><g id="s5"><g id="s4">
        <path id="s" d="M247,90 317.534230,307.082039 132.873218,172.917961H361.126782L176.465770,307.082039z"/>
        <use href="#s" y="420"/><use href="#s" y="840"/><use href="#s" y="1260"/>
      </g><use href="#s" y="1680"/></g><use href="#s4" x="247" y="210"/></g>
      <use href="#s9" x="494"/></g><use href="#s18" x="988"/><use href="#s9" x="1976"/>
    </g>
  </svg>
);

const FlagIcon = ({ code, size = 20 }: { code: string; size?: number }) => {
  if (code === 'cz') return <CzechFlag size={size} />;
  if (code === 'en') return <USFlag size={size} />;
  return null;
};

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
              <FlagIcon code={lang.code} size={16} /> {lang.code.toUpperCase()}
            </Button>
          ))}
        </ButtonGroup>
        <Tooltip title={t('app.backToMenu')} arrow>
          <IconButton
            component="a"
            href={(window as any).electronAPI ? undefined : '../'}
            onClick={(window as any).electronAPI ? () => (window as any).electronAPI.goHome() : undefined}
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
                mb: 0.25
              }}>
                <FlagIcon code={lang.code} size={32} />
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

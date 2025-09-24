import React from 'react'
import { ButtonGroup, Button, Box, IconButton, Tooltip } from '@mui/material'
import { Close } from '@mui/icons-material'
import { useI18n } from '../contexts/I18nContext'
import { SUPPORTED_LOCALES } from '../locales'

export const LanguageSwitcher: React.FC = () => {
  const { locale, setLocale, t } = useI18n()
  
  const handleCloseClick = () => {
    window.location.href = '../'
  }
  
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <ButtonGroup size="small" variant="outlined">
        {SUPPORTED_LOCALES.map((lang) => (
          <Button
            key={lang.code}
            onClick={() => setLocale(lang.code as any)}
            variant={locale === lang.code ? 'contained' : 'outlined'}
            sx={{ fontSize: '0.75rem', px: 1.25, py: 0.5, minWidth: 'auto' }}
          >
            {lang.flag} {lang.code.toUpperCase()}
          </Button>
        ))}
      </ButtonGroup>
      <Tooltip title={t('app.backToMenu')} arrow>
        <IconButton
          onClick={handleCloseClick}
          size="small"
          sx={{
            color: 'inherit',
            '&:hover': {
              backgroundColor: 'rgba(0, 0, 0, 0.04)'
            }
          }}
        >
          <Close fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}



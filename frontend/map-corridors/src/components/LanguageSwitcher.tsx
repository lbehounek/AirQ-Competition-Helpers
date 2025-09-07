import React from 'react'
import { ButtonGroup, Button } from '@mui/material'
import { useI18n } from '../contexts/I18nContext'
import { SUPPORTED_LOCALES } from '../locales'

export const LanguageSwitcher: React.FC = () => {
  const { locale, setLocale } = useI18n()
  return (
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
  )
}



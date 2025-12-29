import React from 'react'
import { ButtonGroup, Button, Box, IconButton, Tooltip } from '@mui/material'
import { Close } from '@mui/icons-material'
import { useI18n } from '../contexts/I18nContext'
import { SUPPORTED_LOCALES } from '../locales'

// SVG Flag components (Windows doesn't render emoji flags)
const CzechFlag = ({ size = 20 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600" width={size} height={size * 0.67}>
    <rect width="900" height="600" fill="#d7141a"/>
    <rect width="900" height="300" fill="#fff"/>
    <path d="M 0,0 L 450,300 L 0,600 Z" fill="#11457e"/>
  </svg>
)

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
)

const FlagIcon = ({ code, size = 20 }: { code: string; size?: number }) => {
  if (code === 'cz') return <CzechFlag size={size} />
  if (code === 'en') return <USFlag size={size} />
  return null
}

export const LanguageSwitcher: React.FC = () => {
  const { locale, setLocale, t } = useI18n()

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <ButtonGroup size="small" variant="outlined">
        {SUPPORTED_LOCALES.map((lang) => (
          <Button
            key={lang.code}
            onClick={() => setLocale(lang.code)}
            variant={locale === lang.code ? 'contained' : 'outlined'}
            sx={{ fontSize: '0.75rem', px: 1.25, py: 0.5, minWidth: 'auto', display: 'flex', gap: 0.5 }}
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



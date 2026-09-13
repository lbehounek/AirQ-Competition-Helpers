import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { useI18n } from '../contexts/I18nContext'
import type { Locale } from '../locales'

function CzFlag() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600" width="20" height="13" aria-hidden>
      <rect width="900" height="600" fill="#d7141a" />
      <rect width="900" height="300" fill="#fff" />
      <path d="M 0,0 L 450,300 L 0,600 Z" fill="#11457e" />
    </svg>
  )
}

function GbFlag() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" width="22" height="11" aria-hidden>
      <clipPath id="s">
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id="t">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath="url(#s)">
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#t)" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  )
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n()

  const handleChange = (_e: React.MouseEvent<HTMLElement>, next: Locale | null) => {
    if (next) setLocale(next)
  }

  return (
    <Box sx={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
      <ToggleButtonGroup
        value={locale}
        exclusive
        size="small"
        onChange={handleChange}
        sx={{
          bgcolor: '#FFFFFF',
          '& .MuiToggleButton-root': {
            textTransform: 'none',
            fontSize: 13,
            fontWeight: 500,
            px: 1.5,
            py: 0.5,
            gap: 0.75,
            borderColor: '#E2E8F0',
            color: '#4A5568',
            '&.Mui-selected': {
              bgcolor: '#EBF5FF',
              color: '#1976D2',
              borderColor: '#1976D2',
            },
          },
        }}
      >
        <ToggleButton value="cz">
          <CzFlag /> CZ
        </ToggleButton>
        <ToggleButton value="en">
          <GbFlag /> EN
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  )
}

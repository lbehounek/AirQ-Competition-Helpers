import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { I18nProvider } from './contexts/I18nContext'
import { locales, DEFAULT_LOCALE } from './locales'
import { theme } from './theme'

// Set initial document title to default locale title
try {
  document.title = locales[DEFAULT_LOCALE].app.title
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)

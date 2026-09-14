import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './contexts/I18nContext'
import { locales, DEFAULT_LOCALE } from './locales'
import { theme } from './theme'

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

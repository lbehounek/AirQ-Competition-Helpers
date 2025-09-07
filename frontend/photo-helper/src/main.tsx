import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import './index.css'
import AppApi from './AppApi.tsx'
import { theme } from './theme'
import { AspectRatioProvider } from './contexts/AspectRatioContext'
import { LabelingProvider } from './contexts/LabelingContext'
import { I18nProvider } from './contexts/I18nContext'
import { LayoutModeProvider } from './contexts/LayoutModeContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <I18nProvider>
        <AspectRatioProvider>
          <LabelingProvider>
            <LayoutModeProvider>
              <AppApi />
            </LayoutModeProvider>
          </LabelingProvider>
        </AspectRatioProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)

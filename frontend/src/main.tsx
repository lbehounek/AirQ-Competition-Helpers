import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import './index.css'
import App from './App.tsx' // localStorage version
import AppApi from './AppApi.tsx' // Backend API version
import { theme } from './theme'
import { AspectRatioProvider } from './contexts/AspectRatioContext'
import { LabelingProvider } from './contexts/LabelingContext'
import { I18nProvider } from './contexts/I18nContext'

// Choose which version to use:
// - App: localStorage version (original)
// - AppApi: Backend API version (systematic architecture)
const USE_BACKEND = true;
const AppComponent = USE_BACKEND ? AppApi : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <I18nProvider>
        <AspectRatioProvider>
          <LabelingProvider>
            <AppComponent />
          </LabelingProvider>
        </AspectRatioProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)

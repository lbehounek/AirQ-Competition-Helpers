import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import './index.css'
import App from './App.tsx' // localStorage version
import AppApi from './AppApi.tsx' // Backend API version
import { theme } from './theme'

// Choose which version to use:
// - App: localStorage version (original)
// - AppApi: Backend API version (systematic architecture)
const USE_BACKEND = true;
const AppComponent = USE_BACKEND ? AppApi : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppComponent />
    </ThemeProvider>
  </StrictMode>,
)

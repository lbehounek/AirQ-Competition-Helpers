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
import { setBootDiscipline } from './utils/parseDiscipline'
import { resolveBootDiscipline } from './utils/resolveBootDiscipline'

function mount() {
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
}

// Boot gate. The discipline (rally vs precision) must be settled BEFORE the
// first render: `LabelingProvider` picks the label set in a `useState`
// initializer, and `useCompetitionSystem`'s legacy-title migration both reads
// AND persists based on it. Resolving it after mount would relabel a live grid
// and could write rally track-set titles into a precision competition.
//
// When `?discipline=` is present (the desktop launcher, and the map app's
// "Send to editor") this resolves with no I/O at all, so the common case adds
// no measurable delay; only the param-less case pays a single OPFS read.
// `finally` guarantees we mount whatever happens — an unresolvable discipline
// just means the historical rally default, and a blank page would be far worse
// than a wrong default.
void (async () => {
  try {
    setBootDiscipline(await resolveBootDiscipline(window.location.search))
  } catch {
    setBootDiscipline(null)
  } finally {
    mount()
  }
})()

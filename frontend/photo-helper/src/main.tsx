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
//
// The deadline covers the case `finally` cannot: `finally` only runs once the
// promise SETTLES, and the resolution chain (initStorage -> init -> three
// getDirectoryHandle hops -> readJSON) has no timeout anywhere. If OPFS wedges
// under storage pressure, or an Electron IPC round-trip never replies, the app
// would never mount at all — a white page with no error, which is strictly
// worse than the wrong default this gate exists to prevent. Racing the rally
// default in costs nothing, because that is already the documented fallback.
const BOOT_DISCIPLINE_TIMEOUT_MS = 1500

void (async () => {
  try {
    const resolved = await Promise.race([
      resolveBootDiscipline(window.location.search),
      new Promise<null>((r) => setTimeout(() => r(null), BOOT_DISCIPLINE_TIMEOUT_MS)),
    ])
    setBootDiscipline(resolved)
  } catch {
    setBootDiscipline(null)
  } finally {
    mount()
  }
})()

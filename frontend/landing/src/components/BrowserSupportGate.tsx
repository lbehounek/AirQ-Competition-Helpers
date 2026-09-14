import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Box, Button, Container, Link, Stack, Typography } from '@mui/material'
import { useI18n } from '../contexts/I18nContext'

async function detectOpfs(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return false
    if (typeof navigator.storage.getDirectory !== 'function') return false
    const root = await navigator.storage.getDirectory()
    return Boolean(root)
  } catch {
    return false
  }
}

export function BrowserSupportGate({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [state, setState] = useState<'checking' | 'ok' | 'unsupported'>('checking')

  useEffect(() => {
    let cancelled = false
    detectOpfs().then((ok) => {
      if (!cancelled) setState(ok ? 'ok' : 'unsupported')
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'checking') {
    return <Box sx={{ minHeight: '100vh' }} />
  }

  if (state === 'unsupported') {
    return (
      <Container maxWidth="sm" sx={{ pt: 10 }}>
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t('app.browserUnsupported.title')}
            </Typography>
            <Typography>{t('app.browserUnsupported.body')}</Typography>
            <Button
              variant="contained"
              component={Link}
              href="https://github.com/lbehounek/AirQ-Competition-Helpers/releases/latest"
              target="_blank"
              rel="noopener"
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('app.browserUnsupported.downloadDesktop')}
            </Button>
          </Stack>
        </Alert>
      </Container>
    )
  }

  return <>{children}</>
}

import { Alert, Button, Stack } from '@mui/material'
import type { CleanupCandidate } from '@airq/competitions'
import { useI18n } from '../contexts/I18nContext'

interface Props {
  candidates: CleanupCandidate[]
  totalCount: number
  maxCount: number
  onCleanup: () => Promise<void>
  onDismiss: () => void
}

export function CleanupBanner({ candidates, totalCount, maxCount, onCleanup, onDismiss }: Props) {
  const { t } = useI18n()
  if (candidates.length === 0) return null

  const hasAge = candidates.some((c) => c.reason === 'age')
  const messageKey = hasAge ? 'competition.cleanupMsg' : 'competition.cleanupExcess'
  const count = hasAge ? candidates.length : totalCount
  void maxCount

  return (
    <Alert
      severity="warning"
      sx={{ borderRadius: 2, alignItems: 'center' }}
      action={
        <Stack direction="row" spacing={1}>
          <Button color="warning" variant="contained" size="small" onClick={onCleanup}>
            {t('competition.cleanupAction')}
          </Button>
          <Button color="inherit" size="small" onClick={onDismiss}>
            {t('competition.cleanupDismiss')}
          </Button>
        </Stack>
      }
    >
      {t(messageKey, { count })}
    </Alert>
  )
}

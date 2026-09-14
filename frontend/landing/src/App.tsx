import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Container, Stack, Typography } from '@mui/material'
import MapIcon from '@mui/icons-material/Map'
import PhotoCameraBackIcon from '@mui/icons-material/PhotoCameraBack'
import type {
  CleanupCandidate,
  CompetitionMetadata,
  CompetitionsIndex,
  Discipline,
} from '@airq/competitions'
import {
  MAX_AGE_DAYS,
  MAX_COMPETITIONS,
  detectCleanupCandidates,
} from '@airq/competitions'
import { useI18n } from './contexts/I18nContext'
import { landingStorage } from './services/landingStorage'
import { AppCard } from './components/AppCard'
import { BrowserSupportGate } from './components/BrowserSupportGate'
import { CleanupBanner } from './components/CleanupBanner'
import { CompetitionBar } from './components/CompetitionBar'
import { LanguageSwitcher } from './components/LanguageSwitcher'

type SubAppKey = 'photo-helper' | 'map-corridors'

function buildSubAppUrl(app: SubAppKey, competitionId: string, discipline: Discipline): string {
  const params = new URLSearchParams({ competitionId, discipline })
  return `/${app}/?${params.toString()}`
}

function LandingMain() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState<CompetitionsIndex | null>(null)
  const [cleanupCandidates, setCleanupCandidates] = useState<CleanupCandidate[]>([])
  const [cleanupDismissed, setCleanupDismissed] = useState(false)

  const refreshCleanup = useCallback((current: CompetitionsIndex) => {
    const candidates = detectCleanupCandidates(current, {
      maxAgeDays: MAX_AGE_DAYS,
      maxCount: MAX_COMPETITIONS,
    })
    setCleanupCandidates(candidates)
  }, [])

  const reload = useCallback(async () => {
    try {
      const next = await landingStorage.getIndex()
      setIndex(next)
      refreshCleanup(next)
    } catch (e) {
      console.error('Failed to load competitions:', e)
      setError(e instanceof Error ? e.message : 'Failed to load competitions')
    } finally {
      setLoading(false)
    }
  }, [refreshCleanup])

  useEffect(() => {
    reload()
  }, [reload])

  const competitions: CompetitionMetadata[] = index?.competitions ?? []
  const activeId = index?.activeCompetitionId ?? null
  const activeComp = competitions.find((c) => c.id === activeId) ?? null
  const discipline: Discipline = (activeComp?.discipline as Discipline | undefined) ?? 'rally'

  const handleSelect = useCallback(
    async (id: string) => {
      try {
        await landingStorage.setActive(id)
        await reload()
      } catch (e) {
        console.error('Failed to set active:', e)
      }
    },
    [reload],
  )

  const handleCreate = useCallback(
    async (name: string) => {
      try {
        await landingStorage.createCompetition(name)
        await reload()
      } catch (e) {
        console.error('Failed to create:', e)
        setError(e instanceof Error ? e.message : 'Failed to create competition')
      }
    },
    [reload],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await landingStorage.deleteCompetition(id)
        await reload()
      } catch (e) {
        console.error('Failed to delete:', e)
        setError(e instanceof Error ? e.message : 'Failed to delete competition')
      }
    },
    [reload],
  )

  const handleDiscipline = useCallback(
    async (id: string, next: Discipline) => {
      try {
        await landingStorage.setDiscipline(id, next)
        await reload()
      } catch (e) {
        console.error('Failed to set discipline:', e)
      }
    },
    [reload],
  )

  const handleCleanup = useCallback(async () => {
    const doomed = cleanupCandidates.filter((c) => c.competition.id !== activeId)
    if (doomed.length === 0) return

    // This deletes several competitions AND their photos, irreversibly, and it
    // used to fire on a single click — while deleting ONE competition requires
    // the two-step confirm in CompetitionBar. Match the stricter gate: the bulk
    // action is the more destructive of the two.
    if (!window.confirm(t('competition.cleanupConfirm', { count: doomed.length }))) return

    const failed: string[] = []
    for (const c of doomed) {
      try {
        await landingStorage.deleteCompetition(c.competition.id)
      } catch (e) {
        // Keep going. A throw mid-loop used to abandon the remaining deletions
        // AND skip the reload below, leaving the UI listing competitions that
        // were already gone from disk.
        console.error('Cleanup failed for', c.competition.id, e)
        failed.push(c.competition.name)
      }
    }
    await reload()
    if (failed.length > 0) {
      // console.error alone left the user with no signal at all, unlike every
      // other handler here.
      setError(t('competition.cleanupPartial', { names: failed.join(', ') }))
    }
  }, [cleanupCandidates, activeId, reload, t])

  const navigate = useCallback(
    (app: SubAppKey) => {
      if (!activeId) return
      window.location.href = buildSubAppUrl(app, activeId, discipline)
    },
    [activeId, discipline],
  )

  return (
    <Box sx={{ minHeight: '100vh', position: 'relative' }}>
      <LanguageSwitcher />

      <Box component="header" sx={{ pt: 6, pb: 1, textAlign: 'center', px: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '1.75rem' }}>
          {t('app.title')}
        </Typography>
        <Typography sx={{ color: '#4A5568', mt: 1 }}>{t('app.subtitle')}</Typography>
      </Box>

      <Container maxWidth="md" sx={{ pt: 3, pb: 6 }}>
        <Stack spacing={2}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <CompetitionBar
            competitions={competitions}
            activeId={activeId}
            loading={loading}
            onSelect={handleSelect}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onChangeDiscipline={handleDiscipline}
          />

          {!cleanupDismissed && (
            <CleanupBanner
              candidates={cleanupCandidates}
              totalCount={competitions.length}
              maxCount={MAX_COMPETITIONS}
              onCleanup={handleCleanup}
              onDismiss={() => setCleanupDismissed(true)}
            />
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
            <Box sx={{ flex: 1 }}>
              <AppCard
                title={t('corridors.title')}
                description={t('corridors.desc')}
                icon={<MapIcon fontSize="large" />}
                disabled={!activeId}
                onClick={() => navigate('map-corridors')}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <AppCard
                title={t('helper.title')}
                description={t('helper.desc')}
                icon={<PhotoCameraBackIcon fontSize="large" />}
                disabled={!activeId}
                onClick={() => navigate('photo-helper')}
              />
            </Box>
          </Stack>

          {!activeId && !loading && (
            <Typography
              variant="body2"
              sx={{ textAlign: 'center', color: '#718096', mt: 2 }}
            >
              {t('competition.selectFirst')}
            </Typography>
          )}
        </Stack>
      </Container>
    </Box>
  )
}

export default function App() {
  return (
    <BrowserSupportGate>
      <LandingMain />
    </BrowserSupportGate>
  )
}

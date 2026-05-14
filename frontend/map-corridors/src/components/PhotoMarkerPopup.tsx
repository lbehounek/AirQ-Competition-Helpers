// Phase 5 of photo-map-culling: the popup shown when the user clicks a
// capture dot (or, in Phase 7, when they pick an entry from the photo
// list panel). Loads its own thumbnail via storage.getPhotoThumb — keeps
// MapProviderView ignorant of storage.

import { useEffect, useState } from 'react'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import { useI18n } from '../contexts/I18nContext'

export interface PhotoMarkerPopupProps {
  photoId: string
  filename: string
  /** ISO 8601 capture timestamp; rendered as-is. Empty/undefined hides the row. */
  timestamp?: string
  storage: StorageInterface
  photosDir: DirectoryHandle
  onInclude: () => void
  onSkip: () => void
  onReject: () => void
}

const THUMB_WIDTH_PX = 200
const THUMB_HEIGHT_PX = 150

export function PhotoMarkerPopup(props: PhotoMarkerPopupProps) {
  const { t } = useI18n()
  const { photoId, filename, timestamp, storage, photosDir } = props
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let cancelled = false
    let urlToRevoke: string | null = null
    setLoadState('loading')
    setThumbUrl(null)
    void (async () => {
      try {
        const blob = await storage.getPhotoThumb(photosDir, photoId)
        if (cancelled) return
        if (!blob) {
          setLoadState('missing')
          return
        }
        const url = URL.createObjectURL(blob)
        urlToRevoke = url
        setThumbUrl(url)
        setLoadState('ready')
      } catch {
        if (!cancelled) setLoadState('missing')
      }
    })()
    return () => {
      cancelled = true
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke)
    }
  }, [photoId, photosDir, storage])

  return (
    <Box sx={{ minWidth: THUMB_WIDTH_PX + 16 }}>
      <Box
        sx={{
          width: THUMB_WIDTH_PX,
          height: THUMB_HEIGHT_PX,
          bgcolor: 'grey.100',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: 1,
          mb: 1,
        }}
      >
        {loadState === 'loading' && <CircularProgress size={24} />}
        {loadState === 'ready' && thumbUrl && (
          <img
            src={thumbUrl}
            alt={filename}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        )}
        {loadState === 'missing' && (
          <Typography variant="caption" color="text.secondary">
            {t('photo.popup.thumbMissing')}
          </Typography>
        )}
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-all' }}>
        {filename}
      </Typography>
      {timestamp && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {timestamp}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button size="small" variant="contained" onClick={props.onInclude}>
          {t('photo.popup.include')}
        </Button>
        <Button size="small" variant="outlined" onClick={props.onSkip}>
          {t('photo.popup.skip')}
        </Button>
        <Button size="small" variant="outlined" color="error" onClick={props.onReject}>
          {t('photo.popup.reject')}
        </Button>
      </Stack>
    </Box>
  )
}

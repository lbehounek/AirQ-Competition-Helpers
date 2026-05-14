// Phase 5 of photo-map-culling: the popup shown when the user clicks a
// capture dot (or, in Phase 7, when they pick an entry from the photo
// list panel). Loads its own thumbnail via storage.getPhotoThumb — keeps
// MapProviderView ignorant of storage.

import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import { useI18n } from '../contexts/I18nContext'
import { usePhotoThumbUrl } from './usePhotoThumbUrl'
import type { PhotoLabel } from '../types/markers'
import { ALL_PHOTO_LABELS } from '../types/markers'

export interface PhotoMarkerPopupProps {
  photoId: string
  filename: string
  /** ISO 8601 capture timestamp; rendered as-is. Empty/undefined hides the row. */
  timestamp?: string
  storage: StorageInterface
  photosDir: DirectoryHandle
  // Label state — the popup is the single place to assign / clear the
  // answer-sheet label on a photo marker (mirrors the KML popup pattern).
  // Without this, picks have no path to a label and never appear in the
  // answer sheet, breaking the locate → select → score flow.
  label?: PhotoLabel
  availableLabels?: readonly PhotoLabel[]
  usedLabels?: readonly string[]
  onLabelChange?: (label: PhotoLabel) => void
  onLabelClear?: () => void
  onInclude: () => void
  onSkip: () => void
  onReject: () => void
}

const THUMB_WIDTH_PX = 200
const THUMB_HEIGHT_PX = 150

export function PhotoMarkerPopup(props: PhotoMarkerPopupProps) {
  const { t } = useI18n()
  const { photoId, filename, timestamp, storage, photosDir } = props
  const { url: thumbUrl, state: loadState } = usePhotoThumbUrl(storage, photosDir, photoId)

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
      {props.onLabelChange && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
            {t('photo.popup.label')}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 0.5 }}>
            {(props.availableLabels ?? ALL_PHOTO_LABELS).map((L) => {
              const used = (props.usedLabels ?? []).includes(L)
              const isCurrent = props.label === L
              const disabled = used && !isCurrent
              return (
                <button
                  key={L}
                  type="button"
                  onClick={() => {
                    if (disabled) return
                    if (isCurrent) {
                      props.onLabelClear?.()
                    } else {
                      props.onLabelChange?.(L)
                    }
                  }}
                  disabled={disabled}
                  title={disabled ? t('photo.popup.labelUsed') : `${t('photo.popup.labelSet')} ${L}`}
                  style={{
                    padding: '2px 0',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    background: isCurrent ? '#facc15' : '#ffffff',
                    color: isCurrent ? '#111827' : (disabled ? '#9ca3af' : '#111827'),
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                    fontSize: 12,
                    minWidth: 0,
                  }}
                >{L}</button>
              )
            })}
          </Box>
        </Box>
      )}
    </Box>
  )
}

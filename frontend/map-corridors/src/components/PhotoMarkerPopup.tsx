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
  /** Primary name shown in bold — the custom name if set, else the filename. */
  filename: string
  /**
   * Original camera filename, shown as a small secondary line. Pass only when
   * a custom name is in effect (i.e. differs from `filename`); `undefined`
   * hides the row so an un-renamed photo isn't printed twice.
   */
  originalFilename?: string
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

/**
 * Derive a label button's UX state from current/used/this-letter inputs.
 *
 * Rules (referenced by the picker click handler and the visual style):
 *  - `disabled`: the letter is already used elsewhere AND this is not
 *    the marker's current letter. Re-clicking the SAME letter must stay
 *    enabled so the user can clear it.
 *  - `intent`: 'clear' when clicking the current letter, 'set' when
 *    clicking any other enabled letter.
 *
 * Exported for unit testing — a regression flipping the comparison
 * (`isCurrent` vs `!isCurrent`) would otherwise silently disable the
 * clear path and ship undetected.
 */
export function labelButtonState(input: {
  thisLabel: string
  currentLabel: string | undefined
  usedLabels: readonly string[]
}): { disabled: boolean; isCurrent: boolean; intent: 'set' | 'clear' | 'noop' } {
  const isCurrent = input.currentLabel === input.thisLabel
  const used = input.usedLabels.includes(input.thisLabel)
  const disabled = used && !isCurrent
  if (disabled) return { disabled: true, isCurrent, intent: 'noop' }
  return { disabled: false, isCurrent, intent: isCurrent ? 'clear' : 'set' }
}

export function PhotoMarkerPopup(props: PhotoMarkerPopupProps) {
  const { t } = useI18n()
  const { photoId, filename, originalFilename, timestamp, storage, photosDir } = props
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
      {originalFilename && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-all' }}>
          {originalFilename}
        </Typography>
      )}
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
              const state = labelButtonState({
                thisLabel: L,
                currentLabel: props.label,
                usedLabels: props.usedLabels ?? [],
              })
              return (
                <button
                  key={L}
                  type="button"
                  onClick={() => {
                    if (state.intent === 'noop') return
                    if (state.intent === 'clear') {
                      props.onLabelClear?.()
                    } else {
                      props.onLabelChange?.(L)
                    }
                  }}
                  disabled={state.disabled}
                  title={state.disabled ? t('photo.popup.labelUsed') : `${t('photo.popup.labelSet')} ${L}`}
                  style={{
                    padding: '2px 0',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    background: state.isCurrent ? '#facc15' : '#ffffff',
                    color: state.isCurrent ? '#111827' : (state.disabled ? '#9ca3af' : '#111827'),
                    cursor: state.disabled ? 'not-allowed' : 'pointer',
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

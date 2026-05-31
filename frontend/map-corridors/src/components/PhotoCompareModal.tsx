// Phase 12 of photo-map-culling — side-by-side compare of 2–3 variants of
// the same turn point. The user opens this from PhotoListPanel after Ctrl-
// or Shift-clicking the rows they want to weigh against each other; picking
// a winner promotes it to `flag='pick'` and demotes the rest to
// `flag='reject'` (which hides their markers from the map per Step 2). The
// rejected variants are NOT deleted from OPFS — they live in the
// "Odmítnuté" list group as the undo path if the user changes their mind.

import { useCallback, useEffect, useMemo } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { Close } from '@mui/icons-material'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import type { PhotoMarker } from '../types/markers'
import { comparePhotoMarkers, photoMarkerDisplayName } from '../types/markers'
import { useI18n } from '../contexts/I18nContext'
import { usePhotoFullUrl } from './usePhotoFullUrl'

export interface PhotoCompareModalProps {
  open: boolean
  /**
   * Selected variants. Received in selection/cluster order; the modal sorts them
   * by original filename (numeric-aware) with EXIF timestamp as tie-break before
   * rendering, so tiles + the 1/2/3 shortcuts follow shooting sequence regardless
   * of click order. See {@link comparePhotoMarkers}.
   */
  markers: readonly PhotoMarker[]
  storage: StorageInterface | null
  photosDir: DirectoryHandle | null
  onClose: () => void
  /**
   * Winner promoted to pick, losers demoted to reject. The parent owns
   * the actual marker mutation so the OPFS write is atomic — a single
   * `persistMarkers` call rather than N round-trips that could leave the
   * session in a half-resolved state mid-write.
   */
  onResolve: (winnerId: string, loserIds: readonly string[]) => void | Promise<void>
}

export function PhotoCompareModal(props: PhotoCompareModalProps) {
  const { open, markers, storage, photosDir, onClose, onResolve } = props
  const { t } = useI18n()

  // Display in shooting sequence (filename, then EXIF time), not click/cluster
  // order. Both the keyboard handler and the tile render read this single sorted
  // array so the number badge always matches its 1/2/3 shortcut.
  const sortedMarkers = useMemo(
    () => [...markers].sort(comparePhotoMarkers),
    [markers],
  )

  const handlePick = useCallback((winnerId: string) => {
    const loserIds = markers
      .filter(m => m.id !== winnerId)
      .map(m => m.id)
    void onResolve(winnerId, loserIds)
    onClose()
  }, [markers, onResolve, onClose])

  // Keyboard shortcuts 1/2/3 → pick that index. Wired at the dialog level
  // so the user doesn't have to mouse to a button after eyeballing the
  // photos. Only active while the dialog is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        const idx = Number(e.key) - 1
        if (idx >= 0 && idx < sortedMarkers.length) {
          e.preventDefault()
          handlePick(sortedMarkers[idx].id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, sortedMarkers, handlePick])

  if (!open) return null
  // Defensive: 0 or 1 variants makes the "compare" framing nonsensical.
  // PhotoListPanel already disables the trigger button, but a stale-state
  // open with too few markers should be a graceful no-op, not a crash.
  if (markers.length < 2) return null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      keepMounted={false}
      aria-labelledby="photo-compare-title"
    >
      <DialogTitle id="photo-compare-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <Box sx={{ flex: 1 }}>{t('photo.compare.title')}</Box>
        <Typography variant="caption" color="text.secondary">
          {t('photo.compare.shortcut')}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label={t('photo.compare.cancel')}>
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 1.5 }}>
        <Box
          sx={{
            display: 'grid',
            // 1 col on narrow screens (mobile), N cols otherwise. Capped at
            // 3 by PhotoListPanel's selection limit, so this never grows
            // past 3 columns regardless of viewport.
            gridTemplateColumns: { xs: '1fr', sm: `repeat(${sortedMarkers.length}, 1fr)` },
            gap: 1.5,
          }}
        >
          {sortedMarkers.map((m, idx) => (
            <CompareTile
              key={m.id}
              marker={m}
              index={idx}
              storage={storage}
              photosDir={photosDir}
              onPick={() => handlePick(m.id)}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('photo.compare.cancel')}</Button>
      </DialogActions>
    </Dialog>
  )
}

function CompareTile(props: {
  marker: PhotoMarker
  index: number
  storage: StorageInterface | null
  photosDir: DirectoryHandle | null
  onPick: () => void
}) {
  const { marker, index, storage, photosDir, onPick } = props
  const { t } = useI18n()
  // Defensive guard: PhotoListPanel's selection filter excludes markers
  // without a photoId (KML markers), so this should always be defined when
  // the modal opens via the supported path. Falling through to a missing-
  // photo render keeps the UI honest if a future caller forgets the guard.
  const { url, state } = usePhotoFullUrl(storage, photosDir, marker.photoId ?? '')
  const ts = marker.capturedAt?.timestamp

  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          // 70vh max so the image area stays inside the viewport even with
          // the title + actions stacked above/below. `aspect-ratio: auto`
          // (default) preserves the photo's native ratio via objectFit.
          maxHeight: '70vh',
          minHeight: 240,
          bgcolor: 'grey.900',
          borderRadius: 1,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {state === 'ready' && url && (
          <img
            src={url}
            alt={photoMarkerDisplayName(marker)}
            style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
          />
        )}
        {state === 'loading' && (
          <Typography variant="caption" color="grey.300">
            {t('photo.compare.loading')}
          </Typography>
        )}
        {state === 'missing' && (
          <Typography variant="caption" color="error.light">
            {t('photo.compare.missing')}
          </Typography>
        )}
        <Box
          sx={{
            position: 'absolute',
            top: 6,
            left: 6,
            bgcolor: 'rgba(0,0,0,0.55)',
            color: 'white',
            px: 0.75,
            py: 0.25,
            borderRadius: 0.5,
            fontSize: 12,
            fontWeight: 600,
          }}
          aria-hidden
        >
          {/* Number badge mirrors the 1/2/3 keyboard shortcut so the user
              can map key → tile at a glance. */}
          {index + 1}
        </Box>
      </Box>
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {photoMarkerDisplayName(marker)}
        </Typography>
        {ts && (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {ts}
          </Typography>
        )}
      </Stack>
      <Button
        variant="contained"
        color="primary"
        onClick={onPick}
        aria-label={t('photo.compare.pickAria', { name: photoMarkerDisplayName(marker), index: index + 1 })}
      >
        {t('photo.compare.pick')}
      </Button>
    </Stack>
  )
}

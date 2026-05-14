// Phase 6 of photo-map-culling — ADR-012.
// Off-map tray pinned to the bottom-left of the map view. Holds imported
// photos that lack EXIF GPS, sorted by capture time. Each thumbnail is
// HTML5-draggable; drop onto the map places it as a `'pick'` PhotoMarker
// at the drop coordinates.

import { useMemo } from 'react'
import { Box, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import { ExpandLess, ExpandMore } from '@mui/icons-material'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import type { NoGpsPhoto } from '../types/markers'
import { useI18n } from '../contexts/I18nContext'
import { usePhotoThumbUrl } from './usePhotoThumbUrl'

/** Drag type the map drop handler watches for. Public — MapProviderView imports this. */
export const NO_GPS_PHOTO_DRAG_TYPE = 'application/x-airq-no-gps-photo'

const TRAY_HEIGHT_PX = 116        // 80px thumb + chrome, under the 120px ADR-012 cap
const THUMB_WIDTH_PX = 96         // 4:3 thumbs in horizontal scroll
const THUMB_HEIGHT_PX = 72
const MAX_TRAY_WIDTH_VW = 20      // ADR-012 — never exceeds 20% of map width

export interface NoGpsTrayProps {
  photos: readonly NoGpsPhoto[]
  open: boolean
  onToggleOpen: () => void
  storage: StorageInterface | null
  photosDir: DirectoryHandle | null
}

export function NoGpsTray(props: NoGpsTrayProps) {
  const { t } = useI18n()
  const { photos, open, onToggleOpen, storage, photosDir } = props

  // Sort by EXIF timestamp ASC; entries without a timestamp settle at the
  // end (assigned a max sort key), tie-broken alphabetically by filename.
  const sorted = useMemo(() => {
    const copy = [...photos]
    copy.sort((a, b) => {
      const ta = a.timestamp ?? '￿'
      const tb = b.timestamp ?? '￿'
      if (ta !== tb) return ta < tb ? -1 : 1
      return a.filename.localeCompare(b.filename)
    })
    return copy
  }, [photos])

  // Auto-hide when nothing to show. Phase 6 acceptance: "Tray empty → collapses".
  // We hide entirely (vs. show empty chrome) — simpler, no chevron-with-nothing.
  if (sorted.length === 0) return null

  return (
    <Paper
      elevation={4}
      sx={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        zIndex: 25,
        maxWidth: `${MAX_TRAY_WIDTH_VW}vw`,
        bgcolor: 'rgba(255,255,255,0.96)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5, gap: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', flex: 1 }}>
          {t('photo.tray.title', { count: sorted.length })}
        </Typography>
        <Tooltip title={open ? t('photo.tray.collapse') : t('photo.tray.expand')}>
          <IconButton size="small" onClick={onToggleOpen} aria-label={open ? t('photo.tray.collapse') : t('photo.tray.expand')}>
            {open ? <ExpandMore fontSize="small" /> : <ExpandLess fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      {open && (
        <Box
          sx={{
            height: TRAY_HEIGHT_PX - 32, // minus header chrome
            overflowX: 'auto',
            overflowY: 'hidden',
            display: 'flex',
            gap: 1,
            px: 1,
            pb: 1,
          }}
        >
          {sorted.map(p => (
            <NoGpsTrayThumb
              key={p.photoId}
              photo={p}
              storage={storage}
              photosDir={photosDir}
              dragHint={t('photo.tray.dragHint')}
            />
          ))}
        </Box>
      )}
    </Paper>
  )
}

function NoGpsTrayThumb(props: {
  photo: NoGpsPhoto
  storage: StorageInterface | null
  photosDir: DirectoryHandle | null
  dragHint: string
}) {
  const { photo, storage, photosDir, dragHint } = props
  const { url, state } = usePhotoThumbUrl(storage, photosDir, photo.photoId)

  return (
    <Tooltip title={`${photo.filename} — ${dragHint}`} placement="top" enterDelay={300}>
      <Box
        draggable
        role="img"
        aria-label={`${photo.filename}. ${dragHint}.`}
        onDragStart={(e: React.DragEvent) => {
          e.dataTransfer.setData(NO_GPS_PHOTO_DRAG_TYPE, photo.photoId)
          e.dataTransfer.effectAllowed = 'move'
        }}
        sx={{
          width: THUMB_WIDTH_PX,
          height: THUMB_HEIGHT_PX,
          flexShrink: 0,
          bgcolor: 'grey.100',
          borderRadius: 0.5,
          overflow: 'hidden',
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          '&:active': { cursor: 'grabbing' },
          '&:hover': { boxShadow: 1 },
        }}
      >
        {state === 'ready' && url && (
          <img
            src={url}
            alt={photo.filename}
            draggable={false}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', pointerEvents: 'none' }}
          />
        )}
        {state !== 'ready' && (
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10, px: 0.5, textAlign: 'center' }}>
            {photo.filename}
          </Typography>
        )}
      </Box>
    </Tooltip>
  )
}

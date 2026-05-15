// Phase 6 of photo-map-culling — ADR-012.
// Off-map tray pinned to the bottom-left of the map view. Holds imported
// photos that lack EXIF GPS, sorted by capture time. Each thumbnail is
// HTML5-draggable; drop onto the map places it as a `'pick'` PhotoMarker
// at the drop coordinates.

import { useMemo } from 'react'
import { Box, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import { Close, ExpandLess, ExpandMore } from '@mui/icons-material'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import type { NoGpsPhoto } from '../types/markers'
import { useI18n } from '../contexts/I18nContext'
import { usePhotoThumbUrl } from './usePhotoThumbUrl'

/** Drag type the map drop handler watches for. Public — MapProviderView imports this. */
export const NO_GPS_PHOTO_DRAG_TYPE = 'application/x-airq-no-gps-photo'

/**
 * Sort comparator for no-GPS tray entries. EXIF timestamp ASC; entries
 * without a timestamp sort to the end via the `'￿'` sentinel, then
 * tie-break alphabetically by filename. Exported for unit testing — a
 * typo flipping the order would otherwise ship silently.
 */
export function compareNoGpsPhotos(a: NoGpsPhoto, b: NoGpsPhoto): number {
  const ta = a.timestamp ?? '￿'
  const tb = b.timestamp ?? '￿'
  if (ta !== tb) return ta < tb ? -1 : 1
  return a.filename.localeCompare(b.filename)
}

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
  /**
   * Hard-delete a photo from the corridor session entirely. Mirrors the
   * X badge on photo-helper grid tiles.
   */
  onPhotoDelete: (photoId: string) => void | Promise<void>
}

export function NoGpsTray(props: NoGpsTrayProps) {
  const { t } = useI18n()
  const { photos, open, onToggleOpen, storage, photosDir, onPhotoDelete } = props

  const sorted = useMemo(() => [...photos].sort(compareNoGpsPhotos), [photos])

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
              onDelete={onPhotoDelete}
              deleteTooltip={t('photo.deleteTooltip')}
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
  onDelete: (photoId: string) => void | Promise<void>
  deleteTooltip: string
}) {
  const { photo, storage, photosDir, dragHint, onDelete, deleteTooltip } = props
  const { url, state } = usePhotoThumbUrl(storage, photosDir, photo.photoId)

  return (
    // Outer wrapper hosts the absolute-positioned delete badge; the inner
    // Box owns the drag affordance so dragging onto the map still works.
    // Reveal full delete-button opacity on hover anywhere on the thumb.
    <Box
      sx={{
        position: 'relative',
        flexShrink: 0,
        '&:hover .nogps-thumb-delete': { opacity: 1 },
      }}
    >
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
      {/* Delete badge — top-right corner. `draggable={false}` so a
          mouse-down on the X doesn't initiate the drag flow on the
          underlying thumb; stopPropagation on the click prevents the
          surrounding Tooltip / drag handlers from racing. */}
      <Tooltip title={deleteTooltip} placement="top" enterDelay={400}>
        <IconButton
          className="nogps-thumb-delete"
          draggable={false}
          onDragStart={(e: React.DragEvent) => e.preventDefault()}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            void onDelete(photo.photoId)
          }}
          aria-label={deleteTooltip}
          size="small"
          sx={{
            position: 'absolute',
            top: 2,
            right: 2,
            width: 22,
            height: 22,
            bgcolor: 'rgba(220, 53, 69, 0.92)',
            color: 'white',
            opacity: 0.6,
            transition: 'opacity 0.15s ease, background-color 0.15s ease',
            '&:hover': {
              bgcolor: 'rgba(200, 35, 51, 1)',
              opacity: 1,
            },
          }}
        >
          <Close sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

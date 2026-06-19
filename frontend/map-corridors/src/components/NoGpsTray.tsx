// Phase 6 of photo-map-culling — ADR-012.
// Off-map tray pinned to the bottom-left of the map view. Holds imported
// photos that lack EXIF GPS, sorted by capture time. Each thumbnail is
// HTML5-draggable; drop onto the map places it as a `'pick'` PhotoMarker
// at the drop coordinates.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Box, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import { Close, ExpandLess, ExpandMore } from '@mui/icons-material'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import type { NoGpsPhoto } from '../types/markers'
import { compareNoGpsPhotos, noGpsPhotoDisplayName } from '../types/markers'
import { useI18n } from '../contexts/I18nContext'
import { usePhotoThumbUrl } from './usePhotoThumbUrl'
// Reuse the marker edge-pan's eased velocity ramp so the tray's drag-scroll
// feels identical to the map's, and the easing stays tested in one place.
import { edgeVelocity } from '../map/useEdgePanDrag'

/** Drag type the map drop handler watches for. Public — MapProviderView imports this. */
export const NO_GPS_PHOTO_DRAG_TYPE = 'application/x-airq-no-gps-photo'

// The tray sort comparator now lives in `types/markers.ts` so the right-side
// list (`groupPhotosByFlag`) shares the exact same tie-break order. Re-exported
// here to keep existing importers (and `componentLogic.test.ts`) stable.
export { compareNoGpsPhotos } from '../types/markers'

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
  /**
   * Double-clicking a tray thumbnail opens the full-resolution single-photo
   * preview (lightbox). Undefined leaves the thumbnail drag-only.
   */
  onPreview?: (photoId: string) => void
}

export function NoGpsTray(props: NoGpsTrayProps) {
  const { t } = useI18n()
  const { photos, open, onToggleOpen, storage, photosDir, onPhotoDelete, onPreview } = props

  const sorted = useMemo(() => [...photos].sort(compareNoGpsPhotos), [photos])

  // --- Auto-scroll the strip while a thumbnail is being dragged onto the map ---
  // Thumbs use native HTML5 drag, so the user can't also operate the scrollbar
  // mid-drag — a thumb outside the 20vw window (ADR-012) would be unreachable.
  // When the drag cursor nears the strip's left/right edge, roll the strip that
  // way each frame (only scrollLeft changes, so the ADR-012 width cap holds).
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const velRef = useRef(0)

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    velRef.current = 0
  }, [])

  // Cancel any in-flight loop if the tray unmounts mid-drag (no leaked rAF).
  useEffect(() => stopAutoScroll, [stopAutoScroll])

  const tick = useCallback(() => {
    const el = scrollRef.current
    if (el && velRef.current !== 0) {
      el.scrollLeft += velRef.current
      rafRef.current = requestAnimationFrame(tick)
    } else {
      rafRef.current = null
    }
  }, [])

  const handleStripDragOver = useCallback((e: React.DragEvent) => {
    // Only our own thumb drags drive the scroll — ignore unrelated drags.
    if (!e.dataTransfer.types.includes(NO_GPS_PHOTO_DRAG_TYPE)) return
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // edgeVelocity: negative near the left edge, positive near the right, 0 in
    // the middle — exactly scrollLeft's sign convention, so add it directly.
    velRef.current = edgeVelocity(e.clientX - rect.left, rect.width)
    if (velRef.current !== 0 && rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick)
    } else if (velRef.current === 0) {
      stopAutoScroll()
    }
  }, [tick, stopAutoScroll])

  const handleStripDragLeave = useCallback((e: React.DragEvent) => {
    // dragleave also fires when moving onto a child thumb; only stop when the
    // pointer truly exits the strip, else dragover restarts it next frame.
    const el = scrollRef.current
    const related = e.relatedTarget as Node | null
    if (el && related && el.contains(related)) return
    stopAutoScroll()
  }, [stopAutoScroll])

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
          ref={scrollRef}
          onDragOver={handleStripDragOver}
          onDragLeave={handleStripDragLeave}
          // Stop the loop when the drag finishes anywhere (dragend bubbles up
          // from the thumb) or drops onto the strip itself.
          onDragEnd={stopAutoScroll}
          onDrop={stopAutoScroll}
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
              onPreview={onPreview}
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
  onPreview?: (photoId: string) => void
}) {
  const { photo, storage, photosDir, dragHint, onDelete, deleteTooltip, onPreview } = props
  const { url, state } = usePhotoThumbUrl(storage, photosDir, photo.photoId)
  // Custom name when set, else the camera filename — shown in the tooltip,
  // a11y labels, and the no-thumb placeholder.
  const label = noGpsPhotoDisplayName(photo)

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
      <Tooltip title={`${label} — ${dragHint}`} placement="top" enterDelay={300}>
        <Box
          draggable
          role="img"
          aria-label={`${label}. ${dragHint}.`}
          onDragStart={(e: React.DragEvent) => {
            e.dataTransfer.setData(NO_GPS_PHOTO_DRAG_TYPE, photo.photoId)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDoubleClick={onPreview ? () => onPreview(photo.photoId) : undefined}
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
              alt={label}
              draggable={false}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', pointerEvents: 'none' }}
            />
          )}
          {state !== 'ready' && (
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10, px: 0.5, textAlign: 'center' }}>
              {label}
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

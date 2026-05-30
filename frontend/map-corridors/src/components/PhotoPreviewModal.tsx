// Single-photo lightbox. Double-clicking a photo — either the thumbnail in
// the map dot popup (PhotoMarkerPopup) or a row in PhotoListPanel — opens this
// to inspect that one photo full-resolution. It's the single-image sibling of
// PhotoCompareModal (which weighs 2–3 variants against each other): same
// MUI Dialog shell and the same `usePhotoFullUrl` loader, but view-only — no
// pick/resolve, no marker mutation.

import { useEffect } from 'react'
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { Close } from '@mui/icons-material'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import { useI18n } from '../contexts/I18nContext'
import { usePhotoFullUrl } from './usePhotoFullUrl'

export interface PhotoPreviewModalProps {
  open: boolean
  /** Photo to show. `null` keeps the dialog closed regardless of `open`. */
  photoId: string | null
  /** Primary name shown in the title bar — custom name if set, else filename. */
  filename?: string
  /** Camera filename, shown as a secondary line only when it differs. */
  originalFilename?: string
  /** Capture timestamp, rendered as-is. */
  timestamp?: string
  storage: StorageInterface | null
  photosDir: DirectoryHandle | null
  onClose: () => void
}

export function PhotoPreviewModal(props: PhotoPreviewModalProps) {
  const { open, photoId, filename, originalFilename, timestamp, storage, photosDir, onClose } = props
  const { t } = useI18n()

  // Esc closes. The MUI Dialog already handles Escape via onClose, but the
  // compare modal binds its own window listener for parity with its 1/2/3
  // shortcuts; here a dedicated listener keeps Esc working even if focus is
  // inside the image area before the Dialog has grabbed it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  if (!open || !photoId) return null
  const showOriginal = !!originalFilename && originalFilename !== filename

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      keepMounted={false}
      aria-labelledby="photo-preview-title"
    >
      <DialogTitle id="photo-preview-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="body1"
            sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {filename || t('photo.preview.title')}
          </Typography>
          {(showOriginal || timestamp) && (
            <Typography variant="caption" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[showOriginal ? originalFilename : null, timestamp].filter(Boolean).join(' · ')}
            </Typography>
          )}
        </Stack>
        <IconButton size="small" onClick={onClose} aria-label={t('photo.preview.close')}>
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 1.5 }}>
        <PreviewImage storage={storage} photosDir={photosDir} photoId={photoId} alt={filename || ''} />
      </DialogContent>
    </Dialog>
  )
}

function PreviewImage(props: {
  storage: StorageInterface | null
  photosDir: DirectoryHandle | null
  photoId: string
  alt: string
}) {
  const { storage, photosDir, photoId, alt } = props
  const { t } = useI18n()
  const { url, state } = usePhotoFullUrl(storage, photosDir, photoId)

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        // Leave room for the title bar + dialog chrome so the image stays
        // inside the viewport; native aspect ratio preserved via objectFit.
        maxHeight: '80vh',
        minHeight: 280,
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
          alt={alt}
          style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
        />
      )}
      {state === 'loading' && (
        <Typography variant="caption" color="grey.300">
          {t('photo.preview.loading')}
        </Typography>
      )}
      {state === 'missing' && (
        <Typography variant="caption" color="error.light">
          {t('photo.preview.missing')}
        </Typography>
      )}
    </Box>
  )
}

/**
 * The image tier of one candidate-tray thumb: a plain `<img>` fed by the
 * thumbnail cache (see `utils/candidateThumbs.ts`), with skeleton / fallback /
 * missing states. Deliberately knows nothing about drag, selection or the
 * thumb toolbar — those stay in `CandidateTray`.
 */
import React from 'react';
import { Box, Skeleton, Typography } from '@mui/material';
import { BrokenImage } from '@mui/icons-material';
import { useI18n } from '../contexts/I18nContext';
import { useCandidateThumbUrl } from '../hooks/useCandidateThumbUrl';
import type { DirectoryHandle } from '@airq/shared-storage';
import type { ApiPhoto } from '../types/api';

export interface CandidateThumbImageProps {
  photo: ApiPhoto;
  /** Tri-state competition photos dir — see `useCandidateThumbUrl`. */
  photosDir: DirectoryHandle | null | undefined;
}

const Impl: React.FC<CandidateThumbImageProps> = ({ photo, photosDir }) => {
  const { t } = useI18n();
  const { url, state } = useCandidateThumbUrl(photo, photosDir);

  return (
    <Box
      data-testid={`candidate-thumb-${photo.id}`}
      data-thumb-state={state}
      sx={{
        width: '100%',
        height: '100%',
        bgcolor: 'grey.100',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {state === 'loading' && (
        <Skeleton variant="rectangular" width="100%" height="100%" animation="wave" />
      )}
      {(state === 'ready' || state === 'fallback') && url && (
        <img
          src={url}
          alt={photo.filename}
          draggable={false}
          decoding="async"
          // `cover` centre-crops into the 144x100 box. The tray previously
          // stretched a 4:3 editor canvas into that box, which distorted every
          // thumb; cropping keeps the subject's proportions honest.
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
      {state === 'missing' && (
        <Box sx={{ textAlign: 'center', color: 'text.disabled' }}>
          <BrokenImage fontSize="small" />
          <Typography variant="caption" display="block">
            {t('candidates.thumbMissing')}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

/**
 * Memoized on the fields the image actually depends on.
 *
 * `canvasState`, `flag` and `label` are IGNORED on purpose: the thumb shows the
 * source photo, not the edit, so none of them can change the pixels — and the
 * tray re-renders on every candidate flag/label change, which would otherwise
 * re-render all N images. `filename` IS included: it is the `<img alt>`, and
 * map-corridors can rename a `pm-` candidate through `setCandidateFilename`.
 */
export const CandidateThumbImage = React.memo(
  Impl,
  (a, b) =>
    a.photo.id === b.photo.id &&
    a.photo.url === b.photo.url &&
    a.photo.isPlaceholder === b.photo.isPlaceholder &&
    a.photo.filename === b.photo.filename &&
    a.photosDir === b.photosDir,
);

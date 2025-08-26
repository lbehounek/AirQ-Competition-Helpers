import React from 'react';
import { Box, Paper, Typography, useMediaQuery, useTheme } from '@mui/material';
import { GridSizedDropZone } from './GridSizedDropZone';
import { PhotoGridApi } from './PhotoGridApi';
import { useI18n } from '../contexts/I18nContext';
import { generateTurningPointLabels } from '../utils/imageProcessing';
import type { ApiPhoto, ApiPhotoSet } from '../types/api';
import { useLayoutMode } from '../contexts/LayoutModeContext';

interface TurningPointLayoutProps {
  set1: ApiPhotoSet;
  set2: ApiPhotoSet;
  loading: boolean;
  error: string | null;
  onFilesDropped: (files: File[]) => void;
  onPhotoClick: (photo: ApiPhoto, setKey: 'set1' | 'set2') => void;
  onPhotoUpdate: (setKey: 'set1' | 'set2', photoId: string, canvasState: any) => void;
  onPhotoRemove: (setKey: 'set1' | 'set2', photoId: string) => void;
  onPhotoMove: (setKey: 'set1' | 'set2', fromIndex: number, toIndex: number) => void;
  totalPhotoCount: number;
}

export const TurningPointLayout: React.FC<TurningPointLayoutProps> = ({
  set1,
  set2,
  loading,
  error,
  onFilesDropped,
  onPhotoClick,
  onPhotoUpdate,
  onPhotoRemove,
  onPhotoMove,
  totalPhotoCount
}) => {
  const { t } = useI18n();
  const { layoutMode } = useLayoutMode();
  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up('lg'));

  // Calculate turning point labels
  const totalPhotos = set1.photos.length + set2.photos.length;
  const turningPointLabels = generateTurningPointLabels(totalPhotos, layoutMode);
  
  // Debug logging
  console.log('🔍 TurningPointLayout Debug:', {
    layoutMode,
    totalPhotos,
    set1Count: set1.photos.length,
    set2Count: set2.photos.length,
    turningPointLabels
  });

  return (
    <Box>
      {totalPhotoCount === 0 ? (
        /* Empty - Show Grid-Sized DropZone in Grid 1 position */
        <Paper elevation={3} sx={{ p: 4, mb: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.light' }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" color="primary" sx={{ fontWeight: 600, textAlign: 'center' }}>
              {t('turningpoint.photos')}
            </Typography>
          </Box>
          <GridSizedDropZone
            onFilesDropped={onFilesDropped}
            setName={t('turningpoint.photos')}
            maxPhotos={18}
            loading={loading}
            error={error}
          />
        </Paper>
      ) : (
        /* Has photos - Show both grids */
        (() => {
          const Set1 = (
            <Paper elevation={3} sx={{ p: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.light' }}>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6" color="primary" sx={{ fontWeight: 600, textAlign: 'center' }}>
                  {t('turningpoint.page1')}
                </Typography>
              </Box>
              <PhotoGridApi
                photoSet={set1}
                setKey="set1"
                onPhotoUpdate={(photoId, canvasState) => onPhotoUpdate('set1', photoId, canvasState)}
                onPhotoRemove={(photoId) => onPhotoRemove('set1', photoId)}
                onPhotoClick={(photo) => onPhotoClick(photo, 'set1')}
                onPhotoMove={(fromIndex, toIndex) => onPhotoMove('set1', fromIndex, toIndex)}
                onFilesDropped={(files) => onFilesDropped(files)}
                customLabels={turningPointLabels.set1}
              />
            </Paper>
          );

          const Set2 = (
            <Paper elevation={3} sx={{ p: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.light' }}>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6" color="primary" sx={{ fontWeight: 600, textAlign: 'center' }}>
                  {t('turningpoint.page2')}
                </Typography>
              </Box>
              <PhotoGridApi
                photoSet={set2}
                setKey="set2"
                onPhotoUpdate={(photoId, canvasState) => onPhotoUpdate('set2', photoId, canvasState)}
                onPhotoRemove={(photoId) => onPhotoRemove('set2', photoId)}
                onPhotoClick={(photo) => onPhotoClick(photo, 'set2')}
                onPhotoMove={(fromIndex, toIndex) => onPhotoMove('set2', fromIndex, toIndex)}
                onFilesDropped={(files) => onFilesDropped(files)}
                customLabels={turningPointLabels.set2}
              />
            </Paper>
          );

          const shouldSideBySide = isLargeScreen && layoutMode === 'portrait';
          if (shouldSideBySide) {
            return (
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 4 }}>
                <Box sx={{ flex: 1 }}>{Set1}</Box>
                <Box sx={{ flex: 1 }}>{Set2}</Box>
              </Box>
            );
          }

          return (
            <>
              <Box sx={{ mb: 4 }}>{Set1}</Box>
              <Box>{Set2}</Box>
            </>
          );
        })()
      )}
    </Box>
  );
};

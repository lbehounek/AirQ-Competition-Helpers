import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { DropZone } from './DropZone';
import { PhotoGridApi } from './PhotoGridApi';
import { useI18n } from '../contexts/I18nContext';
import { generateTurningPointLabels } from '../utils/imageProcessing';

interface ApiPhoto {
  id: string;
  url: string;
  filename: string;
  canvasState: {
    position: { x: number; y: number };
    scale: number;
    brightness: number;
    contrast: number;
    sharpness: number;
    whiteBalance: {
      temperature: number;
      tint: number;
      auto: boolean;
    };
    labelPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  label: string;
  sessionId: string;
  uploadedAt: string;
}

interface ApiPhotoSet {
  title: string;
  photos: ApiPhoto[];
}

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

  // Calculate turning point labels
  const totalPhotos = set1.photos.length + set2.photos.length;
  const turningPointLabels = generateTurningPointLabels(totalPhotos);

  // Generate descriptive headings based on actual labels
  const getGridHeading = (labels: string[], isSet1: boolean) => {
    if (labels.length === 0) {
      // Default headings when no photos
      return isSet1 ? 'SP - TP8' : 'TP9 - FP';
    }
    if (labels.length === 1) return labels[0];
    return `${labels[0]} - ${labels[labels.length - 1]}`;
  };

  const grid1Heading = getGridHeading(turningPointLabels.set1, true);
  const grid2Heading = getGridHeading(turningPointLabels.set2, false);

  return (
    <Box>
      {/* Unified Drop Zone */}
      <Paper elevation={1} sx={{ p: 3, mb: 4 }}>
        <DropZone
          onFilesDropped={onFilesDropped}
          setName={t('turningpoint.photos')}
          currentPhotoCount={totalPhotoCount}
          maxPhotos={18}
          loading={loading}
          error={error}
        />
      </Paper>

      {/* Grid 1: Photos 1-9 (SP, TP1-TP8) */}
      <Paper elevation={3} sx={{ p: 4, mb: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.light' }}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" color="primary" sx={{ fontWeight: 600 }}>
            {grid1Heading}
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

      {/* Grid 2: Photos 10-18 (TP9-TP16, FP) */}
      <Paper elevation={3} sx={{ p: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.light' }}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" color="primary" sx={{ fontWeight: 600 }}>
            {grid2Heading}
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
    </Box>
  );
};

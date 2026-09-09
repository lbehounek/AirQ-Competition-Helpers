import React, { useCallback, useMemo } from 'react';
import { Box, Paper, Typography, useMediaQuery, useTheme } from '@mui/material';
import { GridSizedDropZone } from './GridSizedDropZone';
import { PhotoGridApi } from './PhotoGridApi';
import { useI18n } from '../contexts/I18nContext';
import { generateTurningPointLabels } from '../utils/imageProcessing';
import type { ApiPhoto, ApiPhotoSet } from '../types/api';
import { useLayoutMode } from '../contexts/LayoutModeContext';
import { gridShapeFor } from '../utils/gridShapeFor';

interface TurningPointLayoutProps {
  set1: ApiPhotoSet;
  set2: ApiPhotoSet;
  loading: boolean;
  error: string | null;
  onFilesDropped: (setKey: 'set1' | 'set2', files: File[]) => void;
  /**
   * Called when the user makes the FIRST (empty-state) drop. In Rally this
   * can be up to 18 photos and needs to span both sets — the caller is
   * responsible for distributing. Falls back to set1 drop if omitted.
   */
  onInitialFilesDropped?: (files: File[]) => void;
  onPhotoClick: (photo: ApiPhoto, setKey: 'set1' | 'set2') => void;
  onPhotoUpdate: (setKey: 'set1' | 'set2', photoId: string, canvasState: ApiPhoto['canvasState']) => void;
  onPhotoRemove: (setKey: 'set1' | 'set2', photoId: string) => void;
  onPhotoMove: (setKey: 'set1' | 'set2', fromIndex: number, toIndex: number) => void;
  /**
   * Optional tray → slot promotion handler. AppApi passes one per set key; if
   * omitted, candidate drops on a slot are ignored (back-compat).
   */
  onCandidateDropped?: (setKey: 'set1' | 'set2', candidateId: string, slotIndex: number) => void;
  /** Insert a "no photo" placeholder at a slot in the given set (turning-point only). */
  onAddPlaceholder?: (setKey: 'set1' | 'set2', slotIndex: number) => void;
  totalPhotoCount: number;
  /**
   * Precision discipline only uses a single set of up to 9 photos
   * (SP + TP1…TP7 + FP) — user feedback 2026-04-18. Rally keeps the
   * existing two-set 18-photo flow.
   */
  isPrecision?: boolean;
}

// Precision turning-point mode caps at 9 photos per feedback 2026-04-18:
// SP + up to 7 turning points + FP.
const PRECISION_TURNING_MAX_PHOTOS = 9;
// Rally turning-point caps at 20 (= SP + 18 TP + FP) per feedback
// 2026-05-03. Per-set capacity is 10 in BOTH orientations — landscape
// grid auto-expands from 3×3 to 5×2 once a set reaches 10.
const RALLY_TURNING_MAX_PHOTOS = 20;

export const TurningPointLayout: React.FC<TurningPointLayoutProps> = ({
  set1,
  set2,
  loading,
  error,
  onFilesDropped,
  onInitialFilesDropped,
  onCandidateDropped,
  onAddPlaceholder,
  onPhotoClick,
  onPhotoUpdate,
  onPhotoRemove,
  onPhotoMove,
  totalPhotoCount,
  isPrecision = false
}) => {
  const { t } = useI18n();
  const { layoutMode } = useLayoutMode();
  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up('lg'));

  // Calculate turning point labels based on actual photo counts. In precision
  // mode set2 is hidden, so we pass 0 for its count — the label generator
  // produces SP + TP1..TPn + FP from the (capped) total.
  const effectiveSet2Count = isPrecision ? 0 : set2.photos.length;
  // Memoized: the label arrays are handed to `PhotoGridApi`, whose memo
  // comparator compares them by CONTENT precisely because this used to be a
  // fresh pair of arrays on every render of this component.
  const turningPointLabels = useMemo(
    () => generateTurningPointLabels(set1.photos.length, effectiveSet2Count, layoutMode),
    [set1.photos.length, effectiveSet2Count, layoutMode],
  );
  const initialDropMax = isPrecision ? PRECISION_TURNING_MAX_PHOTOS : RALLY_TURNING_MAX_PHOTOS;

  // Per-set adapters for the (setKey, …) props this component receives. All of
  // them used to be inline arrows, which made every prop of both grids change
  // identity on every render and defeated `React.memo(PhotoGridApi)` outright.
  const handleSet1Update = useCallback(
    (photoId: string, canvasState: ApiPhoto['canvasState']) => onPhotoUpdate('set1', photoId, canvasState),
    [onPhotoUpdate],
  );
  const handleSet2Update = useCallback(
    (photoId: string, canvasState: ApiPhoto['canvasState']) => onPhotoUpdate('set2', photoId, canvasState),
    [onPhotoUpdate],
  );
  const handleSet1Remove = useCallback((photoId: string) => onPhotoRemove('set1', photoId), [onPhotoRemove]);
  const handleSet2Remove = useCallback((photoId: string) => onPhotoRemove('set2', photoId), [onPhotoRemove]);
  const handleSet1Click = useCallback((photo: ApiPhoto) => onPhotoClick(photo, 'set1'), [onPhotoClick]);
  const handleSet2Click = useCallback((photo: ApiPhoto) => onPhotoClick(photo, 'set2'), [onPhotoClick]);
  const handleSet1Move = useCallback(
    (fromIndex: number, toIndex: number) => onPhotoMove('set1', fromIndex, toIndex),
    [onPhotoMove],
  );
  const handleSet2Move = useCallback(
    (fromIndex: number, toIndex: number) => onPhotoMove('set2', fromIndex, toIndex),
    [onPhotoMove],
  );
  const handleSet1Files = useCallback((files: File[]) => onFilesDropped('set1', files), [onFilesDropped]);
  const handleSet2Files = useCallback((files: File[]) => onFilesDropped('set2', files), [onFilesDropped]);
  // These three stay conditionally undefined — the grid treats "absent" as
  // "this affordance does not exist", so a wrapper must not be substituted.
  const handleSet1Candidate = useMemo(
    () => (onCandidateDropped ? (id: string, idx: number) => onCandidateDropped('set1', id, idx) : undefined),
    [onCandidateDropped],
  );
  const handleSet2Candidate = useMemo(
    () => (onCandidateDropped ? (id: string, idx: number) => onCandidateDropped('set2', id, idx) : undefined),
    [onCandidateDropped],
  );
  const handleSet1AddPlaceholder = useMemo(
    () => (onAddPlaceholder ? (idx: number) => onAddPlaceholder('set1', idx) : undefined),
    [onAddPlaceholder],
  );
  const handleSet2AddPlaceholder = useMemo(
    () => (onAddPlaceholder ? (idx: number) => onAddPlaceholder('set2', idx) : undefined),
    [onAddPlaceholder],
  );
  // Empty-state zone: `onInitialFilesDropped` wins, otherwise everything lands
  // in set1 (an empty set always fills slot 0).
  const handleInitialFiles = useCallback(
    (files: File[]) => (onInitialFilesDropped ? onInitialFilesDropped(files) : onFilesDropped('set1', files)),
    [onInitialFilesDropped, onFilesDropped],
  );
  const handleInitialCandidate = useMemo(
    () => (onCandidateDropped ? (id: string) => onCandidateDropped('set1', id, 0) : undefined),
    [onCandidateDropped],
  );

  // Per-set cap is 10 in both orientations. Logic is in `utils/gridShapeFor.ts`
  // so the boundary at count === 10 is unit-testable (round-5 follow-up to
  // feedback 2026-05-03). Applied to precision too: the PDF switches a
  // landscape page to 5×2 on photo count alone, so excluding precision here
  // made a 10-photo set show 9 on screen and print 10.
  const set1Grid = gridShapeFor(set1.photos.length, layoutMode);
  const set2Grid = gridShapeFor(set2.photos.length, layoutMode);
  const rallyMaxPerSet = isPrecision ? undefined : 10;

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
            onFilesDropped={handleInitialFiles}
            maxPhotos={initialDropMax}
            loading={loading}
            error={error}
            // The empty TP zone's file drops default to set1, so candidate-tray
            // drops land there too (an empty set always fills slot 0).
            setKey="set1"
            onCandidateDropped={handleInitialCandidate}
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
                onPhotoUpdate={handleSet1Update}
                onPhotoRemove={handleSet1Remove}
                onPhotoClick={handleSet1Click}
                onPhotoMove={handleSet1Move}
                onFilesDropped={handleSet1Files}
                onCandidateDropped={handleSet1Candidate}
                onAddPlaceholder={handleSet1AddPlaceholder}
                customLabels={turningPointLabels.set1}
                maxPhotosOverride={rallyMaxPerSet}
                slotsOverride={set1Grid?.slots}
                columnsOverride={set1Grid?.columns}
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
                onPhotoUpdate={handleSet2Update}
                onPhotoRemove={handleSet2Remove}
                onPhotoClick={handleSet2Click}
                onPhotoMove={handleSet2Move}
                onFilesDropped={handleSet2Files}
                onCandidateDropped={handleSet2Candidate}
                onAddPlaceholder={handleSet2AddPlaceholder}
                customLabels={turningPointLabels.set2}
                maxPhotosOverride={rallyMaxPerSet}
                slotsOverride={set2Grid?.slots}
                columnsOverride={set2Grid?.columns}
              />
            </Paper>
          );

          // Precision: only ever render the first set (no second page).
          if (isPrecision) {
            return <Box>{Set1}</Box>;
          }

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

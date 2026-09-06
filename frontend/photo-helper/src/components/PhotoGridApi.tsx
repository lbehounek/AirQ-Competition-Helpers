import React, { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { Box, Button, Typography, Paper, CircularProgress, IconButton, Tooltip } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { Image as ImageIcon, CloudUpload, Close } from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import { PhotoEditorApi } from './PhotoEditorApi';
import { isValidImageFile } from '../utils/imageProcessing';
import { useElectronPhotoImport } from '../hooks/useElectronPhotoImport';
import { useAspectRatio } from '../contexts/AspectRatioContext';
import { useLabeling } from '../contexts/LabelingContext';
import { useI18n } from '../contexts/I18nContext';
import { useLayoutMode } from '../contexts/LayoutModeContext';
import { getImageCache } from '../utils/imageCache';
import { useStableCallback } from '../hooks/useStableCallback';
import { debugLog } from '../utils/debugLog';
import { parseDragPayload, serializeDragPayload, DRAG_PAYLOAD_MIME } from '../utils/dragPayload';
import { dispatchSlotDrop } from '../utils/slotDropDispatch';
import type { ApiPhoto, ApiPhotoSet } from '../types/api';

interface PhotoGridApiProps {
  photoSet: ApiPhotoSet;
  setKey: 'set1' | 'set2';
  onPhotoUpdate: (photoId: string, canvasState: ApiPhoto['canvasState']) => void;
  onPhotoRemove: (photoId: string) => void;
  onPhotoClick?: (photo: ApiPhoto) => void;
  onFilesDropped?: (files: File[]) => void; // For uploading files to empty slots
  onPhotoMove?: (fromIndex: number, toIndex: number) => void; // For drag-and-drop reordering
  /**
   * Candidate-tray → slot promotion handler. Receives the candidate's photo
   * id and the target slot index. The hook layer handles swap-on-occupied
   * semantics; the grid just decides where to drop. See
   * docs/CANDIDATE_PHOTOS.md "Drag/drop interactions".
   */
  onCandidateDropped?: (candidateId: string, slotIndex: number) => void;
  /**
   * Optional hint hook for the (out-of-scope-in-v1) cross-set slot→slot drag.
   * Fired when a user drops a slot photo from another set onto this grid.
   * AppApi uses it to nudge the user toward the tray (PR #62 review I4 —
   * previously silently ignored).
   */
  onCrossSetDropRejected?: () => void;
  labelOffset?: number; // Offset for label sequence (e.g., set2 continues from where set1 left off)
  customLabels?: string[]; // Custom labels to use instead of generated ones (for turning point mode)
  /**
   * Override the photo cap from `layoutConfig.maxPhotosPerSet`. Used by precision
   * track mode (feedback 2026-04-18): the layout auto-switches between 9 and 10
   * slots based on actual photo count, but the cap needs to stay at 10 in both
   * layouts so a 10th upload can still land and flip the layout to portrait.
   */
  maxPhotosOverride?: number;
  /**
   * Override the rendered grid slot count and column count. Used by rally
   * turning-point mode (feedback 2026-05-03): per-set capacity is 10 in both
   * orientations, so a landscape grid with 10 photos must render as 5×2
   * instead of the default 3×3 (which silently hid the 10th photo).
   */
  slotsOverride?: number;
  columnsOverride?: number;
  /**
   * Insert a "no photo" placeholder at the given slot index. Provided only in
   * turning-point mode (the affordance is hidden on track sheets). Wired to the
   * hook's `addPlaceholderToSet`.
   */
  onAddPlaceholder?: (slotIndex: number) => void;
}

interface GridSlot {
  id: string;
  index: number;
  label: string;
  photo: ApiPhoto | null;
}

interface PhotoGridSlotEmptyProps {
  label: string;
  position: number;
  /**
   * Always present (the parent wraps the optional prop in `useStableCallback`,
   * which never returns undefined). Whether a drop should actually do anything
   * is carried by `canDropFiles` instead — see that prop.
   */
  onFilesDropped: (files: File[]) => void;
  /**
   * False when the parent received no `onFilesDropped`. Replaces the old
   * `onFilesDropped && …` presence tests, which a stable wrapper would have
   * silently turned into "always true".
   */
  canDropFiles: boolean;
  maxFilesRemaining?: number;
  /** Shows a "No photo" button that inserts a placeholder in this slot. */
  showAddNoPhoto: boolean;
  /** Stable; only called when `showAddNoPhoto` is true. */
  onAddNoPhoto: () => void;
}

interface PhotoGridSlotProps {
  index: number;
  label: string;
  photo: ApiPhoto | null;
  setKey: 'set1' | 'set2';
  labelMode: 'track' | 'turningpoint';
  cssRatio: string;
  isDragOver: boolean;
  isDragging: boolean;
  /** Every callback below is identity-stable (`useStableCallback` in the parent). */
  onSlotUpdate: (photoId: string, canvasState: ApiPhoto['canvasState']) => void;
  onSlotRemove: (photoId: string) => void;
  onSlotClick: (photo: ApiPhoto) => void;
  onDragStart: (e: React.DragEvent, index: number, photoId: string | undefined) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  canDropFiles: boolean;
  onFilesDropped: (files: File[]) => void;
  maxFilesRemaining: number;
  showAddPlaceholder: boolean;
  onAddPlaceholder: (index: number) => void;
}

/**
 * One grid cell: the frame, the drag affordances and either a photo editor, a
 * "no photo" placeholder card or the empty-slot dropzone.
 *
 * Memoized (shallow) — this is where the WP's win lands. Editing photo A
 * produces a new `photos` ARRAY but leaves every other `ApiPhoto` object's
 * identity intact (`updatePhotoState` maps only the edited one), and every
 * callback prop is stabilized by the parent, so B..N skip the render entirely
 * and never redraw their canvases. Returns the rendered cell.
 */
const PhotoGridSlot = React.memo(function PhotoGridSlot({
  index,
  label,
  photo,
  setKey,
  labelMode,
  cssRatio,
  isDragOver,
  isDragging,
  onSlotUpdate,
  onSlotRemove,
  onSlotClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  canDropFiles,
  onFilesDropped,
  maxFilesRemaining,
  showAddPlaceholder,
  onAddPlaceholder,
}: PhotoGridSlotProps) {
  const { t } = useI18n();
  // Bind the per-slot handlers to primitives only, so they stay stable while
  // the photo object is unchanged — otherwise `React.memo(PhotoEditorApi)`
  // below would never get a chance to skip.
  const photoId = photo?.id;

  const handleUpdate = useCallback(
    (canvasState: ApiPhoto['canvasState']) => {
      if (photoId) onSlotUpdate(photoId, canvasState);
    },
    [photoId, onSlotUpdate],
  );

  const handleClick = useCallback(() => {
    if (photo) onSlotClick(photo);
  }, [photo, onSlotClick]);

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent triggering photo click
      if (photoId) onSlotRemove(photoId);
    },
    [photoId, onSlotRemove],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => onDragStart(e, index, photoId),
    [onDragStart, index, photoId],
  );
  const handleDragOver = useCallback(
    (e: React.DragEvent) => onDragOver(e, index),
    [onDragOver, index],
  );
  const handleDrop = useCallback((e: React.DragEvent) => onDrop(e, index), [onDrop, index]);
  const handleAddNoPhoto = useCallback(() => onAddPlaceholder(index), [onAddPlaceholder, index]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Paper
        elevation={photo ? 2 : 0}
        draggable={photo ? true : false}
        onDragStart={photo ? handleDragStart : undefined}
        onDragEnd={photo ? onDragEnd : undefined}
        onDragOver={handleDragOver}
        onDragLeave={onDragLeave}
        onDrop={handleDrop}
        sx={{
          aspectRatio: cssRatio,
          bgcolor: photo ? 'background.paper' : 'grey.50',
          // Remove tile borders for a cleaner look; rely on spacing and hover glows
          border: 'none',
          borderRadius: 0, // Rectangular to match PDF output
          overflow: 'hidden',
          position: 'relative',
          transition: 'all 0.2s ease-in-out',
          cursor: photo ? 'grab' : 'default',
          opacity: isDragging ? 0.5 : 1,
          transform: isDragOver ? 'scale(1.02)' : 'scale(1)',
          boxShadow: isDragOver
            ? '0 0 20px rgba(76, 175, 80, 0.6)' // Green glow when drag over
            : photo
              ? '0 0 12px rgba(33, 150, 243, 0.4)' // Blue glow for photos
              : 'none',
          '&:hover': photo ? {
            boxShadow: '0 0 12px rgba(33, 150, 243, 0.4)'
          } : {}
        }}
      >
        {photo ? (
          <Box
            onClick={photo.isPlaceholder ? undefined : handleClick}
            sx={{
              cursor: photo.isPlaceholder ? 'default' : 'pointer',
              width: '100%',
              height: '100%',
              position: 'relative',
              '&:hover .hover-overlay': {
                opacity: 1
              },
              '&:hover .delete-button': {
                opacity: 1,
                boxShadow: '0 0 12px rgba(0, 0, 0, 0.6)'
              }
            }}
          >
            {photo.isPlaceholder ? (
              // "No photo" placeholder cell: a blank frame holding the slot
              // position, with its TP/SP/FP label (bottom-left, mirroring
              // drawLabel) and a centered "No photo" caption. No PhotoEditorApi
              // (it has no image; routing it there would spin "Loading…" forever).
              <Box sx={{ width: '100%', height: '100%', position: 'relative', bgcolor: 'grey.100', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="body2" sx={{ color: 'text.disabled', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, userSelect: 'none' }}>
                  {t('photo.noPhotoCell')}
                </Typography>
                {label && (
                  <Box sx={{ position: 'absolute', bottom: 4, left: 4, bgcolor: 'rgba(0, 0, 0, 0.7)', color: 'white', fontSize: '0.75rem', fontWeight: 600, px: 1, py: 0.25, borderRadius: 1, pointerEvents: 'none' }}>
                    {label}
                  </Box>
                )}
              </Box>
            ) : (
              <PhotoEditorApi
                key={photo.id} // Stable key based on photo ID to prevent remounting
                photo={photo}
                label={label}
                onUpdate={handleUpdate}
                size="grid" // Small size for grid view
                setKey={setKey} // Pass setKey for PDF generation
                mode={labelMode}
              />
            )}

            {/* Delete button — kept OUTSIDE the dark hover-overlay so it
                has its own visibility. Previously embedded inside the
                overlay at `opacity:0`, which only revealed it on hover —
                user feedback (M., 2026-05-15) reported it was undiscoverable.
                Now visible always at 0.6 opacity, full opacity on tile
                hover, with a Czech-aware tooltip. */}
            <Tooltip title={t('photo.deleteTooltip')} placement="left" enterDelay={400}>
              <IconButton
                className="delete-button"
                onClick={handleRemove}
                aria-label={t('photo.deleteTooltip')}
                sx={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  width: 36,
                  height: 36,
                  bgcolor: 'rgba(220, 53, 69, 0.92)', // Red so the destructive action reads at a glance
                  color: 'white',
                  borderRadius: '6px',
                  opacity: 0.6, // Visible at rest — the whole point of this change
                  transition: 'opacity 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease',
                  zIndex: 2, // Above the dark hover overlay so the red badge stays legible
                  '&:hover': {
                    bgcolor: 'rgba(200, 35, 51, 1)',
                    transform: 'scale(1.08)',
                    opacity: 1,
                  }
                }}
                size="medium"
              >
                <Close sx={{ fontSize: 22 }} />
              </IconButton>
            </Tooltip>

            {/* Hover overlay — dim + "click to edit" hint. Delete button
                is now a sibling above, not a child, so its visibility no
                longer depends on the overlay opacity. Hidden for placeholders
                (they aren't editable). */}
            {!photo.isPlaceholder && (
              <Box
                className="hover-overlay"
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  bgcolor: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  transition: 'opacity 0.2s ease-in-out',
                  pointerEvents: 'none'
                }}
              >
                <Typography
                  variant="body1"
                  sx={{
                    color: 'white',
                    fontWeight: 600,
                    textShadow: '0 2px 4px rgba(0,0,0,0.8)'
                  }}
                >
                  {t('photo.clickToEdit')}
                </Typography>
              </Box>
            )}
          </Box>
        ) : (
          <PhotoGridSlotEmpty
            label={label}
            position={index + 1}
            onFilesDropped={onFilesDropped}
            canDropFiles={canDropFiles}
            maxFilesRemaining={maxFilesRemaining}
            showAddNoPhoto={showAddPlaceholder}
            onAddNoPhoto={handleAddNoPhoto}
          />
        )}
      </Paper>
      {/* Filename caption — screen only; the PDF generator rasterizes
          canvases by data-photo-id, so this DOM text is never emitted
          to print. Keeps the photo itself undisturbed for the
          competitor's view (feedback 2026-04-23). */}
      {photo?.filename && !photo.isPlaceholder && (
        <Typography
          variant="caption"
          title={photo.filename}
          sx={{
            mt: 0.5,
            px: 0.5,
            fontFamily: 'monospace',
            fontSize: '0.65rem',
            color: 'text.secondary',
            textAlign: 'center',
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            userSelect: 'text',
            '@media print': { display: 'none' },
          }}
        >
          {photo.filename}
        </Typography>
      )}
    </Box>
  );
});

/**
 * Element-wise comparison of the two optional label arrays.
 * @returns true when both are absent, or both hold the same strings in order.
 */
function sameStringArray(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, i) => value === b[i]);
}

/**
 * `React.memo` comparator for the grid.
 *
 * Everything is compared by identity except `customLabels`, which
 * `TurningPointLayout` rebuilds with `generateTurningPointLabels` on every one
 * of its renders — an unavoidable fresh array that would defeat a plain
 * shallow memo. Callbacks are deliberately NOT ignored: `useStableCallback`
 * refreshes its ref in a layout effect of THIS component's subtree, so
 * skipping the render would freeze the old closure and silently drop later
 * updates. That makes this memo correct today (it never serves a stale
 * handler) and effective once the callers pass stable callbacks.
 *
 * @returns true when the props are equivalent and the render can be skipped.
 */
function arePhotoGridPropsEqual(a: PhotoGridApiProps, b: PhotoGridApiProps): boolean {
  const keys = Object.keys({ ...a, ...b }) as (keyof PhotoGridApiProps)[];
  for (const key of keys) {
    if (key === 'customLabels') continue;
    if (!Object.is(a[key], b[key])) return false;
  }
  return sameStringArray(a.customLabels, b.customLabels);
}

const PhotoGridApiImpl: React.FC<PhotoGridApiProps> = ({
  photoSet,
  setKey,
  onPhotoUpdate,
  onPhotoRemove,
  onPhotoClick,
  onFilesDropped,
  onPhotoMove,
  onCandidateDropped,
  onCrossSetDropRejected,
  labelOffset = 0,
  customLabels,
  maxPhotosOverride,
  slotsOverride,
  columnsOverride,
  onAddPlaceholder,
}) => {
  const { currentRatio, isTransitioning } = useAspectRatio();
  const { generateLabel } = useLabeling();

  // Turning-point sets supply customLabels (SP/TP1../FP); track sets don't.
  // Reuse that existing signal to size the burned-in photo label per discipline
  // (track −20%, turning −35%; feedback 2026-06-19).
  const labelMode: 'track' | 'turningpoint' = customLabels ? 'turningpoint' : 'track';

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Preload images when the SET's contents actually change.
  //
  // WHY the key: `photoSet.photos` is a brand-new array on every canvasState
  // edit (`updatePhotoState` maps it) and again when the persisted session
  // lands, so an effect keyed on the array re-ran the whole preload pass twice
  // per slider tick. Identity + URL is what the cache actually keys on, so
  // this only re-runs when a photo is added, removed, reordered or re-blobbed.
  // The ref keeps the effect honest without an eslint-disable: the key decides
  // WHEN to preload, the ref supplies the current list to preload.
  const photosRef = useRef(photoSet.photos);
  useLayoutEffect(() => {
    photosRef.current = photoSet.photos;
  });
  const preloadKey = useMemo(
    () => photoSet.photos.map(p => `${p.id}:${p.url}`).join('\n'),
    [photoSet.photos],
  );
  useEffect(() => {
    if (!preloadKey) return;
    getImageCache().preloadImages(photosRef.current).catch(err => {
      console.error('Failed to preload images:', err);
    });
  }, [preloadKey]);

  // Import the layout mode hook
  const { layoutConfig } = useLayoutMode();
  const effectiveMaxPhotos = maxPhotosOverride ?? layoutConfig.maxPhotosPerSet;
  const maxFilesRemaining = Math.max(0, effectiveMaxPhotos - photoSet.photos.length);
  // Effective grid: defaults to the layout config; rally turning-point in
  // landscape passes overrides so a 10-photo set renders as 5×2 instead of
  // the default 3×3 (feedback 2026-05-03).
  const effectiveSlots = slotsOverride ?? layoutConfig.slots;
  const effectiveColumns = columnsOverride ?? layoutConfig.columns;

  // Create grid slots based on layout mode (9 for landscape, 10 for portrait)
  const gridSlots: GridSlot[] = Array.from({ length: effectiveSlots }, (_, index) => {
    const photo = photoSet.photos[index] || null;

    // Only show labels when there's a photo, or in track mode for empty slots
    let label = '';
    if (photo) {
      // Photo exists - always show label
      label = customLabels && customLabels[index]
        ? customLabels[index]
        : generateLabel(index, labelOffset);
    } else if (!customLabels) {
      // Empty slot in track mode - show label
      label = generateLabel(index, labelOffset);
    }
    // Empty slot in turning point mode - no label (label stays empty string)

    return {
      id: `${setKey}-slot-${index}`,
      index,
      label,
      photo
    };
  });


  // Drag and drop handlers
  //
  // Two payload channels:
  //   text/plain                 — legacy in-grid reorder: just the slot index
  //   application/x-airq-photo   — structured payload for tray↔slot transfers.
  //                                 See `utils/dragPayload.ts` for the parser
  //                                 and the strict literal-union check on
  //                                 setKey (PR #62 review G3 — formerly
  //                                 duplicated inline in two components).
  // Slot drags emit both so the tray can recognise the source. The grid only
  // needs the structured payload on drops that *could* be from the tray.
  //
  // Every handler below goes through `useStableCallback`: they close over
  // props and state that change constantly, but the identity handed to the
  // memoized slots must not, or no slot would ever skip a render. The
  // latest-ref inside keeps the closures current.
  const handleDragStart = useStableCallback((e: React.DragEvent, index: number, photoId: string | undefined) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    if (photoId) {
      e.dataTransfer.setData(
        DRAG_PAYLOAD_MIME,
        serializeDragPayload({ kind: 'slot', setKey, index, photoId }),
      );
    }

    // Create custom drag image (optional - use default for now)
    (e.currentTarget as HTMLElement).style.opacity = '0.5';
  });

  const handleDragEnd = useStableCallback((e: React.DragEvent) => {
    setDraggedIndex(null);
    setDragOverIndex(null);
    (e.currentTarget as HTMLElement).style.opacity = '1';
  });

  const handleDragOver = useStableCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  });

  const handleDragLeave = useStableCallback(() => {
    setDragOverIndex(null);
  });

  const handleDrop = useStableCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();

    // Dispatch decided by a pure helper (PR #62 review I4) — the component
    // stays in charge of drag-state resets but no longer holds the branch
    // logic, which is unit-tested in slotDropDispatch.test.ts.
    const action = dispatchSlotDrop({
      payload: parseDragPayload(e.dataTransfer.getData(DRAG_PAYLOAD_MIME)),
      textPlain: e.dataTransfer.getData('text/plain'),
      files: Array.from(e.dataTransfer.files),
      dropIndex,
      setKey,
      isValidImageFile,
    });

    switch (action.kind) {
      case 'promote':
        if (onCandidateDropped) onCandidateDropped(action.photoId, action.dropIndex);
        break;
      case 'cross-set-rejected':
        if (onCrossSetDropRejected) onCrossSetDropRejected();
        break;
      case 'reorder':
        if (onPhotoMove) onPhotoMove(action.fromIndex, action.toIndex);
        break;
      case 'files':
        // Native OS file drop on an occupied slot — without this branch the
        // files vanished from the cursor silently because `e.preventDefault()`
        // already suppressed the dropzone wrapper. Route to smart-drop so it
        // sends the batch to the candidate tray.
        if (onFilesDropped) onFilesDropped(action.files);
        break;
      case 'none':
        break;
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  });

  // Same treatment for the callbacks handed straight down to a slot. A stable
  // wrapper is never `undefined`, so the "is this handler present?" questions
  // the old inline JSX asked become explicit booleans computed here, from the
  // ORIGINAL props.
  const onSlotUpdate = useStableCallback(onPhotoUpdate);
  const onSlotRemove = useStableCallback(onPhotoRemove);
  const onSlotClick = useStableCallback(onPhotoClick);
  const onSlotFilesDropped = useStableCallback(onFilesDropped);
  const onSlotAddPlaceholder = useStableCallback(onAddPlaceholder);
  const canDropFiles = !!onFilesDropped;
  const canAddPlaceholder = labelMode === 'turningpoint' && !!onAddPlaceholder;

  return (
    <Box sx={{ width: '100%', position: 'relative' }}>
      {isTransitioning ? (
        /* Loading State During Aspect Ratio Transition */
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
          bgcolor: 'background.paper',
          borderRadius: 2,
          // Removed outer grid border (redundant)
          border: 'none',
          boxShadow: 0,
          p: 4
        }}>
          <CircularProgress size={48} color="primary" sx={{ mb: 2 }} />
          <Typography variant="body1" color="text.secondary">
            Updating aspect ratio...
          </Typography>
        </Box>
      ) : (
        /* Dynamic Photo Grid (3x3 or 2x5 based on layout) */
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${effectiveColumns}, 1fr)`,
          gap: 2,
          p: 2,
          bgcolor: 'background.paper',
          borderRadius: 2,
          // Removed outer grid border (redundant)
          border: 'none',
          boxShadow: 0,
          // Expand to fill parent width in all cases; parent handles xl constraint
          maxWidth: '100%',
          mx: 'unset'
        }}>
        {gridSlots.map((slot) => (
          <PhotoGridSlot
            key={slot.id}
            index={slot.index}
            label={slot.label}
            photo={slot.photo}
            setKey={setKey}
            labelMode={labelMode}
            cssRatio={currentRatio.cssRatio}
            isDragOver={dragOverIndex === slot.index}
            isDragging={draggedIndex === slot.index}
            onSlotUpdate={onSlotUpdate}
            onSlotRemove={onSlotRemove}
            onSlotClick={onSlotClick}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            canDropFiles={canDropFiles}
            onFilesDropped={onSlotFilesDropped}
            maxFilesRemaining={maxFilesRemaining}
            // The "No photo" affordance only ever sits on the first empty slot.
            showAddPlaceholder={canAddPlaceholder && slot.index === photoSet.photos.length}
            onAddPlaceholder={onSlotAddPlaceholder}
          />
        ))}
        </Box>
      )}
    </Box>
  );
};

/**
 * Memoized public export. See `arePhotoGridPropsEqual` for why `customLabels`
 * needs a content comparison and why the callbacks do not get one.
 */
export const PhotoGridApi = React.memo(PhotoGridApiImpl, arePhotoGridPropsEqual);
PhotoGridApi.displayName = 'PhotoGridApi';

/**
 * Empty grid cell: a react-dropzone target (or an Electron file-dialog button
 * where the native picker is available) plus the optional "No photo" action.
 * Memoized so a drag over a neighbouring slot doesn't re-run `useDropzone`
 * across the whole grid.
 */
const PhotoGridSlotEmpty = React.memo(function PhotoGridSlotEmpty({
  label,
  position: _position,
  onFilesDropped,
  canDropFiles,
  maxFilesRemaining,
  showAddNoPhoto,
  onAddNoPhoto,
}: PhotoGridSlotEmptyProps) {
  const theme = useTheme();
  const { t } = useI18n();
  const electronImport = useElectronPhotoImport();
  const useElectronDialog = electronImport.isAvailable;
  const slotMaxFiles = maxFilesRemaining ?? 9;
  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject
  } = useDropzone({
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png']
    },
    maxFiles: slotMaxFiles, // Respect layout-dependent remaining capacity
    noClick: useElectronDialog,
    onDrop: (acceptedFiles, rejectedFiles) => {
      debugLog('Drop event - Accepted:', acceptedFiles, 'Rejected:', rejectedFiles);

      // `canDropFiles`, not `onFilesDropped &&`: the handler is a stable
      // wrapper and is therefore always truthy.
      if (acceptedFiles.length > 0 && canDropFiles) {
        // Filter out valid files
        const validFiles = acceptedFiles.filter(file => isValidImageFile(file));
        if (validFiles.length > 0) {
          onFilesDropped(validFiles);
        }
      }
    }
  });

  const handleElectronClick = async () => {
    if (electronImport.isImporting) return;
    if (!canDropFiles) return;
    await electronImport.pickPhotos(slotMaxFiles, onFilesDropped);
  };

  // Determine border color based on drag state
  const borderColor = isDragActive
    ? (isDragAccept ? 'success.main' : (isDragReject ? 'error.main' : 'primary.main'))
    : 'grey.300';

  const bgColor = isDragActive
    ? (isDragAccept
        ? alpha(theme.palette.success.main, 0.08)
        : (isDragReject ? alpha(theme.palette.error.main, 0.08) : alpha(theme.palette.primary.main, 0.08)))
    : theme.palette.grey[50];

  return (
    <Box
      {...getRootProps({ onClick: useElectronDialog ? handleElectronClick : undefined })}
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: bgColor,
        color: isDragActive ? (isDragAccept ? 'success.main' : (isDragReject ? 'error.main' : 'primary.main')) : 'grey.500',
        border: '2px dashed',
        borderColor,
        borderRadius: 1,
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          borderColor: 'primary.main',
          color: 'primary.main'
        }
      }}
    >
      <input {...getInputProps()} />

      {electronImport.importError ? (
        // Replace the slot's normal contents with an inline error so the
        // grid layout doesn't reflow — clicking the slot dismisses the
        // error and returns it to the dropzone state.
        <Box
          onClick={(e) => { e.stopPropagation(); electronImport.clearImportError(); }}
          sx={{ p: 1, textAlign: 'center', color: 'warning.dark' }}
        >
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 500 }}>
            {electronImport.importError}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.7, mt: 0.5 }}>
            {t('upload.clickOrDrop')}
          </Typography>
        </Box>
      ) : isDragActive ? (
        <>
          <CloudUpload sx={{ fontSize: 32, mb: 1, opacity: 0.7 }} />
          <Typography variant="body2" sx={{ fontWeight: 500, textAlign: 'center', px: 1 }}>
            {isDragAccept ? t('upload.dropImages') : 'Invalid file type'}
          </Typography>
        </>
      ) : (
        <>
          <ImageIcon sx={{ fontSize: 28, mb: 1, opacity: 0.5 }} />
          {label && (
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                fontSize: '1.1rem',
                color: 'text.secondary',
                mb: 0.5
              }}
            >
              {label}
            </Typography>
          )}
          <Typography variant="caption" sx={{ opacity: 0.7, textAlign: 'center', px: 1 }}>
            {t('upload.clickOrDrop')}
          </Typography>
          {showAddNoPhoto && (
            // Turning-point only: reserve this slot as a "no photo" placeholder
            // so the surrounding TP numbering stays correct. stopPropagation +
            // preventDefault so it doesn't trigger the dropzone's file picker.
            <Button
              size="small"
              variant="text"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onAddNoPhoto(); }}
              sx={{ mt: 0.75, fontSize: '0.7rem', textTransform: 'none', color: 'text.secondary', minWidth: 0, px: 1, '&:hover': { color: 'primary.main' } }}
            >
              {t('photo.addNoPhoto')}
            </Button>
          )}
        </>
      )}
    </Box>
  );
});

import { useCallback, useMemo, useRef, useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight, HelpOutline } from '@mui/icons-material';
import { PhotoEditorApi } from './PhotoEditorApi';
import { PhotoControls } from './PhotoControls';
import { useDebouncedCommit } from '../hooks/useDebouncedCommit';
import { useI18n } from '../contexts/I18nContext';
import type { ApiPhoto } from '../types/api';
import type { CanvasSetting, CanvasState, LabelPosition } from '../utils/canvasStatePatch';

/**
 * The photo-editor modal's contents: the canvas, the two control panels, the
 * filename caption and the prev/next pager.
 *
 * WHY this is its own component rather than inline JSX in `AppApi`: it owns
 * the LIVE PREVIEW of an in-progress edit. A slider drag fires ~60 updates a
 * second, and while that state lived in `AppApi` every one of them re-rendered
 * the whole app — which means every mounted grid and candidate-tray canvas
 * redrew, because `AspectRatioContext.getCanvasSize` hands back a fresh object
 * each render and that object sits in `PhotoEditorApi`'s render dependencies.
 * Holding the preview here confines per-pointermove work to this subtree: one
 * canvas plus two panels. Only the COMMIT (debounced, once per interaction)
 * reaches `AppApi` and the persistence layer.
 */
export interface PhotoEditorModalBodyProps {
  /** The photo under edit, its bucket, and its printed label. Never null — the caller renders this component only when a photo is selected. */
  selected: {
    photo: ApiPhoto;
    setKey: 'set1' | 'set2' | 'candidates';
    label: string;
  };
  /** Discipline of the set, so the editor sizes the burned-in label correctly. */
  sessionMode?: 'track' | 'turningpoint';
  /** Persist a canvas-state DELTA for one photo. Called once per interaction, not once per frame. */
  onUpdate: (
    setKey: 'set1' | 'set2' | 'candidates',
    photoId: string,
    delta: Partial<CanvasState>,
  ) => void;
  onClose: () => void;
  /** 0-based position of this photo within `modalCount`, for the "3 / 12" pager. */
  modalIndex: number;
  modalCount: number;
  canPrev: boolean;
  canNext: boolean;
  onNavigate: (dir: -1 | 1) => void;
  onStartTour: () => void;
  /** Fan a numeric setting out to every photo. Absent → the button is hidden. */
  applySettingToAll?: (setting: CanvasSetting, value: number) => void;
  /** Fan the label corner out to every photo. Absent → the button is hidden. */
  applyLabelPositionToAll?: (position: LabelPosition) => void;
}

export function PhotoEditorModalBody({
  selected,
  sessionMode,
  onUpdate,
  onClose,
  modalIndex,
  modalCount,
  canPrev,
  canNext,
  onNavigate,
  onStartTour,
  applySettingToAll,
  applyLabelPositionToAll,
}: PhotoEditorModalBodyProps) {
  const { t } = useI18n();

  // Moved down from AppApi: both flags are read ONLY inside the modal, so
  // toggling them no longer has to re-render the grid.
  const [showOriginal, setShowOriginal] = useState(false);
  const [circleMode, setCircleMode] = useState(false);

  /**
   * The un-persisted, in-flight edit. Keyed by photo id so a stale overlay
   * left behind by prev/next is ignored on sight — no effect, no cleanup race.
   */
  const [preview, setPreview] = useState<{ photoId: string; patch: Partial<CanvasState> } | null>(null);

  const photoId = selected.photo.id;

  /**
   * Keys of the discrete action currently being committed, or null during a
   * debounced commit. Set for the duration of one synchronous `commitNow` call
   * (see `commitDiscrete`) and read by `commitFn` to pick its retirement rule.
   * A ref rather than an argument because the delta travels through
   * `useDebouncedCommit`, which merges it with the pending payload and so
   * cannot tell the two origins apart.
   */
  const authoritativeKeysRef = useRef<ReadonlySet<string> | null>(null);

  /** The photo as the user currently sees it: persisted state + live overlay. */
  const shownPhoto = useMemo(
    () => (preview && preview.photoId === photoId
      ? { ...selected.photo, canvasState: { ...selected.photo.canvasState, ...preview.patch } }
      : selected.photo),
    [selected.photo, preview, photoId],
  );

  /**
   * Persist one delta and retire the overlay in the SAME handler, so React
   * batches them into a single render: by the time the overlay is gone the
   * committed value has already been handed upstream, so nothing flickers back
   * to the pre-edit value in between.
   *
   * Retires only the fields this commit actually CARRIED, by one of two rules:
   *
   * - DEBOUNCED (`schedule`): retire only where the overlay still holds the very
   *   value being committed. A MUI slider fires `onPreview` per pointermove but
   *   `onCommit` only on release, so it never resets the debounce timer:
   *   re-grabbing a slider within 150 ms of letting go (a nudge, or a keyboard
   *   step followed by a drag) lets the timer fire mid-drag. Dropping the whole
   *   overlay there would discard the live value and snap the thumb and the
   *   canvas back to the just-committed one until the next pointermove — plus
   *   one wasted redraw. Value identity is the right test for the nested
   *   sub-objects too (`whiteBalance`, `circle`): `schedule` captures the same
   *   reference the overlay holds.
   *
   * - DISCRETE (`commitNow`: ↻ reset, global Reset, quick-zoom preset, auto or
   *   reset white balance, label corner, circle colour/remove): retire the
   *   action's OWN fields UNCONDITIONALLY. Such an action is authoritative — it
   *   sets a value rather than continuing a gesture — so an overlay entry that
   *   disagrees with it is stale by definition, not newer. Under the value
   *   identity rule alone a reset to 0 would leave the old preview (say 42)
   *   stuck in the overlay for the life of the modal: the editor and both
   *   control panels would keep showing 42, and the next pan would commit that
   *   42 back to storage, silently undoing the reset.
   *
   * Only the discrete action's own keys get that treatment, never the pending
   * debounced payload `commitNow` folds in alongside them: a zoom drag still in
   * flight when the user clicks "label corner" must keep its live overlay.
   */
  const commitFn = useCallback((delta: Partial<CanvasState>) => {
    const authoritative = authoritativeKeysRef.current;
    setPreview(p => {
      if (!p || p.photoId !== photoId) return p;
      const committed = delta as Record<string, unknown>;
      const rest = Object.fromEntries(
        Object.entries(p.patch).filter(([key, value]) =>
          !(key in committed) || (!authoritative?.has(key) && value !== committed[key])),
      ) as Partial<CanvasState>;
      return Object.keys(rest).length > 0 ? { photoId, patch: rest } : null;
    });
    onUpdate(selected.setKey, photoId, delta);
  }, [onUpdate, selected.setKey, photoId]);

  // One debounce per MODAL, not per control panel: the two PhotoControls
  // instances edit the same photo, so a separate timer each would let one
  // panel's pending delta race the other's commit.
  const { schedule, commitNow, flush } = useDebouncedCommit<Partial<CanvasState>>(commitFn, photoId);

  /**
   * `commitNow` for the discrete controls, flagging the action's own keys as
   * authoritative for the duration of the (synchronous) commit so `commitFn`
   * retires them from the overlay even when it holds a different value.
   * `finally` so a throw upstream cannot leave the flag set for the next
   * debounced commit.
   */
  const commitDiscrete = useCallback((delta: Partial<CanvasState>) => {
    authoritativeKeysRef.current = new Set(Object.keys(delta));
    try {
      commitNow(delta);
    } finally {
      authoritativeKeysRef.current = null;
    }
  }, [commitNow]);

  /** Merge a live value into the overlay (never persisted). */
  const handlePreview = useCallback((delta: Partial<CanvasState>) => {
    setPreview(p => ({
      photoId,
      patch: { ...(p && p.photoId === photoId ? p.patch : {}), ...delta },
    }));
  }, [photoId]);

  /**
   * `PhotoEditorApi` reports pan, circle drag and the auto-white-balance
   * result as FULL canvas-state snapshots. Preview first so its own
   * `localPosition` resync sees the new position immediately (otherwise the
   * photo snaps back mid-drag), then schedule — the 16-60 ms burst of a drag
   * coalesces into one write.
   */
  const handleEditorUpdate = useCallback((snapshot: CanvasState) => {
    handlePreview(snapshot);
    schedule(snapshot);
  }, [handlePreview, schedule]);

  // Apply-to-all reads the hook's current competition, and
  // `updateCurrentCompetition` runs synchronously up to its first await — so
  // the pending delta has to be published BEFORE the fan-out, or it would be
  // fanned out from the pre-edit value and then overwritten by our own commit.
  const handleApplyToAll = useCallback((setting: CanvasSetting, value: number) => {
    flush();
    applySettingToAll?.(setting, value);
  }, [flush, applySettingToAll]);

  const handleSyncLabelPositionToAll = useCallback((position: LabelPosition) => {
    flush();
    applyLabelPositionToAll?.(position);
  }, [flush, applyLabelPositionToAll]);

  return (
    <>
      {/* In-modal tour trigger — highlights the editor controls in place. */}
      <Tooltip title={t('tour.help.button')}>
        <IconButton
          size="small"
          onClick={onStartTour}
          aria-label={t('tour.help.button')}
          data-tour="editor-help"
          sx={{ position: 'absolute', top: 8, right: 48, zIndex: 2, color: 'text.secondary' }}
        >
          <HelpOutline />
        </IconButton>
      </Tooltip>
      {/* Modal Content - L-Shape Layout: Photo top-left, Controls wrapping around */}
      <Box data-tour="editor" sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '90vh', // Much taller content - utilizing saved header space
        maxHeight: '900px'
      }}>
        {/* Top Row: Photo (left) + Right Controls */}
        <Box sx={{
          display: 'flex',
          flex: '1 1 55%', // Reduced to 55% to give more space to bottom
          overflow: 'hidden'
        }}>
          {/* Photo - Top Left */}
          <Box data-tour="editor-photo" sx={{
            flex: '1 1 65%', // Take 65% of width
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'grey.50',
            px: 4, // Horizontal padding
            py: 10 // Much more vertical padding above and below photo
          }}>
            <PhotoEditorApi
              photo={shownPhoto}
              label={selected.label}
              onUpdate={handleEditorUpdate}
              size="large"
              setKey={selected.setKey}
              showOriginal={showOriginal}
              circleMode={circleMode}
              mode={sessionMode}
            />
            {/* Filename caption under the photo — screen only. */}
            {selected.photo.filename && (
              <Typography
                variant="caption"
                title={selected.photo.filename}
                sx={{
                  mt: 1.5,
                  fontFamily: 'monospace',
                  color: 'text.secondary',
                  userSelect: 'text',
                  '@media print': { display: 'none' },
                }}
              >
                {selected.photo.filename}
              </Typography>
            )}
            {/* Prev/next navigation within the same set/pool. Mirrors
                the ArrowLeft/ArrowRight keyboard shortcuts; hidden when
                the set has a single photo. Clamps at both ends. */}
            {modalCount > 1 && (
              <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <IconButton
                  size="small"
                  onClick={() => onNavigate(-1)}
                  disabled={!canPrev}
                  aria-label={t('modal.prevPhoto')}
                  title={t('modal.prevPhoto')}
                >
                  <ChevronLeft />
                </IconButton>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 48, textAlign: 'center' }}>
                  {modalIndex + 1} / {modalCount}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => onNavigate(1)}
                  disabled={!canNext}
                  aria-label={t('modal.nextPhoto')}
                  title={t('modal.nextPhoto')}
                >
                  <ChevronRight />
                </IconButton>
              </Box>
            )}
          </Box>

          {/* Right Controls */}
          <Box sx={{
            flex: '0 0 35%', // Take 35% of width
            borderLeft: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.default',
            overflow: 'auto'
          }}>
            <PhotoControls
              photo={shownPhoto}
              label={selected.label}
              onPreview={handlePreview}
              onCommit={schedule}
              onUpdate={commitDiscrete}
              onClose={onClose}
              mode="compact-right"
              showOriginal={showOriginal}
              onToggleOriginal={() => setShowOriginal(!showOriginal)}
              circleMode={circleMode}
              onCircleModeToggle={() => setCircleMode(!circleMode)}
              onApplyToAll={applySettingToAll ? handleApplyToAll : undefined}
              onSyncLabelPositionToAll={applyLabelPositionToAll ? handleSyncLabelPositionToAll : undefined}
            />
          </Box>
        </Box>

        {/* Bottom Row: Controls spanning full width - Taller */}
        <Box sx={{
          flex: '0 0 38%', // Reduced to move cards down and give more space to photo
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          overflow: 'auto'
        }}>
          <PhotoControls
            photo={shownPhoto}
            label={selected.label}
            onPreview={handlePreview}
            onCommit={schedule}
            onUpdate={commitDiscrete}
            onClose={onClose}
            mode="sliders"
            showOriginal={showOriginal}
            onToggleOriginal={() => setShowOriginal(!showOriginal)}
            onApplyToAll={applySettingToAll ? handleApplyToAll : undefined}
          />
        </Box>
      </Box>
    </>
  );
}

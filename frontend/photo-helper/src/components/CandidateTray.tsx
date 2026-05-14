/**
 * CandidateTray — slotless workspace pool of photos the user is still
 * triaging. See docs/CANDIDATE_PHOTOS.md.
 *
 * Drag/drop wire format (shared with PhotoGridApi):
 *   application/x-airq-photo = JSON.stringify({ kind: 'tray', photoId })   ← drag source
 *                            | JSON.stringify({ kind: 'slot', setKey, index, photoId }) ← drop target
 */
import React, { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Switch,
  FormControlLabel,
  Tooltip,
  Button,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Star,
  StarBorder,
  Block,
  PhotoLibrary,
  Add as AddIcon,
  KeyboardDoubleArrowRight,
  DeleteOutline,
} from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import { useTheme, alpha } from '@mui/material/styles';
import { PhotoEditorApi } from './PhotoEditorApi';
import { useI18n } from '../contexts/I18nContext';
import { isValidImageFile } from '../utils/imageProcessing';
import { filterCandidates, countByFlag } from '../utils/candidateFilter';
import { parseDragPayload, serializeDragPayload, DRAG_PAYLOAD_MIME } from '../utils/dragPayload';
import type { ApiPhoto, CandidateFlag } from '../types/api';

export interface CandidateTrayProps {
  photos: ApiPhoto[];
  onAddFiles: (files: File[]) => void;
  onPhotoClick: (photo: ApiPhoto) => void;
  onSetFlag: (photoId: string, flag: CandidateFlag) => void;
  onDelete: (photoId: string) => void;
  onSendToSet: (photoId: string, setKey: 'set1' | 'set2') => void;
  /**
   * Called when a slot photo is dropped into the tray. Receives the parsed
   * dataTransfer payload. If the payload is a slot drop, AppApi demotes it.
   */
  onSlotDroppedIn: (payload: { setKey: 'set1' | 'set2'; photoId: string }) => void;
  /** Hide "Send to Set 2" in the context menu (precision-track single-set mode). */
  hideSet2?: boolean;
}

const THUMB_WIDTH = 144;
const THUMB_IMAGE_HEIGHT = 100;

export const CandidateTray: React.FC<CandidateTrayProps> = ({
  photos,
  onAddFiles,
  onPhotoClick,
  onSetFlag,
  onDelete,
  onSendToSet,
  onSlotDroppedIn,
  hideSet2,
}) => {
  const theme = useTheme();
  const { t } = useI18n();

  const [collapsed, setCollapsed] = useState(false);
  const [hideRejects, setHideRejects] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  // Filter rejects out when "Hide rejects" is on. Rejects with the toggle off
  // render at 50% opacity to keep the cull-state visible without forcing a
  // mode switch. Logic lives in `utils/candidateFilter` so it stays unit-
  // testable in isolation (PR #62 review).
  const visiblePhotos = useMemo(
    () => filterCandidates(photos, { hideRejects }),
    [photos, hideRejects],
  );

  const counts = useMemo(() => countByFlag(photos), [photos]);

  // Outer drop zone — accepts native file drops AND slot-photo drags.
  // `noClick: true` is required when the tray is populated so MUI Buttons
  // inside the dropzone (e.g. flag toggles) don't open the file picker on
  // every click. We expose `open()` and wire it explicitly to the "Add more"
  // Button below (PR #62 review C2: spreading rootProps onto the Button while
  // noClick was true made the Button click a no-op).
  const { getRootProps, getInputProps, isDragActive, open: openFilePicker } = useDropzone({
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    noClick: photos.length > 0,
    onDrop: (accepted) => {
      const valid = accepted.filter((f) => isValidImageFile(f));
      if (valid.length > 0) onAddFiles(valid);
    },
  });

  // Native HTML5 drag events for slot→tray transfers. react-dropzone owns the
  // file-drop path; we layer our intra-app slot/tray transfer protocol on top.
  // Parsing + literal-union guard live in `utils/dragPayload.ts` (PR #62
  // review G3) — formerly duplicated inline between this component and
  // `PhotoGridApi`.
  const handleDragOver = (e: React.DragEvent) => {
    const hasInternalPayload = e.dataTransfer.types.includes(DRAG_PAYLOAD_MIME);
    if (hasInternalPayload) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropActive(true);
    }
  };
  const handleDragLeave = () => setDropActive(false);
  const handleDrop = (e: React.DragEvent) => {
    setDropActive(false);
    const payload = parseDragPayload(e.dataTransfer.getData(DRAG_PAYLOAD_MIME));
    if (payload?.kind === 'slot') {
      e.preventDefault();
      onSlotDroppedIn({ setKey: payload.setKey, photoId: payload.photoId });
    }
  };

  const handleThumbDragStart = (e: React.DragEvent, photo: ApiPhoto) => {
    e.dataTransfer.setData(
      DRAG_PAYLOAD_MIME,
      serializeDragPayload({ kind: 'tray', photoId: photo.id }),
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  // Compose our slot/tray handlers WITH react-dropzone's internal handlers so
  // native file drops still work (PR #62 critical review CRIT-2). Previously
  // the JSX `{...getRootProps()}` spread was followed by explicit
  // `onDragOver`/`onDrop` props that OVERRODE dropzone's handlers — native
  // drops were dead despite `t('candidates.emptyHint')` promising they'd work.
  // Passing handlers through `getRootProps({...})` chains them: our handler
  // runs first (for the internal `application/x-airq-photo` payload), then
  // react-dropzone's runs (for native files; idempotent preventDefault is
  // harmless). See react-dropzone `composeEventHandlers`.
  const rootProps = getRootProps({
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  });

  // Empty-state — shows a wide drop hint. Only reached when slots have photos
  // (AppApi gates the whole tray on `candidates>0 OR slots>0`), so this acts
  // as the "add more to the candidates pool" entry point when slots are full.
  // Styled distinctly from slot dropzones (warning-tinted border, prominent
  // label) so the user can tell pool vs print at a glance — first dev-test
  // feedback 2026-05-12.
  if (photos.length === 0) {
    const active = isDragActive || dropActive;
    return (
      <Paper
        {...(rootProps as any)}
        elevation={1}
        sx={{
          mb: 2,
          p: 2.5,
          border: '2px dashed',
          borderColor: active ? 'warning.dark' : 'warning.main',
          borderRadius: 2,
          bgcolor: active
            ? alpha(theme.palette.warning.main, 0.10)
            : alpha(theme.palette.warning.main, 0.04),
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.15s ease-in-out',
        }}
      >
        <input {...getInputProps()} />
        <PhotoLibrary sx={{ fontSize: 32, color: 'warning.dark', mb: 0.5 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'warning.dark' }}>
          {t('candidates.poolLabel')}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
          {t('candidates.emptyHint')}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper
      {...(rootProps as any)}
      elevation={1}
      sx={{
        mb: 2,
        borderRadius: 2,
        border: dropActive ? '2px solid' : '1px solid',
        borderColor: dropActive ? 'primary.main' : 'divider',
        bgcolor: dropActive ? alpha(theme.palette.primary.main, 0.04) : 'background.paper',
        transition: 'all 0.15s ease-in-out',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1,
          borderBottom: collapsed ? 'none' : '1px solid',
          borderColor: 'divider',
        }}
      >
        <PhotoLibrary sx={{ color: 'primary.main', fontSize: 20 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {t('candidates.title', { count: counts.total })}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, ml: 1, flexWrap: 'wrap' }}>
          <CountChip icon={<Star sx={{ fontSize: 14 }} />} count={counts.pick} color="warning" />
          <CountChip count={counts.neutral} color="default" />
          <CountChip icon={<Block sx={{ fontSize: 14 }} />} count={counts.reject} color="error" />
        </Box>
        <Box sx={{ flex: 1 }} />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={hideRejects}
              onChange={(_, v) => setHideRejects(v)}
            />
          }
          label={<Typography variant="caption">{t('candidates.hideRejects')}</Typography>}
          sx={{ mr: 1 }}
        />
        <Tooltip title={t('candidates.addMore')}>
          <span>
            <Button
              onClick={(e) => { e.stopPropagation(); openFilePicker(); }}
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              sx={{ mr: 1, minHeight: 32 }}
            >
              {t('candidates.addMore')}
            </Button>
          </span>
        </Tooltip>
        {/* Hidden file input owned by the Paper-level dropzone (rendered once
            so the `Add more` button + native drop both feed the same picker). */}
        <input {...getInputProps()} />
        <IconButton size="small" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ExpandMore /> : <ExpandLess />}
        </IconButton>
      </Box>

      {/* Drag-to-slot hint banner — explains the primary action that isn't
          discoverable from the thumb toolbar alone (first dev-test feedback
          2026-05-12). Always visible while populated — small enough to stay
          out of the way. */}
      {!collapsed && (
        <Box
          sx={{
            px: 2,
            py: 0.75,
            bgcolor: alpha(theme.palette.primary.main, 0.06),
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <KeyboardDoubleArrowRight sx={{ fontSize: 16, color: 'primary.main' }} />
          <Typography variant="caption" color="text.secondary">
            {t('candidates.dragHint')}
          </Typography>
        </Box>
      )}

      {/* Thumb grid — wraps onto multiple rows instead of scrolling
          horizontally (first dev-test feedback 2026-05-12). */}
      {!collapsed && (
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.25,
            p: 1.5,
          }}
        >
          {visiblePhotos.map((photo) => (
            <CandidateThumb
              key={photo.id}
              photo={photo}
              hideSet2={hideSet2}
              onClick={() => onPhotoClick(photo)}
              onDragStart={(e) => handleThumbDragStart(e, photo)}
              onSetFlag={(flag) => onSetFlag(photo.id, flag)}
              onDelete={() => onDelete(photo.id)}
              onSendToSet={(setKey) => onSendToSet(photo.id, setKey)}
            />
          ))}
          {visiblePhotos.length === 0 && (
            <Box sx={{ p: 2, color: 'text.secondary', fontStyle: 'italic' }}>
              <Typography variant="body2">{t('candidates.allFiltered')}</Typography>
            </Box>
          )}
        </Box>
      )}
    </Paper>
  );
};

interface CountChipProps {
  count: number;
  icon?: React.ReactNode;
  color: 'warning' | 'error' | 'default';
}
const CountChip: React.FC<CountChipProps> = ({ count, icon, color }) => {
  const theme = useTheme();
  const bg =
    color === 'warning' ? alpha(theme.palette.warning.main, 0.12)
    : color === 'error' ? alpha(theme.palette.error.main, 0.12)
    : alpha(theme.palette.text.primary, 0.06);
  const fg =
    color === 'warning' ? theme.palette.warning.dark
    : color === 'error' ? theme.palette.error.dark
    : theme.palette.text.secondary;
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5,
      px: 0.75, py: 0.25, borderRadius: 1,
      bgcolor: bg, color: fg, fontSize: '0.75rem', fontWeight: 600
    }}>
      {icon}
      {count}
    </Box>
  );
};

interface CandidateThumbProps {
  photo: ApiPhoto;
  hideSet2?: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onSetFlag: (flag: CandidateFlag) => void;
  onDelete: () => void;
  onSendToSet: (setKey: 'set1' | 'set2') => void;
}
const CandidateThumb: React.FC<CandidateThumbProps> = ({
  photo,
  hideSet2,
  onClick,
  onDragStart,
  onSetFlag,
  onDelete,
  onSendToSet,
}) => {
  const theme = useTheme();
  const { t } = useI18n();
  const flag: CandidateFlag = (photo.flag as CandidateFlag | undefined) ?? 'neutral';
  const isPick = flag === 'pick';
  const isReject = flag === 'reject';

  // Status border colour communicates flag at a glance.
  const borderColor =
    isPick ? theme.palette.warning.main
    : isReject ? theme.palette.error.main
    : theme.palette.divider;

  // Toolbar button — small, single-purpose. Stops click propagation so
  // clicking the toolbar doesn't open the editor modal.
  const tbBtn = (
    title: string,
    active: boolean,
    color: 'warning' | 'error' | 'primary' | 'default',
    icon: React.ReactNode,
    onClickFn: () => void,
  ) => {
    const palette =
      color === 'warning' ? theme.palette.warning
      : color === 'error' ? theme.palette.error
      : color === 'primary' ? theme.palette.primary
      : { main: theme.palette.text.secondary, dark: theme.palette.text.primary, light: theme.palette.action.hover, contrastText: theme.palette.text.primary };
    return (
      <Tooltip title={title} disableInteractive>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); onClickFn(); }}
          sx={{
            p: 0.25,
            borderRadius: 0.75,
            bgcolor: active ? alpha(palette.main, 0.15) : 'transparent',
            color: active ? palette.dark : 'text.secondary',
            '&:hover': {
              bgcolor: alpha(palette.main, 0.2),
              color: palette.dark,
            },
          }}
        >
          {icon}
        </IconButton>
      </Tooltip>
    );
  };

  return (
    <Box
      draggable
      onDragStart={onDragStart}
      sx={{
        flex: '0 0 auto',
        width: THUMB_WIDTH,
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        border: `2px solid ${borderColor}`,
        opacity: isReject ? 0.55 : 1,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        transition: 'transform 0.12s, box-shadow 0.12s, border-color 0.15s',
        cursor: 'grab',
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: '0 2px 8px rgba(33,150,243,0.35)',
        },
        '&:active': { cursor: 'grabbing' },
      }}
    >
      {/* Image area — click opens the edit modal. pointerEvents on the inner
          editor are disabled so the parent's drag/click handlers receive
          events instead. */}
      <Box
        onClick={onClick}
        sx={{
          width: '100%',
          height: THUMB_IMAGE_HEIGHT,
          position: 'relative',
          cursor: 'pointer',
        }}
      >
        <Box sx={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
          <PhotoEditorApi
            key={photo.id}
            photo={photo}
            label=""
            onUpdate={() => { /* persisted via parent's updateCandidatePhotoState */ }}
            onRemove={() => { /* delete via toolbar */ }}
            size="grid"
          />
        </Box>
      </Box>

      {/* Always-visible control toolbar. Left-click only — no right-click menu
          (first dev-test feedback 2026-05-12). Flag toggles act radio-like:
          clicking the active flag clears it back to neutral. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 0.25,
          px: 0.5,
          py: 0.5,
          borderTop: `1px solid ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.background.default, 0.6),
        }}
      >
        {/* Flag toggles */}
        <Box sx={{ display: 'flex', gap: 0.25 }}>
          {tbBtn(
            t('candidates.flag.pick'),
            isPick,
            'warning',
            isPick ? <Star sx={{ fontSize: 16 }} /> : <StarBorder sx={{ fontSize: 16 }} />,
            () => onSetFlag(isPick ? 'neutral' : 'pick'),
          )}
          {tbBtn(
            t('candidates.flag.reject'),
            isReject,
            'error',
            <Block sx={{ fontSize: 16 }} />,
            () => onSetFlag(isReject ? 'neutral' : 'reject'),
          )}
        </Box>

        {/* Send to set */}
        <Box sx={{ display: 'flex', gap: 0.25 }}>
          {tbBtn(
            t('candidates.sendToSet1'),
            false,
            'primary',
            <Box sx={{ display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700 }}>
              <KeyboardDoubleArrowRight sx={{ fontSize: 14 }} />1
            </Box>,
            () => onSendToSet('set1'),
          )}
          {!hideSet2 && tbBtn(
            t('candidates.sendToSet2'),
            false,
            'primary',
            <Box sx={{ display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700 }}>
              <KeyboardDoubleArrowRight sx={{ fontSize: 14 }} />2
            </Box>,
            () => onSendToSet('set2'),
          )}
          {tbBtn(
            t('common.delete'),
            false,
            'error',
            <DeleteOutline sx={{ fontSize: 16 }} />,
            onDelete,
          )}
        </Box>
      </Box>
    </Box>
  );
};

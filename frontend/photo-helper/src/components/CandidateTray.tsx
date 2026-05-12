/**
 * CandidateTray — slotless workspace pool of photos the user is still
 * triaging. See docs/CANDIDATE_PHOTOS.md.
 *
 * Drag/drop wire format (shared with PhotoGridApi):
 *   text/plain = JSON.stringify({ kind: 'tray',  photoId })   ← drag source
 *              | JSON.stringify({ kind: 'slot', setKey, index, photoId }) ← drop target
 */
import React, { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  Divider,
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
  Close,
  PhotoLibrary,
  Add as AddIcon,
} from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import { useTheme, alpha } from '@mui/material/styles';
import { PhotoEditorApi } from './PhotoEditorApi';
import { useI18n } from '../contexts/I18nContext';
import { isValidImageFile } from '../utils/imageProcessing';
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

const THUMB_HEIGHT = 96;
const THUMB_WIDTH = 128;

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
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; photo: ApiPhoto } | null>(null);
  const [dropActive, setDropActive] = useState(false);

  // Filter rejects out when "Hide rejects" is on. Rejects with the toggle off
  // render at 50% opacity to keep the cull-state visible without forcing a
  // mode switch.
  const visiblePhotos = useMemo(() => {
    if (!hideRejects) return photos;
    return photos.filter((p) => p.flag !== 'reject');
  }, [photos, hideRejects]);

  const counts = useMemo(() => {
    let pick = 0, neutral = 0, reject = 0;
    for (const p of photos) {
      if (p.flag === 'pick') pick++;
      else if (p.flag === 'reject') reject++;
      else neutral++;
    }
    return { pick, neutral, reject, total: photos.length };
  }, [photos]);

  const handleContextMenu = (e: React.MouseEvent<HTMLElement>, photo: ApiPhoto) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuAnchor({ el: e.currentTarget, photo });
  };
  const closeMenu = () => setMenuAnchor(null);

  // Outer drop zone — accepts native file drops AND slot-photo drags. We
  // disable react-dropzone's noClick for the empty-state CTA; in normal mode
  // (when photos exist) we use a separate "+" button.
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
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
  const handleDragOver = (e: React.DragEvent) => {
    // Only accept if the drag has our JSON payload — otherwise the user is
    // dragging a native file and react-dropzone handles it.
    const hasInternalPayload = e.dataTransfer.types.includes('application/x-airq-photo');
    if (hasInternalPayload) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropActive(true);
    }
  };
  const handleDragLeave = () => setDropActive(false);
  const handleDrop = (e: React.DragEvent) => {
    setDropActive(false);
    const raw = e.dataTransfer.getData('application/x-airq-photo');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as { kind: string; setKey?: 'set1' | 'set2'; photoId?: string };
      if (payload.kind === 'slot' && payload.setKey && payload.photoId) {
        e.preventDefault();
        onSlotDroppedIn({ setKey: payload.setKey, photoId: payload.photoId });
      }
    } catch {}
  };

  const handleThumbDragStart = (e: React.DragEvent, photo: ApiPhoto) => {
    const payload = JSON.stringify({ kind: 'tray', photoId: photo.id });
    e.dataTransfer.setData('application/x-airq-photo', payload);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Empty-state hero — when there are no candidates AND no slot photos either,
  // AppApi hides this component entirely. So whenever we render, we always
  // have either candidates OR the user is intentionally adding via the "+"
  // button. The empty branch is only reached after the user deletes all
  // candidates from a previously-non-empty tray.
  if (photos.length === 0) {
    return (
      <Paper
        {...(getRootProps() as any)}
        elevation={1}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        sx={{
          mb: 2,
          p: 2,
          border: '2px dashed',
          borderColor: isDragActive || dropActive ? 'primary.main' : 'grey.300',
          borderRadius: 2,
          bgcolor: isDragActive || dropActive
            ? alpha(theme.palette.primary.main, 0.06)
            : 'background.paper',
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        <input {...getInputProps()} />
        <PhotoLibrary sx={{ fontSize: 28, color: 'text.secondary', mb: 0.5 }} />
        <Typography variant="body2" color="text.secondary">
          {t('candidates.emptyHint')}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper
      elevation={1}
      sx={{
        mb: 2,
        borderRadius: 2,
        border: dropActive ? '2px solid' : '1px solid',
        borderColor: dropActive ? 'primary.main' : 'divider',
        bgcolor: dropActive ? alpha(theme.palette.primary.main, 0.04) : 'background.paper',
        transition: 'all 0.15s ease-in-out',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
              {...(getRootProps() as any)}
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              sx={{ mr: 1, minHeight: 32 }}
            >
              <input {...getInputProps()} />
              {t('candidates.addMore')}
            </Button>
          </span>
        </Tooltip>
        <IconButton size="small" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ExpandMore /> : <ExpandLess />}
        </IconButton>
      </Box>

      {/* Thumb strip */}
      {!collapsed && (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            p: 1.5,
            overflowX: 'auto',
            // Subtle hint that more content scrolls
            scrollbarGutter: 'stable',
          }}
        >
          {visiblePhotos.map((photo) => (
            <CandidateThumb
              key={photo.id}
              photo={photo}
              onClick={() => onPhotoClick(photo)}
              onContextMenu={(e) => handleContextMenu(e, photo)}
              onDragStart={(e) => handleThumbDragStart(e, photo)}
            />
          ))}
          {visiblePhotos.length === 0 && (
            <Box sx={{ p: 2, color: 'text.secondary', fontStyle: 'italic' }}>
              <Typography variant="body2">{t('candidates.allFiltered')}</Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Context menu */}
      <Menu
        open={Boolean(menuAnchor)}
        anchorEl={menuAnchor?.el ?? null}
        onClose={closeMenu}
      >
        <MenuItem onClick={() => { if (menuAnchor) onSetFlag(menuAnchor.photo.id, 'pick'); closeMenu(); }}>
          <Star sx={{ fontSize: 18, mr: 1, color: 'warning.main' }} /> {t('candidates.flag.pick')}
        </MenuItem>
        <MenuItem onClick={() => { if (menuAnchor) onSetFlag(menuAnchor.photo.id, 'neutral'); closeMenu(); }}>
          <StarBorder sx={{ fontSize: 18, mr: 1 }} /> {t('candidates.flag.neutral')}
        </MenuItem>
        <MenuItem onClick={() => { if (menuAnchor) onSetFlag(menuAnchor.photo.id, 'reject'); closeMenu(); }}>
          <Block sx={{ fontSize: 18, mr: 1, color: 'error.main' }} /> {t('candidates.flag.reject')}
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { if (menuAnchor) onSendToSet(menuAnchor.photo.id, 'set1'); closeMenu(); }}>
          {t('candidates.sendToSet1')}
        </MenuItem>
        {!hideSet2 && (
          <MenuItem onClick={() => { if (menuAnchor) onSendToSet(menuAnchor.photo.id, 'set2'); closeMenu(); }}>
            {t('candidates.sendToSet2')}
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => { if (menuAnchor) onDelete(menuAnchor.photo.id); closeMenu(); }} sx={{ color: 'error.main' }}>
          <Close sx={{ fontSize: 18, mr: 1 }} /> {t('common.delete')}
        </MenuItem>
      </Menu>
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
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  onDragStart: (e: React.DragEvent) => void;
}
const CandidateThumb: React.FC<CandidateThumbProps> = ({ photo, onClick, onContextMenu, onDragStart }) => {
  const flag: CandidateFlag = (photo.flag as CandidateFlag | undefined) ?? 'neutral';
  const isReject = flag === 'reject';
  return (
    <Box
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onContextMenu={onContextMenu}
      sx={{
        position: 'relative',
        flex: '0 0 auto',
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT,
        borderRadius: 1,
        overflow: 'hidden',
        cursor: 'grab',
        opacity: isReject ? 0.45 : 1,
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        transition: 'transform 0.12s, box-shadow 0.12s',
        '&:hover': {
          transform: 'scale(1.03)',
          boxShadow: '0 2px 8px rgba(33,150,243,0.4)',
        },
        '&:active': { cursor: 'grabbing' },
      }}
    >
      {/* Re-use PhotoEditorApi in grid size so edits applied to candidate
          photos render with the same pipeline as slot photos. Label kept
          empty — tray photos have no slot index. */}
      <Box sx={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
        <PhotoEditorApi
          key={photo.id}
          photo={photo}
          label=""
          onUpdate={() => { /* no-op — modal edits propagate via parent */ }}
          onRemove={() => { /* delete via context menu */ }}
          size="grid"
        />
      </Box>
      {/* Flag badge */}
      {flag === 'pick' && (
        <BadgeIcon><Star sx={{ fontSize: 14, color: 'warning.dark' }} /></BadgeIcon>
      )}
      {flag === 'reject' && (
        <BadgeIcon color="error"><Block sx={{ fontSize: 14, color: 'common.white' }} /></BadgeIcon>
      )}
    </Box>
  );
};

const BadgeIcon: React.FC<{ children: React.ReactNode; color?: 'error' }> = ({ children, color }) => (
  <Box
    sx={{
      position: 'absolute',
      top: 4,
      right: 4,
      width: 20,
      height: 20,
      borderRadius: '50%',
      bgcolor: color === 'error' ? 'error.main' : 'common.white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
    }}
  >
    {children}
  </Box>
);

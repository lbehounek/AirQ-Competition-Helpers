// Phase 7 of photo-map-culling — right-side photo list panel.
// Lists all imported photos grouped by flag. Click an item to fly the
// map to its marker. Auto-hides when there are no photos.

import { useMemo, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Check, ChevronLeft, ChevronRight, Close, EditOutlined, ExpandLess, ExpandMore, SendOutlined } from '@mui/icons-material'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import type { NoGpsPhoto, PhotoMarker } from '../types/markers'
import { useI18n } from '../contexts/I18nContext'
import { usePhotoThumbUrl } from './usePhotoThumbUrl'
import { groupPhotosByFlag } from './groupPhotosByFlag'

const THUMB_W_PX = 40
const THUMB_H_PX = 30

export interface PhotoListPanelProps {
  markers: readonly PhotoMarker[]
  noGpsPhotos: readonly NoGpsPhoto[]
  storage: StorageInterface | null
  photosDir: DirectoryHandle | null
  /** Called when the user clicks an item whose photo has a placed marker. */
  onMarkerClick: (markerId: string) => void
  /**
   * Phase 9 — click handler for the "Send to editor" footer button.
   * Undefined hides the button entirely (e.g., no active competition).
   * The handler is expected to flush any pending map-picks write before
   * navigating, per ADR-009.
   */
  onSendToEditor?: () => void | Promise<void>
  /**
   * Hard-delete a photo from the corridor session entirely. Mirrors the
   * X badge on photo-helper grid tiles. Removes from both `markers` and
   * `noGpsPhotos`, best-effort cleans the file + thumb from storage.
   */
  onPhotoDelete: (photoId: string) => void | Promise<void>
  /**
   * User feedback 2026-05-17: organisers want to rename camera-assigned
   * filenames (e.g. `DSC_0123.JPG`) to something workflow-meaningful
   * (e.g. `TP1`). Persists to `marker.name` (GPS path) or
   * `noGpsPhoto.filename` (no-GPS path). The new name flows downstream to
   * KML export and to `map-picks.json` (via `entry.filename`), so
   * Photo Helper sees the same custom name on its candidate tile without
   * any wire-schema change.
   */
  onPhotoRename: (photoId: string, newName: string) => void | Promise<void>
}

type GroupKey = 'picks' | 'neutral' | 'rejects' | 'noGps'

const GROUP_ORDER: readonly GroupKey[] = ['picks', 'neutral', 'rejects', 'noGps']

export function PhotoListPanel(props: PhotoListPanelProps) {
  const { t } = useI18n()
  const { markers, noGpsPhotos, storage, photosDir, onMarkerClick, onSendToEditor, onPhotoDelete, onPhotoRename } = props
  const [collapsedPanel, setCollapsedPanel] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<GroupKey, boolean>>({
    picks: false,
    neutral: false,
    rejects: true, // default-collapsed — usually fewer items the user revisits less often
    noGps: false,
  })

  const groups = useMemo(() => groupPhotosByFlag(markers, noGpsPhotos), [markers, noGpsPhotos])
  if (groups.total === 0) return null

  const toggleGroup = (key: GroupKey) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <Paper
      elevation={4}
      sx={{
        position: 'absolute',
        top: 12,
        right: 12,
        bottom: 12,
        zIndex: 25,
        width: collapsedPanel ? 40 : 280,
        maxWidth: '24vw',
        bgcolor: 'rgba(255,255,255,0.97)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 150ms ease',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{ px: collapsedPanel ? 0.5 : 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tooltip title={collapsedPanel ? t('photo.list.expand') : t('photo.list.collapse')}>
          <IconButton size="small" onClick={() => setCollapsedPanel(p => !p)} aria-label={collapsedPanel ? t('photo.list.expand') : t('photo.list.collapse')}>
            {collapsedPanel ? <ChevronLeft fontSize="small" /> : <ChevronRight fontSize="small" />}
          </IconButton>
        </Tooltip>
        {!collapsedPanel && (
          <>
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', flex: 1 }}>
              {t('photo.list.title')}
            </Typography>
            <Badge badgeContent={groups.total} color="primary" sx={{ '& .MuiBadge-badge': { position: 'static', transform: 'none' } }} />
          </>
        )}
      </Stack>
      {!collapsedPanel && (
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {GROUP_ORDER.map(key => (
            <GroupSection
              key={key}
              groupKey={key}
              title={t(`photo.list.${key}`)}
              count={groupCount(groups, key)}
              collapsed={collapsedGroups[key]}
              onToggle={() => toggleGroup(key)}
              items={renderGroupItems(groups, key, {
                storage,
                photosDir,
                onMarkerClick,
                onPhotoDelete,
                onPhotoRename,
                deleteTooltip: t('photo.deleteTooltip'),
                renameTooltip: t('photo.renameTooltip'),
                renamePlaceholder: t('photo.renamePlaceholder'),
                renameSaveAria: t('photo.renameSaveAria'),
              })}
            />
          ))}
        </Box>
      )}
      {!collapsedPanel && onSendToEditor && (
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button
            fullWidth
            variant="contained"
            size="small"
            startIcon={<SendOutlined fontSize="small" />}
            disabled={groups.picks.length === 0}
            onClick={() => { void onSendToEditor() }}
          >
            {t('photo.list.sendToEditor', { count: groups.picks.length })}
          </Button>
        </Box>
      )}
    </Paper>
  )
}

function groupCount(g: ReturnType<typeof groupPhotosByFlag>, key: GroupKey): number {
  return g[key].length
}

function GroupSection(props: {
  groupKey: GroupKey
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
  items: React.ReactNode
}) {
  const { title, count, collapsed, onToggle, items } = props
  return (
    <Box>
      <ListItemButton
        onClick={onToggle}
        sx={{ py: 0.5, bgcolor: 'grey.50' }}
        aria-expanded={!collapsed}
      >
        <ListItemText
          primaryTypographyProps={{ variant: 'body2', sx: { fontWeight: 600 } }}
          primary={`${title} (${count})`}
        />
        {collapsed ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
      </ListItemButton>
      <Collapse in={!collapsed}>
        {count === 0 ? null : <List dense disablePadding>{items}</List>}
      </Collapse>
    </Box>
  )
}

function renderGroupItems(
  g: ReturnType<typeof groupPhotosByFlag>,
  key: GroupKey,
  ctx: {
    storage: StorageInterface | null
    photosDir: DirectoryHandle | null
    onMarkerClick: (markerId: string) => void
    onPhotoDelete: (photoId: string) => void | Promise<void>
    onPhotoRename: (photoId: string, newName: string) => void | Promise<void>
    deleteTooltip: string
    renameTooltip: string
    renamePlaceholder: string
    renameSaveAria: string
  },
): React.ReactNode {
  const commonRenameCtx = {
    onRename: ctx.onPhotoRename,
    renameTooltip: ctx.renameTooltip,
    renamePlaceholder: ctx.renamePlaceholder,
    renameSaveAria: ctx.renameSaveAria,
  }
  if (key === 'noGps') {
    return g.noGps.map(p => (
      <PhotoListItem
        key={p.photoId}
        photoId={p.photoId}
        filename={p.filename}
        storage={ctx.storage}
        photosDir={ctx.photosDir}
        // No marker yet — clicking is a no-op for v1. User drags from tray.
        onClick={undefined}
        onDelete={ctx.onPhotoDelete}
        deleteTooltip={ctx.deleteTooltip}
        {...commonRenameCtx}
      />
    ))
  }
  const list = g[key]
  return list.map(m => (
    <PhotoListItem
      key={m.id}
      photoId={m.photoId!}
      filename={m.name}
      storage={ctx.storage}
      photosDir={ctx.photosDir}
      onClick={() => ctx.onMarkerClick(m.id)}
      onDelete={ctx.onPhotoDelete}
      deleteTooltip={ctx.deleteTooltip}
      {...commonRenameCtx}
    />
  ))
}

/**
 * Validate and normalise a rename draft. Exported for unit testing — the
 * keyboard / blur paths in `PhotoListItem` all funnel through this, so a
 * single test pins the rules:
 *
 *  - Trim leading/trailing whitespace.
 *  - Empty (after trim) → reject (return null). Caller treats null as
 *    "cancel without saving" so the previous filename is kept.
 *  - Identical to current filename → return null (no-op, don't write).
 *  - Otherwise return the normalised string.
 *
 * The cap (`MAX_LEN`) guards against the user pasting a 100 KB blob into
 * the inline field — OPFS handles long strings but the UI doesn't.
 */
export function normalizeRename(draft: string, current: string, maxLen = 200): string | null {
  const trimmed = draft.trim().slice(0, maxLen)
  if (trimmed.length === 0) return null
  if (trimmed === current) return null
  return trimmed
}

function PhotoListItem(props: {
  photoId: string
  filename: string
  storage: StorageInterface | null
  photosDir: DirectoryHandle | null
  onClick: (() => void) | undefined
  onDelete: (photoId: string) => void | Promise<void>
  deleteTooltip: string
  onRename: (photoId: string, newName: string) => void | Promise<void>
  renameTooltip: string
  renamePlaceholder: string
  renameSaveAria: string
}) {
  const {
    photoId, filename, storage, photosDir, onClick, onDelete, deleteTooltip,
    onRename, renameTooltip, renamePlaceholder, renameSaveAria,
  } = props
  const { url, state } = usePhotoThumbUrl(storage, photosDir, photoId)
  const [editing, setEditing] = useState(false)
  // `draft` is the in-progress text. Seeded with the current filename on
  // every entry into edit mode so a previous cancel doesn't leak into the
  // next session.
  const [draft, setDraft] = useState(filename)

  const beginEdit = () => {
    setDraft(filename)
    setEditing(true)
  }
  const commit = () => {
    const next = normalizeRename(draft, filename)
    setEditing(false)
    if (next !== null) void onRename(photoId, next)
  }
  const cancel = () => {
    setEditing(false)
  }

  return (
    <Box
      sx={{
        position: 'relative',
        // Reveal full delete-button opacity on hover anywhere on the row,
        // matching the photo-helper grid-tile pattern. The rename pencil
        // mirrors the same hover reveal so resting state stays uncluttered.
        '&:hover .photo-row-delete': { opacity: 1 },
        '&:hover .photo-row-rename': { opacity: 1 },
      }}
    >
      <ListItemButton
        onClick={editing ? undefined : onClick}
        disabled={!editing && !onClick}
        // Edit mode renders as a div so the inner TextField isn't nested
        // inside a <button> (a11y violation + focus contention). Spread
        // `component` conditionally — MUI's overload typing rejects
        // `component={undefined}`.
        {...(editing ? { component: 'div' as const } : {})}
        // Two icon-buttons live in the right pad (rename + delete) when
        // not editing; one (save) when editing. pr: 7 covers the wider case.
        sx={{ py: 0.5, gap: 1, pr: 7 }}
      >
        <Box
          sx={{
            width: THUMB_W_PX,
            height: THUMB_H_PX,
            flexShrink: 0,
            bgcolor: 'grey.100',
            borderRadius: 0.5,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {state === 'ready' && url && (
            <img
              src={url}
              alt={filename}
              draggable={false}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          )}
        </Box>
        {editing ? (
          <TextField
            value={draft}
            onChange={e => setDraft(e.target.value)}
            // `autoFocus` + `selectOnFocus` (via inputProps onFocus) makes
            // the user-typed first character REPLACE the camera filename
            // rather than appending — the whole point of rename is to
            // replace, not extend.
            autoFocus
            onFocus={e => e.target.select()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
              // stopPropagation prevents ListItemButton from re-interpreting
              // Space/Enter as activation while the user is typing.
              e.stopPropagation()
            }}
            onBlur={commit}
            onClick={e => e.stopPropagation()}
            placeholder={renamePlaceholder}
            size="small"
            variant="standard"
            fullWidth
            inputProps={{ 'aria-label': renameTooltip, maxLength: 200, style: { fontSize: 12 } }}
          />
        ) : (
          <ListItemText
            primary={filename}
            primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { fontSize: 12 } }}
          />
        )}
      </ListItemButton>
      {editing ? (
        <Tooltip title={renameSaveAria} placement="left" enterDelay={400}>
          <IconButton
            // MouseDown on the save button would otherwise blur the input
            // and fire commit() via onBlur BEFORE this onClick — meaning we
            // commit on the OLD draft and then this handler runs on stale
            // state. Stopping mousedown keeps focus, so onClick is the
            // single commit path.
            onMouseDown={e => e.preventDefault()}
            onClick={e => {
              e.stopPropagation()
              commit()
            }}
            aria-label={renameSaveAria}
            size="small"
            sx={{
              position: 'absolute',
              top: '50%',
              right: 4,
              transform: 'translateY(-50%)',
              width: 24,
              height: 24,
              bgcolor: 'success.main',
              color: 'white',
              opacity: 1,
              '&:hover': { bgcolor: 'success.dark' },
            }}
          >
            <Check sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      ) : (
        <>
          <Tooltip title={renameTooltip} placement="left" enterDelay={400}>
            <IconButton
              className="photo-row-rename"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation()
                beginEdit()
              }}
              aria-label={renameTooltip}
              size="small"
              sx={{
                position: 'absolute',
                top: '50%',
                right: 32, // sits left of the X
                transform: 'translateY(-50%)',
                width: 24,
                height: 24,
                bgcolor: 'rgba(25, 118, 210, 0.85)',
                color: 'white',
                opacity: 0.6,
                transition: 'opacity 0.15s ease, background-color 0.15s ease',
                '&:hover': {
                  bgcolor: 'rgba(21, 101, 192, 1)',
                  opacity: 1,
                },
              }}
            >
              <EditOutlined sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={deleteTooltip} placement="left" enterDelay={400}>
            <IconButton
              className="photo-row-delete"
              // stopPropagation so the row's `onClick` (fly to marker) doesn't
              // fire when the user clicks the X. `MouseDown` is also stopped
              // because ListItemButton has its own ripple-effect handler that
              // can swallow the click otherwise.
              onMouseDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation()
                void onDelete(photoId)
              }}
              aria-label={deleteTooltip}
              size="small"
              sx={{
                position: 'absolute',
                top: '50%',
                right: 4,
                transform: 'translateY(-50%)',
                width: 24,
                height: 24,
                bgcolor: 'rgba(220, 53, 69, 0.92)', // Same red as photo-helper grid tiles
                color: 'white',
                opacity: 0.6, // Visible at rest — discoverable without hover
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
        </>
      )}
    </Box>
  )
}

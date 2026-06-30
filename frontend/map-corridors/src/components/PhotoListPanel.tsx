// Phase 7 of photo-map-culling — right-side photo list panel.
// Lists all imported photos grouped by flag. Click an item to fly the
// map to its marker. Auto-hides when there are no photos.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Check, ChevronLeft, ChevronRight, Close, CompareArrows, ContentCut, EditOutlined, ExpandLess, ExpandMore, SendOutlined } from '@mui/icons-material'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import type { NoGpsPhoto, PhotoMarker } from '../types/markers'
import { noGpsPhotoDisplayName, photoMarkerDisplayName } from '../types/markers'
import { useI18n } from '../contexts/I18nContext'
import { usePhotoThumbUrl } from './usePhotoThumbUrl'
import { NO_GPS_PHOTO_DRAG_TYPE } from './NoGpsTray'
import { groupPhotosByFlag } from './groupPhotosByFlag'
import { flagForGroup, canRecategorize } from '../recategorize/recategorize'
import { partitionPicksByRouteTP, setBreakDividerIndex, listRouteTpOptions, type SetKey } from '../setSplit/partitionPicksBySet'
import type { RouteWaypoint } from '../corridors/matchPoints'
import type { PhotoFlag } from '../types/markers'

/** Drag MIME for recategorizing a photo row by dropping it on another group. */
const RECAT_MIME = 'application/x-airq-photo-recat'

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
   * (e.g. `TP1`). Persists to the `displayName` field (on `marker` or
   * `noGpsPhoto`) WITHOUT overwriting the original filename — that stays as
   * the list/tray sort key. The custom name flows downstream to KML export
   * and to `map-picks.json` (via `entry.filename = displayName ?? name`), so
   * Photo Helper sees the custom name on its candidate tile without any
   * wire-schema change.
   */
  onPhotoRename: (photoId: string, newName: string) => void | Promise<void>
  /**
   * Phase 12 (variants) — open the compare modal with the user-selected
   * markers. Called when the user clicks the "Srovnat varianty (N)" footer
   * button. Undefined disables the variant workflow entirely (e.g., no
   * active competition / parent didn't opt in).
   *
   * Selection happens in this panel (Ctrl/Cmd+click toggles, Shift+click
   * ranges), then this prop is invoked with the chosen `PhotoMarker[]` in
   * selection order so the modal can show them in a stable layout.
   */
  onCompareVariants?: (markers: readonly PhotoMarker[]) => void
  /**
   * Phase 13 — photoId of the currently active photo (the one whose map popup
   * is open). Its row gets a filled tint and auto-scrolls into view; its group
   * auto-expands. Distinct from the variant-compare `selectedIds` (left
   * border) — a row can be both. `null`/undefined = nothing active.
   */
  activePhotoId?: string | null
  /**
   * Phase 14 — drag-to-recategorize. Set a GPS photo's flag when its row is
   * dropped onto another group section. `null` = neutral (flag cleared).
   */
  onPhotoSetFlag?: (markerId: string, flag: PhotoFlag | null) => void
  /**
   * Phase 14 — click a no-GPS row to start placing it on the map (provisional
   * pin at map center; the photo stays in "Bez GPS" until the user commits a
   * category in the popup). Undefined leaves no-GPS rows non-interactive.
   */
  onNoGpsPhotoClick?: (photoId: string) => void
  /**
   * Double-clicking a photo row opens the full-resolution single-photo
   * preview (lightbox). Receives the photoId. Works for both GPS rows and
   * no-GPS rows. The plain single-clicks that precede the double-click still
   * fire (GPS: select + fly-to + popup; no-GPS: start place-on-map) — that's
   * harmless. Undefined disables the preview path.
   */
  onPreviewPhoto?: (photoId: string) => void
  /**
   * The photoId of the turning point the user designated as the set1↔set2 break
   * (rally only — App passes `null` for precision, which is single-set). When
   * set, the turning-point and track pick groups render a `set1 │ set2` divider
   * at the cut, mirroring the scissors badge on the map. The break itself is
   * still set/moved from the map popup; the panel only visualizes the result.
   * `null`/undefined → no divider. See partitionPicksByRouteTP (single source of
   * truth shared with the handoff writer).
   */
  setBreakWaypointName?: string | null
  /**
   * The route's ordered turning points (SP, TP1…TPn, FP) — the options for the
   * "Set 2 starts at" selector and the input to the geographic partition.
   */
  routeWaypoints?: readonly RouteWaypoint[]
  /**
   * Set/clear the set1↔set2 break from the panel's "Set 2 starts at" selector,
   * by route-TP waypoint name (`null` clears the split). Provided ONLY for rally
   * (precision is single-set) — when omitted, the selector is hidden entirely.
   */
  onSetBreakChange?: (waypointName: string | null) => void
}

/**
 * Hard cap on how many photos can be compared at once. The user's workflow
 * is "2–3 variants of the same turn point"; the modal layout (side-by-side)
 * stops being legible past 3 columns at typical screen widths. Enforced both
 * by disabling the trigger button when |selection| > MAX and by an early
 * return in `triggerCompare`.
 */
export const MAX_COMPARE_VARIANTS = 3

type GroupKey = 'picksTurning' | 'picksTrack' | 'neutral' | 'rejects' | 'noGps'

const GROUP_ORDER: readonly GroupKey[] = ['picksTurning', 'picksTrack', 'neutral', 'rejects', 'noGps']

export function PhotoListPanel(props: PhotoListPanelProps) {
  const { t } = useI18n()
  const { markers, noGpsPhotos, storage, photosDir, onMarkerClick, onSendToEditor, onPhotoDelete, onPhotoRename, onCompareVariants, activePhotoId, onPhotoSetFlag, onNoGpsPhotoClick, onPreviewPhoto, setBreakWaypointName, routeWaypoints, onSetBreakChange } = props
  const [collapsedPanel, setCollapsedPanel] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<GroupKey, boolean>>({
    picksTurning: false,
    picksTrack: false,
    neutral: false,
    rejects: true, // default-collapsed — usually fewer items the user revisits less often
    noGps: false,
  })

  // Phase 12 — multi-select for variant compare. Selection holds photoIds
  // in click order so the compare modal can render them in the order the
  // user picked. Anchor ref drives Shift+click range selection. We hold
  // an array (not a Set) so iteration is stable and order survives toggle.
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const lastAnchorRef = useRef<string | null>(null)
  // Phase 14 — which group the row currently being dragged belongs to. Drives
  // both drop validation (canRecategorize) and the drop-target highlight.
  const [dragSourceGroup, setDragSourceGroup] = useState<GroupKey | null>(null)

  const groups = useMemo(() => groupPhotosByFlag(markers, noGpsPhotos), [markers, noGpsPhotos])
  // Per-photo set membership from the designated break TP. Shared source of
  // truth with the handoff writer (partitionPicksBySet), so the divider the user
  // sees matches the set the editor receives. Empty map (no break / stale break /
  // precision) → no divider rendered.
  const waypoints = routeWaypoints ?? []
  const setByPhotoId = useMemo(() => partitionPicksByRouteTP(markers, waypoints, setBreakWaypointName), [markers, waypoints, setBreakWaypointName])
  // Route turning points (TP1…TPn) — the options for the "Set 2 starts at"
  // selector.
  const breakOptions = useMemo(() => listRouteTpOptions(waypoints), [waypoints])
  // Guard the Select value against a stale break name (route reloaded without
  // that TP) so MUI doesn't warn about an out-of-range value.
  const breakValue = breakOptions.some(o => o.name === setBreakWaypointName) ? (setBreakWaypointName ?? '') : ''
  // All picks (turning-point + track) — the send button counts/enables on this,
  // since "Poslat do editoru" sends every pick regardless of category.
  const pickCount = groups.picksTurning.length + groups.picksTrack.length

  // Visible-order index of every selectable row (GPS markers only — noGps
  // rows have no marker to compare). Drives Shift+click range expansion.
  const orderedSelectableIds = useMemo(() => {
    const ids: string[] = []
    // Visual order matches GROUP_ORDER (turning picks, then track picks, …).
    for (const m of groups.picksTurning) if (m.photoId) ids.push(m.photoId)
    for (const m of groups.picksTrack) if (m.photoId) ids.push(m.photoId)
    for (const m of groups.neutral) if (m.photoId) ids.push(m.photoId)
    for (const m of groups.rejects) if (m.photoId) ids.push(m.photoId)
    return ids
  }, [groups])

  // Prune selection if a selected photo disappears (deleted, or its marker
  // demoted). Without this, a stale photoId could leak into the compare
  // modal and crash on lookup.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.length === 0) return prev
      const valid = new Set(orderedSelectableIds)
      const next = prev.filter(id => valid.has(id))
      if (next.length === prev.length) return prev
      if (lastAnchorRef.current && !valid.has(lastAnchorRef.current)) {
        lastAnchorRef.current = next.length > 0 ? next[next.length - 1] : null
      }
      return next
    })
  }, [orderedSelectableIds])

  // Phase 13 — when a photo becomes active (e.g. its marker was clicked on
  // the map), expand its group so the highlighted row is reachable. The row
  // itself handles scrollIntoView; this only un-collapses. No-op for no-GPS
  // photos (they have no marker and can't be active).
  useEffect(() => {
    if (!activePhotoId) return
    const key = groupKeyForPhotoId(groups, activePhotoId)
    if (!key) return
    setCollapsedGroups(prev => (prev[key] ? { ...prev, [key]: false } : prev))
  }, [activePhotoId, groups])

  const clearSelection = useCallback(() => {
    setSelectedIds([])
    lastAnchorRef.current = null
  }, [])

  const handleRowClick = useCallback((photoId: string, markerId: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastAnchorRef.current) {
      const anchor = lastAnchorRef.current
      setSelectedIds(prev => computeRangeSelection(orderedSelectableIds, anchor, photoId, prev))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds(prev => toggleSelection(prev, photoId))
      lastAnchorRef.current = photoId
      return
    }
    // Plain click: fly to marker and clear any selection so the user
    // doesn't stay in selection mode without an obvious cue.
    clearSelection()
    onMarkerClick(markerId)
  }, [orderedSelectableIds, clearSelection, onMarkerClick])

  // Double-click a row → open the full-res single-photo preview. Keyed on
  // photoId so it works for GPS and no-GPS rows alike. The single-clicks that
  // precede it are harmless.
  const handleRowDoubleClick = useCallback((photoId: string) => {
    onPreviewPhoto?.(photoId)
  }, [onPreviewPhoto])

  const selectedMarkers = useMemo(() => {
    const byPhotoId = new Map<string, PhotoMarker>()
    for (const m of markers) if (m.photoId) byPhotoId.set(m.photoId, m)
    const out: PhotoMarker[] = []
    for (const pid of selectedIds) {
      const m = byPhotoId.get(pid)
      if (m) out.push(m)
    }
    return out
  }, [selectedIds, markers])

  const triggerCompare = useCallback(() => {
    if (!onCompareVariants) return
    if (selectedMarkers.length < 2 || selectedMarkers.length > MAX_COMPARE_VARIANTS) return
    onCompareVariants(selectedMarkers)
    clearSelection()
  }, [onCompareVariants, selectedMarkers, clearSelection])

  if (groups.total === 0) return null

  const toggleGroup = (key: GroupKey) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const compareDisabled = selectedMarkers.length < 2 || selectedMarkers.length > MAX_COMPARE_VARIANTS
  const compareTooltip = selectedMarkers.length > MAX_COMPARE_VARIANTS
    ? t('photo.list.compareLimitTip', { max: MAX_COMPARE_VARIANTS })
    : ''

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
          {/* "Set 2 starts at" selector — rally only (onSetBreakChange wired)
              and only once the route has turning points. The chosen route TP
              becomes the start of set 2: picks at/after it (along the route) go
              to set 2, the editor fills the sheets accordingly, and the pick
              groups below show a "Set 2" divider at the cut. */}
          {onSetBreakChange && breakOptions.length > 0 && (
            <Box sx={{ px: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}>
              <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                {t('photo.list.setBreakLabel')}
              </Typography>
              <TextField
                select
                size="small"
                fullWidth
                value={breakValue}
                onChange={(e) => onSetBreakChange(e.target.value === '' ? null : e.target.value)}
                SelectProps={{ displayEmpty: true }}
                inputProps={{ 'aria-label': t('photo.list.setBreakLabel') }}
              >
                <MenuItem value="">{t('photo.list.setBreakNone')}</MenuItem>
                {breakOptions.map(o => (
                  <MenuItem key={o.name} value={o.name}>{o.name}</MenuItem>
                ))}
              </TextField>
            </Box>
          )}
          {GROUP_ORDER.map(key => (
            <GroupSection
              key={key}
              groupKey={key}
              title={t(`photo.list.${key}`)}
              count={groupCount(groups, key)}
              collapsed={collapsedGroups[key]}
              onToggle={() => toggleGroup(key)}
              // Phase 14 — drop target for drag-to-recategorize. Highlight only
              // when a drag is in progress from a different, valid group.
              isDropTarget={!!onPhotoSetFlag && dragSourceGroup !== null && canRecategorize(dragSourceGroup, key)}
              onDropPhoto={(markerId) => {
                const flag = flagForGroup(key)
                if (flag !== undefined) onPhotoSetFlag?.(markerId, flag)
              }}
              recatMime={RECAT_MIME}
              items={renderGroupItems(groups, key, {
                storage,
                photosDir,
                onRowClick: handleRowClick,
                onRowDoubleClick: onPreviewPhoto ? handleRowDoubleClick : undefined,
                selectedIds,
                activePhotoId: activePhotoId ?? null,
                onPhotoDelete,
                onPhotoRename,
                deleteTooltip: t('photo.deleteTooltip'),
                renameTooltip: t('photo.renameTooltip'),
                renamePlaceholder: t('photo.renamePlaceholder'),
                renameSaveAria: t('photo.renameSaveAria'),
                // Phase 14 — recat drag (GPS rows) + no-GPS click-to-place.
                recatMime: RECAT_MIME,
                recatEnabled: !!onPhotoSetFlag,
                onRowDragStart: (g) => setDragSourceGroup(g),
                onRowDragEnd: () => setDragSourceGroup(null),
                onNoGpsPhotoClick,
                setByPhotoId,
                setBreakLabel: t('photo.list.setBreakDivider'),
              })}
            />
          ))}
        </Box>
      )}
      {!collapsedPanel && onCompareVariants && selectedMarkers.length >= 1 && (
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 1 }}>
          <Tooltip title={compareTooltip} placement="top" disableHoverListener={!compareTooltip}>
            {/* Tooltip needs a non-disabled wrapper to fire on a disabled
                Button — span gets the hover, Button gets the disable. */}
            <span style={{ flex: 1 }}>
              <Button
                fullWidth
                variant="contained"
                size="small"
                color="secondary"
                startIcon={<CompareArrows fontSize="small" />}
                disabled={compareDisabled}
                onClick={triggerCompare}
              >
                {t('photo.list.compareSelected', { count: selectedMarkers.length })}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={t('photo.list.clearSelection')} placement="top">
            <IconButton size="small" onClick={clearSelection} aria-label={t('photo.list.clearSelection')}>
              <Close fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      {!collapsedPanel && onSendToEditor && (
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button
            fullWidth
            variant="contained"
            size="small"
            startIcon={<SendOutlined fontSize="small" />}
            disabled={pickCount === 0}
            onClick={() => { void onSendToEditor() }}
            data-tour="send"
          >
            {t('photo.list.sendToEditor', { count: pickCount })}
          </Button>
          {/* No-GPS photos still sitting in the tray are not picks and will NOT
              transfer to the editor until dropped on the map. Surfacing the
              count here stops the export from looking "one fewer than expected"
              with no explanation (feedback 2026-06-19). */}
          {groups.noGps.length > 0 && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.75, lineHeight: 1.3 }}
            >
              {t('photo.list.noGpsNotPlaced', { count: groups.noGps.length })}
            </Typography>
          )}
        </Box>
      )}
    </Paper>
  )
}

/**
 * Toggle a photoId in the selection list. Append on first click, remove on
 * second. Exported for unit testing — keeps the multi-select event handler
 * pure and lets a single test pin the ordering rules:
 *
 *  - First click on a new id → append to the end (preserves click order).
 *  - Click on an already-selected id → remove (no shuffle of other ids).
 */
export function toggleSelection(
  prev: readonly string[],
  id: string,
): readonly string[] {
  return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
}

/**
 * Shift+click range selection. Builds the union of the previous selection
 * with every id between `anchor` and `target` in the visible row order, so
 * a user can extend an existing selection without losing prior picks.
 * Returns `prev` unchanged when either id isn't in the ordered list (a
 * defensive no-op against stale anchors from photos that were just deleted).
 *
 * Exported for unit testing — drives the variant-compare workflow.
 */
export function computeRangeSelection(
  orderedIds: readonly string[],
  anchor: string,
  target: string,
  prev: readonly string[],
): readonly string[] {
  const a = orderedIds.indexOf(anchor)
  const b = orderedIds.indexOf(target)
  if (a < 0 || b < 0) return prev
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  const range = orderedIds.slice(lo, hi + 1)
  const seen = new Set(prev)
  const next = [...prev]
  for (const id of range) {
    if (!seen.has(id)) {
      next.push(id)
      seen.add(id)
    }
  }
  return next
}

function groupCount(g: ReturnType<typeof groupPhotosByFlag>, key: GroupKey): number {
  return g[key].length
}

/**
 * Which marker group (turning/track picks, neutral, rejects) a photoId lives
 * in, or `null` if it isn't a GPS marker (unknown id, or a no-GPS tray photo —
 * those have no marker and can't be the active photo). Exported for unit
 * testing; drives the Phase-13 auto-expand of the active photo's group.
 */
export function groupKeyForPhotoId(
  g: ReturnType<typeof groupPhotosByFlag>,
  photoId: string,
): Exclude<GroupKey, 'noGps'> | null {
  if (g.picksTurning.some(m => m.photoId === photoId)) return 'picksTurning'
  if (g.picksTrack.some(m => m.photoId === photoId)) return 'picksTrack'
  if (g.neutral.some(m => m.photoId === photoId)) return 'neutral'
  if (g.rejects.some(m => m.photoId === photoId)) return 'rejects'
  return null
}

function GroupSection(props: {
  groupKey: GroupKey
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
  items: React.ReactNode
  // Phase 14 — drag-to-recategorize drop target.
  isDropTarget: boolean
  onDropPhoto: (markerId: string) => void
  recatMime: string
}) {
  const { title, count, collapsed, onToggle, items, isDropTarget, onDropPhoto, recatMime } = props
  const [dragOver, setDragOver] = useState(false)

  // Drop handlers live on the whole section (header + body) so an empty or
  // collapsed group still accepts a dropped row. preventDefault on dragOver is
  // what makes the element a valid drop target.
  const handleDragOver = (e: React.DragEvent) => {
    if (!isDropTarget) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragOver) setDragOver(true)
  }
  const handleDrop = (e: React.DragEvent) => {
    setDragOver(false)
    if (!isDropTarget) return
    const markerId = e.dataTransfer.getData(recatMime)
    if (markerId) {
      e.preventDefault()
      onDropPhoto(markerId)
    }
  }

  return (
    <Box
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      sx={dragOver ? { outline: '2px dashed', outlineColor: 'primary.main', outlineOffset: '-2px', bgcolor: 'action.hover' } : undefined}
    >
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
    onRowClick: (photoId: string, markerId: string, e: React.MouseEvent) => void
    onRowDoubleClick?: (photoId: string) => void
    selectedIds: readonly string[]
    activePhotoId: string | null
    onPhotoDelete: (photoId: string) => void | Promise<void>
    onPhotoRename: (photoId: string, newName: string) => void | Promise<void>
    deleteTooltip: string
    renameTooltip: string
    renamePlaceholder: string
    renameSaveAria: string
    recatMime: string
    recatEnabled: boolean
    onRowDragStart: (group: GroupKey) => void
    onRowDragEnd: () => void
    onNoGpsPhotoClick?: (photoId: string) => void
    /** Per-photo set membership (set1/set2) from the TP break; empty when none. */
    setByPhotoId: ReadonlyMap<string, SetKey>
    /** Localized caption for the set1│set2 divider row. */
    setBreakLabel: string
  },
): React.ReactNode {
  const commonRenameCtx = {
    onRename: ctx.onPhotoRename,
    renameTooltip: ctx.renameTooltip,
    renamePlaceholder: ctx.renamePlaceholder,
    renameSaveAria: ctx.renameSaveAria,
  }
  const selectedSet = new Set(ctx.selectedIds)
  if (key === 'noGps') {
    return g.noGps.map(p => (
      <PhotoListItem
        key={p.photoId}
        photoId={p.photoId}
        displayName={noGpsPhotoDisplayName(p)}
        originalFilename={p.filename}
        storage={ctx.storage}
        photosDir={ctx.photosDir}
        // Phase 14 — clicking a no-GPS row starts placing it on the map
        // (provisional pin at map center). Distinct from the drag below: a
        // drag fires only on motion, a click only without it.
        onClick={ctx.onNoGpsPhotoClick ? () => ctx.onNoGpsPhotoClick!(p.photoId) : undefined}
        // Double-click opens the full-res preview (same as GPS rows).
        onDoubleClick={ctx.onRowDoubleClick ? () => ctx.onRowDoubleClick!(p.photoId) : undefined}
        selected={false}
        active={false}
        // Drag the row straight onto the map to place it — same drag type the
        // bottom tray uses, so it lands at the drop point as a Track pick via
        // the map's existing NO_GPS_PHOTO_DRAG_TYPE drop handler. NOT the
        // recategorise drag (that's GPS-rows-only, drops onto panel groups), so
        // we deliberately don't touch onRowDragStart's group-highlight state.
        recatDraggable
        onRecatDragStart={(e) => {
          e.dataTransfer.setData(NO_GPS_PHOTO_DRAG_TYPE, p.photoId)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDelete={ctx.onPhotoDelete}
        deleteTooltip={ctx.deleteTooltip}
        {...commonRenameCtx}
      />
    ))
  }
  const list = g[key]
  // Set1│set2 divider — only inside the two pick groups, and only when this
  // group straddles the break (has set1 photos followed by set2 photos). The
  // index is computed from the SAME partition the editor receives.
  const dividerIndex = (key === 'picksTurning' || key === 'picksTrack')
    ? setBreakDividerIndex(list.map(m => m.photoId!), ctx.setByPhotoId)
    : -1
  const rows: React.ReactNode[] = []
  list.forEach((m, i) => {
    if (i === dividerIndex) {
      rows.push(<SetBreakDivider key="set-break-divider" label={ctx.setBreakLabel} />)
    }
    rows.push(
      <PhotoListItem
        key={m.id}
        photoId={m.photoId!}
        displayName={photoMarkerDisplayName(m)}
        originalFilename={m.name}
        storage={ctx.storage}
        photosDir={ctx.photosDir}
        onClick={(e) => ctx.onRowClick(m.photoId!, m.id, e)}
        onDoubleClick={ctx.onRowDoubleClick ? () => ctx.onRowDoubleClick!(m.photoId!) : undefined}
        selected={selectedSet.has(m.photoId!)}
        active={m.photoId === ctx.activePhotoId}
        recatDraggable={ctx.recatEnabled}
        onRecatDragStart={(e) => {
          e.dataTransfer.setData(ctx.recatMime, m.id)
          e.dataTransfer.effectAllowed = 'move'
          ctx.onRowDragStart(key)
        }}
        onRecatDragEnd={ctx.onRowDragEnd}
        onDelete={ctx.onPhotoDelete}
        deleteTooltip={ctx.deleteTooltip}
        {...commonRenameCtx}
      />
    )
  })
  return rows
}

/**
 * Thin labelled separator marking where set 2 begins within a pick group. The
 * scissors icon ties it visually to the break TP's scissors badge on the map.
 */
function SetBreakDivider(props: { label: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1,
        py: 0.25,
        color: 'primary.main',
        '&::before, &::after': {
          content: '""',
          flex: 1,
          height: '1px',
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.4),
        },
      }}
    >
      <ContentCut sx={{ fontSize: 12 }} />
      <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {props.label}
      </Typography>
    </Box>
  )
}

/**
 * Validate and normalise a rename draft. Exported for unit testing — the
 * keyboard / blur paths in `PhotoListItem` all funnel through this, so a
 * single test pins the rules:
 *
 *  - Trim leading/trailing whitespace.
 *  - Empty (after trim) → reject (return null). Caller treats null as
 *    "cancel without saving" so the previous name is kept.
 *  - Identical to the current display value → return null (no-op, don't write).
 *  - Otherwise return the normalised string. (Reverting to the original
 *    filename is handled downstream in `computeRenamedPhoto`, which clears the
 *    custom name; here it's just another non-empty value to pass through.)
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
  /** Custom name if set, else the original filename — the primary label + edit seed. */
  displayName: string
  /** Original camera filename. Shown as a secondary line only when renamed. */
  originalFilename: string
  storage: StorageInterface | null
  photosDir: DirectoryHandle | null
  /**
   * Row click receives the raw event so the caller can branch on modifier
   * keys (Ctrl/Cmd → toggle in variant selection, Shift → range select,
   * plain click → fly to marker). `undefined` disables the row entirely.
   */
  onClick: ((e: React.MouseEvent) => void) | undefined
  /**
   * Double-click opens the full-res preview. Independent of `onClick`; the
   * preceding single-clicks still fire. `undefined` disables it.
   */
  onDoubleClick?: (e: React.MouseEvent) => void
  /** Whether this row is part of the variant-compare selection. */
  selected: boolean
  /**
   * Whether this is the active photo (its map popup is open). Renders a
   * filled tint and scrolls the row into view. Independent of `selected`.
   */
  active: boolean
  /**
   * Phase 14 — whether this row can be dragged onto another group to
   * recategorize it (GPS rows only; no-GPS rows have no flag). When true and
   * not editing, the row root is HTML5-draggable.
   */
  recatDraggable?: boolean
  onRecatDragStart?: (e: React.DragEvent) => void
  onRecatDragEnd?: () => void
  onDelete: (photoId: string) => void | Promise<void>
  deleteTooltip: string
  onRename: (photoId: string, newName: string) => void | Promise<void>
  renameTooltip: string
  renamePlaceholder: string
  renameSaveAria: string
}) {
  const {
    photoId, displayName, originalFilename, storage, photosDir, onClick, onDoubleClick, selected, active, onDelete, deleteTooltip,
    onRename, renameTooltip, renamePlaceholder, renameSaveAria,
    recatDraggable, onRecatDragStart, onRecatDragEnd,
  } = props
  const { url, state } = usePhotoThumbUrl(storage, photosDir, photoId)
  const rowRef = useRef<HTMLDivElement | null>(null)
  // Bring the active row into view when it becomes active (e.g. the user
  // clicked its marker on the map). `block: 'nearest'` avoids yanking the
  // scroll when the row is already visible.
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])
  const [editing, setEditing] = useState(false)
  // `draft` is the in-progress text. Seeded with the current display value on
  // every entry into edit mode so a previous cancel doesn't leak into the
  // next session.
  const [draft, setDraft] = useState(displayName)
  // Show the camera filename underneath only when a custom name is in effect —
  // otherwise the row would print the same string twice.
  const showOriginal = displayName !== originalFilename

  const beginEdit = () => {
    setDraft(displayName)
    setEditing(true)
  }
  const commit = () => {
    const next = normalizeRename(draft, displayName)
    setEditing(false)
    if (next !== null) void onRename(photoId, next)
  }
  const cancel = () => {
    setEditing(false)
  }

  return (
    <Box
      ref={rowRef}
      // Phase 14 — recat drag. Disabled while editing so the rename field
      // stays text-selectable. Click/selection still work (drag only fires on
      // real motion). The thumbnail <img> sets draggable={false} so the photo
      // itself isn't what gets dragged.
      draggable={!!recatDraggable && !editing}
      onDragStart={recatDraggable && !editing ? onRecatDragStart : undefined}
      onDragEnd={recatDraggable && !editing ? onRecatDragEnd : undefined}
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
        onDoubleClick={editing ? undefined : onDoubleClick}
        // A disabled button swallows dblclick too, so only disable when the
        // row has neither a click nor a double-click action.
        disabled={!editing && !onClick && !onDoubleClick}
        selected={selected}
        // Edit mode renders as a div so the inner TextField isn't nested
        // inside a <button> (a11y violation + focus contention). Spread
        // `component` conditionally — MUI's overload typing rejects
        // `component={undefined}`.
        {...(editing ? { component: 'div' as const } : {})}
        // Two icon-buttons live in the right pad (rename + delete) when
        // not editing; one (save) when editing. pr: 7 covers the wider case.
        // Left border accent on selected rows so the variant selection is
        // obvious even on rejected rows (which would otherwise have only
        // the subtle MUI `selected` highlight to lean on).
        sx={{
          py: 0.5,
          gap: 1,
          pr: 7,
          ...(selected && {
            borderLeft: '3px solid',
            borderLeftColor: 'secondary.main',
            pl: 0.625, // standard ListItemButton pl is 16px; offset by border so text doesn't shift
          }),
          // Active photo (map popup open): filled primary tint. Distinct from
          // the variant `selected` left-border accent so a row can show both.
          ...(active && {
            backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.14),
            '&:hover': { backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.2) },
          }),
        }}
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
              alt={displayName}
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
            primary={displayName}
            // Original camera filename underneath, but only when renamed —
            // gives the user the workflow name (TP1) AND the camera reference.
            secondary={showOriginal ? originalFilename : undefined}
            primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { fontSize: 12 } }}
            secondaryTypographyProps={{ variant: 'caption', noWrap: true, sx: { fontSize: 10 } }}
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

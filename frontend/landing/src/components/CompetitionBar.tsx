import { useState } from 'react'
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import type { SelectChangeEvent } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import CloseIcon from '@mui/icons-material/Close'
import CheckIcon from '@mui/icons-material/Check'
import type { CompetitionMetadata, Discipline } from '@airq/competitions'
import { useI18n } from '../contexts/I18nContext'
import { DisciplineToggle } from './DisciplineToggle'

interface Props {
  competitions: CompetitionMetadata[]
  activeId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onChangeDiscipline: (id: string, discipline: Discipline) => Promise<void>
}

type Mode = 'select' | 'create' | 'delete'

export function CompetitionBar(props: Props) {
  const { competitions, activeId, loading, onSelect, onCreate, onDelete, onChangeDiscipline } =
    props
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('select')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const active = competitions.find((c) => c.id === activeId) ?? null
  const discipline: Discipline = (active?.discipline as Discipline | undefined) ?? 'rally'

  const handleSelect = (e: SelectChangeEvent<string>) => {
    const id = e.target.value
    if (id && id !== activeId) onSelect(id)
  }

  const openCreate = () => {
    setNewName(t('competition.defaultName'))
    setMode('create')
  }

  const doCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      await onCreate(name)
      setMode('select')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!activeId) return
    setBusy(true)
    try {
      await onDelete(activeId)
      setMode('select')
    } finally {
      setBusy(false)
    }
  }

  const barSx = {
    display: 'flex',
    alignItems: 'center',
    gap: 1.5,
    p: 1.5,
    pl: 2.25,
    pr: 2.25,
    borderRadius: 2,
    bgcolor: '#FFFFFF',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  }

  if (mode === 'create') {
    return (
      <Paper elevation={0} sx={barSx}>
        <Typography sx={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
          {t('competition.promptName')}
        </Typography>
        <TextField
          size="small"
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doCreate()
            if (e.key === 'Escape') setMode('select')
          }}
          slotProps={{ htmlInput: { maxLength: 60 } }}
          sx={{ flex: 1 }}
        />
        <Button
          variant="contained"
          disableElevation
          size="small"
          startIcon={<CheckIcon />}
          onClick={doCreate}
          disabled={busy || !newName.trim()}
        >
          {t('competition.create')}
        </Button>
        <IconButton size="small" onClick={() => setMode('select')} aria-label="cancel">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Paper>
    )
  }

  if (mode === 'delete' && active) {
    return (
      <Paper elevation={0} sx={{ ...barSx, borderColor: '#FED7D7', bgcolor: '#FFF5F5' }}>
        <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', flex: 1, color: '#742A2A' }}>
          {t('competition.deleteConfirmText', { name: active.name })}
        </Typography>
        <Button
          variant="contained"
          color="error"
          disableElevation
          size="small"
          startIcon={<DeleteIcon />}
          onClick={doDelete}
          disabled={busy}
        >
          {t('competition.confirmDelete')}
        </Button>
        <Button
          variant="outlined"
          size="small"
          onClick={() => setMode('select')}
          disabled={busy}
        >
          {t('competition.cancelDelete')}
        </Button>
      </Paper>
    )
  }

  return (
    <Paper elevation={0} sx={barSx}>
      <Typography
        component="label"
        htmlFor="competition-select"
        sx={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', color: '#2D3748' }}
      >
        {t('competition.label')}
      </Typography>
      <Select
        id="competition-select"
        size="small"
        value={activeId ?? ''}
        onChange={handleSelect}
        disabled={loading || competitions.length === 0}
        displayEmpty
        sx={{ flex: 1, bgcolor: '#F8FAFC' }}
      >
        {loading && (
          <MenuItem value="" disabled>
            {t('competition.loading')}
          </MenuItem>
        )}
        {!loading && competitions.length === 0 && (
          <MenuItem value="" disabled>
            {t('competition.empty')}
          </MenuItem>
        )}
        {competitions.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {c.name} ({new Date(c.createdAt).toLocaleDateString()})
          </MenuItem>
        ))}
      </Select>
      <Box sx={{ opacity: activeId ? 1 : 0.4, pointerEvents: activeId ? 'auto' : 'none' }}>
        <DisciplineToggle
          value={discipline}
          onChange={(next) => activeId && onChangeDiscipline(activeId, next)}
        />
      </Box>
      <Button
        variant="contained"
        disableElevation
        size="small"
        startIcon={<AddIcon />}
        onClick={openCreate}
      >
        {t('competition.new')}
      </Button>
      <IconButton
        size="small"
        onClick={() => setMode('delete')}
        disabled={!activeId}
        aria-label={t('competition.deleteBtn')}
        sx={{ color: '#C53030' }}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Paper>
  )
}

import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { Discipline } from '@airq/competitions'
import { useI18n } from '../contexts/I18nContext'

interface Props {
  value: Discipline
  onChange: (next: Discipline) => void
  disabled?: boolean
}

export function DisciplineToggle({ value, onChange, disabled }: Props) {
  const { t } = useI18n()

  const handle = (_e: React.MouseEvent<HTMLElement>, next: Discipline | null) => {
    if (next) onChange(next)
  }

  return (
    <ToggleButtonGroup
      value={value}
      exclusive
      size="small"
      disabled={disabled}
      onChange={handle}
      sx={{
        '& .MuiToggleButton-root': {
          textTransform: 'none',
          fontSize: '0.85rem',
          fontWeight: 500,
          px: 1.75,
          py: 0.75,
          borderColor: '#E2E8F0',
          color: '#4A5568',
          bgcolor: '#F8FAFC',
          '&.Mui-selected': {
            bgcolor: '#1976D2',
            color: '#FFFFFF',
            '&:hover': { bgcolor: '#0D47A1' },
          },
        },
      }}
    >
      <ToggleButton value="precision">{t('discipline.precision')}</ToggleButton>
      <ToggleButton value="rally">{t('discipline.rally')}</ToggleButton>
    </ToggleButtonGroup>
  )
}

import { Box, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

interface Props {
  title: string
  description: string
  icon: ReactNode
  disabled?: boolean
  onClick: () => void
}

export function AppCard({ title, description, icon, disabled, onClick }: Props) {
  return (
    <Card
      elevation={0}
      sx={{
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        border: '1px solid #E2E8F0',
        transition: 'box-shadow 0.2s, transform 0.2s, border-color 0.2s',
        '&:hover': {
          borderColor: '#1976D2',
          transform: 'translateY(-2px)',
          boxShadow: '0 12px 24px rgba(25,118,210,0.12)',
        },
      }}
    >
      <CardActionArea onClick={onClick} disabled={disabled} sx={{ height: '100%' }}>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: '#EBF5FF',
                color: '#1976D2',
                flexShrink: 0,
              }}
            >
              {icon}
            </Box>
            <Stack spacing={0.5}>
              <Typography sx={{ fontWeight: 600, fontSize: '1.125rem', color: '#1A202C' }}>
                {title}
              </Typography>
              <Typography sx={{ color: '#4A5568', fontSize: '0.9rem' }}>
                {description}
              </Typography>
            </Stack>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

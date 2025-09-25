/**
 * Create New Competition button with storage warning
 */

import React, { useState } from 'react';
import { 
  Button, 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  TextField,
  Typography,
  Box,
  Alert,
  LinearProgress,
  CircularProgress,
  Chip
} from '@mui/material';
import { Add as AddIcon, Warning as WarningIcon } from '@mui/icons-material';
import type { StorageStats } from '../types/competition';
import { useI18n } from '../contexts/I18nContext';

interface CreateCompetitionButtonProps {
  onCreateCompetition: (name?: string) => Promise<void>;
  storageStats?: StorageStats | null;
  competitionCount: number;
  disabled?: boolean;
  loading?: boolean;
}

export const CreateCompetitionButton: React.FC<CreateCompetitionButtonProps> = ({
  onCreateCompetition,
  storageStats,
  competitionCount,
  disabled = false,
  loading = false
}) => {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [competitionName, setCompetitionName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleOpenDialog = () => {
    setDialogOpen(true);
    setCompetitionName('');
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setCompetitionName('');
  };

  const handleCreate = async () => {
    try {
      setCreating(true);
      const name = competitionName.trim() || undefined;
      await onCreateCompetition(name);
      handleCloseDialog();
    } catch (error) {
      console.error('Failed to create competition:', error);
    } finally {
      setCreating(false);
    }
  };

  // Storage warnings
  const isStorageLow = storageStats?.isLow || false;
  const isStorageCritical = storageStats?.isCritical || false;
  const storagePercent = storageStats?.percentUsed || 0;

  // Format storage info
  const formatBytes = (bytes: number | null): string => {
    if (bytes == null) return 'Unknown';
    const mb = bytes / 1024 / 1024;
    if (mb < 1024) return `${mb.toFixed(1)}MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(1)}GB`;
  };

  const getStorageWarningLevel = (): 'info' | 'warning' | 'error' => {
    if (isStorageCritical) return 'error';
    if (isStorageLow) return 'warning';
    return 'info';
  };

  const getStorageMessage = (): string => {
    if (isStorageCritical) {
      return t('storage.status.critical', { percent: storagePercent });
    }
    if (isStorageLow) {
      return t('storage.status.high', { percent: storagePercent });
    }
    return t('storage.status.normal', { percent: storagePercent });
  };

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={handleOpenDialog}
        disabled={disabled || loading || isStorageCritical}
        size="small"
        sx={{
          minWidth: 'auto',
          whiteSpace: 'nowrap'
        }}
      >
        {t('competition.createNew')}
      </Button>

      <Dialog 
        open={dialogOpen} 
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t('competition.createNew')}
        </DialogTitle>
        
        <DialogContent>
          <Box sx={{ mb: 3 }}>
            <TextField
              fullWidth
              label={t('competition.placeholder')}
              value={competitionName}
              onChange={(e) => setCompetitionName(e.target.value)}
              placeholder={t('competition.numbered', { number: competitionCount + 1 })}
              helperText={t('competition.helper.leaveEmptyForDefault')}
              disabled={creating}
              autoFocus
            />
          </Box>

          {/* Storage Information */}
          {storageStats && (
            <Box sx={{ mb: 2 }}>
              <Alert 
                severity={getStorageWarningLevel()} 
                icon={isStorageLow ? <WarningIcon /> : undefined}
                sx={{ mb: 2 }}
              >
                <Typography variant="body2">
                  {getStorageMessage()}
                </Typography>
                {storageStats?.usedBytes != null && storageStats?.quotaBytes != null && (
                  <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption">
                      {formatBytes(storageStats.usedBytes)} / {formatBytes(storageStats.quotaBytes)}
                    </Typography>
                    <LinearProgress 
                      variant="determinate" 
                      value={Number.isFinite(storagePercent) ? Math.max(0, Math.min(100, storagePercent)) : 0} 
                      sx={{ 
                        flexGrow: 1, 
                        height: 6, 
                        borderRadius: 1,
                        backgroundColor: 'rgba(0,0,0,0.1)'
                      }}
                      color={isStorageCritical ? 'error' : isStorageLow ? 'warning' : 'primary'}
                    />
                  </Box>
                )}
              </Alert>
            </Box>
          )}

          {/* Competition count info */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('competition.currentCount')}:
            </Typography>
            <Chip 
              size="small" 
              label={`${competitionCount}/10`}
              color={competitionCount >= 8 ? 'warning' : 'default'}
              variant="outlined"
            />
          </Box>

          {/* Cleanup warning for many competitions */}
          {competitionCount >= 8 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                {t('competition.reachingLimit', { count: competitionCount })}
              </Typography>
            </Alert>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={creating}>
            {t('common.cancel')}
          </Button>
          <Button 
            onClick={handleCreate} 
            variant="contained"
            disabled={creating || isStorageCritical}
            startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
          >
            {creating ? t('common.loading') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

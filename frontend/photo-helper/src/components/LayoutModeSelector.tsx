import React, { useState } from 'react';
import {
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  Button,
  Box,
  Typography
} from '@mui/material';
import { CropLandscape, CropPortrait, Warning } from '@mui/icons-material';
import { useLayoutMode } from '../contexts/LayoutModeContext';
import { useI18n } from '../contexts/I18nContext';

interface LayoutModeSelectorProps {
  compact?: boolean;
  set1Count?: number;
  set2Count?: number;
  onModeChangeStart?: () => void;
  onModeChangeComplete?: (newMode: 'landscape' | 'portrait') => void;
}

export const LayoutModeSelector: React.FC<LayoutModeSelectorProps> = ({
  compact = false,
  set1Count = 0,
  set2Count = 0,
  onModeChangeStart,
  onModeChangeComplete
}) => {
  const { layoutMode, setLayoutMode, canSwitchToLandscape } = useLayoutMode();
  const { t } = useI18n();
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [pendingMode, setPendingMode] = useState<'landscape' | 'portrait' | null>(null);

  const handleModeChange = (_event: React.MouseEvent<HTMLElement>, newMode: 'landscape' | 'portrait' | null) => {
    if (!newMode || newMode === layoutMode) return;

    // Warn only if at least one set has 10 photos (would lose the 10th slot)
    if (layoutMode === 'portrait' && newMode === 'landscape' && (set1Count >= 10 || set2Count >= 10)) {
      setPendingMode(newMode);
      setShowWarningDialog(true);
      return;
    }

    // Safe to switch
    performModeChange(newMode);
  };

  const performModeChange = (newMode: 'landscape' | 'portrait') => {
    // Update the context state
    setLayoutMode(newMode);
    // Notify parent component if callbacks are provided
    onModeChangeComplete?.(newMode);
  };

  const handleConfirmSwitch = () => {
    if (pendingMode) {
      performModeChange(pendingMode);
    }
    setShowWarningDialog(false);
    setPendingMode(null);
  };

  const handleCancelSwitch = () => {
    setShowWarningDialog(false);
    setPendingMode(null);
  };

  if (compact) {
    return (
      <>
        <ToggleButtonGroup
          value={layoutMode}
          exclusive
          onChange={handleModeChange}
          size="small"
          sx={{
            height: 28,
            '& .MuiToggleButton-root': {
              px: 1.25,
              py: 0.4,
              fontSize: '0.72rem',
              textTransform: 'none',
              gap: 0.5,
              '& .MuiSvgIcon-root': {
                fontSize: '1rem'
              }
            }
          }}
        >
          <ToggleButton value="landscape">
            <Tooltip title={t('layout.landscape.tooltip')} arrow placement="bottom">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <CropLandscape fontSize="small" />
                <span>{t('layout.landscape.short')}</span>
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="portrait">
            <Tooltip title={t('layout.portrait.tooltip')} arrow placement="bottom">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <CropPortrait fontSize="small" />
                <span>{t('layout.portrait.short')}</span>
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>

        {/* Warning Dialog */}
        <Dialog 
          open={showWarningDialog} 
          onClose={handleCancelSwitch}
          aria-labelledby="layout-warning-title"
          aria-describedby="layout-warning-desc"
        >
          <DialogTitle id="layout-warning-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Warning color="warning" />
            {t('layout.warning.title')}
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="layout-warning-desc">
              {t('layout.warning.message')}
            </DialogContentText>
            <DialogContentText sx={{ mt: 2, fontWeight: 600 }}>
              {t('layout.warning.confirm')}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCancelSwitch} variant="outlined">
              {t('layout.warning.cancel')}
            </Button>
            <Button onClick={handleConfirmSwitch} color="warning" variant="contained">
              {t('layout.warning.proceed')}
            </Button>
          </DialogActions>
        </Dialog>
      </>
    );
  }

  // Full size version
  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {t('layout.title')}
        </Typography>
        <ToggleButtonGroup
          value={layoutMode}
          exclusive
          onChange={handleModeChange}
          size="medium"
          fullWidth
          sx={{
            '& .MuiToggleButton-root': {
              px: 2,
              py: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5
            }
          }}
        >
          <ToggleButton value="landscape">
            <CropLandscape />
            <Typography variant="caption">{t('layout.landscape.name')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('layout.landscape.description')}
            </Typography>
          </ToggleButton>
          <ToggleButton value="portrait">
            <CropPortrait />
            <Typography variant="caption">{t('layout.portrait.name')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('layout.portrait.description')}
            </Typography>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Warning Dialog (same as compact) */}
      <Dialog 
        open={showWarningDialog} 
        onClose={handleCancelSwitch}
        aria-labelledby="layout-warning-title-full"
        aria-describedby="layout-warning-desc-full"
      >
        <DialogTitle id="layout-warning-title-full" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Warning color="warning" />
          {t('layout.warning.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="layout-warning-desc-full">
            {t('layout.warning.message')}
          </DialogContentText>
          <DialogContentText sx={{ mt: 2, fontWeight: 600 }}>
            {t('layout.warning.confirm')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelSwitch} variant="outlined">
            {t('layout.warning.cancel')}
          </Button>
          <Button onClick={handleConfirmSwitch} color="warning" variant="contained">
            {t('layout.warning.proceed')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

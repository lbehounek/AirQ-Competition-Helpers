/**
 * Cleanup confirmation modal - shows storage cleanup suggestions to user
 */

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Checkbox,
  Alert,
  Chip,
  Divider,
  CircularProgress
} from '@mui/material';
import { 
  CleaningServices as CleanIcon,
  Schedule as AgeIcon,
  Storage as ExcessIcon,
  Photo as PhotoIcon,
  Info as InfoIcon
} from '@mui/icons-material';
import type { CleanupCandidate } from '../types/competition';
import { useI18n } from '../contexts/I18nContext';

interface CleanupModalProps {
  open: boolean;
  candidates: CleanupCandidate[];
  onConfirm: (selectedCandidates: CleanupCandidate[]) => void;
  onCancel: () => void;
  loading?: boolean;
}

export const CleanupModal: React.FC<CleanupModalProps> = ({
  open,
  candidates,
  onConfirm,
  onCancel,
  loading = false
}) => {
  const { t } = useI18n();
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(
    new Set(candidates.map(c => c.competition.id))
  );

  // Reset selections when candidates list or open state changes
  useEffect(() => {
    setSelectedCandidates(new Set(candidates.map(c => c.competition.id)));
  }, [candidates, open]);

  const handleToggleCandidate = (candidateId: string) => {
    const newSelected = new Set(selectedCandidates);
    if (newSelected.has(candidateId)) {
      newSelected.delete(candidateId);
    } else {
      newSelected.add(candidateId);
    }
    setSelectedCandidates(newSelected);
  };

  const handleSelectAll = () => {
    setSelectedCandidates(new Set(candidates.map(c => c.competition.id)));
  };

  const handleSelectNone = () => {
    setSelectedCandidates(new Set());
  };

  const handleConfirm = () => {
    const selected = candidates.filter(c => selectedCandidates.has(c.competition.id));
    onConfirm(selected);
  };

  const formatReason = (candidate: CleanupCandidate): string => {
    if (candidate.reason === 'age' && candidate.daysOld) {
      return t('cleanup.ageReason', { 
        days: candidate.daysOld, 
        photos: candidate.competition.photoCount 
      });
    }
    return t('cleanup.excessReason', { max: 10 });
  };

  const getReasonIcon = (reason: 'age' | 'excess') => {
    return reason === 'age' ? <AgeIcon color="warning" /> : <ExcessIcon color="info" />;
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString();
  };

  const estimatedFreedSpace = candidates
    .filter(c => selectedCandidates.has(c.competition.id))
    .reduce((total, c) => total + (c.estimatedSizeMB || 0), 0);

  if (candidates.length === 0) {
    return null;
  }

  return (
    <Dialog 
      open={open} 
      onClose={onCancel}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: '60vh' }
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CleanIcon color="primary" />
          <Typography variant="h6">
            {t('cleanup.title')}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Typography variant="body1" sx={{ mb: 2 }}>
          {t('cleanup.subtitle', { count: candidates.length })}
        </Typography>

        {/* Selection controls */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button size="small" onClick={handleSelectAll} variant="outlined">
            {t('common.selectAll')}
          </Button>
          <Button size="small" onClick={handleSelectNone} variant="outlined">
            {t('common.selectNone')}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Chip 
            size="small" 
            label={`${selectedCandidates.size}/${candidates.length} selected`}
            color={selectedCandidates.size > 0 ? 'primary' : 'default'}
          />
        </Box>

        {/* Candidates list */}
        <List dense>
          {candidates.map((candidate, index) => {
            const isSelected = selectedCandidates.has(candidate.competition.id);
            
            return (
              <React.Fragment key={candidate.competition.id}>
                <ListItem
                  onClick={() => handleToggleCandidate(candidate.competition.id)}
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: 'action.hover' },
                    borderRadius: 1,
                    mb: 1
                  }}
                  disabled={loading}
                >
                  <ListItemIcon>
                    <Checkbox
                      checked={isSelected}
                      onClick={(e) => { e.stopPropagation(); }}
                      onChange={(e) => { e.stopPropagation(); handleToggleCandidate(candidate.competition.id); }}
                      disabled={loading}
                    />
                  </ListItemIcon>
                  
                  <ListItemIcon>
                    {getReasonIcon(candidate.reason)}
                  </ListItemIcon>
                  
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {candidate.competition.name}
                        </Typography>
                        <Chip 
                          size="small" 
                          icon={<PhotoIcon />}
                          label={t('competition.photos', { count: candidate.competition.photoCount })}
                          variant="outlined"
                          sx={{ fontSize: '0.75rem' }}
                        />
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          {formatReason(candidate)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t('common.createdOn', { date: formatDate(candidate.competition.createdAt) })}
                        </Typography>
                      </Box>
                    }
                  />
                </ListItem>
                
                {index < candidates.length - 1 && <Divider variant="inset" />}
              </React.Fragment>
            );
          })}
        </List>

        {/* Summary information */}
        <Box sx={{ mt: 3 }}>
          <Alert severity="info" icon={<InfoIcon />}>
            <Typography variant="body2">
              {t('cleanup.autoCleanupInfo')}
            </Typography>
            
            {selectedCandidates.size > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2">
                  {t('cleanup.willFree', { size: `~${estimatedFreedSpace.toFixed(1)}MB` })}
                </Typography>
                <Typography variant="body2">
                  {t('cleanup.currentTotal', { count: candidates.length })}
                </Typography>
              </Box>
            )}
          </Alert>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button 
          onClick={onCancel} 
          disabled={loading}
          color="inherit"
        >
          {t('cleanup.keepAll')}
        </Button>
        
        <Button 
          onClick={handleConfirm}
          variant="contained"
          disabled={selectedCandidates.size === 0 || loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <CleanIcon />}
          color="warning"
        >
          {loading 
            ? t('common.loading') 
            : t('cleanup.deleteSelected')
          }
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/**
 * Competition Manager - Main component integrating competition system
 * This component can be used in place of or alongside existing photo session management
 */

import React, { useEffect } from 'react';
import { Box, Alert, Typography, Grid, Paper } from '@mui/material';
import { CompetitionSelector } from './CompetitionSelector';
import { CreateCompetitionButton } from './CreateCompetitionButton';
import { CleanupModal } from './CleanupModal';
import { useCompetitionSystem } from '../hooks/useCompetitionSystem';
import { useI18n } from '../contexts/I18nContext';

interface CompetitionManagerProps {
  children?: (competitionHook: ReturnType<typeof useCompetitionSystem>) => React.ReactNode;
  showCleanupOnMount?: boolean;
}

export const CompetitionManager: React.FC<CompetitionManagerProps> = ({
  children,
  showCleanupOnMount = true
}) => {
  const { t } = useI18n();
  const competitionHook = useCompetitionSystem();
  
  const {
    currentCompetition,
    competitions,
    loading,
    error,
    createNewCompetition,
    switchToCompetition,
    deleteCompetition,
    cleanupCandidates,
    storageStats,
    performCleanup,
    dismissCleanup,
    clearError
  } = competitionHook;

  // Show cleanup modal on mount if candidates exist
  const shouldShowCleanup = showCleanupOnMount && cleanupCandidates.length > 0;

  if (loading && !currentCompetition) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          {t('session.loading')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Error Display */}
      {error && (
        <Alert 
          severity="error" 
          onClose={clearError}
          sx={{ mb: 2 }}
        >
          {error}
        </Alert>
      )}

      {/* Competition Controls */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          {t('competition.title')}
        </Typography>
        
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={8}>
            <CompetitionSelector
              competitions={competitions}
              currentCompetitionId={currentCompetition?.id || null}
              onCompetitionChange={switchToCompetition}
              loading={loading}
            />
          </Grid>
          
          <Grid item xs={12} sm={4}>
            <CreateCompetitionButton
              onCreateCompetition={createNewCompetition}
              storageStats={storageStats}
              competitionCount={competitions.length}
              loading={loading}
            />
          </Grid>
        </Grid>

        {/* Current Competition Info */}
        {currentCompetition && (
          <Box sx={{ mt: 2, p: 1, backgroundColor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('competition.current', { name: currentCompetition.name })} • {' '}
              {t('competition.photos', { count: currentCompetition.photoCount })} • {' '}
              {new Date(currentCompetition.createdAt).toLocaleDateString()}
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Cleanup Modal */}
      <CleanupModal
        open={shouldShowCleanup}
        candidates={cleanupCandidates}
        onConfirm={performCleanup}
        onCancel={dismissCleanup}
      />

      {/* Children with competition hook */}
      {children && children(competitionHook)}
    </Box>
  );
};

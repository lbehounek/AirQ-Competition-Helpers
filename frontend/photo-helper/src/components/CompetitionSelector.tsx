/**
 * Competition dropdown selector component
 */

import React, { useState } from 'react';
import { Select, MenuItem, FormControl, InputLabel, Box, Typography, Chip } from '@mui/material';
import type { CompetitionMetadata } from '../types/competition';
import { useI18n } from '../contexts/I18nContext';

interface CompetitionSelectorProps {
  competitions: CompetitionMetadata[];
  currentCompetitionId: string | null;
  onCompetitionChange: (competitionId: string) => void;
  loading?: boolean;
  disabled?: boolean;
}

export const CompetitionSelector: React.FC<CompetitionSelectorProps> = ({
  competitions,
  currentCompetitionId,
  onCompetitionChange,
  loading = false,
  disabled = false
}) => {
  const { t } = useI18n();
  
  // Debug logging
  console.log('CompetitionSelector render:', {
    competitions: competitions?.length || 0,
    currentCompetitionId,
    loading
  });
  
  const handleChange = (event: any) => {
    const competitionId = event.target.value;
    if (competitionId && competitionId !== currentCompetitionId) {
      onCompetitionChange(competitionId);
    }
  };

  const formatCompetitionOption = (competition: CompetitionMetadata) => {
    const photoText = t('competition.photos', { count: competition.photoCount });
    const createdDate = new Date(competition.createdAt).toLocaleDateString();
    
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
        <Typography variant="body1" sx={{ fontWeight: competition.isActive ? 600 : 400 }}>
          {competition.name}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
          <Chip 
            size="small" 
            label={photoText} 
            variant="outlined"
            sx={{ fontSize: '0.75rem', height: '20px' }}
          />
          <Typography variant="caption" color="text.secondary">
            {createdDate}
          </Typography>
          {competition.isActive && (
            <Chip 
              size="small" 
              label={t('common.selected')} 
              color="primary"
              sx={{ fontSize: '0.75rem', height: '20px' }}
            />
          )}
        </Box>
      </Box>
    );
  };

  // Sort competitions by last modified (newest first)
  const sortedCompetitions = [...competitions].sort((a, b) => 
    new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
  );

  return (
    <FormControl fullWidth size="small" disabled={disabled || loading}>
      <InputLabel id="competition-selector-label">
        {t('competition.selectCompetition')}
      </InputLabel>
      <Select
        labelId="competition-selector-label"
        value={currentCompetitionId || ''}
        label={t('competition.selectCompetition')}
        onChange={handleChange}
        renderValue={(selected) => {
          const competition = competitions.find(c => c.id === selected);
          if (!competition) return '';
          
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">
                {competition.name}
              </Typography>
              <Chip 
                size="small" 
                label={t('competition.photos', { count: competition.photoCount })} 
                variant="outlined"
                sx={{ fontSize: '0.7rem', height: '18px' }}
              />
            </Box>
          );
        }}
        sx={{
          '& .MuiSelect-select': {
            py: 1
          }
        }}
      >
        {sortedCompetitions.length === 0 ? (
          <MenuItem disabled>
            <Typography variant="body2" color="text.secondary">
              {loading ? t('common.loading') : 'No competitions available'}
            </Typography>
          </MenuItem>
        ) : (
          sortedCompetitions.map((competition) => (
            <MenuItem 
              key={competition.id} 
              value={competition.id}
              selected={competition.id === currentCompetitionId}
              sx={{
                py: 1.5,
                minHeight: 'auto',
                '&.Mui-selected': {
                  backgroundColor: 'primary.light',
                  '&:hover': {
                    backgroundColor: 'primary.light',
                  }
                }
              }}
            >
              {formatCompetitionOption(competition)}
            </MenuItem>
          ))
        )}
      </Select>
    </FormControl>
  );
};

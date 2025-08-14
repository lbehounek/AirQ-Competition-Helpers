import React from 'react';
import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Tooltip
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { AspectRatio } from '@mui/icons-material';
import { useAspectRatio, ASPECT_RATIO_OPTIONS } from '../contexts/AspectRatioContext';

export const AspectRatioSelector: React.FC = () => {
  const { currentRatio, setAspectRatio } = useAspectRatio();

  const handleChange = (event: SelectChangeEvent<string>) => {
    const selectedRatio = ASPECT_RATIO_OPTIONS.find(
      option => option.id === event.target.value
    );
    if (selectedRatio) {
      setAspectRatio(selectedRatio);
    }
  };

  return (
    <Box sx={{ minWidth: 200 }}>
      <FormControl fullWidth size="small">
        <InputLabel>Photo Format</InputLabel>
        <Select
          value={currentRatio.id}
          label="Photo Format"
          onChange={handleChange}
          startAdornment={<AspectRatio sx={{ mr: 1, color: 'text.secondary' }} />}
        >
          {ASPECT_RATIO_OPTIONS.map((option) => (
            <MenuItem key={option.id} value={option.id}>
              <Tooltip title={option.description} placement="right">
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {option.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.description}
                  </Typography>
                </Box>
              </Tooltip>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
};

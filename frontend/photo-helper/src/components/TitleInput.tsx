import React from 'react';
import { TextField, Typography, Box } from '@mui/material';
import { Title as TitleIcon } from '@mui/icons-material';

interface TitleInputProps {
  value: string;
  onChange: (value: string) => void;
  setName: string;
  placeholder?: string;
}

export const TitleInput: React.FC<TitleInputProps> = ({
  value,
  onChange,
  setName,
  placeholder = 'Enter title for this set...'
}) => {
  return (
    <Box sx={{ mb: 3 }}>
      <TextField
        fullWidth
        label={`${setName} Title`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        variant="outlined"
        inputProps={{ maxLength: 100 }}
        helperText={`${value.length}/100 characters`}
        InputProps={{
          startAdornment: <TitleIcon sx={{ mr: 1, color: 'text.secondary' }} />,
        }}
        sx={{
          '& .MuiOutlinedInput-root': {
            '&:hover fieldset': {
              borderColor: 'primary.light',
            },
            '&.Mui-focused fieldset': {
              borderColor: 'primary.main',
              borderWidth: 2,
            },
          },
          '& .MuiFormLabel-root.Mui-focused': {
            color: 'primary.main',
          },
        }}
      />
    </Box>
  );
};

import React, { useState, useRef, useEffect } from 'react';
import { Typography, TextField, Box, IconButton } from '@mui/material';
import { Edit, Check, Close } from '@mui/icons-material';
import { useI18n } from '../contexts/I18nContext';

interface EditableHeadingProps {
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
  variant?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  color?: string;
  placeholder?: string;
}

export const EditableHeading: React.FC<EditableHeadingProps> = ({
  value,
  defaultValue,
  onChange,
  variant = 'h4',
  color = 'primary',
  placeholder
}) => {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update temp value when value changes
  useEffect(() => {
    setTempValue(value);
  }, [value]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    setTempValue(value);
    setIsEditing(true);
  };

  const handleSave = () => {
    onChange(tempValue.trim());
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTempValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const displayText = value.trim() || defaultValue;

  if (isEditing) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <TextField
          ref={inputRef}
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          placeholder={placeholder || t('sets.title.placeholder', { setName: defaultValue })}
          variant="standard"
          sx={{
            flexGrow: 1,
            '& .MuiInput-input': {
              fontSize: variant === 'h4' ? '2.125rem' : '1.5rem',
              fontWeight: 600,
              color: `${color}.main`,
            }
          }}
        />
        <IconButton 
          size="small" 
          color="primary" 
          onClick={handleSave}
          sx={{ p: 0.5 }}
        >
          <Check fontSize="small" />
        </IconButton>
        <IconButton 
          size="small" 
          onClick={handleCancel}
          sx={{ p: 0.5 }}
        >
          <Close fontSize="small" />
        </IconButton>
      </Box>
    );
  }

  return (
    <Box 
      sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 1, 
        mb: 1,
        cursor: 'pointer',
        borderRadius: 1,
        p: 0.5,
        transition: 'background-color 0.2s ease-in-out',
        '&:hover': {
          backgroundColor: 'action.hover',
          '& .edit-icon': {
            transform: 'scale(1.1)',
            color: 'primary.main'
          }
        }
      }}
      onClick={handleStartEdit}
    >
      <Typography 
        variant={variant} 
        color={color}
        sx={{ 
          fontWeight: 600,
          flexGrow: 1,
          lineHeight: 1.2
        }}
      >
        {displayText}
      </Typography>
      <IconButton 
        className="edit-icon"
        size="small"
        sx={{ 
          opacity: 0.6,
          transition: 'all 0.2s ease-in-out',
          p: 0.5,
          color: 'text.secondary'
        }}
      >
        <Edit fontSize="small" />
      </IconButton>
    </Box>
  );
};

import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      light: '#42A5F5',
      main: '#1976D2',
      dark: '#0D47A1',
      contrastText: '#FFFFFF',
    },
    secondary: {
      light: '#FF7043',
      main: '#FF5722',
      dark: '#D84315',
      contrastText: '#FFFFFF',
    },
    error: {
      light: '#EF5350',
      main: '#F44336',
      dark: '#C62828',
    },
    warning: {
      light: '#FFB74D',
      main: '#FF9800',
      dark: '#E65100',
    },
    info: {
      light: '#29B6F6',
      main: '#0288D1',
      dark: '#0277BD',
    },
    success: {
      light: '#66BB6A',
      main: '#4CAF50',
      dark: '#2E7D32',
    },
    background: {
      default: '#F8FAFC',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1A202C',
      secondary: '#4A5568',
    },
    grey: {
      50: '#F7FAFC',
      100: '#EDF2F7',
      200: '#E2E8F0',
      300: '#CBD5E0',
      400: '#A0AEC0',
      500: '#718096',
      600: '#4A5568',
      700: '#2D3748',
      800: '#1A202C',
      900: '#171923',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 600, fontSize: '2.5rem', lineHeight: 1.2, color: '#1A202C' },
    h2: { fontWeight: 600, fontSize: '2rem', lineHeight: 1.3, color: '#1A202C' },
    h3: { fontWeight: 600, fontSize: '1.75rem', lineHeight: 1.3, color: '#1A202C' },
    h4: { fontWeight: 600, fontSize: '1.5rem', lineHeight: 1.4, color: '#1A202C' },
    h5: { fontWeight: 600, fontSize: '1.25rem', lineHeight: 1.4, color: '#1A202C' },
    h6: { fontWeight: 600, fontSize: '1.125rem', lineHeight: 1.4, color: '#1A202C' },
    body1: { fontSize: '1rem', lineHeight: 1.5, color: '#4A5568' },
    body2: { fontSize: '0.875rem', lineHeight: 1.5, color: '#4A5568' },
    button: { fontWeight: 600, fontSize: '0.875rem', textTransform: 'none' as const },
    caption: { fontSize: '0.75rem', lineHeight: 1.4, color: '#718096' },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 600,
          padding: '10px 24px',
          boxShadow: 'none',
          '&:hover': { boxShadow: '0 2px 8px rgba(25, 118, 210, 0.15)' },
        },
        containedPrimary: {
          background: 'linear-gradient(45deg, #1976D2 30%, #42A5F5 90%)',
          '&:hover': { background: 'linear-gradient(45deg, #0D47A1 30%, #1976D2 90%)' },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
          '&:hover': { boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)' },
          transition: 'box-shadow 0.2s ease-in-out',
        },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { borderRadius: 12 } },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#42A5F5' },
          },
        },
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 6, fontWeight: 500 } } },
  },
  shape: { borderRadius: 8 },
  spacing: 8,
});



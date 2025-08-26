import React, { createContext, useContext, useState, useCallback } from 'react';

export type LayoutMode = 'landscape' | 'portrait';

export interface LayoutConfig {
  mode: LayoutMode;
  slots: number;
  columns: number;
  rows: number;
  gridXs: number; // Material-UI Grid column size (12-column system)
  maxPhotosPerSet: number;
  canvasWidth: number;
  canvasHeight: (aspectRatio: number) => number;
  pdfOrientation: 'landscape' | 'portrait';
}

interface LayoutModeContextType {
  layoutMode: LayoutMode;
  layoutConfig: LayoutConfig;
  setLayoutMode: (mode: LayoutMode) => void;
  canSwitchToLandscape: (currentPhotoCount: number) => boolean;
  getGridDimensions: () => { columns: number; rows: number };
}

const LAYOUT_CONFIGS: Record<LayoutMode, Omit<LayoutConfig, 'mode'>> = {
  landscape: {
    slots: 9,
    columns: 3,
    rows: 3,
    gridXs: 4, // 12/3 = 4 columns in Material-UI grid
    maxPhotosPerSet: 9,
    canvasWidth: 240,
    canvasHeight: (aspectRatio: number) => Math.round(240 / aspectRatio),
    pdfOrientation: 'landscape'
  },
  portrait: {
    slots: 10,
    columns: 2,
    rows: 5,
    gridXs: 6, // 12/2 = 6 columns in Material-UI grid
    maxPhotosPerSet: 10,
    canvasWidth: 240, // Same size as landscape for consistency
    canvasHeight: (aspectRatio: number) => Math.round(240 / aspectRatio),
    pdfOrientation: 'portrait'
  }
};

const LayoutModeContext = createContext<LayoutModeContextType | null>(null);

export const LayoutModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Check localStorage for saved preference, default to landscape
  const [layoutMode, setLayoutModeState] = useState<LayoutMode>(() => {
    try {
      const saved = localStorage.getItem('photo-layout-mode');
      if (saved === 'portrait' || saved === 'landscape') {
        return saved as LayoutMode;
      }
    } catch (error) {
      console.error('Failed to load layout mode from localStorage:', error);
    }
    return 'landscape';
  });

  const layoutConfig: LayoutConfig = {
    mode: layoutMode,
    ...LAYOUT_CONFIGS[layoutMode]
  };

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    setLayoutModeState(mode);
    // Save preference to localStorage
    try {
      localStorage.setItem('photo-layout-mode', mode);
    } catch (error) {
      console.error('Failed to save layout mode to localStorage:', error);
    }
  }, []);

  const canSwitchToLandscape = useCallback((currentPhotoCount: number): boolean => {
    // Can always switch to landscape if we have 9 or fewer photos
    // If we have 10 photos, switching to landscape would lose the 10th photo
    return currentPhotoCount <= 9;
  }, []);

  const getGridDimensions = useCallback(() => {
    return {
      columns: layoutConfig.columns,
      rows: layoutConfig.rows
    };
  }, [layoutConfig]);

  return (
    <LayoutModeContext.Provider 
      value={{
        layoutMode,
        layoutConfig,
        setLayoutMode,
        canSwitchToLandscape,
        getGridDimensions
      }}
    >
      {children}
    </LayoutModeContext.Provider>
  );
};

export const useLayoutMode = () => {
  const context = useContext(LayoutModeContext);
  if (!context) {
    throw new Error('useLayoutMode must be used within a LayoutModeProvider');
  }
  return context;
};

// Export layout configs for external use
export { LAYOUT_CONFIGS };

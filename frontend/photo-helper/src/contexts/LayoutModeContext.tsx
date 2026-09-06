import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

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

  // Memoized on the mode: PhotoGridApi reads `layoutConfig` directly, and this
  // object was previously rebuilt on every provider render. Memoizing it also
  // makes `getGridDimensions` below honestly declare its dependency (it used to
  // close over a fresh object every render).
  const layoutConfig = useMemo<LayoutConfig>(
    () => ({ mode: layoutMode, ...LAYOUT_CONFIGS[layoutMode] }),
    [layoutMode],
  );

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

  const value = useMemo(
    () => ({ layoutMode, layoutConfig, setLayoutMode, canSwitchToLandscape, getGridDimensions }),
    [layoutMode, layoutConfig, setLayoutMode, canSwitchToLandscape, getGridDimensions],
  );

  return (
    <LayoutModeContext.Provider value={value}>
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

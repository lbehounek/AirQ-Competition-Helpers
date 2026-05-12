import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

export interface AspectRatioOption {
  id: string;
  name: string;
  ratio: number; // width / height
  widthRatio: number; // for display
  heightRatio: number; // for display
  cssRatio: string; // for CSS aspect-ratio property
  description: string;
}

// 4:3 listed first so it's the default — the FAI official answer-sheet uses
// 87.3×65.1 mm cells (aspect ratio 1.341, essentially 4:3), and a 3×3 grid of
// 4:3 photos is height-constrained on A4 landscape (grid aspect 1.333 < page
// aspect 1.415), which is what produces the "photos fill A4 vertically with
// white edges on the sides" look you see on the official sheet (feedback
// 2026-05-12 — earlier "default to 3:2" was a misread of the official spec).
export const ASPECT_RATIO_OPTIONS: AspectRatioOption[] = [
  {
    id: '4:3',
    name: '4:3 Classic',
    ratio: 4 / 3,
    widthRatio: 4,
    heightRatio: 3,
    cssRatio: '4/3',
    description: 'Classic'
  },
  {
    id: '3:2',
    name: '3:2 DSLR',
    ratio: 3 / 2,
    widthRatio: 3,
    heightRatio: 2,
    cssRatio: '3/2',
    description: 'DSLR'
  },
  {
    id: '16:9',
    name: '16:9 Widescreen',
    ratio: 16 / 9,
    widthRatio: 16,
    heightRatio: 9,
    cssRatio: '16/9',
    description: 'Widescreen'
  }
];

interface AspectRatioContextType {
  currentRatio: AspectRatioOption;
  isTransitioning: boolean;
  setAspectRatio: (ratio: AspectRatioOption) => void;
  getCanvasSize: (baseWidth: number) => { width: number; height: number };
  getPDFCellHeight: (cellWidth: number) => number;
  getCroppedCanvasSize: (baseWidth: number) => { width: number; height: number };
}

const AspectRatioContext = createContext<AspectRatioContextType | null>(null);

export const AspectRatioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Default to 4:3 (FAI official answer-sheet); ratio order in
  // `ASPECT_RATIO_OPTIONS` keeps 4:3 at index 0 — see the comment on
  // that constant for the rationale.
  const [currentRatio, setCurrentRatio] = useState<AspectRatioOption>(ASPECT_RATIO_OPTIONS[0]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimeoutRef = useRef<number | null>(null);

  const setAspectRatio = (ratio: AspectRatioOption) => {
    if (ratio.id === currentRatio.id) return; // No change needed
    
    // Immediately start transition to hide any visual jump
    setIsTransitioning(true);
    
    // Clear any existing timeout
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }
    
    // Update the ratio immediately
    setCurrentRatio(ratio);
    
    // End transition after canvas has time to re-render
    transitionTimeoutRef.current = window.setTimeout(() => {
      setIsTransitioning(false);
      transitionTimeoutRef.current = null;
    }, 250);
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  const getCanvasSize = (baseWidth: number) => ({
    width: baseWidth,
    height: Math.round(baseWidth / currentRatio.ratio)
  });

  const getPDFCellHeight = (cellWidth: number) => {
    return cellWidth / currentRatio.ratio;
  };

  const getCroppedCanvasSize = (baseWidth: number) => ({
    width: baseWidth,
    height: Math.round(baseWidth / currentRatio.ratio)
  });

  return (
    <AspectRatioContext.Provider value={{
      currentRatio,
      isTransitioning,
      setAspectRatio,
      getCanvasSize,
      getPDFCellHeight,
      getCroppedCanvasSize
    }}>
      {children}
    </AspectRatioContext.Provider>
  );
};

export const useAspectRatio = () => {
  const context = useContext(AspectRatioContext);
  if (!context) {
    throw new Error('useAspectRatio must be used within an AspectRatioProvider');
  }
  return context;
};

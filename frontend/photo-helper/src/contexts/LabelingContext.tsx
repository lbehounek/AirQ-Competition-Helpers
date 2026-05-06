import React, { createContext, useContext, useState } from 'react';
import { parseDiscipline } from '../utils/parseDiscipline';

export interface LabelingOption {
  id: 'letters' | 'numbers';
  name: string;
  description: string;
}

export const LABELING_OPTIONS: LabelingOption[] = [
  {
    id: 'letters',
    name: 'Letters',
    description: 'A, B, C...'
  },
  {
    id: 'numbers',
    name: 'Numbers',
    description: '1, 2, 3...'
  }
];

const LETTERS_OPTION = LABELING_OPTIONS[0];
const NUMBERS_OPTION = LABELING_OPTIONS[1];

/**
 * Precision flying competition rules require photos to be labeled with
 * NUMBERS (1, 2, 3...) — letters are not permitted. Rally has no such
 * constraint and keeps the historical letter default. Pure function so
 * the URL → default mapping is unit-tested without React.
 */
export const resolveDefaultLabeling = (search: string): LabelingOption => {
  return parseDiscipline(search) === 'precision' ? NUMBERS_OPTION : LETTERS_OPTION;
};

interface LabelingContextType {
  currentLabeling: LabelingOption;
  setLabeling: (labeling: LabelingOption) => void;
  generateLabel: (index: number, offset?: number) => string;
  /**
   * True when the discipline mandates a fixed labeling scheme
   * (precision → numbers). Consumers should hide the labeling
   * selector to prevent the user from picking an invalid option
   * for the active competition.
   */
  isLocked: boolean;
}

const LabelingContext = createContext<LabelingContextType | null>(null);

export const LabelingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const isPrecision = parseDiscipline(search) === 'precision';
  const [currentLabeling, setCurrentLabeling] = useState<LabelingOption>(() => resolveDefaultLabeling(search));

  const setLabeling = (labeling: LabelingOption) => {
    // Precision discipline locks labeling to numbers — silently ignore any
    // attempt to switch it (defense in depth: the selector is hidden in
    // the UI, but a stale render or test could still call this).
    if (isPrecision && labeling.id !== 'numbers') return;
    setCurrentLabeling(labeling);
  };

  const generateLabel = (index: number, offset = 0) => {
    const position = index + offset;
    
    if (currentLabeling.id === 'numbers') {
      return `${position + 1}`; // Numbers start from 1, no dot
    } else {
      return `${String.fromCharCode(65 + position)}`; // Letters A, B, C... no dot
    }
  };

  return (
    <LabelingContext.Provider value={{
      currentLabeling,
      setLabeling,
      generateLabel,
      isLocked: isPrecision
    }}>
      {children}
    </LabelingContext.Provider>
  );
};

export const useLabeling = () => {
  const context = useContext(LabelingContext);
  if (!context) {
    throw new Error('useLabeling must be used within a LabelingProvider');
  }
  return context;
};

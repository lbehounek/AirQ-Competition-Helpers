import React, { createContext, useContext, useState } from 'react';
import {
  parseDisciplineFromSearch,
  getLabelingMode,
  generateLabelForMode,
  type Discipline,
} from '@airq/shared-discipline';

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
 * Maps the URL-derived discipline to the photo-helper-specific
 * `LabelingOption` (which carries UI metadata like name/description).
 * The discipline → mode rule itself lives in `@airq/shared-discipline`
 * (`getLabelingMode`) so a future change there propagates to every app
 * that picks labels by discipline.
 */
export const resolveDefaultLabeling = (search: string): LabelingOption => {
  const discipline: Discipline = parseDisciplineFromSearch(search) ?? 'rally';
  return getLabelingMode(discipline) === 'numbers' ? NUMBERS_OPTION : LETTERS_OPTION;
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
  const isPrecision = parseDisciplineFromSearch(search) === 'precision';
  const [currentLabeling, setCurrentLabeling] = useState<LabelingOption>(() => resolveDefaultLabeling(search));

  const setLabeling = (labeling: LabelingOption) => {
    // Precision discipline locks labeling to numbers — silently ignore any
    // attempt to switch it (defense in depth: the selector is hidden in
    // the UI, but a stale render or test could still call this).
    if (isPrecision && labeling.id !== 'numbers') return;
    setCurrentLabeling(labeling);
  };

  // Delegates to the shared label generator so the precision/rally
  // labeling rule cannot drift between photo-helper and map-corridors.
  // The keying axis is `LabelingMode` (not `Discipline`) because the user
  // can flip the labeling option independently of the URL-derived
  // discipline — e.g., a rally session can opt into numbers via the
  // selector. `LabelingOption.id` is structurally identical to
  // `LabelingMode` (`'letters' | 'numbers'`).
  const generateLabel = (index: number, offset = 0): string => {
    return generateLabelForMode(currentLabeling.id, index + offset);
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

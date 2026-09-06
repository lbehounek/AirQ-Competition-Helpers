import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import {
  getLabelingMode,
  generateLabelForMode,
  type Discipline,
} from '@airq/shared-discipline';
import { resolveDiscipline } from '../utils/parseDiscipline';

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
  // Full chain (URL -> boot-resolved persisted value -> rally), not the raw
  // URL parser: a precision competition opened without ?discipline= must not
  // fall back to letters.
  const discipline: Discipline = resolveDiscipline(search);
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
  const isPrecision = resolveDiscipline(search) === 'precision';
  const [currentLabeling, setCurrentLabeling] = useState<LabelingOption>(() => resolveDefaultLabeling(search));

  const setLabeling = useCallback((labeling: LabelingOption) => {
    // Precision discipline locks labeling to numbers — silently ignore any
    // attempt to switch it (defense in depth: the selector is hidden in
    // the UI, but a stale render or test could still call this).
    if (isPrecision && labeling.id !== 'numbers') return;
    setCurrentLabeling(labeling);
  }, [isPrecision]);

  // Delegates to the shared label generator so the precision/rally
  // labeling rule cannot drift between photo-helper and map-corridors.
  // The keying axis is `LabelingMode` (not `Discipline`) because the user
  // can flip the labeling option independently of the URL-derived
  // discipline — e.g., a rally session can opt into numbers via the
  // selector. `LabelingOption.id` is structurally identical to
  // `LabelingMode` (`'letters' | 'numbers'`).
  // Memoized on the labeling id alone: PhotoGridApi calls this once per slot on
  // every render, so a fresh identity here invalidated the whole grid.
  const generateLabel = useCallback(
    (index: number, offset = 0): string => generateLabelForMode(currentLabeling.id, index + offset),
    [currentLabeling.id],
  );

  const value = useMemo(
    () => ({ currentLabeling, setLabeling, generateLabel, isLocked: isPrecision }),
    [currentLabeling, setLabeling, generateLabel, isPrecision],
  );

  return (
    <LabelingContext.Provider value={value}>
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

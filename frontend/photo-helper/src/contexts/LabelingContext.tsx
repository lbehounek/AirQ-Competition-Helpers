import React, { createContext, useContext, useState } from 'react';

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

interface LabelingContextType {
  currentLabeling: LabelingOption;
  setLabeling: (labeling: LabelingOption) => void;
  generateLabel: (index: number, offset?: number) => string;
}

const LabelingContext = createContext<LabelingContextType | null>(null);

export const LabelingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentLabeling, setCurrentLabeling] = useState<LabelingOption>(LABELING_OPTIONS[0]); // Default to letters

  const setLabeling = (labeling: LabelingOption) => {
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
      generateLabel
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

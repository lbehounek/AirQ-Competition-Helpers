import { useState, useEffect } from 'react';

/**
 * Custom hook for localStorage with automatic JSON serialization
 */
export function useLocalStorage<T>(
  key: string, 
  initialValue: T
): [T, (value: T) => void, () => void] {
  
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  };

  const removeValue = () => {
    try {
      setStoredValue(initialValue);
      window.localStorage.removeItem(key);
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue, removeValue];
}

/**
 * Custom hook for debounced localStorage updates
 */
export function useDebouncedLocalStorage<T>(
  key: string, 
  initialValue: T, 
  delay: number = 1000
): [T, (value: T) => void, () => void] {
  
  const [storedValue, setValue, removeValue] = useLocalStorage(key, initialValue);
  const [debouncedValue, setDebouncedValue] = useState<T>(storedValue);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (debouncedValue !== storedValue) {
        setValue(debouncedValue);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [debouncedValue, delay, setValue, storedValue]);

  return [debouncedValue, setDebouncedValue, removeValue];
}

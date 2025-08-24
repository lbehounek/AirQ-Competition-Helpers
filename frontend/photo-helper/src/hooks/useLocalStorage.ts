import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for localStorage with automatic JSON serialization
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T) => void, () => void] {

  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return initialValue;
      }
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) as T : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Re-read when key changes
  useEffect(() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const item = window.localStorage.getItem(key);
      setStoredValue(item ? (JSON.parse(item) as T) : initialValue);
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}" on change:`, error);
      setStoredValue(initialValue);
    }
  }, [key, initialValue]);

  const setValue = useCallback((value: T) => {
    try {
      setStoredValue(value);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  }, [key]);

  const removeValue = useCallback(() => {
    try {
      setStoredValue(initialValue);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, initialValue]);

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
    setDebouncedValue(storedValue);
  }, [storedValue]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setValue(debouncedValue);
    }, delay);
    return () => clearTimeout(timer);
  }, [debouncedValue, delay, setValue]);

  return [debouncedValue, setDebouncedValue, removeValue];
}

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { locales, DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../locales';
import type { Locale, Translation } from '../locales';

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  translations: Translation;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

// Helper function to get nested object values by path
const getNestedValue = (obj: any, path: string): string => {
  return path.split('.').reduce((current, key) => current?.[key], obj) || path;
};

// Helper function to replace placeholders in strings
const interpolate = (text: string, params?: Record<string, string | number>): string => {
  if (!params) return text;
  
  return Object.keys(params).reduce((result, key) => {
    const placeholder = `{{${key}}}`;
    return result.replace(new RegExp(placeholder, 'g'), String(params[key]));
  }, text);
};

interface I18nProviderProps {
  children: ReactNode;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({ children }) => {
  // Get initial locale from localStorage or use default (SSR-safe)
  const getInitialLocale = (): Locale => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return DEFAULT_LOCALE;
      }
      const stored = window.localStorage.getItem('app-locale');
      const codes = SUPPORTED_LOCALES.map(l => l.code);
      return stored && (codes as string[]).includes(stored) ? (stored as Locale) : DEFAULT_LOCALE;
    } catch {
      return DEFAULT_LOCALE;
    }
  };

  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);
  const [translations, setTranslations] = useState<Translation>(locales[locale]);

  // Update translations when locale changes
  useEffect(() => {
    setTranslations(locales[locale]);
  }, [locale]);

  const setLocale = (newLocale: Locale) => {
    const codes = SUPPORTED_LOCALES.map(l => l.code);
    const safeLocale = (codes as string[]).includes(newLocale) ? newLocale : DEFAULT_LOCALE;
    setLocaleState(safeLocale as Locale);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('app-locale', safeLocale);
      }
    } catch {}
    console.log(`🌍 Language changed to: ${safeLocale}`);
  };

  // Translation function with interpolation support
  const t = (key: string, params?: Record<string, string | number>): string => {
    const value = getNestedValue(translations, key);
    return interpolate(value, params);
  };

  const value = {
    locale,
    setLocale,
    t,
    translations
  };

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};

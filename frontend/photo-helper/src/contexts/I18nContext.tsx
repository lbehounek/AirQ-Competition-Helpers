import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
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

/**
 * Walk a dotted path (`'app.title'`) through the translation tree, falling
 * back to the raw key when any segment is missing so a missing string shows up
 * verbatim in the UI instead of as `undefined`.
 *
 * `unknown` rather than a recursive `Translation` walk: the tree is nested to
 * an arbitrary depth and the intermediate values genuinely aren't known to be
 * strings until the last hop, so each step is narrowed explicitly.
 */
const getNestedValue = (obj: unknown, path: string): string => {
  const value = path.split('.').reduce<unknown>(
    (current, key) =>
      // Only descend through real objects; anything else (string leaf reached
      // early, null, undefined) short-circuits to undefined → key fallback.
      typeof current === 'object' && current !== null
        ? (current as Record<string, unknown>)[key]
        : undefined,
    obj,
  );
  return typeof value === 'string' && value ? value : path;
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
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [translations, setTranslations] = useState<Translation>(locales[DEFAULT_LOCALE]);
  const [initialized, setInitialized] = useState(false);

  // Load initial locale from Electron config or localStorage
  useEffect(() => {
    const loadLocale = async () => {
      try {
        // `string | null | undefined`: getConfig resolves `undefined` for a key
        // that was never written (the Electron config store returns `config[key]`),
        // while localStorage.getItem returns `null`. Both are "nothing stored".
        let stored: string | null | undefined = null;

        // In Electron, use config storage (shared across all app:// origins)
        const api = window.electronAPI;
        if (api?.getConfig) {
          stored = await api.getConfig('locale');
        } else if (typeof window !== 'undefined' && window.localStorage) {
          stored = window.localStorage.getItem('app-locale');
        }

        const codes = SUPPORTED_LOCALES.map(l => l.code);
        if (stored && (codes as string[]).includes(stored)) {
          setLocaleState(stored as Locale);
        }
      } catch (e) {
        console.warn('Failed to load locale:', e);
      }
      setInitialized(true);
    };
    loadLocale();
  }, []);

  // Update translations when locale changes
  useEffect(() => {
    setTranslations(locales[locale]);
  }, [locale]);

  // Sync menu language on mount and when locale changes
  useEffect(() => {
    const api = window.electronAPI;
    if (initialized && api?.setMenuLocale) {
      api.setMenuLocale(locale);
    }
  }, [locale, initialized]);

  // Empty dep list: the body reads only module constants, `window.electronAPI`
  // and the state setter, so this identity can be stable for the provider's
  // lifetime. It is passed straight into memoized language menus.
  const setLocale = useCallback(async (newLocale: Locale) => {
    const codes = SUPPORTED_LOCALES.map(l => l.code);
    const safeLocale = (codes as string[]).includes(newLocale) ? newLocale : DEFAULT_LOCALE;
    setLocaleState(safeLocale as Locale);

    try {
      // In Electron, use config storage
      const api = window.electronAPI;
      if (api?.setConfig) {
        // Resolves false when the config file could not be written. The locale
        // still applies for this session; it just will not survive a restart,
        // and silently pretending it saved is how that becomes a mystery.
        const saved = await api.setConfig('locale', safeLocale);
        if (saved === false) {
          console.warn('Locale could not be persisted; it will reset on restart');
        }
      } else if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('app-locale', safeLocale);
      }
      // Update Electron menu language
      if (api?.setMenuLocale) {
        api.setMenuLocale(safeLocale);
      }
    } catch (e) {
      console.warn('Failed to save locale:', e);
    }
    console.log(`🌍 Language changed to: ${safeLocale}`);
  }, []);

  // `t` is consumed by nearly every component and appears in a long list of
  // useCallback/useMemo dependency arrays; a fresh identity per provider render
  // invalidated all of them and every memoized child below. Keyed on
  // `translations` (what it actually reads), not on `locale`: `translations` is
  // set by an effect AFTER `locale` changes, so for exactly one render the new
  // locale is paired with the old table — pre-existing behavior, kept.
  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string =>
      interpolate(getNestedValue(translations, key), params),
    [translations],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, translations }),
    [locale, setLocale, t, translations],
  );

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

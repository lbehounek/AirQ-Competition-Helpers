import React, { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { locales, DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../locales'
import type { Locale, Translation } from '../locales'

interface I18nContextType {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, params?: Record<string, string | number>) => string
  translations: Translation
}

const I18nContext = createContext<I18nContextType | undefined>(undefined)

const getNestedValue = (obj: any, path: string): string => {
  return path.split('.').reduce((current, key) => current?.[key], obj) || path
}

const interpolate = (text: string, params?: Record<string, string | number>): string => {
  if (!params) return text
  return Object.keys(params).reduce((result, key) => {
    const placeholder = `{{${key}}}`
    return result.replace(new RegExp(placeholder, 'g'), String(params[key]))
  }, text)
}

interface I18nProviderProps { children: ReactNode }

export const I18nProvider: React.FC<I18nProviderProps> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)
  const [translations, setTranslations] = useState<Translation>(locales[DEFAULT_LOCALE])
  const [initialized, setInitialized] = useState(false)

  // Load initial locale from Electron config or localStorage
  useEffect(() => {
    const loadLocale = async () => {
      try {
        let stored: string | null = null

        // In Electron, use config storage (shared across all app:// origins)
        if ((window as any).electronAPI?.getConfig) {
          stored = await (window as any).electronAPI.getConfig('locale')
        } else if (typeof window !== 'undefined' && window.localStorage) {
          stored = window.localStorage.getItem('app-locale')
        }

        const codes = SUPPORTED_LOCALES.map(l => l.code)
        if (stored && (codes as string[]).includes(stored)) {
          setLocaleState(stored as Locale)
        }
      } catch (e) {
        console.warn('Failed to load locale:', e)
      }
      setInitialized(true)
    }
    loadLocale()
  }, [])

  useEffect(() => {
    setTranslations(locales[locale])
  }, [locale])

  // Sync menu language on mount and when locale changes
  useEffect(() => {
    if (initialized && (window as any).electronAPI?.setMenuLocale) {
      (window as any).electronAPI.setMenuLocale(locale)
    }
  }, [locale, initialized])

  const setLocale = async (newLocale: Locale) => {
    const codes = SUPPORTED_LOCALES.map(l => l.code)
    const safe = (codes as string[]).includes(newLocale) ? newLocale : DEFAULT_LOCALE
    setLocaleState(safe as Locale)

    try {
      // In Electron, use config storage
      if ((window as any).electronAPI?.setConfig) {
        await (window as any).electronAPI.setConfig('locale', safe)
      } else if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('app-locale', safe)
      }
      // Update Electron menu language
      if ((window as any).electronAPI?.setMenuLocale) {
        (window as any).electronAPI.setMenuLocale(safe)
      }
    } catch (e) {
      console.warn('Failed to save locale:', e)
    }
  }

  const t = (key: string, params?: Record<string, string | number>): string => {
    const value = getNestedValue(translations, key)
    return interpolate(value, params)
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, translations }}>
      {children}
    </I18nContext.Provider>
  )
}

export const useI18n = (): I18nContextType => {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider')
  return ctx
}



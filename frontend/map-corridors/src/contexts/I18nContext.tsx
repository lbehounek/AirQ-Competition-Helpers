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
  const getInitialLocale = (): Locale => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_LOCALE
      const stored = window.localStorage.getItem('app-locale')
      const codes = SUPPORTED_LOCALES.map(l => l.code)
      return stored && (codes as string[]).includes(stored) ? (stored as Locale) : DEFAULT_LOCALE
    } catch {
      return DEFAULT_LOCALE
    }
  }

  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)
  const [translations, setTranslations] = useState<Translation>(locales[locale])

  useEffect(() => {
    setTranslations(locales[locale])
  }, [locale])

  const setLocale = (newLocale: Locale) => {
    const codes = SUPPORTED_LOCALES.map(l => l.code)
    const safe = (codes as string[]).includes(newLocale) ? newLocale : DEFAULT_LOCALE
    setLocaleState(safe as Locale)
    try { if (typeof window !== 'undefined') window.localStorage.setItem('app-locale', safe) } catch {}
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



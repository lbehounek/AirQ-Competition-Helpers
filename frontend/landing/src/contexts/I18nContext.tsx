import { createContext, useContext, useEffect, useState } from 'react'
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

const STORAGE_KEY = 'app-locale'

const getNestedValue = (obj: unknown, path: string): string => {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const key of parts) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key]
    } else {
      return path
    }
  }
  return typeof cur === 'string' ? cur : path
}

const interpolate = (text: string, params?: Record<string, string | number>): string => {
  if (!params) return text
  return Object.keys(params).reduce((acc, key) => {
    return acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(params[key]))
  }, text)
}

function readStoredLocale(): Locale {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_LOCALE
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'cs') return 'cz'
    const codes = SUPPORTED_LOCALES.map((l) => l.code)
    if (raw && (codes as string[]).includes(raw)) return raw as Locale
  } catch {}
  return DEFAULT_LOCALE
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale)
  const translations = locales[locale]

  useEffect(() => {
    try {
      document.documentElement.lang = locale === 'cz' ? 'cs' : 'en'
      document.title = translations.app.title
    } catch {}
  }, [locale, translations])

  const setLocale = (next: Locale) => {
    const codes = SUPPORTED_LOCALES.map((l) => l.code)
    const safe = (codes as string[]).includes(next) ? next : DEFAULT_LOCALE
    setLocaleState(safe as Locale)
    try {
      window.localStorage.setItem(STORAGE_KEY, safe)
    } catch {}
  }

  const t = (key: string, params?: Record<string, string | number>) => {
    return interpolate(getNestedValue(translations, key), params)
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, translations }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider')
  return ctx
}

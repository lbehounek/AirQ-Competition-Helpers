import en from './en.json'
import cs from './cs.json'

export type Locale = 'en' | 'cz'

export const locales = {
  en,
  cz: cs,
} as const

export const SUPPORTED_LOCALES: { code: Locale; name: string; flag: string }[] = [
  { code: 'cz', name: 'Čeština', flag: '🇨🇿' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
]

export const DEFAULT_LOCALE: Locale = 'cz'

export type Translation = typeof en

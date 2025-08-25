import en from './en.json';
import cs from './cs.json';

export type Locale = 'en' | 'cs';

export const locales = {
  en,
  cs
} as const;

export const SUPPORTED_LOCALES: { code: Locale; name: string; flag: string }[] = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'cs', name: 'Čeština', flag: '🇨🇿' }
];

export const DEFAULT_LOCALE: Locale = 'cs';

export type TranslationKey = keyof typeof en;
export type Translation = typeof en;

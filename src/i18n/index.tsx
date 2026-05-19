import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { en } from './dictionaries/en'
import { zh } from './dictionaries/zh'
import { ja } from './dictionaries/ja'

export type Locale = 'en' | 'zh' | 'ja'
export type TParams = Record<string, string | number>
export type TFunction = (key: string, params?: TParams) => string
export type DictionaryValue = string | null | { [key: string]: DictionaryValue }
export type Dictionary = Record<string, DictionaryValue>

export const SUPPORTED: Locale[] = ['en', 'zh', 'ja']

const STORAGE_KEY = 'ai-replay-studio.locale'
const LOCALE_EVENT = 'ai-replay-studio:locale-change'
const dictionaries: Record<Locale, Dictionary> = { en, zh, ja }
const warnedMissingKeys = new Set<string>()

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

function isLocale(value: string | null): value is Locale {
  return value === 'en' || value === 'zh' || value === 'ja'
}

function detectLocale(): Locale {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) return stored
  }

  if (typeof navigator !== 'undefined') {
    const language = navigator.language.toLowerCase()
    if (language.startsWith('zh')) return 'zh'
    if (language.startsWith('ja')) return 'ja'
  }

  return 'en'
}

function lookup(dictionary: Dictionary, key: string): DictionaryValue | undefined {
  return key.split('.').reduce<DictionaryValue | undefined>((value, part) => {
    if (!value || typeof value !== 'object') return undefined
    return value[part]
  }, dictionary)
}

function warnMissing(key: string) {
  if (!import.meta.env.DEV || warnedMissingKeys.has(key)) return
  warnedMissingKeys.add(key)
  console.warn(`[i18n] Missing translation key: ${key}`)
}

function interpolate(template: string, params?: TParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name]
    return value == null ? match : String(value)
  })
}

function translate(locale: Locale, key: string, params?: TParams): string {
  const localized = lookup(dictionaries[locale], key)
  if (typeof localized === 'string') return interpolate(localized, params)

  if (localized === undefined && locale !== 'en') warnMissing(key)

  const fallback = lookup(en, key)
  if (typeof fallback === 'string') return interpolate(fallback, params)

  warnMissing(key)
  return key
}

export function setLocale(locale: Locale) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, locale)
  window.dispatchEvent(new CustomEvent<Locale>(LOCALE_EVENT, { detail: locale }))
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale())

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    function handleLocaleChange(event: Event) {
      const next = (event as CustomEvent<Locale>).detail
      if (isLocale(next)) setLocaleState(next)
    }

    window.addEventListener(LOCALE_EVENT, handleLocaleChange)
    return () => window.removeEventListener(LOCALE_EVENT, handleLocaleChange)
  }, [])

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale }), [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useLocale(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useLocale must be used within I18nProvider')
  return context
}

export function useT(): TFunction {
  const { locale } = useLocale()
  return useCallback<TFunction>((key, params) => translate(locale, key, params), [locale])
}

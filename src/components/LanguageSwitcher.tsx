import { Globe } from 'lucide-react'
import { SUPPORTED, setLocale, useLocale, useT } from '@/i18n'
import type { Locale } from '@/i18n'

const localeKeys: Record<Locale, string> = {
  en: 'language_switcher.en',
  zh: 'language_switcher.zh',
  ja: 'language_switcher.ja',
}

export function LanguageSwitcher() {
  const t = useT()
  const { locale } = useLocale()

  return (
    <div
      style={{
        marginTop: 8,
        padding: 10,
        borderRadius: 8,
        background: '#f8f7f4',
        border: '1px solid #efece5',
      }}
    >
      <div
        className="section-label"
        style={{ fontSize: 9, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}
      >
        <Globe size={10} />
        {t('language_switcher.label')}
      </div>
      <div style={{ display: 'flex', background: 'white', borderRadius: 6, padding: 3, gap: 2 }}>
        {SUPPORTED.map((option) => {
          const active = locale === option
          return (
            <button
              key={option}
              type="button"
              onClick={() => setLocale(option)}
              style={{
                flex: 1,
                padding: '4px 7px',
                borderRadius: 5,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: active ? 600 : 400,
                background: active ? '#1a1814' : 'transparent',
                color: active ? 'white' : '#8d836b',
                transition: 'all 0.1s',
              }}
            >
              {t(localeKeys[option])}
            </button>
          )
        })}
      </div>
    </div>
  )
}

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import zh from './zh';
import en from './en';
import type { Locale } from './zh';

type Lang = 'zh' | 'en';
const locales: Record<Lang, Locale> = { zh, en };

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Locale;
  tf: (key: keyof Locale, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType>(null!);

function getInitialLang(): Lang {
  try {
    const saved = localStorage.getItem('ga-manager-lang');
    if (saved === 'zh' || saved === 'en') return saved;
    const browserLang = navigator.language.toLowerCase();
    if (browserLang.startsWith('zh')) return 'zh';
    return 'en';
  } catch { return 'en'; }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);
  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    try { localStorage.setItem('ga-manager-lang', newLang); } catch {}
  }, []);
  const t = locales[lang];
  const tf = useCallback((key: keyof Locale, params?: Record<string, string | number>) => {
    let str = locales[lang][key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return str;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t, tf }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
export type { Lang };

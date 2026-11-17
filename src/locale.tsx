import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { formatPrice } from '../shared/wishlist.js';
import type { Currency } from '../shared/wishlist.js';
import { idMessages, languages, translate } from './messages.js';
import type { Interpolation, Language, Message } from './messages.js';

const storageKey = 'nanti.language';
type LocaleValue = { language: Language; setLanguage: (language: Language) => void };
const Locale = createContext<LocaleValue>({ language: 'id', setLanguage: () => undefined });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === 'en' ? 'en' : 'id';
    } catch { return 'id'; }
  });
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = 'Nanti';
    try { localStorage.setItem(storageKey, language); } catch { /* Language still works for this visit. */ }
  }, [language]);
  return <Locale.Provider value={{ language, setLanguage }}>{children}</Locale.Provider>;
}

export function useLocale() {
  const { language, setLanguage } = useContext(Locale);
  const locale = language === 'id' ? 'id-ID' : 'en-US';
  const t = (key: Message, values?: Interpolation) => translate(language, key, values);
  return {
    language, setLanguage, locale, t,
    money: (value: string | number, currency: Currency) => formatPrice(value, currency, locale),
    number: (value: number | bigint) => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value),
    percent: (value: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(value),
    date: (value: string) => new Intl.DateTimeFormat(locale, value.length === 10
      ? { dateStyle: 'medium', timeZone: 'UTC' } : { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)),
    decimal: (value: string) => language === 'id' ? value.replace(',', '.') : value,
    error: (message: string) => Object.hasOwn(idMessages, message) ? t(message as Message) : t('Check the details you entered.'),
  };
}

export function LanguagePicker() {
  const { language, setLanguage, t } = useLocale();
  return <div className="language-picker" role="group" aria-label={t('Language')}>
    {languages.map((option) => <button key={option} type="button" aria-pressed={language === option}
      aria-label={option === 'id' ? 'Bahasa Indonesia' : 'English'} lang={option} onClick={() => setLanguage(option)}>
      {option.toUpperCase()}
    </button>)}
  </div>;
}

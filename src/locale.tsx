import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { formatPrice } from '../shared/wishlist.js';
import type { Currency } from '../shared/wishlist.js';
import { idMessages, translate } from './messages.js';
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
  const { language, setLanguage } = useLocale();
  const next = language === 'id' ? 'en' : 'id';
  return <button className="language-switch" type="button"
    aria-label={language === 'id' ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'}
    title={language === 'id' ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'}
    onClick={() => setLanguage(next)}>{next.toUpperCase()}</button>;
}

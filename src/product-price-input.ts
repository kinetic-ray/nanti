import type { Language } from './messages.js';

export function formatProductPriceInput(raw: string, language: Language): string {
  const grouping = language === 'id' ? '.' : ',';
  const decimal = language === 'id' ? ',' : '.';
  const decimalAt = raw.lastIndexOf(decimal);
  const whole = (decimalAt === -1 ? raw : raw.slice(0, decimalAt)).replace(/\D/g, '').slice(0, 7);
  const cents = decimalAt === -1 ? null : raw.slice(decimalAt + 1).replace(/\D/g, '').slice(0, 2);
  if (!whole && cents === null) return '';
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, grouping);
  return cents === null ? grouped : grouped + decimal + cents;
}
export function normalizeProductPriceInput(raw: string, language: Language): string {
  const grouping = language === 'id' ? /\./g : /,/g;
  return raw.replace(grouping, '').replace(language === 'id' ? ',' : '\u0000', '.');
}

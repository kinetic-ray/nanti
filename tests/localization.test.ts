import { describe, expect, it } from 'vitest';
import { formatPrice } from '../shared/wishlist.js';
import { getMethodology, intelligenceModules } from '../shared/methodology.js';
import { idMessages, translate } from '../src/messages.js';
import type { Message } from '../src/messages.js';
import { localizedMethodology } from '../src/methodology-id.js';

describe('public localization', () => {
  it('keeps the same interpolation fields in both languages and falls back safely', () => {
    const tokens = (value: string) => [...value.matchAll(/\{\w+\}/g)].map((entry) => entry[0]).sort();
    for (const [english, indonesian] of Object.entries(idMessages)) {
      expect(indonesian.trim()).not.toBe('');
      expect(tokens(indonesian), english).toEqual(tokens(english));
    }
    expect(translate('id', 'Purchase tools for {name}', { name: 'Lamp A50' })).toBe('Bantu putuskan untuk Lamp A50');
    expect(translate('en', 'Purchase tools for {name}', { name: 'Lamp A50' })).toBe('Purchase tools for Lamp A50');
    expect(translate('id', 'Future entry' as Message)).toBe('Future entry');
  });

  it('formats the same exact minor units in Indonesian and English', () => {
    const minor = '900719925474099501';
    expect(formatPrice(minor, 'IDR', 'id-ID')).toMatch(/,01$/);
    expect(formatPrice(minor, 'IDR', 'en-US')).toMatch(/\.01$/);
    for (const locale of ['id-ID', 'en-US']) expect(formatPrice(minor, 'IDR', locale).replace(/\D/g, '')).toBe(minor);
  });

  it('localizes current and historical methodology while preserving version and citations', () => {
    for (const module of intelligenceModules) {
      for (const version of [undefined, '1.0.0']) {
        const original = getMethodology(module, version)!;
        const translated = localizedMethodology(module, original, 'id');
        expect(localizedMethodology(module, original, 'en')).toBe(original);
        expect(translated).toMatchObject({
          version: original.version, updated: original.updated, references: original.references,
        });
        for (const field of ['title', 'purpose', 'concepts', 'inputs', 'limitations'] as const) {
          expect(translated[field], `${module}/${field}`).not.toBe(original[field]);
        }
        expect(translated.rules).toHaveLength(original.rules.length);
        expect(translated.rules.every((rule, index) => rule !== original.rules[index])).toBe(true);
      }
    }
  });
});

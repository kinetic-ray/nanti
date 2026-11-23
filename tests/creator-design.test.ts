import { describe, expect, it } from 'vitest';
import { applyColorPreset, applyLayoutPreset, defaultDesign, layoutRecipes, presets, validateDesign } from '../shared/creator-design.js';

describe('creator design version 2', () => {
  it('migrates a saved version-1 design without losing its custom values', () => {
    const migrated = validateDesign({
      theme: 'gallery', layoutPersonality: 'brutalist', accent: '#123456', background: '#fefefe',
      foreground: '#101010', heroLayout: 'compact', cardStyle: 'bordered', imageRatio: 'square',
      columns: 4, radius: 7, headingFont: 'mono', showPrices: false, showCategories: true,
      sections: ['products', 'profile', 'products', 'unknown'],
    });

    expect(migrated).toMatchObject({
      version: 2, colorPreset: 'gallery', theme: 'gallery', layoutPreset: 'bold', layoutPersonality: 'brutalist',
      accent: '#123456', background: '#fefefe', foreground: '#101010', heroLayout: 'compact',
      cardStyle: 'bordered', imageRatio: 'square', columns: 4, radius: 7, headingFont: 'mono',
      showPrices: false, showCategories: true, sections: ['products', 'profile'],
    });
  });

  it('uses safe defaults for malformed saved data', () => {
    expect(validateDesign(null)).toEqual(defaultDesign);
    expect(validateDesign({ version: 99, layoutPreset: 'unknown', accent: 'url(javascript:alert(1))', sections: [] }))
      .toEqual(defaultDesign);
  });

  it('defines six layout recipes with distinct compositions', () => {
    expect(Object.keys(layoutRecipes)).toEqual(['simple', 'bold', 'elegant', 'dynamic', 'magazine', 'playful']);
    expect(new Set(Object.values(layoutRecipes).map(recipe => JSON.stringify(recipe))).size).toBe(6);
    expect(validateDesign({ colorPreset: 'utility', layoutPreset: 'playful' })).toMatchObject({
      theme: 'utility', colorPreset: 'utility', layoutPreset: 'playful', cardStyle: 'solid', radius: 28,
    });
  });

  it('keeps existing advanced overrides when requested and applies recipe values on reset', () => {
    const custom = { ...presets.editorial, columns: 4 as const, cardStyle: 'bordered' as const, radius: 7 };
    expect(applyLayoutPreset(custom, 'playful', true)).toMatchObject({
      layoutPreset: 'playful', columns: 4, cardStyle: 'bordered', radius: 7,
    });
    expect(applyLayoutPreset(custom, 'playful', false)).toMatchObject({
      layoutPreset: 'playful', columns: 2, cardStyle: 'solid', radius: 28,
    });
    expect(applyLayoutPreset(presets.editorial, 'bold', true)).toMatchObject({
      layoutPreset: 'bold', columns: 2, cardStyle: 'bordered', radius: 0, headingFont: 'sans',
    });
  });

  it('separates color changes from layout and supports preserving custom colors', () => {
    const custom = { ...presets.editorial, accent: '#123456', columns: 4 as const };
    expect(applyColorPreset(custom, 'gallery', true)).toMatchObject({
      colorPreset: 'gallery', theme: 'gallery', accent: '#123456', background: presets.gallery.background,
      foreground: presets.gallery.foreground, columns: 4, layoutPreset: 'magazine',
    });
    expect(applyColorPreset(presets.editorial, 'gallery', true)).toMatchObject({
      colorPreset: 'gallery', accent: presets.gallery.accent, background: presets.gallery.background,
    });
    expect(applyColorPreset(custom, 'gallery', false)).toMatchObject({
      colorPreset: 'gallery', theme: 'gallery', accent: presets.gallery.accent, columns: 4, layoutPreset: 'magazine',
    });
  });
});

export type CreatorTheme = 'editorial' | 'utility' | 'gallery';
export type LayoutPreset = 'simple' | 'bold' | 'elegant' | 'dynamic' | 'magazine' | 'playful';
/** Kept in saved drafts so designs created before version 2 still round-trip safely. */
export type LayoutPersonality = 'minimalist' | 'editorial' | 'brutalist' | 'gallery';
export type HeroLayout = 'split' | 'center' | 'compact';
export type CardStyle = 'minimal' | 'bordered' | 'solid';
export type ImageRatio = 'square' | 'portrait' | 'landscape';
export type CreatorSection = 'profile' | 'hero' | 'collections' | 'products';

export type CreatorDesign = {
  version: 2;
  /** Canonical palette choice. `theme` is retained as a compatibility alias. */
  colorPreset: CreatorTheme;
  theme: CreatorTheme;
  layoutPreset: LayoutPreset;
  /** Compatibility field for saved version-1 designs. */
  layoutPersonality: LayoutPersonality;
  accent: string;
  background: string;
  foreground: string;
  heroLayout: HeroLayout;
  cardStyle: CardStyle;
  imageRatio: ImageRatio;
  columns: 2 | 3 | 4;
  radius: number;
  headingFont: 'sans' | 'serif' | 'mono';
  showPrices: boolean;
  showCategories: boolean;
  sections: CreatorSection[];
};

type LayoutRecipe = Pick<CreatorDesign,
  'layoutPersonality' | 'heroLayout' | 'cardStyle' | 'imageRatio' | 'columns' | 'radius' |
  'headingFont' | 'showPrices' | 'showCategories'>;

export const layoutRecipes: Record<LayoutPreset, LayoutRecipe> = {
  simple: { layoutPersonality: 'minimalist', heroLayout: 'center', cardStyle: 'minimal', imageRatio: 'square', columns: 3, radius: 16, headingFont: 'sans', showPrices: true, showCategories: true },
  bold: { layoutPersonality: 'brutalist', heroLayout: 'compact', cardStyle: 'bordered', imageRatio: 'square', columns: 2, radius: 0, headingFont: 'sans', showPrices: true, showCategories: true },
  elegant: { layoutPersonality: 'gallery', heroLayout: 'center', cardStyle: 'minimal', imageRatio: 'portrait', columns: 2, radius: 22, headingFont: 'serif', showPrices: true, showCategories: false },
  dynamic: { layoutPersonality: 'gallery', heroLayout: 'split', cardStyle: 'solid', imageRatio: 'landscape', columns: 3, radius: 14, headingFont: 'sans', showPrices: true, showCategories: true },
  magazine: { layoutPersonality: 'editorial', heroLayout: 'split', cardStyle: 'minimal', imageRatio: 'portrait', columns: 3, radius: 18, headingFont: 'serif', showPrices: true, showCategories: true },
  playful: { layoutPersonality: 'minimalist', heroLayout: 'center', cardStyle: 'solid', imageRatio: 'square', columns: 2, radius: 28, headingFont: 'sans', showPrices: true, showCategories: true },
};

export const presets: Record<CreatorTheme, CreatorDesign> = {
  editorial: { version: 2, colorPreset: 'editorial', theme: 'editorial', layoutPreset: 'magazine', ...layoutRecipes.magazine, accent: '#b24f80', background: '#fff9fb', foreground: '#30202c', sections: ['profile', 'hero', 'collections', 'products'] },
  utility: { version: 2, colorPreset: 'utility', theme: 'utility', layoutPreset: 'bold', ...layoutRecipes.bold, accent: '#a9b8cb', background: '#171b20', foreground: '#f1f2f3', sections: ['profile', 'hero', 'collections', 'products'] },
  gallery: { version: 2, colorPreset: 'gallery', theme: 'gallery', layoutPreset: 'elegant', ...layoutRecipes.elegant, accent: '#75644d', background: '#f4f0e8', foreground: '#2c2925', sections: ['profile', 'hero', 'collections', 'products'] },
};

export const defaultDesign: CreatorDesign = presets.editorial;

const legacyLayouts: Record<LayoutPersonality, LayoutPreset> = {
  minimalist: 'simple', editorial: 'magazine', brutalist: 'bold', gallery: 'elegant',
};
const validSections: CreatorSection[] = ['profile', 'hero', 'collections', 'products'];

/** Accepts version-1 saved drafts and returns one canonical version-2 design. */
export function validateDesign(value: unknown): CreatorDesign {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultDesign;
  const v = value as Partial<CreatorDesign> & { version?: unknown; colorPreset?: unknown; layoutPreset?: unknown };
  const pick = <T extends string>(candidate: unknown, options: readonly T[], fallback: T): T =>
    typeof candidate === 'string' && options.includes(candidate as T) ? candidate as T : fallback;
  const colorPreset = pick(v.colorPreset ?? v.theme, ['editorial', 'utility', 'gallery'], 'editorial');
  const base = presets[colorPreset];
  const layoutPreset = pick(v.layoutPreset, ['simple', 'bold', 'elegant', 'dynamic', 'magazine', 'playful'],
    legacyLayouts[pick(v.layoutPersonality, ['minimalist', 'editorial', 'brutalist', 'gallery'], base.layoutPersonality)]);
  const recipe = layoutRecipes[layoutPreset];
  const validColor = (color: unknown, fallback: string) => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/u.test(color) ? color : fallback;
  const sections: CreatorSection[] = Array.isArray(v.sections)
    ? [...new Set(v.sections.filter((section): section is CreatorSection => validSections.includes(section as CreatorSection)))]
    : base.sections;

  return {
    version: 2,
    colorPreset,
    theme: colorPreset,
    layoutPreset,
    layoutPersonality: pick(v.layoutPersonality, ['minimalist', 'editorial', 'brutalist', 'gallery'], recipe.layoutPersonality),
    accent: validColor(v.accent, base.accent),
    background: validColor(v.background, base.background),
    foreground: validColor(v.foreground, base.foreground),
    heroLayout: pick(v.heroLayout, ['split', 'center', 'compact'], recipe.heroLayout),
    cardStyle: pick(v.cardStyle, ['minimal', 'bordered', 'solid'], recipe.cardStyle),
    imageRatio: pick(v.imageRatio, ['square', 'portrait', 'landscape'], recipe.imageRatio),
    columns: v.columns === 2 || v.columns === 3 || v.columns === 4 ? v.columns : recipe.columns,
    radius: typeof v.radius === 'number' && Number.isFinite(v.radius) ? Math.min(32, Math.max(0, v.radius)) : recipe.radius,
    headingFont: pick(v.headingFont, ['sans', 'serif', 'mono'], recipe.headingFont),
    showPrices: typeof v.showPrices === 'boolean' ? v.showPrices : recipe.showPrices,
    showCategories: typeof v.showCategories === 'boolean' ? v.showCategories : recipe.showCategories,
    sections: sections.length ? sections : base.sections,
  };
}

export function applyLayoutPreset(current: CreatorDesign, preset: LayoutPreset, preserveCustomizations: boolean): CreatorDesign {
  const previousRecipe = layoutRecipes[current.layoutPreset];
  const overrides = preserveCustomizations
    ? Object.fromEntries(Object.keys(previousRecipe)
      .filter(key => current[key as keyof CreatorDesign] !== previousRecipe[key as keyof typeof previousRecipe])
      .map(key => [key, current[key as keyof CreatorDesign]]))
    : {};
  return validateDesign({
    ...current,
    ...layoutRecipes[preset],
    ...overrides,
    layoutPreset: preset,
  });
}

export function applyColorPreset(current: CreatorDesign, preset: CreatorTheme, preserveCustomColors: boolean): CreatorDesign {
  const palette = presets[preset];
  const previousPalette = presets[current.colorPreset];
  const customColors = preserveCustomColors ? {
    ...(current.accent !== previousPalette.accent ? { accent: current.accent } : {}),
    ...(current.background !== previousPalette.background ? { background: current.background } : {}),
    ...(current.foreground !== previousPalette.foreground ? { foreground: current.foreground } : {}),
  } : {};
  return validateDesign({
    ...current,
    colorPreset: preset,
    theme: preset,
    accent: palette.accent,
    background: palette.background,
    foreground: palette.foreground,
    ...customColors,
  });
}

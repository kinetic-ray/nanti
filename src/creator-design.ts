export type CreatorTheme = 'editorial' | 'utility' | 'gallery';
export type HeroLayout = 'split' | 'center' | 'compact';
export type CardStyle = 'minimal' | 'bordered' | 'solid';
export type ImageRatio = 'square' | 'portrait' | 'landscape';
export type CreatorSection = 'profile' | 'hero' | 'collections' | 'products';
export type CreatorDesign = {
  theme: CreatorTheme;
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
export const presets: Record<CreatorTheme, CreatorDesign> = {
  editorial: { theme:'editorial', accent:'#b24f80', background:'#fff9fb', foreground:'#30202c', heroLayout:'split', cardStyle:'minimal', imageRatio:'portrait', columns:3, radius:18, headingFont:'serif', showPrices:true, showCategories:true, sections:['profile','hero','collections','products'] },
  utility: { theme:'utility', accent:'#a9b8cb', background:'#171b20', foreground:'#f1f2f3', heroLayout:'compact', cardStyle:'bordered', imageRatio:'square', columns:4, radius:3, headingFont:'mono', showPrices:true, showCategories:true, sections:['profile','hero','collections','products'] },
  gallery: { theme:'gallery', accent:'#75644d', background:'#f4f0e8', foreground:'#2c2925', heroLayout:'center', cardStyle:'solid', imageRatio:'landscape', columns:2, radius:0, headingFont:'sans', showPrices:false, showCategories:false, sections:['profile','hero','collections','products'] },
};
export const defaultDesign: CreatorDesign = presets.editorial;
export function validateDesign(value: unknown): CreatorDesign {
  if (!value || typeof value !== 'object') return defaultDesign;
  const v = value as Partial<CreatorDesign>;
  const theme: CreatorTheme = v.theme === 'utility' || v.theme === 'gallery' ? v.theme : 'editorial';
  const base = presets[theme];
  const pick = <T extends string>(candidate: unknown, options: readonly T[], fallback: T): T =>
    typeof candidate === 'string' && options.includes(candidate as T) ? candidate as T : fallback;
  const validColor = (color: unknown, fallback: string) => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
  const sections: CreatorSection[] = Array.isArray(v.sections)
    ? [...new Set(v.sections.filter((s): s is CreatorSection => ['profile','hero','collections','products'].includes(String(s))))] : base.sections;
  return {
    theme, accent:validColor(v.accent,base.accent), background:validColor(v.background,base.background), foreground:validColor(v.foreground,base.foreground),
    heroLayout:pick(v.heroLayout,['split','center','compact'],base.heroLayout),
    cardStyle:pick(v.cardStyle,['minimal','bordered','solid'],base.cardStyle),
    imageRatio:pick(v.imageRatio,['square','portrait','landscape'],base.imageRatio),
    columns:v.columns===2||v.columns===3||v.columns===4?v.columns:base.columns,
    radius:typeof v.radius==='number'&&Number.isFinite(v.radius)?Math.min(32,Math.max(0,v.radius)):base.radius,
    headingFont:pick(v.headingFont,['sans','serif','mono'],base.headingFont),
    showPrices:typeof v.showPrices==='boolean'?v.showPrices:base.showPrices,
    showCategories:typeof v.showCategories==='boolean'?v.showCategories:base.showCategories,
    sections:sections.length?sections:base.sections
  };
}

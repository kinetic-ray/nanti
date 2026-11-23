import { createRoot } from 'react-dom/client';
import { CreatorDesignStudio } from '../../src/creator-studio.js';
import { LanguagePicker, LocaleProvider } from '../../src/locale.js';
import '../../src/admin-workspace.css';
import '../../src/creator-workspace.css';

const legacyDraft = {
  theme: 'gallery', layoutPersonality: 'gallery', accent: '#123456', background: '#fefefe', foreground: '#101010',
  heroLayout: 'compact', cardStyle: 'bordered', imageRatio: 'square', columns: 4, radius: 7, headingFont: 'mono',
  showPrices: false, showCategories: true, sections: ['profile', 'hero', 'collections', 'products'],
};
const catalog = {
  name: 'Studio Sore',
  products: [{ id: 'fixture-product', title: 'Tas kanvas pilihan', url: 'https://example.com/tote', description: 'Produk contoh untuk pratinjau.',
    category: 'Gaya hidup', color: 'Natural', productType: 'Tote', priceMinor: 39900000, currency: 'IDR' as const, image: null }],
};

createRoot(document.getElementById('root')!).render(<LocaleProvider><main className="aw creator-workspace">
  <header className="aw-topbar"><strong>Fixture</strong><LanguagePicker /></header>
  <CreatorDesignStudio ownerId="fixture-owner" draft={legacyDraft} catalog={catalog} onSaved={() => undefined} />
</main></LocaleProvider>);

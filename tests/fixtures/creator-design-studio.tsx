import { createRoot } from 'react-dom/client';
import { CreatorDesignStudio } from '../../src/creator-studio.js';
import { demoProducts } from '../../src/creator-storefront.js';
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
  products: demoProducts.map((product, index) => ({
    id: String(product.id), title: product.title, url: 'https://example.com/product-' + product.id,
    description: 'Produk pilihan untuk pratinjau etalase.',
    category: ['Daily essentials', 'Desk setup', 'Style picks'][index % 3]!,
    color: ['Natural', 'Warm white', 'Rose'][index % 3]!,
    productType: ['Tote', 'Desk accessory', 'Everyday wear'][index % 3]!,
    priceMinor: [14900000, 28900000, 39900000, 32900000, 11900000, 21900000][index]!,
    currency: 'IDR' as const, image: product.photo,
  })),
};

createRoot(document.getElementById('root')!).render(<LocaleProvider><main className="aw creator-workspace">
  <header className="aw-topbar"><strong>Fixture</strong><LanguagePicker /></header>
  <CreatorDesignStudio ownerId="fixture-owner" draft={legacyDraft} catalog={catalog} onSaved={() => undefined} />
</main></LocaleProvider>);

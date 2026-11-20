import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { defaultDesign } from './creator-design.js';
import type { CreatorDesign, CreatorSection } from './creator-design.js';
import { useLocale, LanguagePicker } from './locale.js';
import './creator-storefront.css';
import './creator-design.css';

const collections = [
  { id: 'daily', name: 'Daily essentials', description: 'Little things I reach for every day.', symbol: '✳', tone: 'lilac' },
  { id: 'desk', name: 'Desk setup', description: 'A calmer, more comfortable workspace.', symbol: '◒', tone: 'sage' },
  { id: 'style', name: 'Style picks', description: 'Simple pieces with plenty of character.', symbol: '✦', tone: 'peach' },
] as const;
type CollectionId = typeof collections[number]['id'];
const products: { id: number; collection: CollectionId; title: string; price: string; symbol: string; tone: string }[] = [
  { id: 1, collection: 'daily', title: 'Everyday tote bag', price: 'Rp 149.000', symbol: '▤', tone: 'lilac' },
  { id: 2, collection: 'desk', title: 'Minimal desk lamp', price: 'Rp 289.000', symbol: '◉', tone: 'sage' },
  { id: 3, collection: 'style', title: 'Classic canvas sneakers', price: 'Rp 399.000', symbol: '✦', tone: 'peach' },
  { id: 4, collection: 'desk', title: 'Wireless keyboard', price: 'Rp 329.000', symbol: '▦', tone: 'lilac' },
  { id: 5, collection: 'daily', title: 'Reusable water bottle', price: 'Rp 119.000', symbol: '◈', tone: 'sage' },
  { id: 6, collection: 'style', title: 'Relaxed cotton shirt', price: 'Rp 219.000', symbol: '✳', tone: 'peach' },
];
export function CreatorStorefront({ design = defaultDesign, embedded = false }: { design?: CreatorDesign; embedded?: boolean }) {
  const { language } = useLocale();
  const id = language === 'id';
  const [active, setActive] = useState<CollectionId | 'all'>('all');
  const [search, setSearch] = useState('');
  const [compactSearch, setCompactSearch] = useState(false);
  const searchRef = useRef<HTMLElement>(null);
  const searchSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = searchSentinelRef.current;
    if (!sentinel) return;
    const preview = embedded ? sentinel.closest('.studio-preview-frame') : null;
    const root = preview ?? null;
    const onScroll = () => {
      const rootTop = root ? root.getBoundingClientRect().top + root.clientTop : 0;
      const crossedBoundary = sentinel.getBoundingClientRect().top < rootTop + 8;
      // In the editor the viewport is independently scrollable; preserve compact
      // mode across design changes, including when the search changes height.
      const previewScrolled = root ? root.scrollTop > 24 : window.scrollY > 24;
      setCompactSearch(crossedBoundary && previewScrolled);
    };
    const scrollTarget: Element | Window = root ?? window;
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const observer = new ResizeObserver(onScroll);
    observer.observe(sentinel);
    if (root) observer.observe(root);
    onScroll();
    return () => {
      scrollTarget.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      observer.disconnect();
    };
  }, [embedded, design]);
  const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
  const activeCollection = collections.find(item => item.id === active);
  const normalized = (value: string) => value.toLocaleLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, ' ').trim();
  const query = normalized(search);
  const collectionMatch = collections.find((collection, index) => query === normalized(collection.name) || query === normalized('etalase ' + (index + 1)) || query === normalized('showcase ' + (index + 1)));
  const visible = products.filter(item => {
    if (query) {
      const collection = collections.find(entry => entry.id === item.collection);
      const collectionNumber = collections.findIndex(entry => entry.id === item.collection) + 1;
      const searchable = [item.title, 'PRD-' + String(item.id).padStart(3, '0'), 'produk ' + item.id, 'product ' + item.id, collection?.name ?? '', 'etalase ' + collectionNumber, 'showcase ' + collectionNumber].map(normalized);
      return collectionMatch ? item.collection === collectionMatch.id : searchable.some(value => value.includes(query));
    }
    return active === 'all' || item.collection === active;
  });
  const selected = products.find(item => item.id === selectedProduct);
  const sections = design.sections;
  const has = (section: CreatorSection) => sections.includes(section);
  const headingFamily = design.headingFont === "serif" ? "Georgia, serif" : design.headingFont === "mono" ? "ui-monospace, monospace" : "inherit";
  const style = { "--sf-accent": design.accent, "--sf-ink": design.foreground, "--sf-page": design.background, "--sf-radius": `${design.radius}px`, "--sf-heading-font": headingFamily, "--sf-columns": design.columns, "--sf-ratio": design.imageRatio === "portrait" ? "4/5" : design.imageRatio === "landscape" ? "4/3" : "1/1" } as CSSProperties;
  return <div className={`storefront storefront-theme-${design.theme} storefront-hero-${design.heroLayout} storefront-card-${design.cardStyle} ${embedded ? "storefront-embedded" : ""}`} style={style}>
    {!embedded && <header className="storefront-header">
      <a href="/creator" className="storefront-brand" aria-label="Nanti Kreator">nanti<span>.</span><small>kreator</small></a>
      <span className="storefront-header-label">{id ? 'Contoh halaman kreator' : 'Creator page preview'}</span>
      <div className="storefront-header-actions"><LanguagePicker /><a href="/creator">{id ? 'Kembali' : 'Back'} ↗</a></div>
    </header>}
    <main className="storefront-main">
      <div className="storefront-demo-notice" style={{order:-2}} role="status">{id ? 'DEMO · Profil, produk, dan harga di halaman ini hanya contoh. Belum ada tautan pembelian.' : 'DEMO · This profile, products, and prices are examples. Purchase links are not available.'}</div>
      <div ref={searchSentinelRef} className="storefront-search-sentinel" style={{order:0}} aria-hidden="true" />
      <section ref={searchRef} className={`storefront-search ${compactSearch ? "storefront-search-compact" : ""}`} style={{order:0}} role="search" aria-label={id ? 'Cari produk dan etalase' : 'Search products and collections'}>
        <label htmlFor={embedded ? 'creator-preview-search' : 'creator-storefront-search'}>{id ? 'Cari dari kode di Instagram' : 'Find it from an Instagram post'}</label>
        <div className="storefront-search-control"><span aria-hidden="true">⌕</span><input id={embedded ? 'creator-preview-search' : 'creator-storefront-search'} type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder={id ? 'Kode PRD-003, Etalase 3, atau nama koleksi' : 'Code PRD-003, Showcase 3, or collection name'} autoComplete="off" />{search && <button type="button" onClick={()=>{setSearch('');setActive('all');}} aria-label={id?'Hapus pencarian':'Clear search'}>×</button>}</div>
        <p aria-live="polite">{query ? (id ? `${visible.length} produk ditemukan` : `${visible.length} products found`) : (id ? 'Coba: PRD-003 · Etalase 3 · Desk setup' : 'Try: PRD-003 · Showcase 3 · Desk setup')}</p>
      </section>
      {has("profile") && <section className="storefront-profile" style={{order:sections.indexOf("profile") + 1}}>
        <div className="storefront-avatar" aria-hidden="true">S.</div>
        <div className="storefront-profile-copy"><h1>Studio Sore </h1><p className="storefront-handle">@studiosore · Jakarta</p><p>{id ? 'Hai, aku Sore! Di sini aku kumpulin barang-barang yang sering kalian tanyain. Tinggal cari koleksinya atau pakai kode dari caption, ya.' : "Hey, I'm Sore! Here's everything you keep asking me about. Search a collection or use the code from my captions."}</p><div className="storefront-profile-meta"><span><strong>{collections.length}</strong> {id ? 'koleksi' : 'collections'}</span><span><strong>{products.length}</strong> {id ? 'produk' : 'products'}</span></div></div>
      </section>}
      {has("hero") && <section className="storefront-featured" style={{order:sections.indexOf("hero") + 1}} aria-labelledby="storefront-featured-title"><div><span className="storefront-kicker">{id ? 'PILIHAN MINGGU INI' : 'THIS WEEK’S EDIT'}</span><h2 id="storefront-featured-title">{id ? 'Favorit kecil, dampak besar.' : 'Small favorites, big difference.'}</h2><p>{id ? 'Mulai dari meja kerja sampai gaya sehari-hari. Semua pilihan ada di sini.' : 'From your desk to your everyday style. Find everything in one place.'}</p><a href="#storefront-products">{id ? 'Jelajahi pilihan' : 'Explore picks'} ↗</a></div><div className="storefront-featured-art" aria-hidden="true"><span>✳</span><span>◒</span><span>✦</span></div></section>}
      {has("collections") && <section className="storefront-collections" style={{order:sections.indexOf("collections") + 1}} aria-labelledby="storefront-collections-title"><div className="storefront-section-heading"><div><span className="storefront-kicker">01 / {id ? 'KOLEKSI' : 'COLLECTIONS'}</span><h2 id="storefront-collections-title">{id ? 'Jelajahi koleksi' : 'Browse collections'}</h2></div><span>{collections.length} {id ? 'koleksi' : 'collections'}</span></div><div className="storefront-collection-grid">{collections.map(collection => <button type="button" key={collection.id} className={`storefront-collection-card storefront-tone-${collection.tone}`} onClick={() => { setSearch(''); setActive(collection.id); document.getElementById('storefront-products')?.scrollIntoView({ behavior: 'smooth' }); }}><span className="storefront-collection-symbol" aria-hidden="true">{collection.symbol}</span><span className="storefront-collection-title">{collection.name}</span><span className="storefront-collection-count">{products.filter(product => product.collection === collection.id).length} {id ? 'produk' : 'products'} <span aria-hidden="true">↗</span></span></button>)}</div></section>}
      {has("products") && <section id="storefront-products" className="storefront-products" style={{order:sections.indexOf("products") + 1}} aria-labelledby="storefront-products-title"><div className="storefront-section-heading"><div><span className="storefront-kicker">02 / {id ? 'ETALASE' : 'THE EDIT'}</span><h2 id="storefront-products-title">{query ? (id ? 'Hasil pencarian' : 'Search results') : activeCollection?.name ?? (id ? 'Semua pilihan' : 'All picks')}</h2><p>{activeCollection?.description ?? (id ? 'Produk yang dipilih untuk halaman contoh ini.' : 'Products curated for this sample page.')}</p></div><span>{visible.length} {id ? 'produk' : 'products'}</span></div><div className="storefront-filters" role="group" aria-label={id ? 'Filter koleksi' : 'Filter collections'}><button type="button" aria-pressed={active === 'all'} onClick={() => {setSearch('');setActive('all');}}>{id ? 'Semua' : 'All'}</button>{collections.map(collection => <button key={collection.id} type="button" aria-pressed={active === collection.id} onClick={() => {setSearch('');setActive(collection.id);}}>{collection.name}</button>)}</div><div className="storefront-product-grid">{visible.map(product => <article className="storefront-product" key={product.id}><div className={`storefront-product-art storefront-tone-${product.tone}`} aria-hidden="true">{product.symbol}</div><div className="storefront-product-copy">{design.showCategories && <span className="storefront-product-category">{collections.find(collection => collection.id === product.collection)?.name}</span>}<h3>{product.title}</h3><span className="storefront-product-code">PRD-{String(product.id).padStart(3,'0')}</span>{design.showPrices && <strong>{product.price}</strong>}<button type="button" onClick={() => setSelectedProduct(product.id)}>{id ? 'Lihat produk' : 'View product'} <span aria-hidden="true">↗</span></button></div></article>)}</div>{visible.length===0 && <p className="storefront-empty" role="status">{id ? 'Tidak ada produk yang cocok. Coba kode atau nama koleksi lain.' : 'No matching products. Try another code or collection name.'}</p>}</section>}
      {!embedded && <section className="storefront-outro" style={{order:99}}><span className="storefront-kicker">{id ? 'DIBUAT DENGAN NANTI' : 'MADE WITH NANTI'}</span><h2>{id ? 'Semua rekomendasi, satu tempat.' : 'Every recommendation, one place.'}</h2><p>{id ? 'Ini contoh etalase kreator. Fitur publikasi dan afiliasi masih dalam pengembangan.' : 'This is a sample storefront. Publishing and affiliate features are still in development.'}</p><a href="/creator">{id ? 'Tentang Nanti Kreator' : 'About Nanti Creator'} ↗</a></section>}
    </main>
    {!embedded && <footer className="storefront-footer"><span>nanti<span>.</span> kreator</span><span>{id ? 'Pratinjau konsep · Bukan toko aktif' : 'Concept preview · Not a live shop'}</span></footer>}
    {selected && <div className="storefront-modal-backdrop" onClick={() => setSelectedProduct(null)}><section className="storefront-modal" role="dialog" aria-modal="true" aria-labelledby="storefront-modal-title" onClick={event => event.stopPropagation()}><button className="storefront-modal-close" type="button" aria-label={id ? 'Tutup' : 'Close'} onClick={() => setSelectedProduct(null)}>×</button><div className={`storefront-modal-art storefront-tone-${selected.tone}`} aria-hidden="true">{selected.symbol}</div><span className="storefront-kicker">{id ? 'PRODUK CONTOH' : 'SAMPLE PRODUCT'}</span><h2 id="storefront-modal-title">{selected.title}</h2><strong>{selected.price}</strong><p>{id ? 'Ini hanya contoh tampilan detail produk. Tautan marketplace akan tersedia setelah fitur kreator diluncurkan.' : 'This is a sample product detail. Marketplace links will be available after creator features launch.'}</p><button className="storefront-modal-dismiss" type="button" onClick={() => setSelectedProduct(null)}>{id ? 'Kembali ke etalase' : 'Back to storefront'}</button></section></div>}
  </div>;
}
